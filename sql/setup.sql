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

-- Index trigrammes pour les motifs LIKE '%terme%'.
CREATE INDEX IF NOT EXISTS idx_cis_denomination_trgm
  ON dbpm.cis_bdpm
  USING gin (public.f_unaccent(lower(denomination_medicament)) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_compo_substance_trgm
  ON dbpm.cis_compo_bdpm
  USING gin (public.f_unaccent(lower(denomination_substance)) gin_trgm_ops);

-- Jointures fréquentes.
CREATE INDEX IF NOT EXISTS idx_compo_code_cis
  ON dbpm.cis_compo_bdpm (code_cis);

CREATE INDEX IF NOT EXISTS idx_cip_code_cis
  ON dbpm.cis_cip_bdpm (code_cis);

CREATE INDEX IF NOT EXISTS idx_gener_code_cis
  ON dbpm.cis_gener_bdpm (code_cis);

CREATE INDEX IF NOT EXISTS idx_gener_groupe
  ON dbpm.cis_gener_bdpm (identifiant_groupe_generique);

-- Recherche exacte de substance (produits apparentés).
CREATE INDEX IF NOT EXISTS idx_compo_substance
  ON dbpm.cis_compo_bdpm (denomination_substance);

ANALYZE dbpm.cis_bdpm;
ANALYZE dbpm.cis_compo_bdpm;
