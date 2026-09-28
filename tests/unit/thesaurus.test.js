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

  it('rend vide pour une saisie vide', () => {
    assert.deepEqual(elargir(''), { atomes: [], elargissements: [] });
    assert.deepEqual(elargir(null), { atomes: [], elargissements: [] });
  });
});
