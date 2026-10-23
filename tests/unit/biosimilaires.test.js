import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { statutBiologique, groupeBiologique, substitutionBiosimilaires } from '../../src/biosimilaires.js';
import { regrouperSpecialites } from '../../src/specialites.js';

describe('biosimilaires', () => {
  it('reconnaît la référence et ses biosimilaires au début du nom', () => {
    assert.equal(statutBiologique('LOVENOX 4 000 UI (40 mg)/0,4 ml, solution injectable'), 'reference');
    assert.equal(statutBiologique('ENOXAPARINE ARROW 2 000 UI (20 mg)/0,2 mL, solution injectable'), 'biosimilaire');
    assert.equal(statutBiologique('INHIXA 2 000 UI, solution injectable'), 'biosimilaire');
    assert.equal(statutBiologique('DOLIPRANE 1000 mg, comprimé'), null);
  });

  it('ne reconnaît pas un nom qui en prolonge un autre', () => {
    assert.equal(statutBiologique('LANTUSX 100 unités/ml, solution'), null);
  });

  // Pas l'ordre alphabétique : LOVENOX avant INHIXA.
  it('met la référence en tête de sa forme', () => {
    const [forme] = regrouperSpecialites([
      { id: '1', denomination: 'INHIXA 2 000 UI (20 mg)/0,2 mL, solution injectable', forme_pharmaceutique: 'solution injectable', titulaires: 'T' },
      { id: '2', denomination: 'LOVENOX 2 000 UI (20 mg)/0,2 ml, solution injectable', forme_pharmaceutique: 'solution injectable', titulaires: 'S' },
    ]);
    assert.deepEqual(forme.noms.map((nom) => [nom.nom, nom.biologique]), [['LOVENOX', 'reference'], ['INHIXA', 'biosimilaire']]);
  });

  // Le rituximab n'est pas substituable en officine.
  it('dit si le groupe est substituable en officine', () => {
    assert.deepEqual(groupeBiologique('INHIXA 4 000 UI, solution injectable'),
      { substance: 'énoxaparine', substituable: true, role: 'biosimilaire' });
    assert.equal(groupeBiologique('TRUXIMA 500 mg, solution').substituable, false);
    assert.equal(groupeBiologique('DOLIPRANE 1000 mg'), null);
  });
});

describe('substitutionBiosimilaires', () => {
  it('rend les liens de l’arrêté et d’ameli en https', () => {
    const substitution = substitutionBiosimilaires();
    assert.match(substitution.url_arrete, /^https:\/\/www\.legifrance\.gouv\.fr\//);
    assert.match(substitution.url_conditions, /^https:\/\/www\.ameli\.fr\//);
  });
});
