import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { config } from '../../src/config.js';
import { https, compresser } from '../../src/middleware.js';

const app = () => {
  const application = express();
  application.use(https);
  application.use(compresser);
  application.get('/page', (req, res) => res.send(`<p>${'Paracétamol '.repeat(200)}</p>`));
  application.get('/court', (req, res) => res.send('<p>court</p>'));
  application.get('/json', (req, res) => res.json({ texte: 'x'.repeat(2000) }));
  return application;
};

describe('compression des réponses', () => {
  it('compresse une page en gzip quand le client l’accepte, type et Vary compris', async () => {
    // supertest décompresse : l'en-tête dit l'encodage, le texte reste lisible.
    const res = await request(app()).get('/page').set('Accept-Encoding', 'gzip, br').expect(200);
    assert.equal(res.headers['content-encoding'], 'gzip');
    assert.match(res.headers['content-type'], /^text\/html; charset=utf-8/);
    assert.match(res.headers.vary, /Accept-Encoding/);
    assert.ok(Number(res.headers['content-length']) < 500, 'deux cents fois le même mot tiennent en peu d’octets');
    assert.match(res.text, /^<p>Paracétamol /);
  });

  it('laisse en clair une réponse courte, ou un client sans gzip', async () => {
    const court = await request(app()).get('/court').set('Accept-Encoding', 'gzip').expect(200);
    assert.equal(court.headers['content-encoding'], undefined);
    const sans = await request(app()).get('/page').set('Accept-Encoding', 'identity').expect(200);
    assert.equal(sans.headers['content-encoding'], undefined);
    assert.match(sans.text, /^<p>Paracétamol/);
  });

  it('compresse le JSON', async () => {
    const res = await request(app()).get('/json').set('Accept-Encoding', 'gzip').expect(200);
    assert.equal(res.headers['content-encoding'], 'gzip');
    assert.equal(res.body.texte.length, 2000);
  });
});

describe('HTTPS en production', () => {
  const avant = { env: config.env, publicUrl: config.publicUrl };
  afterEach(() => Object.assign(config, avant));

  it('redirige HTTP vers HTTPS et pose HSTS', async () => {
    Object.assign(config, { env: 'production', publicUrl: null });
    const redirige = await request(app()).get('/court?q=a').set('Host', 'kevin.test').set('X-Forwarded-Proto', 'http').expect(301);
    assert.equal(redirige.headers.location, 'https://kevin.test/court?q=a');
    const servi = await request(app()).get('/court').set('X-Forwarded-Proto', 'https').expect(200);
    assert.match(servi.headers['strict-transport-security'], /max-age=31536000/);
  });

  it('redirige vers l’adresse publique quand elle est fixée, depuis HTTP ou un autre hôte', async () => {
    Object.assign(config, { env: 'production', publicUrl: 'https://kevin.exemple.fr' });
    const http = await request(app()).get('/court').set('X-Forwarded-Proto', 'http').expect(301);
    assert.equal(http.headers.location, 'https://kevin.exemple.fr/court');
    const secours = await request(app()).get('/court?q=a').set('Host', 'dr-kevin.herokuapp.com').set('X-Forwarded-Proto', 'https').expect(301);
    assert.equal(secours.headers.location, 'https://kevin.exemple.fr/court?q=a');
    const servi = await request(app()).get('/court').set('Host', 'kevin.exemple.fr').set('X-Forwarded-Proto', 'https').expect(200);
    assert.equal(servi.headers.location, undefined);
  });

  it('ne fait rien hors production', async () => {
    Object.assign(config, { env: 'development' });
    const res = await request(app()).get('/court').set('X-Forwarded-Proto', 'http').expect(200);
    assert.equal(res.headers['strict-transport-security'], undefined);
  });
});
