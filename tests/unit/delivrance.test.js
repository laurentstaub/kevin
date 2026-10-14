import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT } from '../../src/config.js';
import {
  classer, presenter, pourcentage, getRemboursement, getDelivrance, chargerComplements,
  delivranceIndisponible, remboursementIndisponible,
} from '../../src/delivrance.js';

/** Les libellés sont ceux de dbpm.cis_cpd_bdpm, recopiés tels quels. */
const MORPHINE = [
  'liste I',
  'stupéfiants',
  'prescription en toutes lettres sur ordonnance sécurisée',
  'prescription limitée à 28 jours',
  'délivrance fractionnée de 7 jours',
];

const courts = (classement) => classement.resume.map((mention) => mention.court);

/** Le libellé d'origine, tel que la vue le garde en infobulle. */
const bruts = (groupe) => groupe.conditions.map((condition) => condition.brut);

describe('classer', () => {
  // Mentions abrégées pour tenir sur une ligne ; ce qui conditionne la délivrance avant les modalités.
  it('rend la réponse du comptoir en mentions courtes, la plus lourde d’abord', () => {
    assert.deepEqual(courts(classer(MORPHINE)), [
      'Ordo sécurisée',
      '28 j max',
      'Fractionné 7 j',
      'Stupéfiant',
      'Liste I',
    ]);
  });

  it('garde le libellé entier derrière chaque abréviation', () => {
    const par = (court) => classer(MORPHINE).resume.find((mention) => mention.court === court);
    assert.equal(par('Ordo sécurisée').long, 'Ordonnance sécurisée');
    assert.equal(par('28 j max').long, 'Prescription limitée à 28 jours');
    assert.equal(par('Liste I').long, 'Liste I', 'rien à développer, long = court');
  });

  it('abrège l’unité sans la traduire', () => {
    const unite = (libelle) => classer([libelle]).resume[0].court;
    assert.equal(unite('prescription limitée à 4 semaines'), '4 sem. max');
    assert.equal(unite('prescription limitée à 12 mois'), '12 mois max');
    assert.equal(unite('prescription limitée à 28 jours'), '28 j max');
  });

  it('porte l’axe de chaque mention, pour que la vue sache la détacher', () => {
    const classement = classer(MORPHINE).resume.filter((mention) => mention.cle === 'classement');
    assert.deepEqual(classement.map((mention) => mention.court), ['Stupéfiant', 'Liste I']);
  });

  it('suit l’ordre de la portée, pas celui de la base', () => {
    // La requête trie par libellé : ordre d'arrivée arbitraire.
    const desordre = classer([...MORPHINE].sort());
    assert.deepEqual(courts(desordre), courts(classer(MORPHINE)));
  });

  it('range chaque condition sous son axe', () => {
    const groupes = classer(MORPHINE).groupes;
    const par = (cle) => groupes.find((groupe) => groupe.cle === cle);

    assert.deepEqual(bruts(par('classement')), ['liste I', 'stupéfiants']);
    assert.equal(par('duree').conditions.length, 1);
    assert.equal(par('fractionnement').titre, 'Fractionnement');
  });

  // ---- Ce qui empêche de délivrer ----------------------------------------

  // « réservé à l'usage professionnel DENTAIRE » n'est pas un usage hospitalier.
  it('ne confond pas l’usage hospitalier et l’usage professionnel', () => {
    assert.deepEqual(courts(classer(["réservé à l'usage HOSPITALIER"])), ['Hôpital seulement']);
    assert.deepEqual(courts(classer(["réservé à l'usage professionnel DENTAIRE"])), ['Usage professionnel']);
  });

  // BUVIDAL : usage professionnel et délivrance en pharmacie de ville.
  it('l’usage professionnel se vérifie, il n’interdit pas l’officine', () => {
    const delivrance = classer([
      "réservé à l'usage professionnel", 'délivrance effectuée par une pharmacie de ville', 'stupéfiants',
    ]);
    assert.equal(delivrance.resume.find((mention) => mention.court === 'Usage professionnel').portee, 'verifier');
    assert.equal(delivrance.bloque, false);
  });

  it('signale d’un seul drapeau ce qui ne sort pas de l’hôpital', () => {
    assert.equal(classer(["réservé à l'usage HOSPITALIER"]).bloque, true);
    assert.equal(classer(['liste I']).bloque, false);
  });

  // Prescrite à l'hôpital, délivrée en ville.
  it('ne bloque pas sur une prescription hospitalière', () => {
    const classement = classer(['prescription hospitalière']);
    assert.equal(classement.bloque, false);
    assert.deepEqual(courts(classement), ['Prescr. hosp.']);
  });

  it('remonte ce qui est à vérifier avant de délivrer', () => {
    const classement = classer([
      "prescription nécessitant la signature annuelle par le médecin et la patiente d'une attestation d'information",
      'prescription nécessitant la remise d’un carnet patient',
      'délivrance après vérification du recueil de l’accord de soins',
    ]);
    assert.deepEqual(courts(classement), ['Attestation', 'Accord de soins', 'Carnet patient']);
  });

  it('reconnaît la spécialité requise quelle qu’en soit la formule', () => {
    const forme = (libelle) => courts(classer([libelle]));
    assert.deepEqual(forme('prescription réservée aux spécialistes et services ONCOLOGIE MEDICALE'), ['Spécialiste']);
    assert.deepEqual(forme('prescription réservée aux médecins compétents en CANCEROLOGIE'), ['Spécialiste']);
    assert.deepEqual(forme('prescription initiale réservée à certains spécialistes'), ['Spécialiste']);
  });

  it('reprend la durée telle qu’elle est écrite', () => {
    assert.deepEqual(classer(['prescription limitée à 12 semaines']).resume[0].long,
      'Prescription limitée à 12 semaines');
  });

  // Ne doit pas ressembler à une lecture échouée.
  it('rend un classement vide sans condition', () => {
    for (const rien of [[], null, undefined, ['', '   ']]) {
      const classement = classer(rien);
      assert.deepEqual(classement.resume, [], String(rien));
      assert.deepEqual(classement.groupes, []);
      assert.deepEqual(classement.liens, []);
    }
  });

  it('dédoublonne les libellés répétés', () => {
    const classement = classer(['liste I', 'liste I']);
    assert.deepEqual(bruts(classement.groupes[0]), ['liste I']);
    assert.deepEqual(courts(classement), ['Liste I']);
  });
});

describe('conditions non reconnues', () => {
  // Donnée réglementaire : mieux vaut l'afficher brute que la perdre sans le dire.
  it('sortent verbatim plutôt que d’être perdues', () => {
    const classement = classer(['condition inédite de la BDPM 2027']);
    const autres = classement.groupes.find((groupe) => groupe.cle === 'autres');

    assert.equal(autres.titre, 'Autres conditions');
    assert.deepEqual(bruts(autres), ['condition inédite de la BDPM 2027']);
  });

  it('ne polluent pas le résumé', () => {
    assert.deepEqual(classer(['condition inédite']).resume, []);
  });

  it('passent après les axes connus', () => {
    const cles = classer(['zzz inconnu', 'liste II']).groupes.map((groupe) => groupe.cle);
    assert.deepEqual(cles, ['classement', 'autres']);
  });
});

describe('liens Meddispar', () => {
  // Meddispar n'est pas en accès ouvert : lien vers la rubrique, sans recopie.
  it('accompagnent le classement stupéfiant', () => {
    const liens = classer(MORPHINE).liens;
    assert.equal(liens.length, 1);
    assert.match(liens[0].url, /^https:\/\/www\.meddispar\.fr\//);
    assert.match(liens[0].label, /[Ss]tup/);
  });

  it('ne sont rendus qu’une fois quand deux conditions pointent au même endroit', () => {
    const liens = classer(['stupéfiants', 'médicament assimilé stupéfiant']).liens;
    assert.equal(liens.length, 1);
  });

  it('couvrent la prescription restreinte', () => {
    const liens = classer([
      'prescription initiale hospitalière',
      'surveillance particulière pendant le traitement',
    ]).liens;

    assert.equal(liens.length, 2);
    for (const lien of liens) assert.match(lien.url, /\/Criteres$/);
  });

  it('restent absents quand rien ne les appelle', () => {
    assert.deepEqual(classer(['liste II']).liens, []);
  });
});

describe('presenter', () => {
  const rendu = (classement) => {
    const presente = presenter(classement);
    return (presente.population ? `[${presente.population}] ` : '')
      + presente.segments.map((segment) => (segment.fort ? `**${segment.texte}**` : segment.texte)).join('');
  };

  // Le deux-points sépare population et condition ; aucun autre libellé n'en contient.
  it('détache la population de la condition', () => {
    assert.equal(
      rendu('pour adolescents de sexe masculin et hommes susceptibles de procréer : prescription initiale réservée à certains spécialistes'),
      '[Pour adolescents de sexe masculin et hommes susceptibles de procréer] Prescription initiale réservée à certains spécialistes',
    );
  });

  // La BDPM isole la discipline par des capitales.
  it('rend lisible la discipline criée', () => {
    assert.equal(
      rendu('prescription réservée aux spécialistes et services NEUROLOGIE'),
      'Prescription réservée aux spécialistes et services **Neurologie**',
    );
  });

  // Sinon « Maladies Infectieuses ET Tropicales » : trois emphases, et « ET » resté en capitales.
  it('tient une locution entière pour une seule notion', () => {
    assert.equal(
      rendu('prescription réservée aux spécialistes en MALADIES INFECTIEUSES ET TROPICALES'),
      'Prescription réservée aux spécialistes en **Maladies infectieuses et tropicales**',
    );
    assert.equal(
      rendu('prescription réservée aux spécialistes CHIRURGIE THORACIQUE et CARDIOVASCULAIRE'),
      'Prescription réservée aux spécialistes **Chirurgie thoracique** et **Cardiovasculaire**',
    );
  });

  // Liste close : trois sigles dans la base.
  it('laisse les sigles en capitales', () => {
    assert.equal(rendu('délivrance effectuée par un CSAPA'), 'Délivrance effectuée par un CSAPA');
    assert.match(rendu("prescription et délivrance subordonnées à l'obtention du résultat du dépistage d'un déficit en DPD"), /DPD$/);
  });

  it('garde le libellé d’origine intact', () => {
    const brut = 'prescription réservée aux spécialistes et services PEDIATRIE';
    assert.equal(presenter(brut).brut, brut);
  });
});

describe('pourcentage', () => {
  // node-postgres rend un numeric en chaîne.
  it('rend le taux avec son signe et sans ses décimales mortes', () => {
    assert.equal(pourcentage('30.00'), '30\u00A0%');
    assert.equal(pourcentage('65.00'), '65\u00A0%');
    assert.equal(pourcentage(100), '100\u00A0%');
  });

  // Cas réel : texte sans taux, qui ne doit pas donner « NaN\u00A0% ».
  it('ne rend rien quand le taux manque', () => {
    for (const vide of [null, undefined, '', 'non renseigné']) {
      assert.equal(pourcentage(vide), null);
    }
  });

  // Le schéma n'impose pas les seuls taux entiers de la BDPM.
  it('garde une décimale réelle, à la virgule', () => {
    assert.equal(pourcentage('62.50'), '62,50\u00A0%');
  });
});

describe('getRemboursement', () => {
  // Champ BDPM rendu en HTML : assaini comme les documents.
  it('assainit le texte des indications', async () => {
    const pool = { query: async () => ({ rows: [{
      texte: 'Indication <br>remboursée<script>alert(1)</script> <a href="javascript:x()">lien</a>', taux: '65',
    }] }) };
    const { texte, taux } = await getRemboursement(pool, '60234100');
    assert.match(texte, /<br \/>remboursée/);
    assert.doesNotMatch(texte, /script|javascript/);
    assert.equal(taux, '65\u00A0%');
  });
});

describe('ordonnance hors liste', () => {
  const courts = (libelles) => classer(libelles).resume.map((mention) => mention.court);

  // Seule mention d'une ordonnance pour Vitaros ou le vaccin Valneva : la bande disait « Sans ordonnance ».
  it('reconnaît « médicament soumis à prescription médicale » et ses variantes', () => {
    for (const libelle of [
      'médicament soumis à prescription médicale',
      'médicament soumis à prescription médicale restreinte',
      'médicament soumis à prescription médicale, en attente de notification de la Blue Box',
    ]) {
      assert.deepEqual(courts([libelle]), ['Sur ordonnance'], libelle);
    }
  });

  it('l’omet à côté d’une liste ou d’un stupéfiant, qui l’impliquent', () => {
    assert.deepEqual(courts(['liste I', 'médicament soumis à prescription médicale']), ['Liste I']);
    assert.deepEqual(courts(['stupéfiants', 'médicament soumis à prescription médicale']), ['Stupéfiant']);
    // Le libellé reste dans le détail du bloc.
    const { groupes } = classer(['liste I', 'médicament soumis à prescription médicale']);
    assert.equal(groupes.find((groupe) => groupe.cle === 'classement').conditions.length, 2);
  });

  it('le garde à côté d’une restriction de prescripteur, qui ne le dit pas', () => {
    assert.deepEqual(
      courts(['médicament soumis à prescription médicale', 'prescription réservée aux spécialistes et services DERMATOLOGIE']),
      ['Spécialiste', 'Sur ordonnance'],
    );
  });
});

describe('pannes', () => {
  it('la panne des conditions n’affirme rien sur leur portée', () => {
    const panne = delivranceIndisponible();
    assert.equal(panne.indisponible, true);
    assert.equal(panne.bloque, null);
  });

  it('la panne du remboursement se distingue de l’absence de restriction', () => {
    const panne = remboursementIndisponible();
    assert.equal(panne.indisponible, true);
    assert.ok(panne, 'jamais null : null veut dire « sans restriction »');
  });
});

describe('compléments aux lacunes de la BDPM', () => {
  const GABAPENTINE = '64446079';
  const pool = (conditions) => ({ query: async () => ({ rows: conditions.map((condition) => ({ condition })) }) });

  // GABAPENTINE TEVA SANTE : aucune condition en base, « Sans ordonnance » à l'écran.
  it('complète une spécialité que la BDPM laisse sans condition', async () => {
    const delivrance = await getDelivrance(pool([]), GABAPENTINE);
    assert.deepEqual(delivrance.resume.map((mention) => mention.court), ['Liste I']);
    assert.match(delivrance.complement.motif, /gabapentine/i);
  });

  it('la BDPM l’emporte dès qu’elle enregistre une condition', async () => {
    const delivrance = await getDelivrance(pool(['liste II']), GABAPENTINE);
    assert.deepEqual(delivrance.resume.map((mention) => mention.court), ['Liste II']);
    assert.equal(delivrance.complement, undefined);
  });

  it('ne touche pas une spécialité sans complément', async () => {
    const delivrance = await getDelivrance(pool([]), '60234100');
    assert.deepEqual(delivrance.resume, []);
    assert.equal(delivrance.complement, undefined);
  });

  it('ignore une entrée non confirmée', () => {
    const dossier = mkdtempSync(path.join(tmpdir(), 'complements-'));
    const fichier = path.join(dossier, 'complements.json');
    writeFileSync(fichier, JSON.stringify({ specialites: [
      { cis: '11111111', conditions: ['liste I'], motif: 'brouillon' },
      { cis: '22222222', conditions: ['liste I'], motif: 'relu', confirme_le: '2026-10-13' },
    ] }));
    try {
      const charges = chargerComplements(fichier);
      assert.deepEqual([...charges.keys()], ['22222222']);
    } finally {
      chargerComplements();
      rmSync(dossier, { recursive: true, force: true });
    }
  });

  it('chaque entrée du fichier versionné est confirmée, motivée et classable', () => {
    const { specialites } = JSON.parse(readFileSync(path.join(ROOT, 'data', 'conditions-complementaires.json'), 'utf8'));
    for (const entree of specialites) {
      assert.match(entree.cis, /^\d{8}$/, entree.denomination);
      assert.ok(entree.motif && entree.confirme_le, entree.cis);
      // Une condition que `classer` ne reconnaîtrait pas ne changerait rien à l'écran.
      assert.ok(classer(entree.conditions).resume.length > 0, entree.cis);
    }
  });
});

describe('hors officine', () => {
  const court = (libelle) => classer([libelle]).resume.map((mention) => `${mention.court}/${mention.portee}`);

  it('reconnaît les circuits qui excluent l’officine', () => {
    for (const libelle of [
      'délivrance réservée aux pharmacies à usage intérieur',
      'délivrance réservée aux ETS pour les malades qui y sont traités',
      'réservé aux centres de vaccination habilités à effectuer la vaccination antiamarile',
      'réservé aux centres de vaccination anti-rabique',
      "médicament réservé aux centres de vaccination désignés par l'agence régionale de santé",
      "réservé à l'usage militaire",
    ]) {
      assert.deepEqual(court(libelle), ['Hors officine/bloque'], libelle);
    }
  });

  it('laisse le CSAPA, alternative à la pharmacie de ville', () => {
    assert.deepEqual(court('délivrance effectuée par un CSAPA'), []);
  });
});
