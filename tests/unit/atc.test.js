import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resumerClasse } from '../../src/atc.js';

const CHAINE = [
  { code: 'N', label: 'Système nerveux', level: 1 },
  { code: 'N02', label: 'ANALGESIQUES', level: 2 },
  { code: 'N02B', label: 'AUTRES ANALGESIQUES ET ANTIPYRETIQUES', level: 3 },
  { code: 'N02BE', label: 'ANILIDES', level: 4 },
  { code: 'N02BE01', label: 'PARACETAMOL', level: 5 },
];

describe('resumerClasse', () => {
  it('ne garde que le contexte : groupe anatomique et classe thérapeutique', () => {
    const r = resumerClasse(CHAINE);
    assert.deepEqual(
      r.contexte.map((n) => n.code),
      ['N', 'N02'],
    );
    assert.equal(r.feuille.code, 'N02BE01');
  });

  it('écarte la taxonomie chimique et la DCI', () => {
    // Cent six signes en capitales rompaient le bandeau d'identité ; « ANILIDES »
    // ne sert pas au comptoir et « PARACETAMOL » est déjà affiché plus haut.
    const codes = resumerClasse(CHAINE).contexte.map((n) => n.code);
    for (const inutile of ['N02B', 'N02BE', 'N02BE01']) {
      assert.ok(!codes.includes(inutile), `${inutile} ne doit pas être dans l'en-tête`);
    }
  });

  it('montre la feuille elle-même quand la chaîne n’a pas de contexte', () => {
    const seule = [{ code: 'V', label: 'Divers', level: 1 }];
    const r = resumerClasse(seule);
    assert.deepEqual(r.contexte, seule);
    assert.equal(r.feuille.code, 'V');
  });

  it('rend null sans classe — un tiers des spécialités', () => {
    assert.equal(resumerClasse([]), null);
    assert.equal(resumerClasse(null), null);
    assert.equal(resumerClasse(undefined), null);
  });
});
