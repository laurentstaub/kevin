import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from '../../src/config.js';
import {
  GROUPES, classesDe, motif, extraire, regrouper, plier,
} from '../../src/interactions.js';
import { lireGroupes, lireCouples, niveauxAnsm, formulations, idGroupe } from '../../src/thesaurus-ansm.js';

const classe = (termes) => new RegExp(motif([], termes));
const trouve = (termes, texte) => classe(termes).test(plier(texte));

describe('termes de classe', () => {
  it('en mots entiers : « AINS » ne trouve pas « ainsi »', () => {
    assert.ok(trouve(['AINS'], '+ Autres AINS : majoration du risque'));
    assert.ok(!trouve(['AINS'], 'Il convient ainsi de surveiller'));
  });

  it('pluriel, tirets et espaces indifférents', () => {
    assert.ok(trouve(['statine'], 'Inhibiteurs de l’HMG-CoA réductase (statines)'));
    for (const texte of ['bêtabloquants', 'bêta-bloquants', 'Bétabloquant']) assert.ok(trouve(['bêta-bloquant'], texte), texte);
    assert.ok(trouve(['anti-inflammatoires non stéroïdiens'], 'anti-inflammatoires non-stéroïdiens'));
  });

  it('apostrophe typographique trouvée sans pliage, comme en base', () => {
    assert.ok(classe(["inhibiteurs de l'enzyme de conversion"]).test('inhibiteurs de l’enzyme de conversion'));
  });

  it('« QT » ne trouve pas « QTc », qui a son propre terme', () => {
    assert.ok(trouve(['QT'], 'allongement de l’intervalle QT'));
    assert.ok(!trouve(['QT'], 'QTc'));
    assert.ok(trouve(['QTc'], 'QTc'));
  });
});

describe('groupes du thésaurus d’un médicament', () => {
  const ids = (substances) => classesDe(substances).map((groupe) => groupe.id);

  it('par l’appartenance que donne l’ANSM, sel et acide mis à part', () => {
    assert.ok(ids(['IBUPROFÈNE']).includes('anti-inflammatoires-non-steroidiens'));
    assert.ok(ids(['FLUINDIONE']).includes('antivitamines-k'));
    assert.ok(ids(['FLUINDIONE']).includes('anticoagulants-oraux'));
    assert.ok(ids(['APIXABAN']).includes('anticoagulants-oraux'));
    assert.ok(!ids(['APIXABAN']).includes('antivitamines-k'));
    assert.ok(ids(['VALPROATE DE SODIUM']).includes('valproique-acide-et-par-extrapolation-valpromide'));
    assert.ok(ids(["CHLORHYDRATE D'AMIODARONE"]).includes('substances-susceptibles-de-donner-des-torsades-de-pointes'));
  });

  it('un membre en plusieurs mots les veut tous', () => {
    const groupes = [{ id: 'g', nom: 'G', membres: ['candesartan cilexetil'], termes: ['G'] }];
    assert.equal(classesDe(['CANDÉSARTAN CILEXETIL'], groupes).length, 1);
    assert.equal(classesDe(['CILEXETIL'], groupes).length, 0);
  });

  it('rien quand l’ANSM ne range la substance nulle part', () => {
    assert.deepEqual(ids(['PARACÉTAMOL']).filter((id) => id.includes('anti-inflammatoires')), []);
  });
});

describe('passages trouvés par la classe', () => {
  const texte = 'Associations déconseillées + Anticoagulants oraux Majoration du risque hémorragique. '
    + 'Associations contre-indiquées + Fluindione Hémorragies graves.';
  const substance = new RegExp(motif(['fluindione']));
  const avk = [{ nom: 'Antivitamines K', regex: classe(['anticoagulants oraux']) }];

  it('marque la provenance de chaque passage', () => {
    const trouves = extraire(texte, substance, avk);
    assert.deepEqual(trouves.map(({ par, classe: nom, niveau }) => [par, nom, niveau]), [
      ['classe', 'Antivitamines K', 'deconseillee'],
      ['substance', null, 'ci'],
    ]);
  });

  it('sans terme de substance, la classe seule', () => {
    assert.equal(extraire(texte, null, avk).length, 1);
  });

  it('à niveau égal, la substance avant la classe', () => {
    const lignes = [{
      code_cis: '1', denomination_medicament: 'A', position: 3,
      texte: 'Associations déconseillées + Anticoagulants oraux Risque. + Fluindione Risque.',
    }];
    assert.deepEqual(regrouper(lignes, substance, avk).map((groupe) => groupe.par), ['substance', 'classe']);
  });
});

describe('groupes extraits du thésaurus', () => {
  const thesaurus = [
    'ABATACEPT',
    '+ ANTI-TNF ALPHA',
    '',
    'ALCALINISANTS URINAIRES',
    ' (acetazolamide, sodium (bicarbonate de), trometamol)',
    '',
    '+ QUINIDINE',
    'SUBSTANCES À ABSORPTION RÉDUITE PAR LES TOPIQUES GASTRO-INTESTINAUX, ANTIACIDES ET',
    'ADSORBANTS',
    ' (acide acetylsalicylique,',
    ' digoxine)',
    '+ TOPIQUES',
    'ANTICHOLINESTÉRASIQUES',
    ' (voir aussi "bradycardisants")',
    '+ MEDICAMENTS ATROPINIQUES',
  ].join('\n');

  it('lit nom, membres et description, têtes sur deux lignes comprises', () => {
    const groupes = lireGroupes(thesaurus);
    assert.deepEqual(groupes.map((groupe) => [groupe.nom, groupe.membres]), [
      ['ALCALINISANTS URINAIRES', ['acetazolamide', 'sodium (bicarbonate de)', 'trometamol']],
      ['SUBSTANCES À ABSORPTION RÉDUITE PAR LES TOPIQUES GASTRO-INTESTINAUX, ANTIACIDES ET ADSORBANTS', ['acide acetylsalicylique', 'digoxine']],
    ]);
  });

  it('formulations : le nom sans ses précisions, l’autre nom de la parenthèse, les abréviations', () => {
    assert.deepEqual(formulations('BÊTA-BLOQUANTS (SAUF ESMOLOL ET SOTALOL) (Y COMPRIS COLLYRES)'), ['BÊTA-BLOQUANTS']);
    assert.deepEqual(formulations("INHIBITEURS DE L'HMG-COA RÉDUCTASE (STATINES)"), ["INHIBITEURS DE L'HMG-COA RÉDUCTASE", 'STATINES']);
    assert.deepEqual(formulations('ANTIVITAMINES K', ['AVK']), ['ANTIVITAMINES K', 'AVK']);
    assert.equal(idGroupe("ANTI-INFLAMMATOIRES NON STÉROÏDIENS"), 'anti-inflammatoires-non-steroidiens');
  });

  it('chaque groupe a un identifiant unique, des membres et des formulations', () => {
    const ids = GROUPES.map((groupe) => groupe.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const groupe of GROUPES) assert.ok(groupe.membres.length && groupe.termes.length, groupe.id);
  });

  it('la liste des torsadogènes est la copie exacte du groupe ANSM', () => {
    const liste = JSON.parse(readFileSync(path.join(ROOT, 'data', 'listes', 'torsadogenes.json'), 'utf8'));
    const groupe = GROUPES.find((entree) => entree.nom === liste.source.groupe);
    assert.ok(groupe, liste.source.groupe);
    assert.deepEqual(liste.inscriptions.map((inscription) => inscription.substance), groupe.membres.map((membre) => plier(membre)));
  });
});

describe('couples du thésaurus', () => {
  // Mise en page de `pdftotext -layout` : mécanisme à gauche, niveau puis conduite à droite.
  const texte = [
    'ALCOOL (BOISSON OU EXCIPIENT)',
    '+ METFORMINE',
    "                    Risque majoré d'acidose lactique lors d'intoxication alcoolique         Association DECONSEILLEE",
    '                    aiguë.                                                                  Eviter la prise de boissons alcoolisées',
    '                                                                                            et de médicaments contenant de l’alcool.',
    '                                                                                  12',
    'OMBITASVIR + PARITAPRÉVIR',
    '+ SUBSTANCES À ABSORPTION RÉDUITE PAR LES TOPIQUES GASTRO-INTESTINAUX, ANTIACIDES ET',
    '  ADSORBANTS',
    '                    Diminution de l\'absorption de ces substances.                          ASDEC - PE',
    '                                                                                            Précaution d\'emploi: à distance.',
  ].join('\n');

  it('lit tête, autre terme, niveau, mécanisme et conduite ; têtes avec « + » et noms sur deux lignes', () => {
    const [alcool, topiques] = lireCouples(texte);
    assert.deepEqual(alcool, {
      de: 'ALCOOL (BOISSON OU EXCIPIENT)', avec: 'METFORMINE', niveau: 'Association DECONSEILLEE', niveaux: ['deconseillee'],
      mecanisme: "Risque majoré d'acidose lactique lors d'intoxication alcoolique aiguë.",
      conduite: 'Eviter la prise de boissons alcoolisées et de médicaments contenant de l’alcool.',
    });
    assert.equal(topiques.de, 'OMBITASVIR + PARITAPRÉVIR');
    assert.equal(topiques.avec, 'SUBSTANCES À ABSORPTION RÉDUITE PAR LES TOPIQUES GASTRO-INTESTINAUX, ANTIACIDES ET ADSORBANTS');
    assert.deepEqual(topiques.niveaux, ['deconseillee', 'pe']);
  });

  it('niveaux : intitulés écrits en toutes lettres ou en sigles', () => {
    assert.deepEqual(niveauxAnsm('CONTRE-INDICATION'), ['ci']);
    assert.deepEqual(niveauxAnsm('CI - ASDEC - APEC'), ['ci', 'deconseillee', 'apec']);
    assert.deepEqual(niveauxAnsm("Précaution d'emploi"), ['pe']);
    assert.deepEqual(niveauxAnsm('A prendre en compte'), ['apec']);
  });

  it('le fichier extrait compte tous les couples, chacun avec un niveau', () => {
    const { couples } = JSON.parse(readFileSync(path.join(ROOT, 'data', 'thesaurus-ansm', 'couples.json'), 'utf8'));
    assert.ok(couples.length >= 3200);
    assert.ok(couples.every((couple) => couple.niveaux.length > 0 && couple.mecanisme), 'niveau et mécanisme partout');
  });
});
