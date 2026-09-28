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
    // Laboratoire écrit après le dosage (« GLUCOSE 10 % <labo> ») : absent de la racine.
    const rendus = etiqueter([
      { racine: 'GLUCOSE', titulaires: 'BAXTER' },
      { racine: 'GLUCOSE', titulaires: 'AGUETTANT' },
      { racine: 'DOLIPRANE', titulaires: 'OPELLA HEALTHCARE FRANCE' },
    ]);

    assert.deepEqual(
      rendus.map((rendu) => rendu.libelle),
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
    for (const rendu of rendus) assert.equal(rendu.libelle, 'GLUCOSE');
  });
});
