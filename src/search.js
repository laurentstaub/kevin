import { config } from './config.js';
import { deaccent } from './text.js';
import {
  racineSql,
  importSql,
  titulaireCleSql,
  ORDRE_PERTINENCE,
  ORDRE_REPRESENTANT,
  etiqueter,
} from './groupes.js';

/**
 * Recherche de médicaments — UNE seule requête SQL, quel que soit le volume.
 *
 * **L'unité de résultat est le produit, pas le code CIS.** Un CIS est un
 * triplet marque × dosage × forme : DOLIPRANE en compte dix-sept, DAFALGAN
 * quatorze. En rendre la liste, c'est remplir l'écran d'un seul médicament et
 * cacher tous les autres — et aucun classement n'y peut rien, puisque ces
 * dix-sept lignes sont réellement d'égale pertinence. Le regroupement est fait
 * en base, avant le LIMIT : regrouper après rendrait un nombre de produits
 * imprévisible. Voir `src/groupes.js` pour la clé et l'ordre de pertinence.
 *
 * **Chaque famille a son propre quota et son propre classement.** Un quota
 * commun laissait la dénomination affamer le principe actif : soixante
 * spécialités portent « paracétamol » dans leur nom, elles consommaient tous
 * les créneaux et DOLIPRANE n'apparaissait jamais. Et un rang calculé sur la
 * dénomination pour *toutes* les lignes plaçait en tête, dans les trouvailles
 * par substance, précisément les produits que la recherche par nom avait déjà
 * rendus — l'inverse du service attendu. Une ligne trouvée par substance est
 * donc classée sur la substance.
 *
 * `limit` s'entend **par famille** : « paracétamol » peut rendre 60 produits
 * par dénomination et 60 par principe actif.
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
  // On retient large avant de regrouper : la borne porte sur des produits, la
  // sélection interne sur des CIS, et il en faut plusieurs pour un produit.
  const innerLimit = Math.max(limit * 12, 400);

  const params = terms.map((term) => `%${deaccent(term)}%`);
  const exact = deaccent(query.normalized);
  const prefix = `${exact}%`;

  const $exact = `$${params.length + 1}`;
  const $prefix = `$${params.length + 2}`;
  const $inner = `$${params.length + 3}`;
  const $limit = `$${params.length + 4}`;
  params.push(exact, prefix, innerLimit, limit);

  const brandExpr = 'f_unaccent(lower(m.denomination_medicament))';
  const substExpr = 'f_unaccent(lower(c.denomination_substance))';
  const and = (expr) => terms.map((_, i) => `${expr} LIKE $${i + 1}`).join(' AND ');

  /** Exact d'abord, puis préfixe, puis simple occurrence. */
  const rang = (expr) => `CASE
    WHEN ${expr} = ${$exact} THEN 0
    WHEN ${expr} LIKE ${$prefix} THEN 1
    ELSE 2
  END`;

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
    // Sur l'onglet « Tous », cette famille répond à une question précise : quels
    // produits contiennent la substance *sans* la porter dans leur nom. Ceux qui
    // la portent sont déjà rendus par la dénomination, les remonter ici ferait
    // doublon — et les écarter avant le LIMIT est ce qui garantit que DOLIPRANE
    // ne se fait pas évincer par deux cents PARACETAMOL ARROW.
    const horsDenomination = wantBrand
      ? `AND NOT EXISTS (
           SELECT 1 FROM dbpm.cis_bdpm mb
           WHERE mb.code_cis = c.code_cis
             AND ${terms.map((_, i) => `f_unaccent(lower(mb.denomination_medicament)) LIKE $${i + 1}`).join(' AND ')}
         )`
      : '';

    ctes.push(`
      subst_hits AS (
        SELECT c.code_cis, min(${rang(substExpr)}) AS rang
        FROM dbpm.cis_compo_bdpm c
        WHERE ${and(substExpr)}
          ${horsDenomination}
        GROUP BY c.code_cis
        ORDER BY rang, c.code_cis
        LIMIT ${$inner}
      )`);
    unions.push(`SELECT code_cis, 'active'::text AS match_type, rang FROM subst_hits`);
  }

  // Le terme désigne-t-il une molécule ? Si oui, la question posée n'est plus
  // « quels produits s'appellent ainsi » mais « quels produits en contiennent »,
  // et séparer selon que le mot figure ou non dans le nom n'a plus de sens :
  // c'est un détail de récupération, pas une distinction que le lecteur pose.
  // Les deux familles sont alors fondues en une seule liste classée.
  //
  // La reconnaissance se fait sur le **préfixe** et non sur l'égalité : on tape
  // « oxaz » avant « oxazépam », et la page ne peut pas changer de forme au
  // septième caractère. Un préfixe reste exigeant — « oxaz » ouvre OXAZEPAM,
  // mais ne reconnaît pas SULFAMÉTHOXAZOLE, qui ne fait que le contenir.
  // La substance reconnue est rendue avec le résultat : le titre de la liste
  // nomme la molécule (« contenant PARACÉTAMOL ») et non ce qui a été tapé,
  // qui n'en est souvent qu'un début. La plus courte des substances candidates est
  // la molécule de base — « OXAZEPAM » plutôt qu'« OXAZEPAM SODIQUE ».
  ctes.unshift(`
      dci AS (
        SELECT denomination_substance AS substance
        FROM dbpm.cis_compo_bdpm
        WHERE f_unaccent(lower(denomination_substance)) LIKE ${$prefix}
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
               min(${rang(substExpr)}) AS rang_substance
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
           importation, commercialise, princeps, nb_substances, marque_propre,
           (SELECT substance FROM dci) IS NOT NULL AS dci,
           (SELECT substance FROM dci) AS substance_dci
    FROM classes
    WHERE n <= ${$limit}
    ORDER BY n, match_type
  `;

  const { rows } = await pool.query(sql, params);
  const dci = rows[0]?.dci === true;
  const substance = dci ? (rows[0]?.substance_dci ?? null) : null;

  // L'étiquetage se calcule sur la liste telle qu'elle sera affichée : c'est la
  // présence d'un homonyme sous les yeux du lecteur qui rend la précision utile.
  const produits = dci
    ? etiqueter(rows)
    : [
        ...etiqueter(rows.filter((r) => r.match_type === 'brand')),
        ...etiqueter(rows.filter((r) => r.match_type === 'active')),
      ];

  return {
    // Vrai quand le terme désigne une molécule : la page n'affiche alors qu'une
    // liste, et `produits` en porte l'ordre. `substance` nomme la molécule
    // reconnue — c'est elle que le titre annonce, pas ce qui a été tapé.
    dci,
    substance,
    produits,
    brandMatches: produits.filter((r) => r.match_type === 'brand'),
    activeIngredientMatches: produits.filter((r) => r.match_type === 'active'),
    total: rows.length,
  };
}

/**
 * Suggestions d'autocomplétion : la même requête, bornée plus court.
 *
 * Le regroupement se fait en base — il n'y a plus de dédoublonnage à refaire
 * ici. Huit produits, et non huit dosages du même produit.
 *
 * La liste rendue est `produits`, dans son ordre. Reconstituer les deux
 * familles pour les concaténer remettrait les génériques homonymes de la
 * molécule devant la marque : c'est ce qui affichait SERESTA en dernier sur
 * « oxazépam », après ses trois génériques.
 */
export async function suggest(pool, query) {
  const limite = config.search.suggestLimit;
  const brut = await searchMedications(pool, query, 'all', { limit: limite });

  return { produits: brut.produits.slice(0, limite), dci: brut.dci, total: brut.total };
}
