import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  chercherDansDocuments, manqueIndex, normaliserRubrique, PLAFOND, PAR_PAGE,
} from '../../src/recherche-texte.js';

describe('normaliserRubrique', () => {
  it('accepte un numéro de rubrique, avec ou sans sous-niveau', () => {
    assert.equal(normaliserRubrique('4'), '4');
    assert.equal(normaliserRubrique('4.3'), '4.3');
    assert.equal(normaliserRubrique('10'), '10');
    assert.equal(normaliserRubrique(' 4.10 '), '4.10');
  });

  // Le numéro vient de l'URL, donc de n'importe où. Il entre dans un LIKE :
  // le vérifier ici est ce qui permet de ne pas s'en méfier plus loin.
  it('refuse tout ce qui n’est pas un numéro', () => {
    for (const piege of ['4.3.2', '%', "4' OR 1=1", '', null, undefined, 'quatre', '4;']) {
      assert.equal(normaliserRubrique(piege), null, String(piege));
    }
  });
});

describe('bornes', () => {
  // Classer par pertinence suppose d'avoir évalué chaque occurrence : sur un
  // mot courant, c'est cent mille rubriques pour un résultat que personne ne
  // lira. Le plafond est assumé, et la vue dit qu'il a été atteint.
  it('sont des valeurs, pas des nombres épars dans le code', () => {
    assert.equal(typeof PLAFOND, 'number');
    assert.ok(PLAFOND >= 1000, 'assez haut pour toute recherche utile');
    assert.ok(PAR_PAGE > 0 && PAR_PAGE <= 100);
  });
});

describe('manqueIndex', () => {
  // Les deux situations demandent des choses opposées : lancer une commande,
  // ou attendre. Une panne annoncée « momentanée » alors qu'elle est
  // définitive fait attendre pour rien.
  it('reconnaît une configuration de recherche absente', () => {
    assert.equal(manqueIndex({ code: '42704', message: 'text search configuration "french_nu" does not exist' }), true);
    assert.equal(manqueIndex({ code: '42883', message: 'function websearch_to_tsquery(unknown, unknown) does not exist' }), true);
  });

  it('ne prend pas une panne passagère pour une absence', () => {
    assert.equal(manqueIndex({ code: '57014', message: 'canceling statement due to statement timeout' }), false);
    assert.equal(manqueIndex({ code: '53300', message: 'too many connections' }), false);
    assert.equal(manqueIndex(null), false);
  });
});

/**
 * Un pool qui rend `n` lignes et retient les paramètres reçus.
 * On ne teste pas Postgres — on teste ce qu'on lui demande et ce qu'on fait de
 * sa réponse, qui est exactement là où la pagination peut mentir.
 */
const faussePool = (n) => {
  const vues = [];
  const ligne = (i) => ({
    code_cis: String(60000000 + i),
    document_type: 'rcp',
    position: i,
    numero: '4.4',
    libelle: 'Mises en garde',
    specialites: 1,
    score: 1 - i / 1000,
    denomination: `PRODUIT ${i}`,
    extrait: 'intervalle <mark>QT</mark>',
    occurrences: PLAFOND,
  });
  return {
    appels: vues,
    query: async (_texte, params) => {
      vues.push(params);
      return { rows: Array.from({ length: n }, (_, i) => ligne(i)) };
    },
  };
};

describe('pagination de la recherche plein texte', () => {
  // La page suivante ne se déduit d'aucun décompte : `occurrences` compte les
  // rubriques avant regroupement, donc majore. On demande une ligne de plus
  // que ce qu'on affiche, et sa présence répond à la question.
  it('demande une ligne de plus et ne la montre pas', async () => {
    const pool = faussePool(21);
    const d = await chercherDansDocuments(pool, 'intervalle QT', { limite: 20 });
    assert.equal(pool.appels[0][2], 21, 'limite + 1 dans la requête');
    assert.equal(d.resultats.length, 20, 'la ligne témoin ne s’affiche pas');
    assert.equal(d.suite, true);
  });

  it('annonce la fin quand la dernière page est incomplète', async () => {
    const d = await chercherDansDocuments(faussePool(7), 'intervalle QT', { limite: 20 });
    assert.equal(d.suite, false);
    assert.equal(d.resultats.length, 7);
  });

  it('traduit la page en décalage', async () => {
    const pool = faussePool(5);
    await chercherDansDocuments(pool, 'QT', { limite: 20, decalage: 40 });
    assert.equal(pool.appels[0][3], 40);
  });

  // Au-delà du plafond il n'y a plus rien à sauter : une page vide au milieu
  // d'un jeu de résultats se lit comme une panne, pas comme une fin.
  it('borne le décalage au plafond de la recherche', async () => {
    const pool = faussePool(0);
    await chercherDansDocuments(pool, 'QT', { decalage: 999999 });
    assert.equal(pool.appels[0][3], PLAFOND);
  });

  it('refuse un décalage négatif ou absurde', async () => {
    const pool = faussePool(0);
    for (const mauvais of [-5, NaN, undefined, 'douze']) {
      await chercherDansDocuments(pool, 'QT', { decalage: mauvais });
    }
    for (const params of pool.appels) assert.equal(params[3], 0);
  });
});
