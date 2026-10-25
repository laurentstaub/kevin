import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { config } from '../../src/config.js';
import {
  estQuestion, validerInterpretation, interpreterQuestion, oublierInterpretations, lireMistral,
} from '../../src/ia.js';
import { createApp } from '../../src/app.js';

describe('question ou recherche', () => {
  it('reconnaît une question : « ? », mot interrogatif ou quatre mots', () => {
    assert.equal(estQuestion('tramadol allaitement ?'), true);
    assert.equal(estQuestion('metformine et insuffisance rénale'), true);
    assert.equal(estQuestion('comment arrêter paroxétine'), true);
    assert.equal(estQuestion('puis-je donner du tramadol à une femme qui allaite'), true);
  });

  it('laisse les recherches courtes, les expressions de trois mots et les expressions exactes', () => {
    assert.equal(estQuestion('tramadol'), false);
    assert.equal(estQuestion('allongement QT'), false);
    assert.equal(estQuestion('insuffisance hépatique sévère'), false);
    assert.equal(estQuestion('"insuffisance hépatique sévère chez le sujet âgé"'), false);
  });
});

describe('validation de la sortie du modèle', () => {
  it('garde des critères sûrs', () => {
    assert.deepEqual(
      validerInterpretation({ molecule: 'tramadol', rubrique: '4.6', mots: 'allaitement' }),
      { molecule: 'tramadol', rubrique: '4.6', mots: 'allaitement' },
    );
  });

  it('écarte une rubrique inconnue et une molécule suspecte', () => {
    assert.deepEqual(
      validerInterpretation({ molecule: '<script>', rubrique: '9.9', mots: 'allaitement ?' }),
      { molecule: null, rubrique: null, mots: 'allaitement' },
    );
  });

  // Vu en production : molecule « null » en toutes lettres, mots en liste à virgules.
  it('ramène « null » à rien et ne garde que la première expression d’une liste', () => {
    assert.deepEqual(
      validerInterpretation({
        molecule: 'null', rubrique: '4.4',
        mots: 'insuffisance hépatique sévère, ajustement posologique, contre-indication',
      }),
      { molecule: null, rubrique: '4.4', mots: 'insuffisance hépatique sévère' },
    );
  });

  it('ramène un nom courant de molécule à sa substance', () => {
    assert.equal(
      validerInterpretation({ molecule: 'aspirine', rubrique: '4.6', mots: 'allaitement' }).molecule,
      'acide acetylsalicylique',
    );
  });

  it('refuse une sortie sans mots-clés', () => {
    assert.equal(validerInterpretation({ molecule: 'tramadol', rubrique: '4.6', mots: '' }), null);
    assert.equal(validerInterpretation(null), null);
  });
});

describe('réponse Mistral', () => {
  it('lit le JSON du message', () => {
    const corps = { choices: [{ message: { content: '{"molecule":"tramadol","rubrique":"4.6","mots":"allaitement"}' } }] };
    assert.deepEqual(lireMistral(corps), { molecule: 'tramadol', rubrique: '4.6', mots: 'allaitement' });
  });

  it('rend null sur un contenu illisible', () => {
    assert.equal(lireMistral({ choices: [{ message: { content: 'pas du json' } }] }), null);
    assert.equal(lireMistral({}), null);
  });

  // Mode strict : chaînes vides plutôt que null.
  it('ramène les chaînes vides à null', () => {
    assert.deepEqual(
      validerInterpretation({ molecule: '', rubrique: '', mots: 'allaitement' }),
      { molecule: null, rubrique: null, mots: 'allaitement' },
    );
  });
});

describe('interprétation', () => {
  beforeEach(oublierInterpretations);

  it('n’appelle le modèle qu’une fois par question', async () => {
    let appels = 0;
    const appeler = async () => { appels += 1; return { molecule: 'tramadol', rubrique: '4.6', mots: 'allaitement' }; };
    await interpreterQuestion('Tramadol et allaitement ?', { appeler });
    await interpreterQuestion('tramadol et allaitement ?', { appeler });
    assert.equal(appels, 1);
  });
});

describe('routes, IA active', () => {
  const poolVide = {
    query: async () => ({ rows: [] }),
    connect: async () => ({ query: async () => ({ rows: [] }), release() {} }),
    end: async () => {},
    on() {},
  };
  const avant = { ...config.ia };
  const app = createApp(poolVide);
  const QUESTION = 'puis-je donner du tramadol à une femme qui allaite ?';

  beforeEach(async () => {
    Object.assign(config.ia, { fournisseur: 'mistral', cleMistral: 'test', modele: 'test' });
    oublierInterpretations();
    // Pré-remplit le cache : aucun appel réseau.
    await interpreterQuestion(QUESTION, {
      appeler: async () => ({ molecule: 'tramadol', rubrique: '4.6', mots: 'allaitement' }),
    });
  });
  after(() => Object.assign(config.ia, avant));

  it('envoie une question vers la recherche dans les documents', async () => {
    const res = await request(app).get(`/search?q=${encodeURIComponent(QUESTION)}`).expect(302);
    assert.match(res.headers.location, /^\/documents\?q=/);
  });

  it('traduit la question en critères explicites et retirables', async () => {
    const res = await request(app).get(`/documents?q=${encodeURIComponent(QUESTION)}`).expect(302);
    const url = new URL(res.headers.location, 'http://x');
    assert.equal(url.searchParams.get('q'), 'allaitement');
    assert.equal(url.searchParams.get('rubrique'), '4.6');
    assert.equal(url.searchParams.get('molecule'), 'tramadol');
    assert.equal(url.searchParams.get('question'), QUESTION);
    assert.equal(url.searchParams.get('ia'), '1');
  });

  it('annonce l’interprétation et propose de chercher tel quel', async () => {
    const res = await request(app)
      .get(`/documents?q=allaitement&molecule=tramadol&ia=1&question=${encodeURIComponent(QUESTION)}`)
      .expect(200);
    assert.match(res.text, /interprétée par Kevin/);
    assert.match(res.text, /brut=1/);
    // Le nom mène aux spécialités de la molécule ; seule la croix retire le filtre.
    assert.match(res.text, /class="jeton-nom" href="\/search\?q=tramadol"[^>]*>Tramadol/);
    assert.match(res.text, /class="jeton-croix" href="\/documents\?q=allaitement[^"]*"[^>]*>×/);
    assert.doesNotMatch(res.text, /class="jeton-croix" href="[^"]*molecule=/);
  });

  // Vu en production : 6.1 (excipients) pour une question d'allaitement. La base factice
  // ne rend rien : la rubrique de l'IA tombe, le reste de l'interprétation est gardé.
  it('une rubrique choisie par l’IA et vide est abandonnée', async () => {
    const res = await request(app)
      .get(`/documents?q=allaitement&rubrique=6.1&molecule=tramadol&ia=1&question=${encodeURIComponent(QUESTION)}`)
      .expect(302);
    assert.doesNotMatch(res.headers.location, /rubrique=/);
    assert.match(res.headers.location, /molecule=tramadol/);
    assert.match(res.headers.location, /ia=1/);
  });

  it('« tel quel » ne réinterprète pas', async () => {
    await request(app).get(`/documents?q=${encodeURIComponent(QUESTION)}&brut=1`).expect(200);
  });

  it('IA inactive : rien ne change', async () => {
    Object.assign(config.ia, { cleMistral: undefined });
    await request(app).get(`/search?q=${encodeURIComponent(QUESTION)}`).expect(200);
  });
});

// « couper le Lévothyrox ? » : le nom reconnu par la base, il ne restait que
// « couper le », deux mots sans point d'interrogation, jamais envoyés à l'IA.
describe('question qui nomme un médicament', () => {
  const poolLevothyrox = {
    query: async (sql, params) => (sql.includes('FROM unnest($1::text[]) AS mot')
      ? { rows: params[0].map((mot) => ({ mot, substances: 0, marque: mot === 'levothyrox' })) }
      : { rows: [] }),
    connect: async () => ({ query: async () => ({ rows: [] }), release() {} }),
    end: async () => {},
    on() {},
  };
  const avant = { ...config.ia };
  const app = createApp(poolLevothyrox);
  const QUESTION = 'couper le Lévothyrox ?';

  beforeEach(async () => {
    Object.assign(config.ia, { fournisseur: 'mistral', cleMistral: 'test', modele: 'test' });
    oublierInterpretations();
    await interpreterQuestion(QUESTION, {
      appeler: async () => ({ molecule: 'lévothyrox', rubrique: '3', mots: 'divisé' }),
    });
  });
  after(() => Object.assign(config.ia, avant));

  it('envoie la question entière à l’IA, la molécule reste celle de la base', async () => {
    const res = await request(app).get(`/search?q=${encodeURIComponent(QUESTION)}`).expect(302);
    const url = new URL(res.headers.location, 'http://x');
    assert.equal(url.pathname, '/documents');
    assert.equal(url.searchParams.get('q'), 'divisé');
    assert.equal(url.searchParams.get('rubrique'), '3');
    assert.equal(url.searchParams.get('molecule'), 'levothyrox');
    assert.equal(url.searchParams.get('ia'), '1');
  });
});
