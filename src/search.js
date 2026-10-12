import { config } from './config.js';
import { formesDuProduit } from './specialites.js';
import { deaccent } from './text.js';
import { canonique } from './synonymes.js';
import {
  racineSql,
  importSql,
  titulaireCleSql,
  ORDRE_PERTINENCE,
  ORDRE_REPRESENTANT,
  etiqueter,
} from './groupes.js';

/**
 * Recherche de médicaments en une seule requête SQL. Unité de résultat : le
 * produit (voir `src/groupes.js`), regroupé en base avant le LIMIT.
 * Chaque famille a son quota et son classement : un quota commun laissait les
 * « PARACETAMOL … » évincer DOLIPRANE. `limit` s'entend par famille.
 *
 * @param {import('pg').Pool} pool
 * @param {{ terms: string[], normalized: string }} query - sortie de parseQuery()
 * @param {'all'|'specialty'|'active'} filter
 * @param {{ limit?: number }} [options]
 * @returns {Promise<{ brandMatches: object[], activeIngredientMatches: object[], total: number }>}
 */
export async function searchMedications(pool, query, filter = 'all', options = {}) {
  const empty = { brandMatches: [], activeIngredientMatches: [], total: 0 };
  const terms = query?.terms ?? [];
  if (terms.length === 0) return empty;

  const limit = options.limit ?? config.search.limit;
  // Marge : la borne porte sur des produits, la sélection interne sur des CIS.
  const innerLimit = Math.max(limit * 12, 400);

  const params = terms.map((term) => `%${deaccent(term)}%`);
  const exact = deaccent(query.normalized);
  const prefix = `${exact}%`;

  const $exact = `$${params.length + 1}`;
  const $prefix = `$${params.length + 2}`;
  const $inner = `$${params.length + 3}`;
  const $limit = `$${params.length + 4}`;
  params.push(exact, prefix, innerLimit, limit);

  // Nom courant (« aspirine ») : la substance se cherche aussi sous son nom
  // de base (« acide acetylsalicylique »), au même rang qu'une égalité.
  const alias = canonique(query.normalized);
  const $alias = `$${params.length + 1}`;
  const $aliasExact = `$${params.length + 2}`;
  if (alias) params.push(`%${alias}%`, alias);

  const brandExpr = 'f_unaccent(lower(m.denomination_medicament))';
  const substExpr = 'f_unaccent(lower(c.denomination_substance))';
  const and = (expr) => terms.map((_, i) => `${expr} LIKE $${i + 1}`).join(' AND ');

  /** Exact d'abord, puis préfixe, puis simple occurrence. */
  const rang = (expr) => `CASE
    WHEN ${expr} = ${$exact} THEN 0
    WHEN ${expr} LIKE ${$prefix} THEN 1
    ELSE 2
  END`;
  const rangSubstance = alias
    ? `CASE WHEN ${substExpr} = ${$aliasExact} THEN 0 WHEN ${substExpr} LIKE ${$alias} THEN 1 ELSE ${rang(substExpr)} END`
    : rang(substExpr);
  const parSubstance = alias ? `(${and(substExpr)} OR ${substExpr} LIKE ${$alias})` : and(substExpr);

  const wantBrand = filter !== 'active';
  const wantActive = filter !== 'specialty';

  const ctes = [];
  const unions = [];

  if (wantBrand) {
    ctes.push(`
      brand_hits AS (
        SELECT m.code_cis, ${rang(brandExpr)} AS rang
        FROM dbpm.cis_bdpm m
        WHERE ${and(brandExpr)}
        ORDER BY rang, length(m.denomination_medicament), m.code_cis
        LIMIT ${$inner}
      )`);
    unions.push(`SELECT code_cis, 'brand'::text AS match_type, rang FROM brand_hits`);
  }

  if (wantActive) {
    // Sur « Tous », exclut les produits qui portent déjà le terme dans leur nom :
    // sinon doublon, et les PARACETAMOL ARROW évinceraient DOLIPRANE avant le LIMIT.
    const horsDenomination = wantBrand
      ? `AND NOT EXISTS (
           SELECT 1 FROM dbpm.cis_bdpm mb
           WHERE mb.code_cis = c.code_cis
             AND ${terms.map((_, i) => `f_unaccent(lower(mb.denomination_medicament)) LIKE $${i + 1}`).join(' AND ')}
         )`
      : '';

    ctes.push(`
      subst_hits AS (
        SELECT c.code_cis, min(${rangSubstance}) AS rang
        FROM dbpm.cis_compo_bdpm c
        WHERE ${parSubstance}
          ${horsDenomination}
        GROUP BY c.code_cis
        ORDER BY rang, c.code_cis
        LIMIT ${$inner}
      )`);
    unions.push(`SELECT code_cis, 'active'::text AS match_type, rang FROM subst_hits`);
  }

  // Si le terme est le préfixe d'une substance, les deux familles fusionnent en
  // une liste. Préfixe plutôt qu'égalité : la page ne doit pas changer de forme
  // en cours de frappe. La candidate la plus courte nomme la molécule de base
  // (« OXAZEPAM », pas « OXAZEPAM SODIQUE ») affichée dans le titre.
  ctes.unshift(`
      dci AS (
        SELECT denomination_substance AS substance
        FROM dbpm.cis_compo_bdpm
        WHERE f_unaccent(lower(denomination_substance)) LIKE ${$prefix}
          ${alias ? `OR f_unaccent(lower(denomination_substance)) LIKE ${$alias}` : ''}
        ORDER BY length(denomination_substance), denomination_substance
        LIMIT 1
      )`);

  const sql = `
    WITH ${ctes.join(',')},
    hits AS (
      ${unions.join(' UNION ALL ')}
    ),
    -- Une ligne par CIS, augmentée de tout ce qui sert à classer.
    lignes AS (
      SELECT
        h.code_cis,
        h.match_type,
        -- Sur une recherche de molécule, le rang se lit sur la substance pour
        -- tout le monde : sans cela, SERESTA (trouvé par sa composition) et
        -- OXAZEPAM ARROW (trouvé par son nom) porteraient des rangs issus de
        -- deux mesures différentes, et les comparer n'aurait aucun sens.
        CASE WHEN (SELECT substance FROM dci) IS NOT NULL
             THEN least(h.rang, coalesce(c.rang_substance, 2))
             ELSE h.rang END AS rang,
        m.denomination_medicament,
        m.forme_pharmaceutique,
        m.titulaires,
        ${racineSql('m')} AS racine,
        f_unaccent(lower(${racineSql('m')})) AS racine_cle,
        ${importSql('m')} AS import,
        (m.etat_commercialisation = 'Commercialisée') AS commercialise,
        (m.statut_administratif_amm = 'Autorisation active') AS actif,
        g.princeps,
        c.substances,
        c.nb_substances
      FROM hits h
      JOIN dbpm.cis_bdpm m ON m.code_cis = h.code_cis
      LEFT JOIN LATERAL (
        SELECT string_agg(DISTINCT denomination_substance, ', '
                          ORDER BY denomination_substance) AS substances,
               count(DISTINCT denomination_substance)::int AS nb_substances,
               min(${rangSubstance}) AS rang_substance
        FROM dbpm.cis_compo_bdpm c WHERE c.code_cis = h.code_cis
      ) c ON true
      LEFT JOIN LATERAL (
        SELECT bool_or(type_generique = '0') AS princeps
        FROM dbpm.cis_gener_bdpm WHERE code_cis = h.code_cis
      ) g ON true
    ),
    cles AS (
      SELECT l.*, ${titulaireCleSql('l')} AS titulaire_cle
      FROM lignes l
    ),
    -- La spécialité qui représente le groupe : celle vers laquelle on pointe.
    representants AS (
      SELECT DISTINCT ON (match_type, racine_cle, titulaire_cle)
        match_type, racine_cle, titulaire_cle,
        code_cis AS id, racine, denomination_medicament,
        forme_pharmaceutique, titulaires, substances AS active_ingredients
      FROM cles
      ORDER BY match_type, racine_cle, titulaire_cle, ${ORDRE_REPRESENTANT}
    ),
    agregats AS (
      SELECT
        match_type, racine_cle, titulaire_cle,
        min(rang) AS rank,
        bool_or(commercialise) AS commercialise,
        bool_or(actif) AS actif,
        bool_or(princeps) AS princeps,
        min(nb_substances) AS nb_substances,
        count(*)::int AS presentations,
        -- Les spécialités du groupe, pour afficher chaque dosage en lien.
        json_agg(json_build_object(
          'id', code_cis, 'denomination', denomination_medicament,
          'forme_pharmaceutique', forme_pharmaceutique, 'titulaires', titulaires,
          'princeps', princeps, 'commercialise', commercialise, 'importation', import
        ) ORDER BY denomination_medicament, code_cis) AS specialites,
        count(*) FILTER (WHERE import)::int AS importations,
        bool_and(import) AS importation,
        -- Trouvé par sa composition et non par son nom : le produit ne
        -- s'appelle donc pas comme la molécule. C'est ce qui sépare SERESTA
        -- d'OXAZEPAM ARROW, et DOLIPRANE de PARACETAMOL EG.
        (match_type = 'active') AS marque_propre
      FROM cles
      GROUP BY match_type, racine_cle, titulaire_cle
    ),
    groupes AS (
      SELECT a.*, r.id, r.racine, r.denomination_medicament,
             r.forme_pharmaceutique, r.titulaires, r.active_ingredients
      FROM agregats a
      JOIN representants r USING (match_type, racine_cle, titulaire_cle)
    ),
    classes AS (
      SELECT *, row_number() OVER (
        -- Une seule partition sur une recherche de molécule : c'est la fusion.
        PARTITION BY CASE WHEN (SELECT substance FROM dci) IS NOT NULL THEN 'tous' ELSE match_type END
        ORDER BY ${ORDRE_PERTINENCE}
      ) AS n
      FROM groupes
    )
    SELECT id, racine, denomination_medicament, forme_pharmaceutique, titulaires,
           active_ingredients, match_type, rank, presentations, importations,
           importation, commercialise, princeps, nb_substances, marque_propre, specialites,
           (SELECT substance FROM dci) IS NOT NULL AS dci,
           (SELECT substance FROM dci) AS substance_dci
    FROM classes
    WHERE n <= ${$limit}
    ORDER BY n, match_type
  `;

  const { rows: bruts } = await pool.query(sql, params);
  // Dosages rangés par forme, comme sur la page d'une molécule.
  const rows = bruts.map(({ specialites, ...row }) => ({ ...row, formes: formesDuProduit(specialites) }));
  const dci = rows[0]?.dci === true;
  const substance = dci ? (rows[0]?.substance_dci ?? null) : null;

  // Par liste affichée : l'homonymie ne compte qu'au sein d'une même liste.
  const produits = dci
    ? etiqueter(rows)
    : [
        ...etiqueter(rows.filter((row) => row.match_type === 'brand')),
        ...etiqueter(rows.filter((row) => row.match_type === 'active')),
      ];

  return {
    // Vrai si le terme désigne une molécule : une seule liste, ordonnée par `produits`.
    dci,
    substance,
    produits,
    brandMatches: produits.filter((produit) => produit.match_type === 'brand'),
    activeIngredientMatches: produits.filter((produit) => produit.match_type === 'active'),
    total: rows.length,
  };
}

/**
 * Suggestions d'autocomplétion : la même requête, bornée plus court.
 * Rend `produits` dans son ordre : concaténer les deux familles remettrait les
 * génériques devant la marque (SERESTA derrière ses génériques).
 */
export async function suggest(pool, query) {
  const limite = config.search.suggestLimit;
  const brut = await searchMedications(pool, query, 'all', { limit: limite });

  return { produits: brut.produits.slice(0, limite), dci: brut.dci, total: brut.total };
}
