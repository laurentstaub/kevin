import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ressemblance, plusProche } from '../../src/correction.js';

describe('fautes de frappe', () => {
  it('ressemblance par trigrammes, à la manière de pg_trgm', () => {
    assert.equal(ressemblance('macrogol', 'macrogol'), 1);
    assert.ok(ressemblance('macogol', 'macrogol') > 0.5);
    assert.ok(ressemblance('macogol', 'paracetamol') < 0.2);
  });

  it('corrige vers le mot qui se détache', () => {
    assert.equal(plusProche('previscna', ['previscan', 'prevenar', 'prevymis']), 'previscan');
    // Une même famille ne se concurrence pas : « doliprane » contre « dolipranetabs ».
    assert.equal(plusProche('doliprnae', ['doliprane', 'dolipranetabs', 'dolipranecaps']), 'doliprane');
  });

  it('ne corrige pas sous le seuil, ni entre deux candidats trop proches', () => {
    assert.equal(plusProche('xyzabc', ['doliprane', 'previscan']), null);
    assert.equal(plusProche('macrogel', ['macrogol', 'macrogal']), null);
  });

  it('un seuil plus haut pour un mot que les RCP écrivent déjà', () => {
    assert.equal(plusProche('amoxiciline', ['amoxicilline'], 0.7), 'amoxicilline');
    assert.equal(plusProche('thyroide', ['thyroidea'], 0.95), null);
  });
});
