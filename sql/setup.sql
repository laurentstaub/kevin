-- Prérequis SQL de l'application. Idempotent : rejouable sans risque.
-- Exécution : npm run db:setup

CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- unaccent() est STABLE : ce wrapper IMMUTABLE sur dictionnaire nommé la rend indexable.
CREATE OR REPLACE FUNCTION public.f_unaccent(text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE PARALLEL SAFE STRICT
AS $$
  SELECT public.unaccent('public.unaccent'::regdictionary, $1)
$$;

-- Index, sur les seules tables présentes : sur une base partagée (Heroku,
-- avec Dispomed), le script passe avant le chargement des tables propres à
-- Kevin (cis_compo_bdpm, cis_cip_bdpm), puis une seconde fois après.
DO $$
DECLARE
  index_ record;
BEGIN
  FOR index_ IN SELECT * FROM (VALUES
    -- Index trigrammes pour les motifs LIKE '%terme%'.
    ('dbpm.cis_bdpm', 'CREATE INDEX IF NOT EXISTS idx_cis_denomination_trgm ON dbpm.cis_bdpm
       USING gin (public.f_unaccent(lower(denomination_medicament)) gin_trgm_ops)'),
    ('dbpm.cis_compo_bdpm', 'CREATE INDEX IF NOT EXISTS idx_compo_substance_trgm ON dbpm.cis_compo_bdpm
       USING gin (public.f_unaccent(lower(denomination_substance)) gin_trgm_ops)'),
    -- Jointures fréquentes.
    ('dbpm.cis_compo_bdpm', 'CREATE INDEX IF NOT EXISTS idx_compo_code_cis ON dbpm.cis_compo_bdpm (code_cis)'),
    ('dbpm.cis_cip_bdpm', 'CREATE INDEX IF NOT EXISTS idx_cip_code_cis ON dbpm.cis_cip_bdpm (code_cis)'),
    ('dbpm.cis_gener_bdpm', 'CREATE INDEX IF NOT EXISTS idx_gener_code_cis ON dbpm.cis_gener_bdpm (code_cis)'),
    ('dbpm.cis_gener_bdpm', 'CREATE INDEX IF NOT EXISTS idx_gener_groupe ON dbpm.cis_gener_bdpm (identifiant_groupe_generique)'),
    -- Recherche exacte de substance (produits apparentés).
    ('dbpm.cis_compo_bdpm', 'CREATE INDEX IF NOT EXISTS idx_compo_substance ON dbpm.cis_compo_bdpm (denomination_substance)'),
    ('dbpm.cis_bdpm', 'ANALYZE dbpm.cis_bdpm'),
    ('dbpm.cis_compo_bdpm', 'ANALYZE dbpm.cis_compo_bdpm')
  ) AS t(table_, ordre) LOOP
    IF to_regclass(index_.table_) IS NOT NULL THEN
      EXECUTE index_.ordre;
    ELSE
      RAISE NOTICE '% absente : % reporté', index_.table_, split_part(index_.ordre, ' ON ', 1);
    END IF;
  END LOOP;
END $$;
