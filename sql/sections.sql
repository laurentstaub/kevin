-- Rubriques de documents — schéma docs.
-- Idempotent. Exécution : npm run db:sections
-- Schéma à part : `dbpm`, miroir des CIS_*.txt reconstruit à chaque chargement,
-- doit rester jetable.

CREATE SCHEMA IF NOT EXISTS docs;

-- Une ligne par rubrique ; l'arbre se déduit du numéro (« 4.2 » → « 4 »).
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

-- Distingue le texte officiel d'une reconstruction depuis un PDF.
ALTER TABLE docs.rcp_sections
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'bdpm_html';

CREATE INDEX IF NOT EXISTS idx_sections_numero
  ON docs.rcp_sections (numero);

CREATE INDEX IF NOT EXISTS idx_sections_cis
  ON docs.rcp_sections (code_cis);

-- Index plein texte : dans sql/recherche.sql uniquement (unaccent, config maison).

-- État du découpage par document, échecs compris (sans rubrique, sinon invisibles).
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
