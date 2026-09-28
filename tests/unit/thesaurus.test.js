import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { elargir } from '../../src/thesaurus.js';

const alternatives = (saisie, i = 0) => elargir(saisie).atomes[i];

describe('elargir', () => {
  it('laisse passer un mot inconnu tel quel', () => {
    assert.deepEqual(elargir('paracétamol'), { atomes: [['paracétamol']], elargissements: [] });
  });

  // « QT » ne trouvait pas « torsade de pointes » : le pharmacien tape le
  // sigle, le RCP a écrit la forme longue.
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

  // « CYP3A4 » et « CYP 3A4 » sont deux jetons pour Postgres, et un seul
  // concept pour le pharmacien. On compare des squelettes, pas des graphies.
  it('reconnaît un terme malgré la casse, les accents et les séparateurs', () => {
    for (const forme of ['cyp3a4', 'CYP 3A4', 'Cyp-3a4', 'anti-vitamine K', 'antivitamine k', 'oedeme de quincke']) {
      assert.ok(elargir(forme).elargissements.length === 1, forme);
    }
  });

  // « intervalle QT » est un terme du thésaurus ; le reconnaître comme un tout
  // évite de chercher « intervalle » ET (« QT » ou ses synonymes), qui
  // exigerait le mot « intervalle » dans une rubrique parlant de torsades.
  it('préfère le terme le plus long', () => {
    const { atomes, elargissements } = elargir('intervalle QT');
    assert.equal(atomes.length, 1);
    assert.equal(elargissements[0].terme, 'intervalle QT');
  });

  // Des guillemets sont une demande d'exactitude : websearch en fait une
  // locution, et le thésaurus se tait.
  it('n’élargit jamais une requête citée', () => {
    assert.deepEqual(elargir('"intervalle QT"'), { atomes: [['"intervalle QT"']], elargissements: [] });
  });

  // Ce qu'on dit au lecteur : le terme reconnu, et ce qu'on a cherché en plus
  // — sans lui répéter sa propre graphie sous une autre casse.
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
