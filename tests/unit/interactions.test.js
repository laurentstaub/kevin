import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  plier, racine, motsUtiles, termes, motif, passages, extraire, regrouper, choisir, communes,
  memesClasses, ressemblance, fusionnerVoisins, uneParRacine, estCis, sens, niveauProse, remettreEnOrdre,
  couplesEntre, designe, partieHorsRcp, classesDe,
} from '../../src/interactions.js';
import { reconnaitreMedicaments } from '../../src/reconnaissance.js';
import { lienInteractions } from '../../src/routes/pages.js';

const regex = (liste) => new RegExp(motif(liste));

describe('termes cherchés', () => {
  it('plie sans changer la longueur', () => {
    const texte = 'Œstrogènes : l’acide acétylsalicylique';
    assert.equal(plier(texte).length, texte.length);
    assert.equal(plier('Déconseillée’'), "deconseillee'");
  });

  it('réduit sels et articles, garde la racine commune', () => {
    assert.deepEqual(motsUtiles('ACÉTYLSALICYLATE DE DL-LYSINE'), ['acetylsalicylate']);
    assert.deepEqual(motsUtiles('TRAMADOL (CHLORHYDRATE DE)'), ['tramadol']);
    assert.equal(racine('acetylsalicylique'), racine('acetylsalicylate'));
    assert.equal(racine('folique'), 'folique');
  });

  it('ajoute les noms courants', () => {
    assert.deepEqual(termes(['ACIDE ACÉTYLSALICYLIQUE']), ['acetylsalicyl', 'aspirine']);
    assert.deepEqual(termes(['ACÉTYLSALICYLATE DE DL-LYSINE']), ['acetylsalicyl', 'aspirine']);
  });

  it('cherche en début de mot seulement', () => {
    assert.ok(regex(['warfarine']).test('+ warfarine sodique'));
    assert.ok(!regex(['tramadol']).test('desmotramadol'));
  });
});

describe('passages de la 4.5', () => {
  const texte = 'Les AVK sont concernés. Associations contre-indiquées + Acide acétylsalicylique (forte dose) · '
    + 'Pour des doses anti-inflammatoires. Majoration du risque hémorragique. + Miconazole Hémorragies. '
    + 'Associations déconseillées + Millepertuis Diminution de l’effet. '
    + 'Associations nécessitant des précautions d’emploi ou à prendre en compte + Amiodarone Surveiller l’INR.';

  it('découpe par niveau puis par substance annoncée', () => {
    const decoupe = passages(texte);
    assert.deepEqual(decoupe.map((passage) => passage.niveau), [null, 'ci', 'ci', 'deconseillee', 'pe']);
    // Les puces sous un « + » restent dans le passage de la substance.
    assert.match(decoupe[1].texte, /^Acide acétylsalicylique.*anti-inflammatoires.*hémorragique\.$/);
    assert.equal(decoupe[4].texte, 'Amiodarone Surveiller l’INR.');
  });

  it('découpe aux puces quand le RCP n’emploie pas le « + »', () => {
    const kardegic = 'Associations déconseillées · Anticoagulants oraux : majoration du risque. · Ticlopidine : majoration.';
    assert.deepEqual(passages(kardegic).map((passage) => passage.texte), ['Anticoagulants oraux : majoration du risque.', 'Ticlopidine : majoration.']);
  });

  it('cite le passage qui nomme la substance, avec son niveau', () => {
    const trouves = extraire(texte, regex(['acetylsalicyl', 'aspirine']));
    assert.equal(trouves.length, 1);
    assert.equal(trouves[0].niveau, 'ci');
  });

  it('lit le niveau dans la prose quand aucun intitulé ne le donne', () => {
    const prose = "L'association de midazolam et de clarithromycine est donc déconseillée par voie orale.";
    assert.equal(extraire(prose, regex(['midazolam']))[0].niveau, 'deconseillee');
    assert.equal(extraire('Le midazolam est métabolisé.', regex(['midazolam']))[0].niveau, null);
  });

  it('regroupe les passages identiques des génériques, le plus grave d’abord', () => {
    const lignes = [
      { code_cis: '1', denomination_medicament: 'A', position: 8, texte: 'Associations à prendre en compte + Warfarine Risque.' },
      { code_cis: '2', denomination_medicament: 'B', position: 9, texte: 'Associations contre-indiquées + Warfarine Danger.' },
      { code_cis: '3', denomination_medicament: 'C', position: 9, texte: 'Associations contre-indiquées + Warfarine Danger.' },
      { code_cis: '4', denomination_medicament: 'D', position: 9, texte: null },
    ];
    const groupes = regrouper(lignes, regex(['warfarine']));
    assert.deepEqual(groupes.map((groupe) => [groupe.niveau, groupe.nb]), [['ci', 2], ['apec', 1]]);
    assert.deepEqual(groupes[0].exemple, { cis: '2', denomination: 'B', ancre: 'rcp-9' });
  });
});

describe('médicaments', () => {
  const ligne = (code_cis, denomination_medicament, substances, extra = {}) => ({
    code_cis, denomination_medicament, substances, commercialise: true, par_substance: false, ...extra,
  });

  it('une marque garde ses dosages, pas ses associations', () => {
    const dafalgan = choisir('dafalgan', [
      ligne('1', 'DAFALGAN 500 mg, gélule', ['PARACÉTAMOL']),
      ligne('2', 'DAFALGAN CODEINE, comprimé', ['PARACÉTAMOL', 'CODÉINE (PHOSPHATE DE)']),
    ]);
    assert.deepEqual(dafalgan.cis, ['1']);
    assert.deepEqual(dafalgan.substances, ['PARACÉTAMOL']);
    assert.equal(dafalgan.type, 'marque');
  });

  it('une substance lit ses spécialités seules et garde ses accents', () => {
    const aspirine = choisir('acide acetylsalicylique', [
      ligne('1', 'ASPIRINE UPSA 500 mg', ['ACIDE ACÉTYLSALICYLIQUE'], { par_substance: true }),
      ligne('2', 'ASSOCIATION X', ['ACIDE ACÉTYLSALICYLIQUE', 'CAFÉINE'], { par_substance: true }),
    ]);
    assert.deepEqual(aspirine.cis, ['1']);
    assert.equal(aspirine.libelle, 'acide acétylsalicylique');
  });

  it('repère une substance commune', () => {
    const a = { substances: ['PARACÉTAMOL'] };
    const b = { substances: ['PARACÉTAMOL', 'CODÉINE'] };
    assert.deepEqual(communes(a, b), ['PARACÉTAMOL']);
  });

  it('adresse de la page, un paramètre par médicament', () => {
    assert.equal(lienInteractions(['kardegic', 'acide folique']), '/interactions?m=kardegic&m=acide+folique');
  });
});

describe('plusieurs médicaments dans une saisie', () => {
  const CONNUS = {
    substances: { warfarine: 1, sertraline: 1, tramadol: 1, 'acide acetylsalicylique': 1, 'acide folique': 1, avec: 3 },
    marques: new Set(['kardegic', 'previscan', 'doliprane']),
  };
  const pool = {
    query: async (sql, params) => ({
      rows: params[0].map((mot) => ({ mot, substances: CONNUS.substances[mot] ?? 0, marque: CONNUS.marques.has(mot) })),
    }),
  };

  it('reconnaît deux médicaments ou plus, liaisons comprises', async () => {
    assert.deepEqual(await reconnaitreMedicaments(pool, 'kardegic previscan'), ['kardegic', 'previscan']);
    assert.deepEqual(await reconnaitreMedicaments(pool, 'tramadol et sertraline'), ['tramadol', 'sertraline']);
    assert.deepEqual(await reconnaitreMedicaments(pool, 'aspirine avec warfarine'), ['acide acetylsalicylique', 'warfarine']);
    assert.deepEqual(await reconnaitreMedicaments(pool, 'doliprane+kardegic 75 mg'), ['doliprane', 'kardegic']);
  });

  // Thésaurus : le pamplemousse et l'alcool sont des parties sans RCP.
  it('compte le pamplemousse et l’alcool comme parties, « jus de » compris', async () => {
    assert.deepEqual(await reconnaitreMedicaments(pool, 'tramadol pamplemousse'), ['tramadol', 'pamplemousse']);
    assert.deepEqual(await reconnaitreMedicaments(pool, 'warfarine jus de pamplemousse interactions'), ['warfarine', 'pamplemousse']);
    assert.deepEqual(await reconnaitreMedicaments(pool, 'sertraline alcool'), ['sertraline', 'ethanol']);
    // « jus » seul n'est pas une partie : le reste est du texte.
    assert.equal(await reconnaitreMedicaments(pool, 'tramadol jus'), null);
  });

  it('laisse le reste à la reconnaissance d’un seul médicament', async () => {
    assert.equal(await reconnaitreMedicaments(pool, 'doliprane 1000'), null);
    assert.equal(await reconnaitreMedicaments(pool, 'acide folique'), null);
    assert.equal(await reconnaitreMedicaments(pool, 'kardegic previscan grossesse'), null);
  });
});

describe('fiche produit, classes et rédactions voisines', () => {
  const ligne = (code_cis, denomination_medicament, substances, extra = {}) => ({
    code_cis, denomination_medicament, substances, commercialise: true, par_substance: false, atc: [], ...extra,
  });

  it('un code CIS lit le RCP de cette seule spécialité', () => {
    assert.equal(estCis('61358994'), true);
    assert.equal(estCis('doliprane'), false);
    const depakine = choisir('61358994', [
      ligne('61358994', 'DEPAKINE CHRONO 500 mg, comprimé pelliculé sécable à libération prolongée', ['SODIUM (VALPROATE DE)', 'VALPROATE DE SODIUM'], { atc: ['N03AG01'] }),
      ligne('60000000', 'AUTRE', ['PARACÉTAMOL']),
    ]);
    assert.deepEqual(depakine.cis, ['61358994']);
    assert.equal(depakine.type, 'specialite');
    assert.equal(depakine.libelle, 'Depakine Chrono 500 mg');
    assert.deepEqual(depakine.substances, ['VALPROATE DE SODIUM']);
  });

  it('préfère la graphie sans parenthèse', () => {
    assert.deepEqual(uneParRacine(['DL-LYSINE (ACÉTYLSALICYLATE DE)', 'ACÉTYLSALICYLATE DE DL-LYSINE']), ['ACÉTYLSALICYLATE DE DL-LYSINE']);
  });

  it('repère deux médicaments de la même classe ATC de niveau 4', () => {
    const omeprazole = { substances: ['OMÉPRAZOLE'], atc: ['A02BC01'] };
    const esomeprazole = { substances: ['ÉSOMÉPRAZOLE MAGNÉSIQUE'], atc: ['A02BC05'] };
    const ibuprofene = { substances: ['IBUPROFÈNE'], atc: ['M01AE01'] };
    assert.deepEqual(memesClasses(omeprazole, esomeprazole), ['A02BC']);
    assert.deepEqual(memesClasses(omeprazole, ibuprofene), []);
    // Même substance : déjà signalée comme telle, pas en doublon de classe.
    assert.deepEqual(memesClasses(omeprazole, { substances: ['OMÉPRAZOLE'], atc: ['A02BC01'] }), []);
  });

  it('fusionne les rédactions voisines, cite la plus répandue', () => {
    const base = 'De tels inhibiteurs comprennent l itraconazole, le kétoconazole, la clarithromycine et la télithromycine, contre-indiqués avec la simvastatine';
    const groupes = [
      { niveau: 'ci', par: 'substance', classe: null, extrait: `${base} (tels que le nelfinavir).`, cis: new Set(['1', '2', '3']) },
      { niveau: 'ci', par: 'substance', classe: null, extrait: `${base} (par exemple le nelfinavir).`, cis: new Set(['4']) },
      { niveau: 'pe', par: 'substance', classe: null, extrait: `${base} (tels que le nelfinavir).`, cis: new Set(['5']) },
      { niveau: 'ci', par: 'substance', classe: null, extrait: 'Simvastatine : risque de rhabdomyolyse.', cis: new Set(['6']) },
    ];
    assert.ok(ressemblance(new Set(['a', 'b']), new Set(['a', 'b'])) === 1);
    const fusion = fusionnerVoisins(groupes);
    assert.equal(fusion.length, 3);
    assert.deepEqual([...fusion[0].cis], ['1', '2', '3', '4']);
    assert.equal(fusion[0].variantes, 1);
    assert.match(fusion[0].extrait, /tels que/);
  });
});

describe('classe commune aux deux médicaments', () => {
  it('ne retient que « autre(s) » + classe', async () => {
    const ipp = { id: 'ipp', nom: 'IPP', termes: ['IPP'] };
    const omeprazole = { libelle: 'oméprazole', type: 'substance', substances: ['OMÉPRAZOLE'], termes: ['omeprazole'], classes: [ipp], cis: ['1'] };
    const esomeprazole = { libelle: 'ésoméprazole', type: 'substance', substances: ['ÉSOMÉPRAZOLE'], termes: ['esomeprazole'], classes: [ipp], cis: ['2'] };
    const texte = 'Associations à prendre en compte + Méthotrexate Arrêt provisoire de l’IPP. + Autres IPP Pas d’intérêt à les associer.';
    const pool = { query: async () => ({ rows: [{ code_cis: '1', denomination_medicament: 'MOPRAL', position: 8, texte }] }) };
    const lu = await sens(pool, omeprazole, esomeprazole);
    assert.deepEqual(lu.passages.map((passage) => passage.extrait), ['Autres IPP Pas d’intérêt à les associer.']);
  });
});

describe('niveau lu dans la prose', () => {
  const amiodarone = regex(['amiodarone']);

  it('suit ce qu’il qualifie, dans une phrase courte', () => {
    assert.equal(niveauProse("L'association de simvastatine et d'amiodarone est déconseillée.", amiodarone).niveau, 'deconseillee');
    // Tableau aplati : « déconseillé » vise l'acide fusidique, avant l'amiodarone.
    assert.equal(niveauProse('Acide fusidique Déconseillé avec la simvastatine Amiodarone Amlodipine Ne pas dépasser 20 mg.', amiodarone), null);
    assert.equal(niveauProse(`Amiodarone ${'x '.repeat(200)}est contre-indiquée.`, amiodarone), null);
  });

  it('se lit sur tout le passage, et sa phrase reste dans la citation', () => {
    const long = `Clopidogrel Une étude ${'a montré une baisse de l’exposition '.repeat(10)}avec le clopidogrel. `
      + `Des données contradictoires ont été rapportées sur le clopidogrel ${'dans plusieurs études '.repeat(8)}. `
      + 'Par mesure de précaution, l’utilisation concomitante d’oméprazole et de clopidogrel doit être déconseillée.';
    const [trouve] = extraire(long, regex(['clopidogrel']));
    assert.equal(trouve.niveau, 'deconseillee');
    assert.match(trouve.extrait, /doit être déconseillée\.$/);
  });

  it('un sel minéral se cherche par son ion', () => {
    assert.deepEqual(motsUtiles('CHLORURE DE POTASSIUM'), ['potassium']);
    assert.deepEqual(motsUtiles('CARBONATE DE CALCIUM'), ['calcium']);
    assert.deepEqual(motsUtiles('VALPROATE DE SODIUM'), ['valproate']);
  });
});

describe('noms de substance', () => {
  it('remet le sel devant la substance', () => {
    assert.equal(remettreEnOrdre('CLOPIDOGREL (HYDROGÉNOSULFATE DE)'), 'HYDROGÉNOSULFATE DE CLOPIDOGREL');
    assert.equal(remettreEnOrdre("AMIODARONE (CHLORHYDRATE D')"), "CHLORHYDRATE D'AMIODARONE");
    assert.equal(remettreEnOrdre('PARACÉTAMOL'), 'PARACÉTAMOL');
  });
});

describe('thésaurus de l’ANSM entre deux médicaments', () => {
  const med = (substances) => ({ substances, classes: classesDe(substances) });
  const resume = (a, b) => couplesEntre(a, b).map((couple) => `${couple.de} + ${couple.avec} : ${couple.libelleNiveau}`);

  it('trouve le couple par la substance, dans un sens ou dans l’autre, une seule fois', () => {
    assert.deepEqual(resume(med(['SIMVASTATINE']), med(['MILLEPERTUIS (EXTRAIT DE)'])), ['MILLEPERTUIS + SIMVASTATINE : Déconseillée']);
    assert.deepEqual(resume(med(['MILLEPERTUIS (EXTRAIT DE)']), med(['SIMVASTATINE'])), ['MILLEPERTUIS + SIMVASTATINE : Déconseillée']);
  });

  it('trouve le couple par le groupe, niveau composé gardé en entier', () => {
    const lignes = resume(med(['ACÉTYLSALICYLATE DE DL-LYSINE']), med(['FLUINDIONE']));
    assert.equal(lignes[0], 'ACIDE ACETYLSALICYLIQUE + ANTICOAGULANTS ORAUX : Contre-indiquée · Déconseillée · À prendre en compte');
  });

  it('se tait quand l’ANSM n’a pas classé le couple', () => {
    assert.deepEqual(resume(med(['ATORVASTATINE CALCIQUE TRIHYDRATÉE']), med(['MILLEPERTUIS (EXTRAIT DE)'])), []);
  });

  it('pamplemousse et alcool : parties sans RCP, désignées par leur tête', () => {
    const pamplemousse = partieHorsRcp('jus de pamplemousse');
    assert.equal(pamplemousse.type, 'hors-rcp');
    assert.equal(pamplemousse.libelle, 'Pamplemousse (jus et fruit)');
    assert.deepEqual(pamplemousse.termes, ['pamplemousse']);
    assert.deepEqual(resume(med(['ATORVASTATINE CALCIQUE']), pamplemousse), ['ATORVASTATINE + PAMPLEMOUSSE (JUS ET FRUIT) : À prendre en compte']);
    assert.equal(partieHorsRcp('ethanol').tete, 'ALCOOL (BOISSON OU EXCIPIENT)');
    assert.equal(partieHorsRcp('doliprane'), null);
  });

  it('une substance ne désigne pas un nom dont elle n’a qu’une partie', () => {
    assert.equal(designe('OMBITASVIR + PARITAPRÉVIR', med(['OMBITASVIR'])), false);
    assert.equal(designe('THÉOPHYLLINE (ET, PAR EXTRAPOLATION, AMINOPHYLLINE)', med(['THÉOPHYLLINE'])), true);
  });
});
