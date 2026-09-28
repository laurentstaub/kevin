import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../../src/app.js';

/**
 * Les pages se rendent, toutes, jusqu'au bout.
 *
 * Les tests de rendu de vues fournissent eux-mêmes les locales des gabarits :
 * ils ne peuvent donc pas voir qu'une route a oublié d'en passer une. C'est
 * exactement ce qui est arrivé — la page d'accueil ne passait pas `lien` et
 * répondait 500, la suite restant verte.
 *
 * Ici, c'est l'application entière qui répond : ses app.locals, ses routes,
 * ses gabarits. Une locale manquante fait une 500, et la 500 fait un échec.
 *
 * La base est un trompe-l'œil qui ne rend jamais rien. C'est volontaire : on
 * ne teste pas les données — l'intégration s'en charge sur des fixtures — mais
 * le fait qu'une page vide se rende quand même, ce qui est aussi le cas d'une
 * recherche sans résultat, d'une base neuve, ou d'une table qu'on vient de
 * vider. Et ça s'exécute partout, sans Postgres, donc à chaque `npm test`.
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

  // Une recherche vide n'est pas une page : elle renvoie à l'accueil.
  it('renvoie à l’accueil sans requête', async () => {
    await request(app).get('/search').expect(302);
    await request(app).get('/documents').expect(302);
  });
});
