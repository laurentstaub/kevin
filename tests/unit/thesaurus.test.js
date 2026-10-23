import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { elargir } from '../../src/thesaurus.js';

const alternatives = (saisie, i = 0) => elargir(saisie).atomes[i];

describe('elargir', () => {
  it('laisse passer un mot inconnu tel quel', () => {
    assert.deepEqual(elargir('paracétamol'), { atomes: [['paracétamol']], elargissements: [] });
  });

  // Le pharmacien tape le sigle, le RCP écrit la forme longue.
  it('remplace un terme du thésaurus par tout son groupe', () => {
    const alts = alternatives('QT');
    assert.ok(alts.includes('QT'));
    assert.ok(alts.includes('"torsade de pointes"'), 'la locution est citée pour websearch');
  });

  it('cherche les autres mots tels quels, en ET', () => {
    const { atomes } = elargir('sertraline QT');
    assert.equal(atomes.length, 2);
    assert.deepEqual(atomes[0], ['sertraline']);
    assert.ok(atomes[1].length > 1);
  });

  // « CYP3A4 » et « CYP 3A4 » : deux jetons Postgres, un seul concept.
  it('reconnaît un terme malgré la casse, les accents et les séparateurs', () => {
    for (const forme of ['cyp3a4', 'CYP 3A4', 'Cyp-3a4', 'anti-vitamine K', 'antivitamine k', 'oedeme de quincke']) {
      assert.ok(elargir(forme).elargissements.length === 1, forme);
    }
  });

  // Sinon « intervalle » serait exigé en ET à côté des synonymes de « QT ».
  it('préfère le terme le plus long', () => {
    const { atomes, elargissements } = elargir('intervalle QT');
    assert.equal(atomes.length, 1);
    assert.equal(elargissements[0].terme, 'intervalle QT');
  });

  // websearch en fait une locution exacte.
  it('n’élargit jamais une requête citée', () => {
    assert.deepEqual(elargir('"intervalle QT"'), { atomes: [['"intervalle QT"']], elargissements: [] });
  });

  it('décrit l’élargissement sans y répéter le terme tapé', () => {
    const [e] = elargir('cyp3a4').elargissements;
    assert.equal(e.terme, 'cyp3a4');
    assert.ok(!e.vers.some((cible) => cible.toLowerCase().replace(/\s/g, '') === 'cyp3a4'));
    assert.ok(e.vers.includes('cytochrome 3A4'));
  });

  // Concepts du comptoir (data/concepts-document.json) : après le thésaurus, plus strict.
  it('élargit un concept du comptoir aux termes des RCP, le mot tapé compris', () => {
    const { atomes, elargissements } = elargir('divisé');
    assert.ok(atomes[0].includes('sécable') && atomes[0].includes('"barre de cassure"') && atomes[0].includes('divisé'));
    assert.ok(elargissements[0].vers.includes('sécable'));
    assert.ok(!elargissements[0].vers.includes('divisé'));
    // Le mot du comptoir mène aux termes des RCP ; « froid » n'y entre que si on le tape.
    assert.ok(elargir('frigo').atomes[0].includes('réfrigérateur'));
    assert.ok(!elargir('frigo').atomes[0].includes('froid'));
    assert.equal(elargir('rein').atomes[0][0], 'rein');
  });

  // Abréviation du comptoir : « poso » ne partage pas le radical de « posologie » (« poso » ≠ « posolog »).
  it('« poso » cherche « posologie », le titre de la rubrique 4.2', () => {
    assert.deepEqual(alternatives('poso'), ['posologie', 'poso']);
  });

  it('rend vide pour une saisie vide', () => {
    assert.deepEqual(elargir(''), { atomes: [], elargissements: [] });
    assert.deepEqual(elargir(null), { atomes: [], elargissements: [] });
  });
});
