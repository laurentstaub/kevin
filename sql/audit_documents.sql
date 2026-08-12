-- Audit des spécialités sans RCP — lecture seule.
--
-- Une fiche sans bloc Documents ne dit pas pourquoi : le lecteur ne peut pas
-- distinguer « ce médicament n'a pas de RCP publié » de « le site n'a pas su le
-- récupérer ». Avant de compenser, il faut savoir laquelle des trois causes
-- domine, parce qu'elles n'appellent pas la même réponse :
--
--   aucune ligne dans cis_documents   la BDPM ne publie rien — à énoncer
--   une ligne, mais html et pdf vides la collecte a échoué — à réparer
--   du contenu, mais aucune rubrique  le découpage a échoué — à rejouer
--
-- Usage :  npm run audit-documents
--
-- Le périmètre est celui qui compte : les spécialités effectivement
-- commercialisées. Une AMM éteinte sans RCP n'est pas un défaut.

\echo ''
\echo '=== 1. Où en sont les spécialités commercialisées ? ====================='
\echo ''

WITH actives AS (
  SELECT DISTINCT m.code_cis, m.denomination_medicament, m.type_procedure_amm
  FROM dbpm.cis_bdpm m
  JOIN dbpm.cis_cip_bdpm p ON p.code_cis = m.code_cis
  WHERE p.etat_commercialisation ILIKE 'Déclaration de commercialisation%'
),
etat AS (
  SELECT a.code_cis,
         a.type_procedure_amm ~* 'importation\s+parall'                 AS import,
         EXISTS (SELECT 1 FROM dbpm.cis_documents d
                 WHERE d.code_cis = a.code_cis)                         AS a_une_ligne,
         EXISTS (SELECT 1 FROM dbpm.cis_documents d
                 WHERE d.code_cis = a.code_cis
                   AND coalesce(d.html_content, '') <> '')              AS a_du_html,
         EXISTS (SELECT 1 FROM dbpm.cis_documents d
                 WHERE d.code_cis = a.code_cis
                   AND coalesce(d.file_path, '') <> '')                 AS a_un_pdf,
         EXISTS (SELECT 1 FROM docs.rcp_sections r
                 WHERE r.code_cis = a.code_cis)                         AS a_des_rubriques
  FROM actives a
)
SELECT
  count(*)                                                    AS commercialisees,
  count(*) FILTER (WHERE a_des_rubriques)                     AS avec_rubriques,
  count(*) FILTER (WHERE NOT a_des_rubriques AND import)      AS import_parallele,
  count(*) FILTER (WHERE NOT a_des_rubriques AND NOT import
                     AND NOT a_une_ligne)                     AS aucun_document,
  count(*) FILTER (WHERE NOT a_des_rubriques AND NOT import
                     AND a_une_ligne AND NOT a_du_html
                     AND NOT a_un_pdf)                        AS ligne_vide,
  count(*) FILTER (WHERE NOT a_des_rubriques AND NOT import
                     AND (a_du_html OR a_un_pdf))             AS contenu_non_decoupe
FROM etat;

\echo ''
\echo '--- Ce que dit docs.document_parse des découpages ratés ---'
\echo ''

SELECT statut, source, count(*) AS documents
FROM docs.document_parse
GROUP BY 1, 2
ORDER BY count(*) DESC;

\echo ''
\echo '=== 2. Le cas d’AMOXICILLINE ALMUS, pour comprendre un exemple ========='
\echo ''

SELECT m.code_cis, left(m.denomination_medicament, 44) AS denomination,
       m.etat_commercialisation, m.statut_administratif_amm,
       (SELECT count(*) FROM dbpm.cis_documents d WHERE d.code_cis = m.code_cis)  AS documents,
       (SELECT count(*) FROM docs.rcp_sections r WHERE r.code_cis = m.code_cis)   AS rubriques
FROM dbpm.cis_bdpm m
WHERE m.code_cis = '60151544';

\echo ''
\echo '=== 3. Le groupe générique offre-t-il un voisin qui a un RCP ? =========='
\echo ''

-- Si la réponse est « presque toujours », l'emprunt encadré est jouable : le
-- groupe générique est l'affirmation de l'ANSM que ces produits sont
-- interchangeables à même dose et même forme. Sinon, il ne reste qu'à énoncer
-- l'absence, ce qui vaut de toute façon mieux qu'une page muette.
WITH orphelines AS (
  SELECT DISTINCT m.code_cis
  FROM dbpm.cis_bdpm m
  JOIN dbpm.cis_cip_bdpm p ON p.code_cis = m.code_cis
  WHERE p.etat_commercialisation ILIKE 'Déclaration de commercialisation%'
    AND coalesce(m.type_procedure_amm, '') !~* 'importation\s+parall'
    AND NOT EXISTS (SELECT 1 FROM docs.rcp_sections r WHERE r.code_cis = m.code_cis)
),
voisins AS (
  SELECT o.code_cis,
         (SELECT count(*) FROM dbpm.cis_gener_bdpm g1
          JOIN dbpm.cis_gener_bdpm g2
            ON g2.identifiant_groupe_generique = g1.identifiant_groupe_generique
           AND g2.code_cis <> g1.code_cis
          WHERE g1.code_cis = o.code_cis
            AND EXISTS (SELECT 1 FROM docs.rcp_sections r
                        WHERE r.code_cis = g2.code_cis)) AS voisins_avec_rcp
  FROM orphelines o
)
SELECT count(*)                                        AS sans_rcp,
       count(*) FILTER (WHERE voisins_avec_rcp > 0)    AS un_voisin_au_moins,
       count(*) FILTER (WHERE voisins_avec_rcp = 0)    AS aucun_voisin,
       round(100.0 * count(*) FILTER (WHERE voisins_avec_rcp > 0)
             / greatest(count(*), 1), 1)               AS pourcent_couvert
FROM voisins;

\echo ''
\echo '--- Vingt exemples, pour juger sur pièces ---'
\echo ''

SELECT m.code_cis, left(m.denomination_medicament, 52) AS denomination,
       (SELECT count(*) FROM dbpm.cis_documents d WHERE d.code_cis = m.code_cis) AS docs,
       (SELECT count(*) FROM dbpm.cis_gener_bdpm g1
        JOIN dbpm.cis_gener_bdpm g2
          ON g2.identifiant_groupe_generique = g1.identifiant_groupe_generique
         AND g2.code_cis <> g1.code_cis
        WHERE g1.code_cis = m.code_cis
          AND EXISTS (SELECT 1 FROM docs.rcp_sections r WHERE r.code_cis = g2.code_cis)) AS voisins
FROM dbpm.cis_bdpm m
WHERE EXISTS (SELECT 1 FROM dbpm.cis_cip_bdpm p WHERE p.code_cis = m.code_cis
                AND p.etat_commercialisation ILIKE 'Déclaration de commercialisation%')
  AND coalesce(m.type_procedure_amm, '') !~* 'importation\s+parall'
  AND NOT EXISTS (SELECT 1 FROM docs.rcp_sections r WHERE r.code_cis = m.code_cis)
ORDER BY m.denomination_medicament
LIMIT 20;


\echo ''
\echo '=== 4. Les 971 sans document : lesquelles ont vraiment un RCP à aller chercher ? ==='
\echo ''

-- Deux populations très différentes se cachent dans ce chiffre. Un
-- enregistrement homéopathique ne publie aucun RCP : rien à collecter, tout à
-- énoncer. Une AMM ordinaire en a forcément un — vérifié à la main sur le CIS
-- 60151544, dont la page BDPM publie bien RCP et notice quand la base n'en a
-- aucun. C'est du travail de collecte, et il se chiffre ici.
WITH manquantes AS (
  SELECT m.code_cis, m.denomination_medicament, m.type_procedure_amm, m.date_amm
  FROM dbpm.cis_bdpm m
  WHERE EXISTS (SELECT 1 FROM dbpm.cis_cip_bdpm p WHERE p.code_cis = m.code_cis
                  AND p.etat_commercialisation ILIKE 'Déclaration de commercialisation%')
    AND coalesce(m.type_procedure_amm, '') !~* 'importation\s+parall'
    AND NOT EXISTS (SELECT 1 FROM dbpm.cis_documents d WHERE d.code_cis = m.code_cis)
)
SELECT coalesce(type_procedure_amm, '(non renseigné)')  AS procedure,
       count(*)                                        AS specialites,
       min(date_amm)                                   AS amm_la_plus_ancienne,
       max(date_amm)                                   AS amm_la_plus_recente
FROM manquantes
GROUP BY 1
ORDER BY count(*) DESC;

\echo ''
\echo '--- Et par ancienneté de l’AMM, hors homéopathie ---'
\echo ''

-- Si la masse est récente, le collecteur n'a simplement jamais tourné depuis :
-- une seule passe suffit. Si elle est étalée sur vingt ans, le trou est
-- structurel et il faudra comprendre ce que la collecte laisse passer.
WITH manquantes AS (
  SELECT m.date_amm
  FROM dbpm.cis_bdpm m
  WHERE EXISTS (SELECT 1 FROM dbpm.cis_cip_bdpm p WHERE p.code_cis = m.code_cis
                  AND p.etat_commercialisation ILIKE 'Déclaration de commercialisation%')
    AND coalesce(m.type_procedure_amm, '') !~* 'importation\s+parall'
    AND coalesce(m.type_procedure_amm, '') !~* 'hom[ée]o'
    AND NOT EXISTS (SELECT 1 FROM dbpm.cis_documents d WHERE d.code_cis = m.code_cis)
)
SELECT extract(year FROM date_amm)::int AS annee_amm, count(*) AS specialites
FROM manquantes
GROUP BY 1
ORDER BY 1 DESC NULLS LAST
LIMIT 15;

\echo ''
\echo '--- Comparaison : la même répartition chez celles qui ONT un document ---'
\echo ''

-- Le témoin. Sans lui, on ne saurait pas si « beaucoup de 2024 » veut dire
-- « la collecte s'est arrêtée en 2023 » ou simplement « il y a eu beaucoup
-- d'AMM en 2024 ».
SELECT extract(year FROM m.date_amm)::int AS annee_amm,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM dbpm.cis_documents d
                                      WHERE d.code_cis = m.code_cis))  AS avec_document,
       count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM dbpm.cis_documents d
                                          WHERE d.code_cis = m.code_cis)) AS sans_document
FROM dbpm.cis_bdpm m
WHERE EXISTS (SELECT 1 FROM dbpm.cis_cip_bdpm p WHERE p.code_cis = m.code_cis
                AND p.etat_commercialisation ILIKE 'Déclaration de commercialisation%')
  AND coalesce(m.type_procedure_amm, '') !~* 'importation\s+parall|hom[ée]o'
GROUP BY 1
ORDER BY 1 DESC NULLS LAST
LIMIT 15;
