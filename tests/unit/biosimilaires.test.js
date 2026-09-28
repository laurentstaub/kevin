import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { statutBiologique } from '../../src/biosimilaires.js';
import { regrouperSpecialites } from '../../src/specialites.js';

describe('biosimilaires', () => {
  it('reconnaît la référence et ses biosimilaires au début du nom', () => {
    assert.equal(statutBiologique('LOVENOX 4 000 UI (40 mg)/0,4 ml, solution injectable'), 'reference');
    assert.equal(statutBiologique('ENOXAPARINE ARROW 2 000 UI (20 mg)/0,2 mL, solution injectable'), 'biosimilaire');
    assert.equal(statutBiologique('INHIXA 2 000 UI, solution injectable'), 'biosimilaire');
    assert.equal(statutBiologique('DOLIPRANE 1000 mg, comprimé'), null);
  });

  // Le nom doit être entier : LANTUS ne reconnaît pas un LANTUSX.
  it('ne reconnaît pas un nom qui en prolonge un autre', () => {
    assert.equal(statutBiologique('LANTUSX 100 unités/ml, solution'), null);
  });

  // LOVENOX avant INHIXA, que l'ordre alphabétique mettait devant.
  it('met la référence en tête de sa forme', () => {
    const [f] = regrouperSpecialites([
      { id: '1', denomination: 'INHIXA 2 000 UI (20 mg)/0,2 mL, solution injectable', forme_pharmaceutique: 'solution injectable', titulaires: 'T' },
      { id: '2', denomination: 'LOVENOX 2 000 UI (20 mg)/0,2 ml, solution injectable', forme_pharmaceutique: 'solution injectable', titulaires: 'S' },
    ]);
    assert.deepEqual(f.noms.map((n) => [n.nom, n.biologique]), [['LOVENOX', 'reference'], ['INHIXA', 'biosimilaire']]);
  });
});
