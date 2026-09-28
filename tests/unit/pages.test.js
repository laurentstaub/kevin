import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../../src/app.js';

/**
 * Rendu par l'application entière : détecte une locale qu'une route oublie de passer.
 * La base factice ne rend rien, volontairement : une page vide doit se rendre, sans Postgres.
 */
const poolVide = {
  query: async () => ({ rows: [] }),
  connect: async () => ({ query: async () => ({ rows: [] }), release() {} }),
  end: async () => {},
  on() {},
};

const PAGES = [
  ['/', 'accueil'],
  ['/search?q=aspirine', 'résultats par nom'],
  ['/search?q=aspirine&filter=active', 'résultats filtrés par principe actif'],
  ['/search?q=aspirine&filter=specialty', 'résultats filtrés par dénomination'],
  ['/search?q=ab', 'requête trop courte'],
  ['/documents?q=aspirine', 'plein texte'],
  ['/documents?q=aspirine&rubrique=4.4', 'plein texte filtré'],
  ['/documents?q=aspirine&page=2', 'plein texte, seconde page'],
  ['/documents?q=ab', 'plein texte, requête trop courte'],
  // Hors production, une fiche non relue se prévisualise.
  ['/fiches', 'index des fiches'],
  ['/fiches/torsadogenes', 'fiche torsadogènes (brouillon)'],
];

describe('rendu des pages, de bout en bout', () => {
  const app = createApp(poolVide);

  for (const [chemin, quoi] of PAGES) {
    it(`${quoi} — ${chemin}`, async () => {
      const res = await request(app).get(chemin);
      assert.equal(res.status, 200, `${chemin} a répondu ${res.status}`);
      assert.match(res.text, /<\/html>/, 'la page est rendue jusqu’au bout');
    });
  }

  it('une fiche inconnue est une 404', async () => {
    await request(app).get('/fiches/inconnue').expect(404);
    await request(app).get('/fiches/..%2Fpackage').expect(404);
  });

  it('renvoie à l’accueil sans requête', async () => {
    await request(app).get('/search').expect(302);
    await request(app).get('/documents').expect(302);
  });
});
