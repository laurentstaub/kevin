import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CONCEPTS_DOCUMENT } from '../../src/concepts-document.js';

const plier = (texte) => texte.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim().replace(/\s+/g, ' ');

describe('concepts du filtre de document', () => {
  it('chaque concept a des mots et des formes non vides', () => {
    assert.ok(CONCEPTS_DOCUMENT.length > 0);
    for (const { mots, formes } of CONCEPTS_DOCUMENT) {
      assert.ok(mots.length > 0 && formes.length > 0);
      for (const texte of [...mots, ...formes]) assert.ok(typeof texte === 'string' && plier(texte).length >= 2, texte);
    }
  });

  // La saisie entière désigne un seul concept : sinon, l'ordre de la table trancherait.
  it('un mot du comptoir n’appartient qu’à un concept', () => {
    const vus = new Map();
    for (const [indice, { mots }] of CONCEPTS_DOCUMENT.entries()) {
      for (const mot of mots) {
        const cle = plier(mot);
        assert.ok(!vus.has(cle) || vus.get(cle) === indice, `« ${mot} » dans deux concepts`);
        vus.set(cle, indice);
      }
    }
  });

  it('sécabilité cherche les mots des RCP', () => {
    const concept = CONCEPTS_DOCUMENT.find(({ mots }) => mots.includes('sécabilité'));
    for (const forme of ['barre de cassure', 'doses égales', 'être divisé', 'sécable']) assert.ok(concept.formes.includes(forme), forme);
  });
});
