import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { etiqueter } from '../../src/groupes.js';

describe('etiqueter', () => {
  it('affiche la racine seule quand elle est sans ambiguïté', () => {
    const [doliprane] = etiqueter([
      { racine: 'DOLIPRANE', titulaires: 'OPELLA HEALTHCARE FRANCE' },
    ]);
    assert.equal(doliprane.libelle, 'DOLIPRANE');
  });

  it('précise le titulaire quand deux produits partagent la racine', () => {
    // Les neuf « GLUCOSE 10 % <laboratoire> » : le laboratoire est écrit après
    // le dosage, il disparaît donc de la racine. Sans lui, six lignes
    // identiques.
    const rendus = etiqueter([
      { racine: 'GLUCOSE', titulaires: 'BAXTER' },
      { racine: 'GLUCOSE', titulaires: 'AGUETTANT' },
      { racine: 'DOLIPRANE', titulaires: 'OPELLA HEALTHCARE FRANCE' },
    ]);

    assert.deepEqual(
      rendus.map((r) => r.libelle),
      ['GLUCOSE — BAXTER', 'GLUCOSE — AGUETTANT', 'DOLIPRANE'],
    );
  });

  it('se rabat sur la dénomination quand la racine manque', () => {
    const [seul] = etiqueter([{ denomination_medicament: 'PRODUIT X 5 mg, comprimé' }]);
    assert.equal(seul.libelle, 'PRODUIT X 5 mg, comprimé');
  });

  it('n’invente pas de tiret quand le titulaire est absent', () => {
    const rendus = etiqueter([
      { racine: 'GLUCOSE', titulaires: null },
      { racine: 'GLUCOSE', titulaires: '   ' },
    ]);
    for (const r of rendus) assert.equal(r.libelle, 'GLUCOSE');
  });
});
