import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { config } from '../../src/config.js';

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

describe('question que l’IA ne sait pas interpréter', () => {
  // Sans `question` dans l'URL de repli, /documents se réorientait vers lui-même.
  it('mène aux documents en une redirection, sans boucle', async (contexte) => {
    const ia = { ...config.ia };
    Object.assign(config.ia, { fournisseur: 'mistral', cleMistral: 'test', modele: 'test' });
    contexte.mock.method(globalThis, 'fetch', async () => { throw new Error('IA injoignable'); });
    contexte.after(() => Object.assign(config.ia, ia));

    const app = createApp(poolVide);
    const premiere = await request(app).get('/documents?q=comment+ça+marche+avec+ça').expect(302);
    assert.match(premiere.headers.location, /question=/);

    const seconde = await request(app).get(premiere.headers.location);
    assert.equal(seconde.status, 200, `la redirection a mené à ${seconde.headers.location}`);
  });
});

describe('fiche produit, base en panne sur les conditions de délivrance', () => {
  // Une spécialité qui existe ; seule la table des conditions échoue.
  const pool = {
    ...poolVide,
    query: async (sql) => {
      if (sql.includes('cis_cpd_bdpm')) throw new Error('délai dépassé');
      if (sql.includes('cip_products')) {
        return { rows: [{ id: '60234100', denomination_medicament: 'X 10 mg, comprimé', commercialise: true, cip_products: [] }] };
      }
      return { rows: [] };
    },
  };

  it('ne dit pas « Sans ordonnance »', async (contexte) => {
    contexte.mock.method(console, 'error', () => {});
    const res = await request(createApp(pool)).get('/product/60234100').expect(200);
    assert.match(res.text, /Conditions indisponibles/);
    assert.doesNotMatch(res.text, /Sans ordonnance/);
  });
});

describe('fiche produit, base en panne sur la HAS et le remboursement', () => {
  const pool = {
    ...poolVide,
    query: async (sql) => {
      if (sql.includes('cis_has_smr') || sql.includes('indications_remboursement')) throw new Error('délai dépassé');
      if (sql.includes('cip_products')) {
        return { rows: [{ id: '60234100', denomination_medicament: 'X 10 mg, comprimé', commercialise: true, cip_products: [] }] };
      }
      return { rows: [] };
    },
  };

  it('dit les pannes au lieu de « Pas d’avis HAS » et d’une prise en charge entière', async (contexte) => {
    contexte.mock.method(console, 'error', () => {});
    const res = await request(createApp(pool)).get('/product/60234100').expect(200);
    assert.match(res.text, /Évaluation indisponible/);
    assert.doesNotMatch(res.text, /Pas d’avis HAS/);
    assert.match(res.text, /Prise en charge à vérifier/);
  });
});
