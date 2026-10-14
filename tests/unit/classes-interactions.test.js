import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from '../../src/config.js';
import {
  CLASSES, classesDe, motif, extraire, regrouper, plier,
} from '../../src/interactions.js';

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

describe('classes d’un médicament', () => {
  const noms = (liste) => liste.map((entree) => entree.id);

  it('par préfixe ATC', () => {
    // Listes vides : seul le code ATC rattache (l'amiodarone est aussi torsadogène par sa liste).
    const sansListe = (atc, substances) => noms(classesDe(atc, substances, undefined, () => []));
    assert.deepEqual(sansListe(['M01AE01'], ['IBUPROFÈNE']), ['ains']);
    assert.deepEqual(sansListe(['B01AA12'], ['FLUINDIONE']), ['avk']);
    assert.deepEqual(sansListe(['C01BD01'], ['AMIODARONE']), ['antiarythmiques']);
  });

  it('par la liste des torsadogènes, désormais remplie', () => {
    assert.ok(noms(classesDe(['C01BD01'], ['AMIODARONE'])).includes('torsadogenes'));
    assert.ok(noms(classesDe(['N06AB04'], ['CITALOPRAM'])).includes('torsadogenes'));
  });

  it('sauf exclusion : le lithium n’est pas un neuroleptique', () => {
    assert.deepEqual(noms(classesDe(['N05AN01'], ['LITHIUM'])), []);
    assert.deepEqual(noms(classesDe(['N05AH03'], ['OLANZAPINE'])), ['neuroleptiques']);
  });

  it('par inscription sur une liste', () => {
    const inscrits = (liste) => (liste === 'torsadogenes' ? ['amiodarone'] : []);
    assert.ok(noms(classesDe([], ["CHLORHYDRATE D'AMIODARONE"], CLASSES, inscrits)).includes('torsadogenes'));
    assert.deepEqual(noms(classesDe([], ['FLUINDIONE'], CLASSES, inscrits)), []);
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

describe('table des classes', () => {
  it('chaque classe a un identifiant unique, un nom, des termes et un rattachement', () => {
    const ids = CLASSES.map((entree) => entree.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const entree of CLASSES) {
      assert.ok(entree.nom && entree.termes.length, entree.id);
      assert.ok(entree.atc?.length || entree.liste, `${entree.id} : ni ATC ni liste`);
      if (entree.liste) assert.ok(existsSync(path.join(ROOT, 'data', 'listes', `${entree.liste}.json`)), entree.liste);
    }
  });

  it('aucun terme en double dans une classe', () => {
    for (const entree of CLASSES) {
      const cles = entree.termes.map((terme) => motif([], [terme]));
      assert.equal(new Set(cles).size, cles.length, entree.id);
    }
  });
});
