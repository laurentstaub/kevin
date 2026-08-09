import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { estImportation, regrouperVariantes } from '../../src/imports.js';

describe('estImportation', () => {
  it('reconnaît la rédaction de la BDPM', () => {
    assert.equal(estImportation("Autorisation d'importation parallèle"), true);
    assert.equal(estImportation('AUTORISATION D’IMPORTATION PARALLELE'), true);
  });

  it('ne confond pas avec les autres procédures', () => {
    for (const p of [
      'Procédure nationale',
      'Procédure décentralisée',
      'Procédure centralisée',
      'Procédure de reconnaissance mutuelle',
      'Enreg homéo (Proc. Nat.)',
      null,
      undefined,
      '',
    ]) {
      assert.equal(estImportation(p), false, String(p));
    }
  });
});

describe('regrouperVariantes', () => {
  const ligne = (id, nom, procedure, titulaire) => ({
    id,
    denomination_medicament: nom,
    type_procedure_amm: procedure,
    titulaires: titulaire,
  });

  const IMPORT = "Autorisation d'importation parallèle";
  const NATIONAL = 'Procédure nationale';

  const VENTOLINE = [
    ligne('60928110', 'VENTOLINE 100 microgrammes/dose', IMPORT, 'BB FARMA (ITALIE)'),
    ligne('61187493', 'VENTOLINE 100 microgrammes/dose', IMPORT, 'DIFARMED (ESPAGNE)'),
    ligne('64720167', 'VENTOLINE 100 microgrammes/dose', NATIONAL, 'GLAXOSMITHKLINE'),
    ligne('65195719', 'VENTOLINE 100 microgrammes/dose', IMPORT, 'PHARMA LAB'),
    ligne('69077942', 'VENTOLINE 0,5 mg/1 ml', NATIONAL, 'GLAXOSMITHKLINE'),
  ];

  it('rend une ligne par dénomination', () => {
    const groupes = regrouperVariantes(VENTOLINE);
    assert.equal(groupes.length, 2);
  });

  it('met le produit d’origine en tête de groupe, quel que soit l’ordre reçu', () => {
    const groupes = regrouperVariantes(VENTOLINE);
    const cent = groupes.find((g) => g.denomination_medicament.includes('100'));

    assert.equal(cent.id, '64720167', 'le CIS national représente le groupe');
    assert.equal(cent.importation, false);
  });

  it('compte les importations écartées', () => {
    const cent = regrouperVariantes(VENTOLINE).find((g) =>
      g.denomination_medicament.includes('100'),
    );
    assert.equal(cent.importations, 3);
  });

  it('marque un groupe qui n’a pas de produit d’origine', () => {
    const groupes = regrouperVariantes([
      ligne('1', 'OMACOR, capsule molle', IMPORT, 'BB FARMA'),
      ligne('2', 'OMACOR, capsule molle', IMPORT, 'DIFARMED'),
    ]);

    assert.equal(groupes.length, 1);
    assert.equal(groupes[0].importation, true);
    assert.equal(groupes[0].importations, 2);
  });

  it('ne regroupe pas des dénominations différentes', () => {
    const groupes = regrouperVariantes([
      ligne('1', 'VENTOLINE 100 microgrammes/dose', NATIONAL, 'GSK'),
      ligne('2', 'VENTOLINE 2,5 mg/2,5 ml', NATIONAL, 'GSK'),
    ]);
    assert.equal(groupes.length, 2);
  });

  it('ignore accents et casse pour apparier', () => {
    const groupes = regrouperVariantes([
      ligne('1', 'AROMASINE 25 mg, comprimé enrobé', NATIONAL, 'PFIZER'),
      ligne('2', 'aromasine 25 mg, comprime enrobe', IMPORT, 'BB FARMA'),
    ]);
    assert.equal(groupes.length, 1);
    assert.equal(groupes[0].id, '1');
  });

  it('supporte une liste vide', () => {
    assert.deepEqual(regrouperVariantes([]), []);
  });
});
