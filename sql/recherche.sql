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
-- La construction de l'index prend des minutes sur trois cent mille rubriques.
-- Le pool de l'application coupe à cinq secondes — juste pour une requête
-- servie à un lecteur qui attend, absurde pour une migration. scripts/db-migrer
-- passe déjà `statement_timeout: 0` ; cette ligne le garantit aussi lorsque le
-- fichier est joué à la main, par psql ou par un administrateur.
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
-- Ce fichier portait d'abord un index d'expression, au motif que `texte` pèse
-- déjà autant que `html` et qu'une troisième copie du même contenu se paierait
-- sur un plan Heroku. Le raisonnement pesait le disque et n'avait jamais mesuré
-- le temps. Mesure faite, sur 120 000 rubriques d'un kilo-octet :
--
--   index d'expression   407 ms      colonne stockée   21 ms
--
-- Vingt fois. Le balayage d'index ne prend que 0,6 ms dans les deux cas ; tout
-- le reste est `to_tsvector` recalculé sur chacune des 3 000 rubriques
-- candidates, une fois pour la revérification et une fois pour `ts_rank_cd`.
-- Un index d'expression indexe le résultat, il ne le conserve pas.
--
-- Le prix est de 45 Mo pour ces 120 000 rubriques, soit environ 40 % du texte
-- compressé. C'est le bon échange : la lenteur se paie à chaque recherche, le
-- disque une fois.
--
-- ATTENTION : une colonne générée ne se recalcule pas quand la configuration
-- `french_nu` change. Si la table des correspondances est modifiée plus haut,
-- il faut supprimer la colonne et réexécuter ce fichier.
ALTER TABLE docs.rcp_sections
  ADD COLUMN IF NOT EXISTS vecteur tsvector
  GENERATED ALWAYS AS (to_tsvector('french_nu', texte)) STORED;

CREATE INDEX IF NOT EXISTS idx_sections_vecteur
  ON docs.rcp_sections USING gin (vecteur);

-- Les deux index précédents ne servent plus personne, et trois index GIN sur
-- la même matière coûteraient trois fois le stockage en ralentissant chaque
-- écriture de build-sections.
DROP INDEX IF EXISTS docs.idx_sections_fts_nu;
DROP INDEX IF EXISTS docs.idx_sections_texte_fts;

-- Le filtre par rubrique se pose avec la recherche : « insuffisance rénale
-- dans les contre-indications » n'est pas la même question que dans tout le
-- document. L'index sur `numero` existe déjà (sections.sql).
