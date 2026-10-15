-- Audit de l'arbre ATC, lecture seule : 1. molécules sans intitulé (renommables
-- depuis la BDPM ?) ; 2. nœuds orphelins et produits perdus en naviguant par
-- `parent_atc_code` ; 3. taille des listes aplaties de molécules par classe.
-- Usage :  npm run audit-atc          (depuis le dépôt 00_dr_kevin)
-- Base : même repli que src/config.js. Tables : ref.atc_classification, ref.cis_atc_mapping.
-- « Racine de marque » : définition de src/groupes.js.

\echo ''
\echo '=== 1. Molécules sans intitulé exploitable ==============================='
\echo ''

-- Sans intitulé CNAM, le code est recopié dans le libellé (NOT NULL).
SELECT
  atc_level                                              AS niveau,
  count(*)                                               AS codes,
  count(*) FILTER (WHERE atc_label = atc_code)           AS sans_intitule,
  round(100.0 * count(*) FILTER (WHERE atc_label = atc_code) / count(*), 1)
                                                         AS pourcent
FROM ref.atc_classification
GROUP BY atc_level
ORDER BY atc_level;

\echo ''
\echo '--- Ces molécules sont-elles renommables depuis la BDPM ? ---'
\echo ''

-- Renommable si toutes les spécialités du code portent une seule substance.
-- « ambigues » = associations, renommables par une liste ; seules les muettes
-- sans spécialité (muettes - avec_produits) sont perdues.
WITH muettes AS (
  SELECT atc_code
  FROM ref.atc_classification
  WHERE atc_level = 5 AND atc_label = atc_code
),
substances AS (
  SELECT m.atc_code,
         count(DISTINCT c.denomination_substance) AS substances_distinctes,
         min(c.denomination_substance)            AS exemple
  FROM muettes m
  JOIN ref.cis_atc_mapping a ON a.atc_code = m.atc_code
  JOIN dbpm.cis_compo_bdpm c ON c.code_cis = a.code_cis
  GROUP BY m.atc_code
)
SELECT
  (SELECT count(*) FROM muettes)                                    AS muettes,
  count(*)                                                          AS avec_produits,
  count(*) FILTER (WHERE substances_distinctes = 1)                 AS renommables,
  count(*) FILTER (WHERE substances_distinctes > 1)                 AS ambigues
FROM substances;

\echo ''
\echo '--- Le détail, pour juger sur pièces ---'
\echo ''

-- Préfère la fraction thérapeutique ('ST') au sel ('SA') : une molécule, un nom.
WITH muettes AS (
  SELECT atc_code FROM ref.atc_classification
  WHERE atc_level = 5 AND atc_label = atc_code
),
composants AS (
  SELECT DISTINCT ON (a.atc_code, coalesce(c.numero_liaison_saft, c.code_substance))
         a.atc_code, c.code_cis, c.denomination_substance
  FROM muettes m
  JOIN ref.cis_atc_mapping a ON a.atc_code = m.atc_code
  JOIN dbpm.cis_compo_bdpm c ON c.code_cis = a.code_cis
  ORDER BY a.atc_code, coalesce(c.numero_liaison_saft, c.code_substance),
           (c.nature_composant = 'ST') DESC, c.denomination_substance
)
SELECT m.atc_code,
       (SELECT count(*) FROM ref.cis_atc_mapping a WHERE a.atc_code = m.atc_code)
                                                                    AS specialites,
       string_agg(DISTINCT k.denomination_substance, ' + '
                  ORDER BY k.denomination_substance)                AS intitule_reconstruit
FROM muettes m
LEFT JOIN composants k ON k.atc_code = m.atc_code
GROUP BY m.atc_code
ORDER BY (SELECT count(*) FROM ref.cis_atc_mapping a WHERE a.atc_code = m.atc_code) DESC,
         m.atc_code;

\echo ''
\echo '=== 2. Nœuds orphelins =================================================='
\echo ''

-- Orphelin : `parent_atc_code` ne désigne aucune ligne (le préfixe, lui, reste valable).
SELECT
  c.atc_level                                            AS niveau,
  count(*)                                               AS orphelins
FROM ref.atc_classification c
WHERE c.parent_atc_code IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM ref.atc_classification p
                  WHERE p.atc_code = c.parent_atc_code)
GROUP BY c.atc_level
ORDER BY c.atc_level;

\echo ''
\echo '--- Ce que la navigation par parent ferait perdre ---'
\echo ''

-- Produits atteignables par préfixe mais pas par la chaîne des parents.
WITH orphelins AS (
  SELECT c.atc_code
  FROM ref.atc_classification c
  WHERE c.parent_atc_code IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM ref.atc_classification p
                    WHERE p.atc_code = c.parent_atc_code)
)
SELECT
  count(DISTINCT a.code_cis)                                        AS specialites,
  count(DISTINCT regexp_replace(
    split_part(m.denomination_medicament, ',', 1), '\s+[0-9].*$', ''))
                                                                    AS produits
FROM orphelins o
JOIN ref.cis_atc_mapping a ON a.atc_code = o.atc_code
JOIN dbpm.cis_bdpm m ON m.code_cis = a.code_cis;

\echo ''
\echo '--- Le parent déclaré contredit-il jamais le préfixe ? ---'
\echo ''

-- Vide : `parent_atc_code` est redondant avec le préfixe.
SELECT c.atc_code, c.atc_level, c.parent_atc_code
FROM ref.atc_classification c
WHERE c.parent_atc_code IS NOT NULL
  AND c.atc_code NOT LIKE c.parent_atc_code || '%'
ORDER BY c.atc_code;

\echo ''
\echo '=== 3. Une liste aplatie de molécules tient-elle sur une page ? =========='
\echo ''

-- Molécules par classe, tous niveaux confondus : liste aplatie ou enfants directs ?
WITH molecules AS (
  SELECT c.atc_code AS classe, c.atc_level AS niveau, c.atc_label AS libelle,
         count(DISTINCT f.atc_code) AS molecules
  FROM ref.atc_classification c
  JOIN ref.atc_classification f
    ON f.atc_level = 5 AND f.atc_code LIKE c.atc_code || '%'
  WHERE c.atc_level <= 4
  GROUP BY 1, 2, 3
)
SELECT niveau,
       count(*)                                        AS classes,
       min(molecules)                                  AS mini,
       round(avg(molecules))                           AS moyenne,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY molecules)::int AS mediane,
       percentile_cont(0.9) WITHIN GROUP (ORDER BY molecules)::int AS d9,
       max(molecules)                                  AS maxi,
       count(*) FILTER (WHERE molecules <= 60)         AS tiennent_en_60
FROM molecules
GROUP BY niveau
ORDER BY niveau;

\echo ''
\echo '--- Les vingt classes les plus fournies ---'
\echo ''

WITH molecules AS (
  SELECT c.atc_code AS classe, c.atc_level AS niveau, c.atc_label AS libelle,
         count(DISTINCT f.atc_code) AS molecules
  FROM ref.atc_classification c
  JOIN ref.atc_classification f
    ON f.atc_level = 5 AND f.atc_code LIKE c.atc_code || '%'
  WHERE c.atc_level <= 4
  GROUP BY 1, 2, 3
)
SELECT classe, niveau, left(libelle, 46) AS libelle, molecules
FROM molecules
ORDER BY molecules DESC
LIMIT 20;
