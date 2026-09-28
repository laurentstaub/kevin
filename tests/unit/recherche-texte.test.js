import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  chercherDansDocuments, extraitDeRubrique, rechercheAbsente, composerTsquery, expressionExacte,
  normaliserRubrique, PLAFOND, PAR_PAGE, APERCU,
} from '../../src/recherche-texte.js';

describe('normaliserRubrique', () => {
  it('accepte un numéro de rubrique, avec ou sans sous-niveau', () => {
    assert.equal(normaliserRubrique('4'), '4');
    assert.equal(normaliserRubrique('4.3'), '4.3');
    assert.equal(normaliserRubrique('10'), '10');
    assert.equal(normaliserRubrique(' 4.10 '), '4.10');
  });

  // Le numéro vient de l'URL et entre dans un LIKE.
  it('refuse tout ce qui n’est pas un numéro', () => {
    for (const piege of ['4.3.2', '%', "4' OR 1=1", '', null, undefined, 'quatre', '4;']) {
      assert.equal(normaliserRubrique(piege), null, String(piege));
    }
  });
});

describe('bornes', () => {
  // Le classement évalue chaque occurrence : plafond assumé, signalé par la vue.
  it('sont des valeurs, pas des nombres épars dans le code', () => {
    assert.equal(typeof PLAFOND, 'number');
    assert.ok(PLAFOND >= 1000, 'assez haut pour toute recherche utile');
    assert.ok(PAR_PAGE > 0 && PAR_PAGE <= 100);
  });

  // Groupée par molécule et repliée, une trouvaille n'occupe qu'une ligne.
  it('rendent assez de lignes pour que la page vaille la peine', () => {
    assert.ok(PAR_PAGE >= 50, 'la vue complète remplit l’écran');
    assert.ok(APERCU >= 10 && APERCU < PAR_PAGE, 'l’aperçu en montre moins, pas cinq');
  });
});

describe('rechercheAbsente', () => {
  // Absence (lancer la migration) et panne passagère (attendre) appellent des gestes opposés.
  it('reconnaît une configuration de recherche absente', () => {
    assert.equal(rechercheAbsente({ code: '42704', message: 'text search configuration "french_nu" does not exist' }), true);
    assert.equal(rechercheAbsente({ code: '42883', message: 'function websearch_to_tsquery(unknown, unknown) does not exist' }), true);
  });

  // Base non migrée : `s.vecteur` manque, ce n'est pas une panne passagère.
  it('reconnaît la colonne vecteur absente', () => {
    assert.equal(rechercheAbsente({
      code: '42703', message: 'column s.vecteur does not exist',
    }), true);
  });

  it('ne prend pas une panne passagère pour une absence', () => {
    assert.equal(rechercheAbsente({ code: '57014', message: 'canceling statement due to statement timeout' }), false);
    assert.equal(rechercheAbsente({ code: '53300', message: 'too many connections' }), false);
    assert.equal(rechercheAbsente(null), false);
  });
});

/** Pool factice qui rend `n` lignes et retient les paramètres reçus. */
const faussePool = (nombre) => {
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
      return { rows: Array.from({ length: nombre }, (_, i) => ligne(i)) };
    },
  };
};

describe('pagination de la recherche plein texte', () => {
  // `occurrences` majore (compté avant regroupement) : la ligne en plus dit s'il y a une suite.
  it('demande une ligne de plus et ne la montre pas', async () => {
    const pool = faussePool(21);
    const recherche = await chercherDansDocuments(pool, 'intervalle QT', { limite: 20 });
    assert.equal(pool.appels[0][1], 21, 'limite + 1 dans la requête');
    assert.equal(recherche.resultats.length, 20, 'la ligne témoin ne s’affiche pas');
    assert.equal(recherche.suite, true);
  });

  it('annonce la fin quand la dernière page est incomplète', async () => {
    const recherche = await chercherDansDocuments(faussePool(7), 'intervalle QT', { limite: 20 });
    assert.equal(recherche.suite, false);
    assert.equal(recherche.resultats.length, 7);
  });

  it('traduit la page en décalage', async () => {
    const pool = faussePool(5);
    await chercherDansDocuments(pool, 'QT', { limite: 20, decalage: 40 });
    assert.equal(pool.appels[0][2], 40);
  });

  // Au-delà, une page vide se lirait comme une panne.
  it('borne le décalage au plafond de la recherche', async () => {
    const pool = faussePool(0);
    await chercherDansDocuments(pool, 'QT', { decalage: 999999 });
    assert.equal(pool.appels[0][2], PLAFOND);
  });

  it('refuse un décalage négatif ou absurde', async () => {
    const pool = faussePool(0);
    for (const mauvais of [-5, NaN, undefined, 'douze']) {
      await chercherDansDocuments(pool, 'QT', { decalage: mauvais });
    }
    for (const params of pool.appels) assert.equal(params[2], 0);
  });
});

describe('extraitDeRubrique', () => {
  const espion = () => {
    const vus = [];
    return {
      vus,
      query: async (_sql, params) => {
        vus.push(params);
        return { rows: [{ numero: '4.5', libelle: 'Interactions', denomination: 'PROGRAF', extrait: 'x' }] };
      },
    };
  };

  it('désigne la rubrique par sa clé primaire', async () => {
    const pool = espion();
    const extrait = await extraitDeRubrique(pool, { cis: '66297965', type: 'rcp', position: '12', requete: 'QT' });
    // Les atomes, en nombre variable, viennent après les trois clés.
    assert.deepEqual(pool.vus[0].slice(0, 3), ['66297965', 'rcp', 12]);
    assert.ok(pool.vus[0].slice(3).includes('QT'));
    assert.equal(extrait.numero, '4.5');
  });

  // Les trois paramètres viennent de l'URL.
  it('refuse ce qui n’est pas une rubrique, sans toucher la base', async () => {
    const pool = espion();
    for (const mauvais of [
      { cis: 'abc', type: 'rcp', position: '1', requete: 'QT' },
      { cis: '66297965', type: 'autre', position: '1', requete: 'QT' },
      { cis: '66297965', type: 'rcp', position: 'douze', requete: 'QT' },
      { cis: '66297965', type: 'rcp', position: '1', requete: '   ' },
      { cis: '12', type: 'rcp', position: '1', requete: 'QT' },
    ]) {
      assert.equal(await extraitDeRubrique(pool, mauvais), null, JSON.stringify(mauvais));
    }
    assert.equal(pool.vus.length, 0, 'aucune requête n’a été lancée');
  });
});

describe('composition de la requête tsquery', () => {
  // websearch_to_tsquery inverse la précédence voulue de « OR » : un websearch par alternative.
  it('un ET entre les concepts, un OU entre les alternatives', () => {
    const { sql, params } = composerTsquery([['sertraline'], ['QT', '"torsade de pointes"']], 4);
    assert.equal(params.length, 3);
    assert.deepEqual(params, ['sertraline', 'QT', '"torsade de pointes"']);
    assert.match(sql, /^websearch_to_tsquery\('french_nu', \$4\) && \(websearch_to_tsquery\('french_nu', \$5\) \|\| websearch_to_tsquery\('french_nu', \$6\)\)$/);
  });

  it('ne met aucune valeur dans le SQL', () => {
    const { sql } = composerTsquery([["'); DROP TABLE docs.rcp_sections; --"]], 4);
    assert.doesNotMatch(sql, /DROP/);
  });

  it('rend une requête vide, pas une erreur, sans atome', () => {
    const { sql, params } = composerTsquery([], 4);
    assert.equal(params.length, 0);
    assert.match(sql, /websearch_to_tsquery\('french_nu', ''\)/);
  });
});

describe('expression exacte', () => {
  // Mots dans l'ordre classés devant mots dispersés.
  it('retient une expression de plusieurs mots', () => {
    assert.equal(expressionExacte(' insuffisance hépatique sévère '), 'insuffisance hépatique sévère');
  });

  // Mot seul, locution entre guillemets ou requête avec opérateur.
  it('ne distingue rien quand il n’y a rien à distinguer', () => {
    for (const saisie of ['QT', '"torsade de pointes"', 'QT -torsade', 'QT or torsade', '']) {
      assert.equal(expressionExacte(saisie), null, saisie);
    }
  });

  it('passe en quatrième paramètre, avant les atomes', async () => {
    const vus = [];
    const pool = { query: async (_s, params) => { vus.push(params); return { rows: [] }; } };
    await chercherDansDocuments(pool, 'insuffisance hépatique');
    assert.equal(vus[0][3], 'insuffisance hépatique');
    await chercherDansDocuments(pool, 'QT');
    assert.equal(vus[1][3], null);
  });
});
