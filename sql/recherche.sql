-- Recherche plein texte dans les rubriques — configuration et index.
-- Idempotent. Exécution : npm run db:recherche
-- Index sur `docs.rcp_sections.texte` pour chercher une expression dans tous les RCP.

-- ---------------------------------------------------------------- la langue
--
-- L'application utilise toujours `french_nu`. Ce fichier décide s'il est
-- désaccentué (unaccent disponible) ou non, et l'annonce par NOTICE.
-- Pas de délai : la construction de l'index prend des minutes, le pool coupe à 5 s.
SET statement_timeout = 0;

DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS unaccent;
  EXCEPTION WHEN insufficient_privilege OR feature_not_supported THEN
    RAISE NOTICE 'unaccent indisponible — la recherche restera sensible aux accents';
  END;

  IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'french_nu') THEN
    CREATE TEXT SEARCH CONFIGURATION french_nu (COPY = french);
  END IF;

  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'unaccent') THEN
    ALTER TEXT SEARCH CONFIGURATION french_nu
      ALTER MAPPING FOR hword, hword_part, word WITH unaccent, french_stem;
    RAISE NOTICE 'french_nu : recherche insensible aux accents';
  ELSE
    RAISE NOTICE 'french_nu : recherche SENSIBLE aux accents (unaccent absent)';
  END IF;
END $$;

-- ------------------------------------------------- le vecteur, en colonne
--
-- Colonne stockée plutôt qu'index d'expression : 21 ms contre 407 ms (pas de
-- `to_tsvector` recalculé par ligne candidate), pour ~45 Mo par 120 000 rubriques.
-- ATTENTION : la colonne ne se recalcule pas si `french_nu` change ; la supprimer
-- et réexécuter ce fichier.
--
-- Le titre de la rubrique y entre, poids A : « excipients » trouve 6.1 Liste
-- des excipients, dont le texte ne fait qu'énumérer. ts_rank_cd compte un mot
-- du titre dix fois un mot du texte (poids D). Extraits et surlignage restent
-- calculés sur `texte`.
-- Colonne d'avant (texte seul) : refaite, son index avec elle.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'docs' AND table_name = 'rcp_sections'
               AND column_name = 'vecteur' AND generation_expression NOT LIKE '%libelle%') THEN
    ALTER TABLE docs.rcp_sections DROP COLUMN vecteur;
    RAISE NOTICE 'vecteur : titre de rubrique ajouté, colonne recalculée';
  END IF;
END $$;

-- Table absente (base partagée, avant chargement) : la configuration seule.
-- Restaurée depuis une archive, la table arrive avec sa colonne et son index.
DO $$
BEGIN
  IF to_regclass('docs.rcp_sections') IS NULL THEN
    RAISE NOTICE 'docs.rcp_sections absente : colonne vecteur et index reportés';
    RETURN;
  END IF;
  ALTER TABLE docs.rcp_sections
    ADD COLUMN IF NOT EXISTS vecteur tsvector
    GENERATED ALWAYS AS (
      setweight(to_tsvector('french_nu', libelle), 'A') || to_tsvector('french_nu', texte)
    ) STORED;
  CREATE INDEX IF NOT EXISTS idx_sections_vecteur
    ON docs.rcp_sections USING gin (vecteur);
  -- Anciens index GIN, remplacés par idx_sections_vecteur.
  DROP INDEX IF EXISTS docs.idx_sections_fts_nu;
  DROP INDEX IF EXISTS docs.idx_sections_texte_fts;
END $$;

-- Le filtre par rubrique utilise l'index sur `numero` (sections.sql).

-- ------------------------------------------- signatures des molécules
--
-- Le nom de molécule d'une spécialité (« PARACETAMOL + TRAMADOL »), qui
-- regroupe ses rubriques trouvées. Il ne dépend que des compositions : calculé
-- une fois ici plutôt qu'à chaque recherche, où il coûtait 0,3 à 0,8 s sur
-- les mots courants. Recalculé par build-sections et par ce fichier.
CREATE SCHEMA IF NOT EXISTS docs;

CREATE TABLE IF NOT EXISTS docs.signatures (
  code_cis   varchar(20) PRIMARY KEY,
  signature  text        NOT NULL
);

CREATE OR REPLACE FUNCTION docs.calculer_signatures() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  nombre integer;
BEGIN
  DELETE FROM docs.signatures;
  INSERT INTO docs.signatures (code_cis, signature)
  -- Les libellés du sel, découpés en mots — sans accents ni ponctuation,
  -- « BROMURE D'IPRATROPIUM » devenant {BROMURE, D, IPRATROPIUM}.
  WITH libelles AS (
    SELECT c.code_substance, c.denomination_substance AS nom,
           string_to_array(btrim(regexp_replace(
             upper(public.f_unaccent(c.denomination_substance)),
             '[^A-Z0-9]+', ' ', 'g')), ' ') AS mots
    FROM dbpm.cis_compo_bdpm c
    WHERE c.nature_composant = 'SA'
  ),
  -- Les fractions thérapeutiques rattachées au même numéro de liaison.
  fractions AS (
    SELECT sa.code_substance, ft.denomination_substance AS nom,
           string_to_array(btrim(regexp_replace(
             upper(public.f_unaccent(ft.denomination_substance)),
             '[^A-Z0-9]+', ' ', 'g')), ' ') AS mots
    FROM dbpm.cis_compo_bdpm sa
    JOIN dbpm.cis_compo_bdpm ft
      ON ft.code_cis = sa.code_cis
     AND ft.numero_liaison_saft = sa.numero_liaison_saft
     AND ft.nature_composant = 'FT'
    WHERE sa.nature_composant = 'SA'
  ),
  -- Une fraction ne peut nommer la substance que si tous ses mots sont des
  -- mots du sel. C'est toute la règle, et elle a été trouvée en constatant
  -- les dégâts de l'autre : onze produits de contraste réunis sous « IODE »,
  -- le carboxymaltose ferrique avec le sulfate ferreux, l'acétylcystéine
  -- sous « CYSTÉINE ». La fraction thérapeutique n'est pas la molécule,
  -- c'est ce qui, dans le sel, porte l'effet — parfois un simple atome.
  candidats AS (
    SELECT code_substance, nom FROM libelles
    UNION
    SELECT f.code_substance, f.nom
    FROM fractions f
    WHERE EXISTS (SELECT 1 FROM libelles l
                  WHERE l.code_substance = f.code_substance AND f.mots <@ l.mots)
  ),
  noms AS MATERIALIZED (
    SELECT DISTINCT ON (code_substance) code_substance, nom
    FROM candidats
    WHERE coalesce(nom, '') <> ''
    ORDER BY code_substance, length(nom), nom
  )
  -- La signature : l'ensemble trié des noms résolus. Sur le nom et non sur
  -- le code, sans quoi DARUNAVIR sort trois fois — un code par sel, et la
  -- base elle-même leur donne le même nom. Les spécialités sans composition
  -- retombent sur leur propre CIS plutôt que de se fondre dans un groupe vide
  -- commun, qui les réunirait sans qu'elles aient rien en partage.
  SELECT m.code_cis,
         coalesce(string_agg(DISTINCT n.nom, ' + ' ORDER BY n.nom), 'cis:' || m.code_cis)
  FROM dbpm.cis_bdpm m
  LEFT JOIN dbpm.cis_compo_bdpm c
    ON c.code_cis = m.code_cis AND c.nature_composant = 'SA'
  LEFT JOIN noms n ON n.code_substance = c.code_substance
  GROUP BY m.code_cis;
  GET DIAGNOSTICS nombre = ROW_COUNT;
  RETURN nombre;
END $$;

-- Sans les tables de la BDPM (base partagée, avant chargement) : reporté.
DO $$
BEGIN
  IF to_regclass('dbpm.cis_bdpm') IS NULL OR to_regclass('dbpm.cis_compo_bdpm') IS NULL THEN
    RAISE NOTICE 'tables de la BDPM absentes : signatures reportées';
    RETURN;
  END IF;
  RAISE NOTICE 'signatures : % spécialités', docs.calculer_signatures();
END $$;
