import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery, parseFilter, firstString, isValidCis } from '../../src/validate.js';

describe('firstString', () => {
  it('renvoie la chaîne telle quelle', () => {
    assert.equal(firstString('aspirine'), 'aspirine');
  });

  it('prend la première valeur quand le paramètre est répété (?q=a&q=b)', () => {
    assert.equal(firstString(['a', 'b']), 'a');
  });

  it('renvoie une chaîne vide pour tout le reste', () => {
    for (const value of [undefined, null, { q: 1 }, 42]) {
      assert.equal(firstString(value), '');
    }
  });
});

describe('isValidCis', () => {
  it('accepte un code CIS à 8 chiffres', () => {
    assert.equal(isValidCis('61111111'), true);
  });

  it('refuse tout ce qui n’est pas 8 chiffres', () => {
    for (const value of ['abc', '', '123', '123456789', '6111111a', ' 61111111']) {
      assert.equal(isValidCis(value), false, `attendu invalide : ${JSON.stringify(value)}`);
    }
  });

  it('refuse les valeurs non textuelles', () => {
    assert.equal(isValidCis(61111111), false);
    assert.equal(isValidCis(null), false);
  });
});

describe('parseQuery', () => {
  it('découpe en termes normalisés', () => {
    const q = parseQuery('  ASPIRINE   500  ');
    assert.deepEqual(q.terms, ['aspirine', '500']);
    assert.equal(q.raw, 'ASPIRINE   500');
    assert.equal(q.tooShort, false);
  });

  it('signale les requêtes trop courtes', () => {
    assert.equal(parseQuery('as').tooShort, true);
    assert.equal(parseQuery('a b').tooShort, true);
    assert.equal(parseQuery('asp').tooShort, false);
  });

  it('borne le nombre de termes', () => {
    assert.equal(parseQuery('a b c d e f g h', { minLength: 1, maxTerms: 5 }).terms.length, 5);
  });

  it('borne la longueur totale', () => {
    assert.equal(parseQuery('x'.repeat(500)).raw.length, 120);
  });

  it('ne casse pas sur un paramètre répété', () => {
    assert.doesNotThrow(() => parseQuery(['aspirine', 'doliprane']));
    assert.deepEqual(parseQuery(['aspirine', 'doliprane']).terms, ['aspirine']);
  });
});

describe('parseFilter', () => {
  it('accepte les filtres connus', () => {
    assert.equal(parseFilter('specialty'), 'specialty');
    assert.equal(parseFilter('active'), 'active');
    assert.equal(parseFilter(['specialty']), 'specialty');
  });

  it('retombe sur "all" pour tout le reste', () => {
    assert.equal(parseFilter('xxx'), 'all');
    assert.equal(parseFilter(undefined), 'all');
  });
});
