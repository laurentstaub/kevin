-- Recherche plein texte dans les rubriques — configuration et index.
-- Idempotent. Exécution : npm run db:recherche
--
-- Ce que la BDPM ne sait pas faire : chercher « allongement de l'intervalle
-- QT » à travers tous les RCP et savoir dans quelle rubrique de quel produit
-- l'expression figure. La matière est déjà en base — `docs.rcp_sections.texte`
-- est le texte détagué de chaque rubrique — il n'y manquait qu'un index.

-- ---------------------------------------------------------------- la langue
--
-- Une configuration nommée, et une seule, quoi qu'il arrive.
--
-- `unaccent` est la différence entre trouver et ne pas trouver : sans lui,
-- « hypersensibilite » tapé sans accent ne rend rien, et personne ne se relit
-- en tapant vite. Mais l'extension n'est pas garantie partout, et un
-- chargement qui échoue sur ce point priverait le site de sa recherche.
--
-- L'application dit donc toujours `french_nu`. C'est ce fichier qui décide si
-- ce nom recouvre du français désaccentué ou du français simple — et qui le
-- dit tout haut, plutôt que de laisser croire à une recherche insensible aux
-- accents qui ne le serait pas.
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

-- ----------------------------------------------------------------- l'index
--
-- Index d'expression et non colonne calculée : `texte` occupe déjà autant que
-- `html` dans cette table, une troisième copie du même contenu se paierait sur
-- un plan Heroku. L'index porte le tsvector, la table ne le porte pas.
--
-- L'expression doit être écrite ici *exactement* comme dans la requête, sans
-- quoi le planificateur ne reconnaît pas l'index et parcourt la table entière.
CREATE INDEX IF NOT EXISTS idx_sections_fts_nu
  ON docs.rcp_sections
  USING gin (to_tsvector('french_nu', texte));

-- L'ancien index, sur la configuration `french` sans désaccentuation, ne sert
-- plus personne : deux index GIN sur la même colonne coûtent deux fois le
-- stockage et ralentissent chaque écriture de build-sections.
DROP INDEX IF EXISTS docs.idx_sections_texte_fts;

-- Le filtre par rubrique se pose avec la recherche : « insuffisance rénale
-- dans les contre-indications » n'est pas la même question que dans tout le
-- document. L'index sur `numero` existe déjà (sections.sql).
