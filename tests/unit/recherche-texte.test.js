import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  chercherDansDocuments, extraitDeRubrique, rechercheAbsente, composerTsquery, expressionExacte,
  normaliserRubrique, marquer, MOLECULES_MAX, PAR_PAGE, APERCU, MINIMUM_CIBLE, motsTrouves,
  composerProximite, composerTitre, lireRubrique, LECTURE_FORMES_MAX,
} from '../../src/recherche-texte.js';
import { config } from '../../src/config.js';

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
  // Toutes les occurrences sont classées ; seules les premières molécules sont détaillées.
  it('sont des valeurs, pas des nombres épars dans le code', () => {
    assert.equal(typeof MOLECULES_MAX, 'number');
    assert.ok(MOLECULES_MAX >= 2 * PAR_PAGE, 'quelques pages avant d’inviter à affiner');
    assert.ok(PAR_PAGE > 0 && PAR_PAGE <= 100);
  });

  // Groupée par molécule et repliée, une trouvaille n'occupe qu'une ligne.
  it('rendent assez de lignes pour que la page vaille la peine', () => {
    assert.ok(PAR_PAGE >= 50, 'la vue complète remplit l’écran');
    assert.ok(APERCU >= 10 && APERCU < PAR_PAGE, 'l’aperçu en montre moins, pas cinq');
  });

  // « olanzapine QT » : la base reconnaît le médicament, il reste « QT », deux lettres.
  it('laissent passer un terme de deux lettres dans les documents d’un médicament', () => {
    assert.equal(MINIMUM_CIBLE, 2);
    assert.ok(MINIMUM_CIBLE <= config.search.minLength);
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
    occurrences: 10358,
    molecules: 461,
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
  it('borne le décalage aux molécules détaillées', async () => {
    const pool = faussePool(0);
    await chercherDansDocuments(pool, 'QT', { decalage: 999999 });
    assert.equal(pool.appels[0][2], MOLECULES_MAX);
  });

  // Le total est exact ; la borne dit qu'il y a plus de molécules que de détaillées.
  it('rend le total exact et le nombre de molécules', async () => {
    const recherche = await chercherDansDocuments(faussePool(3), 'QT', { limite: 20 });
    assert.equal(recherche.total, 10358);
    assert.equal(recherche.molecules, 461);
    assert.equal(recherche.borne, true);
    assert.equal(recherche.moleculesMax, MOLECULES_MAX);
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

describe('mots trouvés, pour le surlignage de la fiche', () => {
  it('rend les formes marquées par ts_headline, sans doublon, en minuscules', async () => {
    const pool = { query: async () => ({ rows: [
      { marque: 'Des cas d’⟦insuffisance⟧ ⟦hépatique⟧ sévère' },
      { marque: 'des ⟦Insuffisances⟧ ⟦hépatiques⟧ et ⟦insuffisance⟧' },
    ] }) };
    assert.deepEqual(await motsTrouves(pool, '60234100', 'insuffisance hépatique'),
      ['insuffisance', 'hépatique', 'insuffisances', 'hépatiques']);
  });

  it('ne lance rien sans saisie ni CIS valide', async () => {
    const pool = { query: async () => { throw new Error('appelé'); } };
    assert.deepEqual(await motsTrouves(pool, '60234100', '  '), []);
    assert.deepEqual(await motsTrouves(pool, 'x', 'foie'), []);
  });
});

describe('proximité des concepts', () => {
  it('rapproche chaque concept du suivant, dans les deux sens, jusqu’à l’écart donné', () => {
    const sql = composerProximite(['A', 'B', 'C'], 2);
    assert.equal(sql, '(tsquery_phrase(A, B, 1) || tsquery_phrase(B, A, 1) || tsquery_phrase(A, B, 2) || tsquery_phrase(B, A, 2))'
      + ' && (tsquery_phrase(B, C, 1) || tsquery_phrase(C, B, 1) || tsquery_phrase(B, C, 2) || tsquery_phrase(C, B, 2))');
  });

  it('ne contraint rien pour un seul concept', () => {
    assert.equal(composerProximite(['A']), null);
  });
});

describe('titre de rubrique', () => {
  it('retient un concept au moins dans le titre', () => {
    assert.equal(composerTitre(['A', '(B || C)']), '(A || (B || C))');
  });

  it('ne retient rien sans concept', () => {
    assert.equal(composerTitre([]), "websearch_to_tsquery('french_nu', '')");
  });

  it('fait passer devant la rubrique dont le titre porte un mot cherché', async () => {
    const textes = [];
    const pool = { query: async (texte) => { textes.push(texte); return { rows: [] }; } };
    await chercherDansDocuments(pool, 'excipients', { limite: 20 });
    assert.match(textes[0], /AS titre/);
    assert.match(textes[0], /to_tsvector\('french_nu', coalesce\(s\.libelle, ''\)\) @@ q\.titre THEN -100/);
  });
});

describe('filtre médicament', () => {
  // « doliprane 100 » ne doit pas ramener DOLIPRANE 1000 mg.
  it('compare un dosage au nombre entier de la dénomination', async () => {
    const textes = [];
    const pool = { query: async (texte) => { textes.push(texte); return { rows: [] }; } };
    await chercherDansDocuments(pool, 'excipients', { molecule: 'doliprane 100', limite: 20 });
    assert.match(textes[0], /\(\^\|\[\^0-9,\]\)' \|\| mot \|\| '\(\$\|\[\^0-9,\]\)/);
  });
});

describe('marquer', () => {
  // `texte` est décodé : « <LSN » s'ouvrirait en balise si l'extrait partait tel quel.
  it('échappe le texte et ne garde que les <mark>', () => {
    assert.equal(marquer('ALAT <LSN \u27e6foie\u27e7'), 'ALAT &lt;LSN <mark>foie</mark>');
    assert.equal(marquer('<img src=x onerror="a()">'), '&lt;img src=x onerror=&quot;a()&quot;&gt;');
    assert.equal(marquer('a & b'), 'a &amp; b');
  });

  it('laisse l’absence d’extrait telle quelle', () => {
    assert.equal(marquer(null), null);
    assert.equal(marquer(undefined), null);
  });

  it('échappe aussi l’extrait servi au survol', async () => {
    const pool = { query: async () => ({ rows: [{ numero: '4.4', extrait: 'x <b> \u27e6QT\u27e7' }] }) };
    const extrait = await extraitDeRubrique(pool, { cis: '66297965', type: 'rcp', position: '1', requete: 'QT' });
    assert.equal(extrait.extrait, 'x &lt;b&gt; <mark>QT</mark>');
  });
});

describe('saisies venues de l’URL', () => {
  it('borne la saisie de l’extrait au survol', async () => {
    const vus = [];
    const pool = { query: async (_sql, params) => { vus.push(params); return { rows: [] }; } };
    await extraitDeRubrique(pool, { cis: '66297965', type: 'rcp', position: '1', requete: 'qt '.repeat(2000) });
    assert.ok(vus[0].length < 120, `${vus[0].length} paramètres`);
  });

  it('échappe les jokers LIKE du filtre par médicament', async () => {
    const vus = [];
    const pool = { query: async (_sql, params) => { vus.push(params); return { rows: [] }; } };
    await chercherDansDocuments(pool, 'allaitement', { molecule: '%' });
    assert.equal(vus[0][4], '\\%');
  });
});

describe('lireRubrique', () => {
  // La base rend une ligne par forme ; `nombre` compte toutes les formes retenues.
  const pool = (lignes) => ({ query: async () => ({ rows: lignes }) });
  const ligne = (champs) => ({
    code_cis: '60000000', denomination: 'X 10 mg, comprimé', commercialise: true, nombre: 1, a_rcp: true,
    document_type: 'rcp', position: 3, libelle: 'Forme pharmaceutique', texte: 'Comprimé.', trouve: false, passage: null,
    ...champs,
  });
  const lire = (lignes, requete = 'sécable') => lireRubrique(pool(lignes), { molecule: 'x 10', rubrique: '3', requete });

  it('dit le statut de chaque forme : trouvé, entier, muet, vide, absent, sans RCP', async () => {
    const formes = await lire([
      ligne({ trouve: true, passage: 'Comprimé \u27e6sécable\u27e7.' }),
      ligne({}),
      ligne({ texte: 'Lorem ipsum. '.repeat(60) }),
      ligne({ texte: '  ' }),
      ligne({ document_type: null, position: null, texte: null }),
      ligne({ a_rcp: false, document_type: null, texte: null }),
    ].map((forme) => ({ ...forme, nombre: 6 })));
    assert.deepEqual(formes.map((forme) => forme.statut), ['trouve', 'entiere', 'muette', 'vide', 'absente', 'sans-rcp']);
    assert.equal(formes[0].html, 'Comprimé <mark>sécable</mark>.');
    assert.equal(formes[1].html, 'Comprimé.');
    assert.equal(formes[0].ancre, 'rcp-3');
    assert.equal(formes[4].ancre, null);
  });

  it('rend la main au-delà de LECTURE_FORMES_MAX formes, ou sans filtre, rubrique ou requête', async () => {
    assert.equal(await lire([ligne({ nombre: LECTURE_FORMES_MAX + 1 })]), null);
    assert.equal(await lire([]), null);
    assert.equal(await lireRubrique(pool([ligne({})]), { molecule: '', rubrique: '3', requete: 'x' }), null);
    assert.equal(await lireRubrique(pool([ligne({})]), { molecule: 'x', rubrique: 'abc', requete: 'x' }), null);
    assert.equal(await lireRubrique(pool([ligne({})]), { molecule: 'x', rubrique: '3', requete: ' ' }), null);
  });
});
