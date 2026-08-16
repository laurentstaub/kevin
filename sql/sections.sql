-- Rubriques de documents — schéma docs.
-- Idempotent. Exécution : npm run db:sections
--
-- Pourquoi un schéma à part : `dbpm` est le miroir des fichiers CIS_*.txt,
-- reconstruit par DELETE + insert à chaque chargement. Ce qui est dérivé du
-- scraping n'y a pas sa place — sans quoi le miroir cesse d'être jetable.

CREATE SCHEMA IF NOT EXISTS docs;

-- Une ligne par rubrique. La numérotation porte l'arbre : « 4.2 » a pour
-- parent « 4 », ça se déduit, ça ne se stocke pas.
CREATE TABLE IF NOT EXISTS docs.rcp_sections (
  code_cis       varchar(20)  NOT NULL,
  document_type  varchar(20)  NOT NULL,
  position       integer      NOT NULL,   -- ordre dans le document
  numero         text         NOT NULL,   -- « 4.2 »
  libelle        text         NOT NULL,
  profondeur     smallint     NOT NULL,
  canonical      boolean      NOT NULL,   -- libellé rétabli depuis le plan QRD
  html           text         NOT NULL,   -- pour l'affichage
  texte          text         NOT NULL,   -- pour la recherche
  source         text         NOT NULL DEFAULT 'bdpm_html',
  PRIMARY KEY (code_cis, document_type, position)
);

-- Sur une page médicale, le lecteur doit pouvoir savoir s'il lit le texte
-- officiel ou une reconstruction depuis un PDF.
ALTER TABLE docs.rcp_sections
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'bdpm_html';

CREATE INDEX IF NOT EXISTS idx_sections_numero
  ON docs.rcp_sections (numero);

CREATE INDEX IF NOT EXISTS idx_sections_cis
  ON docs.rcp_sections (code_cis);

-- La recherche plein texte a son propre fichier, sql/recherche.sql : elle a
-- besoin d'unaccent et d'une configuration maison, que ce fichier-ci ne doit
-- pas exiger. L'index vivait ici, sur la configuration `french` : db:sections
-- le recréait donc juste après que db:recherche l'eut supprimé, et deux index
-- GIN sur la même matière ralentissaient chaque écriture pour rien.

-- État du découpage, une ligne par document — y compris les échecs, qui ne
-- produisent aucune rubrique et seraient donc invisibles autrement.
CREATE TABLE IF NOT EXISTS docs.document_parse (
  code_cis       varchar(20)  NOT NULL,
  document_type  varchar(20)  NOT NULL,
  source_hash    text         NOT NULL,   -- empreinte du html_content d'origine
  parser_version integer      NOT NULL,   -- pour rejouer après amélioration
  section_count  integer      NOT NULL,
  statut         text         NOT NULL,   -- ok | partiel | echec
  manquantes     text[]       NOT NULL DEFAULT '{}',  -- rubriques socle absentes
  source         text         NOT NULL DEFAULT 'bdpm_html',  -- bdpm_html | bdpm_pdf
  parsed_at      timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (code_cis, document_type)
);

ALTER TABLE docs.document_parse
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'bdpm_html';

CREATE INDEX IF NOT EXISTS idx_parse_statut
  ON docs.document_parse (statut);

COMMENT ON TABLE docs.rcp_sections IS
  'Rubriques découpées des RCP et notices. Dérivé de dbpm.cis_documents, reconstructible.';
COMMENT ON TABLE docs.document_parse IS
  'Suivi du découpage : empreinte, version du découpeur, qualité. Sert au saut incrémental.';
