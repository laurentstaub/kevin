import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classer, presenter } from '../../src/delivrance.js';

/** Les libellés sont ceux de dbpm.cis_cpd_bdpm, recopiés tels quels. */
const MORPHINE = [
  'liste I',
  'stupéfiants',
  'prescription en toutes lettres sur ordonnance sécurisée',
  'prescription limitée à 28 jours',
  'délivrance fractionnée de 7 jours',
];

const courts = (c) => c.resume.map((m) => m.court);

/** Le libellé d'origine, tel que la vue le garde en infobulle. */
const bruts = (groupe) => groupe.conditions.map((c) => c.brut);

describe('classer', () => {
  // Écrit en toutes lettres, le résumé occupait deux lignes dans l'en-tête du
  // bloc. Abrégé, il tient sur une : c'est la seule raison d'être des mentions.
  // Ce qui conditionne le geste d'abord, ce qui le décrit ensuite : on lit la
  // réponse avant d'en lire les modalités.
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
    const par = (court) => classer(MORPHINE).resume.find((m) => m.court === court);
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
    const classement = classer(MORPHINE).resume.filter((m) => m.cle === 'classement');
    assert.deepEqual(classement.map((m) => m.court), ['Stupéfiant', 'Liste I']);
  });

  it('suit l’ordre de la portée, pas celui de la base', () => {
    // La requête trie par libellé : l'ordre d'arrivée est arbitraire et ne doit
    // jamais transparaître dans la réponse.
    const desordre = classer([...MORPHINE].sort());
    assert.deepEqual(courts(desordre), courts(classer(MORPHINE)));
  });

  it('range chaque condition sous son axe', () => {
    const groupes = classer(MORPHINE).groupes;
    const par = (cle) => groupes.find((g) => g.cle === cle);

    assert.deepEqual(bruts(par('classement')), ['liste I', 'stupéfiants']);
    assert.equal(par('duree').conditions.length, 1);
    assert.equal(par('fractionnement').titre, 'Fractionnement');
  });

  // ---- Ce qui empêche de délivrer ----------------------------------------

  // Le motif précédent, « réservé à l'usage », attrapait « réservé à l'usage
  // professionnel DENTAIRE » et l'affichait « Usage hospitalier ». Faux, et
  // faux sur la mention la plus lourde de conséquence du bloc.
  it('ne confond pas l’usage hospitalier et l’usage professionnel', () => {
    assert.deepEqual(courts(classer(["réservé à l'usage HOSPITALIER"])), ['Hôpital seulement']);
    assert.deepEqual(courts(classer(["réservé à l'usage professionnel DENTAIRE"])), ['Usage professionnel']);
  });

  it('signale d’un seul drapeau ce qui ne sort pas de l’hôpital', () => {
    assert.equal(classer(["réservé à l'usage HOSPITALIER"]).bloque, true);
    assert.equal(classer(['liste I']).bloque, false);
  });

  // « Prescription hospitalière » ne veut pas dire « délivrance hospitalière » :
  // l'ordonnance vient de l'hôpital, la boîte se délivre en ville. Les
  // confondre, c'est refuser à tort.
  it('ne bloque pas sur une prescription hospitalière', () => {
    const c = classer(['prescription hospitalière']);
    assert.equal(c.bloque, false);
    assert.deepEqual(courts(c), ['Prescr. hosp.']);
  });

  it('remonte ce qui est à vérifier avant de délivrer', () => {
    const c = classer([
      "prescription nécessitant la signature annuelle par le médecin et la patiente d'une attestation d'information",
      'prescription nécessitant la remise d’un carnet patient',
      'délivrance après vérification du recueil de l’accord de soins',
    ]);
    assert.deepEqual(courts(c), ['Attestation', 'Accord de soins', 'Carnet patient']);
  });

  it('reconnaît la spécialité requise quelle qu’en soit la formule', () => {
    const forme = (l) => courts(classer([l]));
    assert.deepEqual(forme('prescription réservée aux spécialistes et services ONCOLOGIE MEDICALE'), ['Spécialiste']);
    assert.deepEqual(forme('prescription réservée aux médecins compétents en CANCEROLOGIE'), ['Spécialiste']);
    assert.deepEqual(forme('prescription initiale réservée à certains spécialistes'), ['Spécialiste']);
  });

  it('reprend la durée telle qu’elle est écrite', () => {
    assert.deepEqual(classer(['prescription limitée à 12 semaines']).resume[0].long,
      'Prescription limitée à 12 semaines');
  });

  // Le vrai risque : une spécialité sans condition ressemble à une spécialité
  // dont la lecture a échoué. Le vide doit être un vide net.
  it('rend un classement vide sans condition', () => {
    for (const rien of [[], null, undefined, ['', '   ']]) {
      const c = classer(rien);
      assert.deepEqual(c.resume, [], String(rien));
      assert.deepEqual(c.groupes, []);
      assert.deepEqual(c.liens, []);
    }
  });

  it('dédoublonne les libellés répétés', () => {
    const c = classer(['liste I', 'liste I']);
    assert.deepEqual(bruts(c.groupes[0]), ['liste I']);
    assert.deepEqual(courts(c), ['Liste I']);
  });
});

describe('conditions non reconnues', () => {
  // Sur une donnée réglementaire, escamoter ce qu'on n'a pas su ranger serait
  // pire que de l'afficher brut : le lecteur perdrait l'information sans le
  // savoir. Les 163 libellés de la base évoluent, les règles suivront.
  it('sortent verbatim plutôt que d’être perdues', () => {
    const c = classer(['condition inédite de la BDPM 2027']);
    const autres = c.groupes.find((g) => g.cle === 'autres');

    assert.equal(autres.titre, 'Autres conditions');
    assert.deepEqual(bruts(autres), ['condition inédite de la BDPM 2027']);
  });

  it('ne polluent pas le résumé', () => {
    assert.deepEqual(classer(['condition inédite']).resume, []);
  });

  it('passent après les axes connus', () => {
    const cles = classer(['zzz inconnu', 'liste II']).groupes.map((g) => g.cle);
    assert.deepEqual(cles, ['classement', 'autres']);
  });
});

describe('liens Meddispar', () => {
  // Meddispar est édité par l'Ordre et n'est pas en accès ouvert : on renvoie
  // vers la rubrique, on ne recopie pas la conduite à tenir.
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
    for (const l of liens) assert.match(l.url, /\/Criteres$/);
  });

  it('restent absents quand rien ne les appelle', () => {
    assert.deepEqual(classer(['liste II']).liens, []);
  });
});

describe('presenter', () => {
  const rendu = (c) => {
    const r = presenter(c);
    return (r.population ? `[${r.population}] ` : '')
      + r.segments.map((s) => (s.fort ? `**${s.texte}**` : s.texte)).join('');
  };

  // La source porte sa structure dans la ponctuation : le deux-points sépare
  // la population de la condition, et aucun autre libellé n'en contient.
  it('détache la population de la condition', () => {
    assert.equal(
      rendu('pour adolescents de sexe masculin et hommes susceptibles de procréer : prescription initiale réservée à certains spécialistes'),
      '[Pour adolescents de sexe masculin et hommes susceptibles de procréer] Prescription initiale réservée à certains spécialistes',
    );
  });

  // Les capitales de la BDPM ne sont pas une emphase mais un repérage : c'est
  // ainsi qu'elle isole la discipline dans une phrase d'un seul tenant.
  it('rend lisible la discipline criée', () => {
    assert.equal(
      rendu('prescription réservée aux spécialistes et services NEUROLOGIE'),
      'Prescription réservée aux spécialistes et services **Neurologie**',
    );
  });

  // Une locution désigne une seule spécialité. Traitée mot à mot, elle sortait
  // en « Maladies Infectieuses ET Tropicales » — trois emphases pour une
  // notion, et un « ET » resté crié parce qu'il est trop court pour être vu.
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

  // Un sigle mis en bas de casse cesse d'être un sigle. Relevé sur les 164
  // libellés : trois seulement, la liste est close.
  it('laisse les sigles en capitales', () => {
    assert.equal(rendu('délivrance effectuée par un CSAPA'), 'Délivrance effectuée par un CSAPA');
    assert.match(rendu("prescription et délivrance subordonnées à l'obtention du résultat du dépistage d'un déficit en DPD"), /DPD$/);
  });

  it('garde le libellé d’origine intact', () => {
    const brut = 'prescription réservée aux spécialistes et services PEDIATRIE';
    assert.equal(presenter(brut).brut, brut);
  });
});
