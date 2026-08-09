import { config } from './config.js';
import { racineSql } from './groupes.js';

/**
 * Dosages et formes du même produit.
 *
 * La recherche rend un produit par ligne — DOLIPRANE, et non ses dix-sept
 * codes CIS. C'est ce qu'il faut pour lire une liste, mais il manquerait alors
 * le moyen de choisir : arrivé sur la fiche, on veut le 1000 mg en gélule, pas
 * celui que le regroupement a désigné comme représentant. Cette liste rend ce
 * choix à la fiche.
 *
 * Le libellé affiché est ce que la racine avait retiré — « 1000 mg, comprimé ».
 * Répéter « DOLIPRANE » sur chacune des dix-sept entrées n'apprendrait rien.
 */
export async function getVariantes(pool, cis) {
  const { rows } = await pool.query(
    `
    WITH cible AS (
      SELECT ${racineSql('m')} AS racine, coalesce(m.titulaires, '') AS titulaire
      FROM dbpm.cis_bdpm m
      WHERE m.code_cis = $1
    ),
    fratrie AS (
      SELECT
        m.code_cis AS id,
        m.denomination_medicament,
        m.forme_pharmaceutique,
        ltrim(substr(m.denomination_medicament, length(c.racine) + 1), ' ,') AS variante,
        (m.code_cis = $1) AS courante,
        (m.etat_commercialisation = 'Commercialisée') AS commercialise
      FROM dbpm.cis_bdpm m
      CROSS JOIN cible c
      WHERE ${racineSql('m')} = c.racine
        AND coalesce(m.titulaires, '') = c.titulaire
    )
    SELECT *
    FROM fratrie
    -- Par dose croissante : « 100 mg » avant « 1000 mg », ce que l'ordre
    -- alphabétique fait exactement à l'envers.
    ORDER BY NULLIF(substring(variante from '[0-9]+'), '')::int NULLS FIRST,
             forme_pharmaceutique, denomination_medicament
    `,
    [cis],
  );

  return rows;
}

/**
 * Fiche produit : dénomination, forme, titulaire, principes actifs, présentations CIP.
 * Une seule requête. Renvoie null si le CIS n'existe pas.
 */
export async function getProduct(pool, cis) {
  const { rows } = await pool.query(
    `
    WITH info AS (
      SELECT
        m.code_cis AS id,
        m.denomination_medicament,
        m.forme_pharmaceutique,
        m.titulaires,
        m.type_procedure_amm,
        string_agg(DISTINCT c.denomination_substance, ', '
                   ORDER BY c.denomination_substance) AS active_ingredients
      FROM dbpm.cis_bdpm m
      LEFT JOIN dbpm.cis_compo_bdpm c ON c.code_cis = m.code_cis
      WHERE m.code_cis = $1
      GROUP BY m.code_cis, m.denomination_medicament, m.forme_pharmaceutique,
               m.titulaires, m.type_procedure_amm
    ),
    presentations AS (
      SELECT json_agg(json_build_object(
               'code_cip7', code_cip7,
               'code_cip13', code_cip13,
               'libelle_presentation', libelle_presentation
             -- Tri par quantité réelle : « Boîte de 30 » avant « Boîte de 100 »,
          -- ce que l'ordre alphabétique fait exactement à l'envers.
          ) ORDER BY NULLIF(substring(libelle_presentation from '\\d+'), '')::int NULLS LAST,
                     libelle_presentation) AS cip_products
      FROM dbpm.cis_cip_bdpm
      WHERE code_cis = $1
    )
    SELECT i.*, p.cip_products
    FROM info i CROSS JOIN presentations p
    `,
    [cis],
  );

  return rows[0] ?? null;
}

/**
 * Produits apparentés : d'abord le groupe générique officiel (cis_gener_bdpm),
 * puis, en complément, les spécialités partageant les mêmes principes actifs.
 *
 * Deux requêtes bornées, quel que soit le produit. Aucune boucle.
 */
export async function getRelatedProducts(pool, cis, activeIngredients) {
  const byId = new Map();

  const { rows: generics } = await pool.query(
    `
    SELECT
      m.code_cis AS id,
      m.denomination_medicament,
      m.forme_pharmaceutique,
      'generic' AS match_type,
      own.type_generique,
      own.libelle_groupe_generique,
      string_agg(DISTINCT c.denomination_substance, ', '
                 ORDER BY c.denomination_substance) AS active_ingredients
    FROM dbpm.cis_gener_bdpm source
    JOIN dbpm.cis_gener_bdpm own
      ON own.identifiant_groupe_generique = source.identifiant_groupe_generique
    JOIN dbpm.cis_bdpm m ON m.code_cis = own.code_cis
    LEFT JOIN dbpm.cis_compo_bdpm c ON c.code_cis = m.code_cis
    WHERE source.code_cis = $1
      AND own.code_cis <> $1
    GROUP BY m.code_cis, m.denomination_medicament, m.forme_pharmaceutique,
             own.type_generique, own.libelle_groupe_generique
    ORDER BY own.type_generique, m.denomination_medicament
    LIMIT $2
    `,
    [cis, config.search.relatedLimit],
  );

  for (const row of generics) byId.set(String(row.id), row);

  // Complément par principes actifs : seulement s'il reste de la place.
  const remaining = config.search.relatedLimit - byId.size;
  const substances = (activeIngredients ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (remaining > 0 && substances.length > 0) {
    const excluded = [cis, ...byId.keys()];

    const { rows: siblings } = await pool.query(
      `
      SELECT
        m.code_cis AS id,
        m.denomination_medicament,
        m.forme_pharmaceutique,
        'related' AS match_type,
        NULL::text AS type_generique,
        NULL::text AS libelle_groupe_generique,
        string_agg(DISTINCT c.denomination_substance, ', '
                   ORDER BY c.denomination_substance) AS active_ingredients
      FROM dbpm.cis_bdpm m
      JOIN dbpm.cis_compo_bdpm c ON c.code_cis = m.code_cis
      WHERE c.denomination_substance = ANY($1::text[])
        AND m.code_cis <> ALL($2::text[])
      GROUP BY m.code_cis, m.denomination_medicament, m.forme_pharmaceutique
      ORDER BY m.denomination_medicament
      LIMIT $3
      `,
      [substances, excluded.map(String), remaining],
    );

    for (const row of siblings) byId.set(String(row.id), row);
  }

  return [...byId.values()]
    .map((row) => ({ ...row, role: roleOf(row) }))
    .sort((a, b) => {
      if (a.match_type !== b.match_type) return a.match_type === 'generic' ? -1 : 1;
      if (a.match_type === 'generic' && a.type_generique !== b.type_generique) {
        return String(a.type_generique).localeCompare(String(b.type_generique));
      }
      return a.denomination_medicament.localeCompare(b.denomination_medicament, 'fr');
    });
}

/**
 * Rôle du produit vis-à-vis de celui consulté. C'est l'information que le
 * pharmacien cherche dans une liste de substitution — elle a sa place dans
 * une colonne, pas dans deux sections séparées.
 *
 * type_generique BDPM : 0 = princeps, 1 = générique, 2 = générique par
 * complémentarité posologique, 4 = substituable sans groupe.
 */
export function roleOf(row) {
  if (row.match_type !== 'generic') return 'Même DCI';
  return String(row.type_generique) === '0' ? 'Princeps' : 'Générique';
}

/** Libellé du groupe générique, s'il y en a un. Métadonnée, pas ligne de tableau. */
export function genericGroupLabel(related) {
  return related.find((r) => r.libelle_groupe_generique)?.libelle_groupe_generique ?? null;
}
