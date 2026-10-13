import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { normaliser, motDeTexte, reconnaitreMedicament } from '../../src/reconnaissance.js';
import { createApp } from '../../src/app.js';
import { config } from '../../src/config.js';

/** Base factice : « paracetamol » et « acide folique » sont des substances, « doliprane » une marque. */
const CONNUS = {
  substances: { paracetamol: 1, 'acide folique': 1, 'acide acetylsalicylique': 1, sodium: 300 },
  marques: new Set(['doliprane', 'aspirine']),
  // Nombres entiers des dénominations : DOLIPRANE 300 mg, 1000 mg, 2,4 %.
  dosages: { doliprane: ['300', '1000', '2,4'], paracetamol: ['500', '1000'] },
};
const poolFactice = {
  query: async (sql, params) => {
    if (sql.includes('AS nombre')) {
      const connus = CONNUS.dosages[params[0]] ?? [];
      return { rows: params[1].filter((nombre) => connus.includes(nombre)).map((nombre) => ({ nombre })) };
    }
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

  // « aspirine » est une marque (ASPIRINE UPSA) mais le pharmacien pense substance :
  // la table des noms courants la ramène à l'acide acétylsalicylique.
  it('ramène un nom courant à sa substance', async () => {
    assert.deepEqual(
      await reconnaitreMedicament(poolFactice, 'aspirine allaitement'),
      { molecule: 'acide acetylsalicylique', reste: 'allaitement' },
    );
  });

  it('préfère la paire au mot seul', async () => {
    assert.deepEqual(
      await reconnaitreMedicament(poolFactice, 'acide folique grossesse'),
      { molecule: 'acide folique', reste: 'grossesse' },
    );
  });

  // Reste vide : la route garde la recherche par nom et n'appelle pas l'IA.
  it('un nom avec dosage ou forme est reconnu, sans rien à chercher', async () => {
    assert.equal(await reconnaitreMedicament(poolFactice, 'paracetamol'), null);
    assert.deepEqual(await reconnaitreMedicament(poolFactice, 'doliprane 1000 mg'), { molecule: 'doliprane', reste: '' });
    assert.deepEqual(await reconnaitreMedicament(poolFactice, 'paracetamol gelule'), { molecule: 'paracetamol', reste: '' });
  });

  // Dosage et forme restreignent le médicament au lieu d'être cherchés dans le texte.
  it('rattache au médicament le nombre qui suit le nom', async () => {
    assert.deepEqual(
      await reconnaitreMedicament(poolFactice, 'doliprane 300 excipients'),
      { molecule: 'doliprane 300', reste: 'excipients' },
    );
  });

  it('rattache un nombre suivi d’une unité de dose, où qu’il soit', async () => {
    assert.deepEqual(
      await reconnaitreMedicament(poolFactice, '1000 mg de paracetamol à un enfant de 14 ans'),
      { molecule: 'paracetamol 1000', reste: 'de a un enfant de 14 ans' },
    );
    assert.deepEqual(
      await reconnaitreMedicament(poolFactice, 'doliprane 1000mg grossesse'),
      { molecule: 'doliprane 1000', reste: 'grossesse' },
    );
    assert.deepEqual(
      await reconnaitreMedicament(poolFactice, 'doliprane 2,4 % conservation'),
      { molecule: 'doliprane 2,4', reste: 'conservation' },
    );
  });

  // Juste après le nom, sans unité : un dosage seulement s'il existe pour ce médicament.
  it('laisse au texte un nombre qui n’est pas un dosage connu du médicament', async () => {
    assert.deepEqual(
      await reconnaitreMedicament(poolFactice, 'doliprane 3 ans'),
      { molecule: 'doliprane', reste: '3 ans' },
    );
    assert.deepEqual(
      await reconnaitreMedicament(poolFactice, 'paracetamol 4 fois par jour'),
      { molecule: 'paracetamol', reste: '4 fois par jour' },
    );
    assert.deepEqual(
      await reconnaitreMedicament(poolFactice, 'paracetamol 500 grossesse'),
      { molecule: 'paracetamol 500', reste: 'grossesse' },
    );
  });

  it('laisse au texte un nombre qui n’est pas un dosage', async () => {
    assert.deepEqual(
      await reconnaitreMedicament(poolFactice, 'paracetamol enfant 14 ans'),
      { molecule: 'paracetamol', reste: 'enfant 14 ans' },
    );
  });

  it('rattache la forme, au singulier', async () => {
    assert.deepEqual(
      await reconnaitreMedicament(poolFactice, 'doliprane suppositoires excipients'),
      { molecule: 'doliprane suppositoire', reste: 'excipients' },
    );
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

describe('routes : la base avant l’IA', () => {
  const avant = { ...config.ia };
  const app = createApp(poolFactice);
  beforeEach(() => Object.assign(config.ia, { fournisseur: 'mistral', cleMistral: 'test', modele: 'test' }));
  after(() => Object.assign(config.ia, avant));

  it('un médicament reconnu passe par la base, pas par l’IA', async () => {
    const res = await request(app).get('/search?q=paracetamol+femme+enceinte').expect(302);
    assert.match(res.headers.location, /molecule=paracetamol/);
    assert.doesNotMatch(res.headers.location, /ia=1/);
  });

  it('un nom avec dosage et forme ne va pas à l’IA', async () => {
    await request(app).get('/search?q=doliprane+1000+mg+comprime').expect(200);
  });

  // L'IA (indisponible ici) aurait traduit le reste ; à défaut, il part tel quel, la molécule venant de la base.
  it('une question autour d’un nom courant garde la molécule de la base', async () => {
    const res = await request(app).get('/search?q=une+femme+qui+allaite+peut-elle+prendre+de+l%27aspirine').expect(302);
    assert.match(res.headers.location, /molecule=acide\+acetylsalicylique/);
    assert.match(res.headers.location, /q=une\+femme\+qui\+allaite\+peut-elle\+prendre\+de&/);
  });

  it('sans médicament, trois mots restent une expression ; quatre vont à l’IA', async () => {
    await request(app).get('/search?q=allongement+intervalle+QT').expect(200);
    const res = await request(app).get('/search?q=risque+allongement+intervalle+QT').expect(302);
    assert.match(res.headers.location, /^\/documents\?q=/);
  });
});
