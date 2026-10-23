import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { config } from '../../src/config.js';
import { lireFiche, publiee, DOSSIER_PAGES } from '../../src/fiches.js';
import { lienSignalement } from '../../src/signalement.js';

const poolVide = {
  query: async () => ({ rows: [] }),
  connect: async () => ({ query: async () => ({ rows: [] }), release() {} }),
  end: async () => {},
  on() {},
};

describe('pages du site', () => {
  it('« Pourquoi Médipile » est signée, pas encore relue ; les mentions légales sont complètes et publiées', () => {
    const pourquoi = lireFiche('pourquoi-medipile', DOSSIER_PAGES);
    assert.equal(pourquoi.meta.titre, 'Pourquoi Médipile');
    assert.match(pourquoi.meta.auteur, /docteur en pharmacie/);
    assert.equal(publiee(pourquoi), false);
    const mentions = lireFiche('mentions-legales', DOSSIER_PAGES);
    assert.equal(mentions.aCompleter, false);
    assert.equal(publiee(mentions), true);
    assert.match(JSON.stringify(mentions.blocs), /RCS de Paris sous le numéro 948 306 865/);
  });

  it('une page datée mais « à compléter » ne se publie pas', () => {
    const page = { meta: { relu: '2026-10-22' }, aCompleter: true };
    assert.equal(publiee(page), false);
    assert.equal(publiee({ ...page, aCompleter: false }), true);
    assert.equal(publiee({ meta: {}, aCompleter: false }), false);
  });
});

describe('routes des pages et pied de page', () => {
  const app = createApp(poolVide);
  const env = config.env;
  after(() => { config.env = env; });

  it('en développement : brouillon visible, lié depuis le pied', async () => {
    config.env = 'development';
    const res = await request(app).get('/pourquoi').expect(200);
    assert.match(res.text, /class="brouillon"/);
    assert.match(res.text, /<footer class="pied">.*href="\/mentions-legales">Mentions légales<\/a>/s);
    assert.match(res.text, /href="mailto:contact@medipile\.fr"/);
    // Dans le texte de la page aussi : le Markdown admet les liens mailto.
    assert.match(res.text, /<p>[^<]*<a href="mailto:contact@medipile\.fr">contact@medipile\.fr<\/a>/);
    const mentions = await request(app).get('/mentions-legales').expect(200);
    assert.doesNotMatch(mentions.text, /class="brouillon"|à compléter/);
  });

  it('en production : une page non relue n’a pas d’adresse ni de lien, une page relue en a', async () => {
    config.env = 'production';
    await request(app).get('/pourquoi').expect(404);
    const mentions = await request(app).get('/mentions-legales').expect(200);
    assert.match(mentions.text, /capital de 3 000 euros/);
    const accueil = await request(app).get('/fiches').expect(200);
    assert.doesNotMatch(accueil.text, /href="\/pourquoi"/);
    assert.match(accueil.text, /href="\/mentions-legales"/);
    assert.match(accueil.text, /href="mailto:contact@medipile\.fr"/);
  });
});

describe('signaler une erreur', () => {
  it('prépare un courriel qui situe la rubrique', () => {
    const lien = lienSignalement({
      cis: '60234100', denomination: 'DOLIPRANE 1000 mg, comprimé', type: 'rcp',
      numero: '4.2', libelle: 'Posologie et mode d’administration', adresse: 'https://medipile.fr/product/60234100#rcp-7',
    });
    assert.match(lien, /^mailto:contact@medipile\.fr\?subject=/);
    const url = new URL(lien);
    assert.equal(url.searchParams.get('subject'), 'Erreur · DOLIPRANE 1000 mg, comprimé · RCP 4.2');
    const corps = url.searchParams.get('body');
    assert.match(corps, /CIS 60234100/);
    assert.match(corps, /Rubrique : 4\.2 Posologie/);
    assert.match(corps, /Page : https:\/\/medipile\.fr\/product\/60234100#rcp-7/);
  });
});
