import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { roleOf, genericGroupLabel } from '../../src/products.js';

describe('roleOf', () => {
  it('distingue princeps et générique dans le groupe', () => {
    assert.equal(roleOf({ match_type: 'generic', type_generique: '0' }), 'Princeps');
    assert.equal(roleOf({ match_type: 'generic', type_generique: '1' }), 'Générique');
    assert.equal(roleOf({ match_type: 'generic', type_generique: '2' }), 'Générique');
  });

  it('qualifie de « Même DCI » hors groupe générique', () => {
    assert.equal(roleOf({ match_type: 'related', type_generique: null }), 'Même DCI');
  });
});

describe('genericGroupLabel', () => {
  it('remonte le libellé du groupe', () => {
    const label = genericGroupLabel([
      { libelle_groupe_generique: null },
      { libelle_groupe_generique: 'ACIDE ACETYLSALICYLIQUE 500 mg' },
    ]);
    assert.equal(label, 'ACIDE ACETYLSALICYLIQUE 500 mg');
  });

  it('renvoie null sans groupe', () => {
    assert.equal(genericGroupLabel([{ libelle_groupe_generique: null }]), null);
    assert.equal(genericGroupLabel([]), null);
  });
});
