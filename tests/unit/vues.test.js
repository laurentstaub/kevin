import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import pug from 'pug';
import { ROOT } from '../../src/config.js';

/**
 * Les gabarits se rendent, et pas seulement se compilent.
 *
 * `pug.compileFile` ne vérifie rien de ce qui se résout à l'exécution : un
 * mixin absent compile sans une plainte et casse à la première visite. C'est
 * arrivé sur la page des documents — elle appelait `barreSituation` sans
 * inclure `_barre.pug`, et trois vérifications « pug ok » de suite l'ont
 * laissée passer.
 *
 * Rendre chaque page avec des données minimales coûte quelques millisecondes
 * et attrape toute la famille : mixin manquant, variable indéfinie, boucle sur
 * ce qui n'est pas un tableau.
 */
const rendre = (vue, locals) => pug.renderFile(
  path.join(ROOT, 'views', `${vue}.pug`),
  { v: 'test', ...locals },
);

const RECHERCHE_VIDE = { resultats: [], total: 0, borne: false };

const PAGES = [
  ['search_page', { query: '', filter: 'all', results: null, classes: [] }],
  ['search_page', {
    query: 'aspirine',
    filter: 'all',
    results: { brandMatches: [], activeIngredientMatches: [], total: 0 },
    documents: RECHERCHE_VIDE,
  }],
  ['documents', { query: 'QT', rubrique: null, documents: RECHERCHE_VIDE }],
  ['documents', { query: 'QT', rubrique: '4.4', documents: RECHERCHE_VIDE, panne: 'indisponible' }],
  ['error', { title: 'Erreur', message: 'Cette page n’existe pas.', status: 404 }],
];

describe('rendu des gabarits', () => {
  for (const [vue, locals] of PAGES) {
    it(`${vue} se rend (${Object.keys(locals).join(', ')})`, () => {
      const html = rendre(vue, locals);
      assert.ok(html.includes('<!DOCTYPE html>') || html.includes('<!doctype html>'), 'document complet');
    });
  }

  // Le cas qui a cassé : une page qui appelle un mixin d'un fichier qu'elle
  // n'inclut pas. Le rendu est le seul moment où ça se voit.
  it('la page des documents dispose de la barre de situation', () => {
    const html = rendre('documents', { query: 'QT', rubrique: null, documents: RECHERCHE_VIDE });
    assert.match(html, /class="barre"/);
  });
});
