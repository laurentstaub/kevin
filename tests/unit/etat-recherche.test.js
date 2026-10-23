import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { lireEtat, lien, titre } from '../../src/etat-recherche.js';

const DOCS = lireEtat({ q: 'CYP 3A4', rubrique: '4.5', page: '3' }, 'documents');

describe('lireEtat', () => {
  it('normalise ce qui vient de l’URL', () => {
    assert.equal(DOCS.mode, 'documents');
    assert.equal(DOCS.requete, 'CYP 3A4');
    assert.equal(DOCS.rubrique, '4.5');
    assert.equal(DOCS.page, 3);
  });

  it('écarte ce qui n’est pas une rubrique, un filtre ou une page', () => {
    const e = lireEtat({ q: 'x', rubrique: "4' OR 1=1", filter: 'sql', page: 'douze' }, 'documents');
    assert.equal(e.rubrique, null);
    assert.equal(e.filtre, 'all');
    assert.equal(e.page, 1);
  });

  it('retombe sur la recherche par nom si le mode est inconnu', () => {
    assert.equal(lireEtat({ q: 'x' }, 'ailleurs').mode, 'nom');
  });
});

describe('lien', () => {
  it('rend l’état courant tel quel', () => {
    assert.equal(lien(DOCS), '/documents?q=CYP+3A4&rubrique=4.5&page=3');
  });

  it('ne change que la clé qu’on lui donne', () => {
    assert.equal(lien(DOCS, { page: 4 }), '/documents?q=CYP+3A4&rubrique=4.5&page=4');
  });

  // Sert à retirer le jeton de filtre.
  it('retire une clé avec null', () => {
    assert.equal(lien(DOCS, { rubrique: null }), '/documents?q=CYP+3A4');
  });

  // Sinon changer de rubrique en page 3 mène sur une page vide.
  it('remet la page à 1 dès qu’autre chose change', () => {
    assert.equal(lien(DOCS, { rubrique: '4.8' }), '/documents?q=CYP+3A4&rubrique=4.8');
  });

  // La recherche par nom ne connaît pas les rubriques.
  it('abandonne ce qui n’a pas cours dans le mode d’arrivée', () => {
    assert.equal(lien(DOCS, { mode: 'nom' }), '/search?q=CYP+3A4');
    assert.equal(
      lien(DOCS, { mode: 'nom', filtre: 'active' }),
      '/search?q=CYP+3A4&filter=active',
    );
  });

  // Un même état, une seule URL.
  it('n’écrit pas les valeurs par défaut', () => {
    const nom = lireEtat({ q: 'aspirine', filter: 'all' }, 'nom');
    assert.equal(lien(nom), '/search?q=aspirine');
    assert.equal(lien(DOCS, { page: 1 }), '/documents?q=CYP+3A4&rubrique=4.5');
  });

  it('rend un chemin nu sans requête', () => {
    assert.equal(lien({ mode: 'documents' }), '/documents');
  });
});

describe('titre', () => {
  // Distingue les onglets de plusieurs recherches.
  it('porte la requête et sa restriction', () => {
    assert.equal(titre(DOCS), '« CYP 3A4 » — rubrique 4.5 · Médipile');
    assert.equal(titre(lireEtat({ q: 'aspirine' }, 'nom')), '« aspirine » · Médipile');
    assert.equal(titre(lireEtat({}, 'nom')), 'Médipile');
  });
});
