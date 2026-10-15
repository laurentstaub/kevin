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

-- Le filtre par rubrique utilise l'index sur `numero` (sections.sql).
