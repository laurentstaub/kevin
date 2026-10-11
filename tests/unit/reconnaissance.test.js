import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { normaliser, motDeTexte, reconnaitreMedicament } from '../../src/reconnaissance.js';
import { createApp } from '../../src/app.js';

/** Base factice : « paracetamol » et « acide folique » sont des substances, « doliprane » une marque. */
const CONNUS = { substances: { paracetamol: 1, 'acide folique': 1, sodium: 300 }, marques: new Set(['doliprane']) };
const poolFactice = {
  query: async (sql, params) => {
    if (!sql.includes('FROM unnest($1::text[]) AS mot')) return { rows: [] };
    return {
      rows: params[0].map((mot) => ({
        mot, substances: CONNUS.substances[mot] ?? 0, marque: CONNUS.marques.has(mot),
      })),
    };
  },
  connect: async () => ({ query: async () => ({ rows: [] }), release() {} }),
  end: async () => {},
  on() {},
};

describe('mots de la saisie', () => {
  it('normalise sans accents ni ponctuation', () => {
    assert.equal(normaliser('Paracétamol,'), 'paracetamol');
    assert.equal(normaliser('allaitement ?'), 'allaitement');
  });

  it('distingue un mot de texte d’un nombre, d’une unité ou d’une forme', () => {
    assert.equal(motDeTexte('allaitement'), true);
    assert.equal(motDeTexte('qt'), true);
    for (const mot of ['1000', 'mg', 'gelule', 'lp']) assert.equal(motDeTexte(mot), false, mot);
  });
});

describe('reconnaissance d’un médicament', () => {
  it('sépare le médicament du reste', async () => {
    assert.deepEqual(
      await reconnaitreMedicament(poolFactice, 'Paracétamol allaitement'),
      { molecule: 'paracetamol', reste: 'allaitement' },
    );
    assert.deepEqual(
      await reconnaitreMedicament(poolFactice, 'allaitement doliprane ?'),
      { molecule: 'doliprane', reste: 'allaitement' },
    );
  });

  it('préfère la paire au mot seul', async () => {
    assert.deepEqual(
      await reconnaitreMedicament(poolFactice, 'acide folique grossesse'),
      { molecule: 'acide folique', reste: 'grossesse' },
    );
  });

  it('ne réoriente ni un nom seul, ni un nom avec dosage ou forme', async () => {
    assert.equal(await reconnaitreMedicament(poolFactice, 'paracetamol'), null);
    assert.equal(await reconnaitreMedicament(poolFactice, 'doliprane 1000 mg'), null);
    assert.equal(await reconnaitreMedicament(poolFactice, 'paracetamol gelule'), null);
  });

  it('ignore un composant générique et une saisie sans médicament', async () => {
    assert.equal(await reconnaitreMedicament(poolFactice, 'sodium allaitement'), null);
    assert.equal(await reconnaitreMedicament(poolFactice, 'allongement QT'), null);
  });
});

describe('routes : médicament reconnu', () => {
  const app = createApp(poolFactice);

  it('la recherche par nom renvoie vers les documents du médicament', async () => {
    const res = await request(app).get('/search?q=paracetamol+allaitement').expect(302);
    const url = new URL(res.headers.location, 'http://x');
    assert.equal(url.pathname, '/documents');
    assert.equal(url.searchParams.get('q'), 'allaitement');
    assert.equal(url.searchParams.get('molecule'), 'paracetamol');
    assert.equal(url.searchParams.get('question'), 'paracetamol allaitement');
    assert.equal(url.searchParams.get('ia'), null);
  });

  it('les documents aussi, tapés directement', async () => {
    const res = await request(app).get('/documents?q=doliprane+grossesse').expect(302);
    assert.match(res.headers.location, /molecule=doliprane/);
  });

  it('annonce la restriction, sans parler d’IA, et propose « tel quel »', async () => {
    const res = await request(app)
      .get('/documents?q=allaitement&molecule=paracetamol&question=paracetamol+allaitement')
      .expect(200);
    assert.match(res.text, /reconnu comme médicament/);
    assert.doesNotMatch(res.text, /interprétée par IA/);
    assert.match(res.text, /brut=1/);
  });

  it('un nom seul reste une recherche par nom', async () => {
    await request(app).get('/search?q=doliprane+1000').expect(200);
    await request(app).get('/search?q=paracetamol+allaitement&brut=1').expect(200);
  });
});
