-- Audit de l'arbre ATC — lecture seule, rien n'est modifié.
--
-- Trois questions, dans l'ordre où elles commandent des décisions de conception :
--
--   1. Combien de molécules n'ont pas d'intitulé exploitable, et combien
--      d'entre elles la BDPM permettrait-elle de renommer ?
--   2. Combien de nœuds sont orphelins — leur parent déclaré n'existe pas —
--      et combien de produits deviendraient inatteignables si l'on naviguait
--      par `parent_atc_code` plutôt que par préfixe ?
--   3. La liste aplatie des molécules d'une classe tient-elle sur une page ?
--
-- Usage :  psql "$DATABASE_URL" -f sql/audit_atc.sql
--
-- La « racine de marque » reprend la définition de src/groupes.js : compter des
-- codes CIS annoncerait des listes quatre fois plus longues qu'elles ne sont.

\echo ''
\echo '=== 1. Molécules sans intitulé exploitable ==============================='
\echo ''

-- Le libellé est NOT NULL : là où la source CNAM n'en donnait pas, le code a
-- été recopié dans la colonne. C'est ce doublon que l'on compte.
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

-- Si les spécialités d'un code portent toutes la même substance, la BDPM sait
-- ce que le CNAM ignore : on peut reconstruire l'intitulé au lieu de le subir.
--
-- « ambigues » ne veut pas dire « perdues ». Une association en porte plusieurs
-- par nature — LAMALINE est paracétamol + opium + caféine — et son intitulé est
-- justement cette énumération. La colonne sépare donc les molécules simples,
-- renommables d'un mot, des associations, renommables d'une liste. Ce qui est
-- réellement perdu, c'est la ligne sans aucune spécialité : muettes moins
-- avec_produits.
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

WITH muettes AS (
  SELECT atc_code FROM ref.atc_classification
  WHERE atc_level = 5 AND atc_label = atc_code
)
SELECT m.atc_code,
       count(DISTINCT a.code_cis)                                   AS specialites,
       string_agg(DISTINCT c.denomination_substance, ' + '
                  ORDER BY c.denomination_substance)                AS substances
FROM muettes m
LEFT JOIN ref.cis_atc_mapping a ON a.atc_code = m.atc_code
LEFT JOIN dbpm.cis_compo_bdpm c ON c.code_cis = a.code_cis
GROUP BY m.atc_code
ORDER BY m.atc_code;

\echo ''
\echo '=== 2. Nœuds orphelins =================================================='
\echo ''

-- Un nœud dont le `parent_atc_code` ne désigne aucune ligne existante n'est
-- l'enfant de personne : il n'apparaît dans la liste d'aucune classe. Le code
-- porte pourtant sa filiation — la hiérarchie ATC est un préfixe strict.
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

-- Produits atteignables seulement par préfixe, jamais par la chaîne des
-- parents. C'est le coût réel du trou, exprimé en ce que le lecteur ne verrait
-- plus si la liste de spécialités disparaissait des pages de classe.
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

-- Si cette requête ne rend rien, `parent_atc_code` est un pur doublon du code
-- et l'on peut naviguer par préfixe sans rien perdre — la conclusion qui
-- décide de la correction.
SELECT c.atc_code, c.atc_level, c.parent_atc_code
FROM ref.atc_classification c
WHERE c.parent_atc_code IS NOT NULL
  AND c.atc_code NOT LIKE c.parent_atc_code || '%'
ORDER BY c.atc_code;

\echo ''
\echo '=== 3. Une liste aplatie de molécules tient-elle sur une page ? =========='
\echo ''

-- Pour chaque classe, le nombre de molécules qu'elle contient en tout, tous
-- niveaux confondus. C'est ce qui décide si l'on peut proposer « toutes les
-- molécules de J05 » d'un coup, ou s'il faut s'en tenir aux enfants directs.
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
