import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canonique, substituer } from '../../src/synonymes.js';

describe('noms courants des substances', () => {
  it('donne la substance d’un nom courant', () => {
    assert.equal(canonique('Aspirine'), 'acide acetylsalicylique');
    assert.equal(canonique('vitamine  C'), 'acide ascorbique');
    assert.equal(canonique('paracétamol'), null);
  });

  it('substitue les noms courants dans une saisie, mots entiers seulement', () => {
    assert.equal(substituer('aspirine allaitement'), 'acide acetylsalicylique allaitement');
    assert.equal(substituer('Vitamine B12 grossesse'), 'cyanocobalamine grossesse');
    assert.equal(substituer('aspirines'), 'aspirines');
    assert.equal(substituer('tramadol'), 'tramadol');
  });
});
