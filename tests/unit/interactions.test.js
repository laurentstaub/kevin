import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  plier, racine, motsUtiles, termes, motif, passages, extraire, regrouper, choisir, communes,
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

  it('laisse le reste à la reconnaissance d’un seul médicament', async () => {
    assert.equal(await reconnaitreMedicaments(pool, 'doliprane 1000'), null);
    assert.equal(await reconnaitreMedicaments(pool, 'acide folique'), null);
    assert.equal(await reconnaitreMedicaments(pool, 'kardegic previscan grossesse'), null);
  });
});
