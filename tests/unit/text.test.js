import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { echapperLike } from '../../src/text.js';
import { searchMedications } from '../../src/search.js';

describe('echapperLike', () => {
  it('échappe les jokers et le caractère d’échappement', () => {
    assert.equal(echapperLike('%%%'), '\\%\\%\\%');
    assert.equal(echapperLike('a_b\\c'), 'a\\_b\\\\c');
    assert.equal(echapperLike('doliprane'), 'doliprane');
  });
});

describe('recherche par nom', () => {
  // « %%% » passait le minimum de 3 caractères et valait toute la base.
  it('cherche les jokers tels quels', async () => {
    const vus = [];
    const pool = { query: async (_sql, params) => { vus.push(params); return { rows: [] }; } };
    await searchMedications(pool, { terms: ['%%%'], normalized: '%%%' });
    assert.equal(vus[0][0], '%\\%\\%\\%%');
    assert.equal(vus[0][1], '%%%', 'l’égalité exacte n’est pas un LIKE');
    assert.equal(vus[0][2], '\\%\\%\\%%');
  });
});
