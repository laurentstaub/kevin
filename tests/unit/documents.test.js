import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { groupByType, isEmpty, DOCUMENT_TYPES } from '../../src/documents.js';

describe('groupByType', () => {
  it('regroupe par type et laisse les types absents vides', () => {
    const grouped = groupByType([{ type: 'rcp' }, { type: 'rcp' }, { type: 'notice' }]);
    assert.equal(grouped.rcp.length, 2);
    assert.equal(grouped.notice.length, 1);
    assert.equal(grouped.main.length, 0);
  });

  it('ignore un type inconnu', () => {
    assert.equal(groupByType([{ type: 'exploit' }]).rcp.length, 0);
  });

  it('expose les quatre types présents en base, dans l’ordre d’affichage', () => {
    assert.deepEqual(DOCUMENT_TYPES, ['rcp', 'rcp_notice', 'notice', 'main']);
  });

  it('ne jette pas les documents de type rcp_notice', () => {
    // 2 101 lignes en base, soit ~15 % des CIS : elles étaient perdues.
    const grouped = groupByType([{ type: 'rcp_notice' }, { type: 'main' }]);
    assert.equal(grouped.rcp_notice.length, 1);
    assert.equal(grouped.main.length, 1);
  });
});

describe('isEmpty', () => {
  it('détecte l’absence totale de document', () => {
    assert.equal(isEmpty(groupByType([])), true);
    assert.equal(isEmpty(groupByType([{ type: 'rcp' }])), false);
  });
});
