-- Jeu de données minimal et figé pour les tests d'intégration, indépendant de la BDPM.
-- Chargement : psql -d <base_de_test> -f tests/fixtures.sql

DROP SCHEMA IF EXISTS dbpm CASCADE;
CREATE SCHEMA dbpm;

CREATE TABLE dbpm.cis_bdpm (
  code_cis text PRIMARY KEY,
  denomination_medicament text NOT NULL,
  forme_pharmaceutique text,
  titulaires text,
  -- Requises par la recherche et la fiche produit (sinon 500). Colonnes nommées dans les INSERT.
  type_procedure_amm text,
  statut_administratif_amm text,
  etat_commercialisation text
);

CREATE TABLE dbpm.cis_compo_bdpm (
  code_cis text NOT NULL,
  denomination_substance text NOT NULL
);

CREATE TABLE dbpm.cis_cip_bdpm (
  code_cis text NOT NULL,
  code_cip7 text,
  code_cip13 text,
  libelle_presentation text
);

CREATE TABLE dbpm.cis_gener_bdpm (
  code_cis text NOT NULL,
  identifiant_groupe_generique integer NOT NULL,
  type_generique text,
  libelle_groupe_generique text
);

CREATE TABLE dbpm.cis_documents (
  code_cis text NOT NULL,
  document_type text NOT NULL,
  html_content text,
  file_path text,
  last_updated timestamptz
);

INSERT INTO dbpm.cis_bdpm
  (code_cis, denomination_medicament, forme_pharmaceutique, titulaires,
   type_procedure_amm, statut_administratif_amm, etat_commercialisation)
VALUES
  ('61111111', 'ASPIRINE UPSA 500 mg, comprimé effervescent', 'comprimé effervescent', 'UPSA', 'Procédure nationale', 'Autorisation active', 'Commercialisée'),
  ('61111112', 'ASPIRINE PROTECT 100 mg, comprimé gastro-résistant', 'comprimé', 'BAYER', 'Procédure nationale', 'Autorisation active', 'Commercialisée'),
  ('61111113', 'KARDEGIC 75 mg, poudre pour solution buvable', 'poudre', 'SANOFI', 'Procédure centralisée', 'Autorisation active', 'Commercialisée'),
  -- Deux dosages : une ligne de résultat = un produit, pas un CIS.
  ('61111114', 'DOLIPRANE 1000 mg, comprimé', 'comprimé', 'SANOFI', 'Procédure nationale', 'Autorisation active', 'Commercialisée'),
  ('61111119', 'DOLIPRANE 500 mg, gélule', 'gélule', 'SANOFI', 'Procédure nationale', 'Autorisation active', 'Commercialisée'),
  ('61111115', 'DAFALGAN 1000 mg, comprimé pelliculé', 'comprimé pelliculé', 'UPSA', 'Procédure nationale', 'Autorisation active', 'Commercialisée'),
  ('61111116', 'SIROP PÉDIATRIQUE FRUITS ROUGES', 'sirop', 'LABO TEST', 'Procédure nationale', 'Autorisation active', 'Commercialisée'),
  -- « paracétamol » en dénomination et en composition : éprouve le partage entre familles de résultats.
  -- TEVA n'est pas commercialisé : il doit passer derrière ARROW.
  ('61111117', 'PARACETAMOL ARROW 1000 mg, comprimé', 'comprimé', 'ARROW', 'Procédure nationale', 'Autorisation active', 'Commercialisée'),
  ('61111118', 'PARACETAMOL TEVA 500 mg, comprimé', 'comprimé', 'TEVA', 'Procédure nationale', 'Autorisation active', 'Non commercialisée');

INSERT INTO dbpm.cis_compo_bdpm VALUES
  ('61111111', 'ACIDE ACETYLSALICYLIQUE'),
  ('61111112', 'ACIDE ACETYLSALICYLIQUE'),
  ('61111113', 'ACETYLSALICYLATE DE LYSINE'),
  ('61111114', 'PARACETAMOL'),
  ('61111119', 'PARACETAMOL'),
  ('61111115', 'PARACETAMOL'),
  ('61111116', 'PARACETAMOL'),
  ('61111117', 'PARACETAMOL'),
  ('61111118', 'PARACETAMOL');

INSERT INTO dbpm.cis_cip_bdpm VALUES
  ('61111111', '3400931', '3400930000025', 'Boîte de 30 comprimés effervescents'),
  ('61111111', '3400930', '3400930000018', 'Boîte de 20 comprimés effervescents');

-- Groupe générique : 0 = princeps, 1 = générique
INSERT INTO dbpm.cis_gener_bdpm VALUES
  ('61111111', 101, '0', 'ACIDE ACETYLSALICYLIQUE 500 mg'),
  ('61111112', 101, '1', 'ACIDE ACETYLSALICYLIQUE 500 mg');

-- Classification ATC : SIROP PÉDIATRIQUE et KARDEGIC restent sans classe, comme une partie de la base réelle.
DROP SCHEMA IF EXISTS ref CASCADE;
CREATE SCHEMA ref;

CREATE TABLE ref.atc_classification (
  atc_code        text PRIMARY KEY,
  atc_label       text NOT NULL,
  atc_level       integer NOT NULL,
  parent_atc_code text
);

CREATE TABLE ref.cis_atc_mapping (
  code_cis text PRIMARY KEY,
  atc_code text NOT NULL,
  source   text
);

INSERT INTO ref.atc_classification VALUES
  ('N',        'Système nerveux',                       1, NULL),
  ('N02',      'ANALGESIQUES',                          2, 'N'),
  ('N02B',     'AUTRES ANALGESIQUES ET ANTIPYRETIQUES', 3, 'N02'),
  ('N02BA',    'ACIDE SALICYLIQUE ET DERIVES',          4, 'N02B'),
  ('N02BA01',  'ACIDE ACETYLSALICYLIQUE',               5, 'N02BA'),
  ('N02BE',    'ANILIDES',                              4, 'N02B'),
  ('N02BE01',  'PARACETAMOL',                           5, 'N02BE'),
  -- Code sans libellé (le libellé recopie le code) : l'affichage reprend celui du parent.
  ('N02BE71',  'N02BE71',                               5, 'N02BE'),
  ('B',        'Sang et organes hématopoiétiques',      1, NULL),
  ('B01',      'ANTITHROMBOTIQUES',                     2, 'B'),
  ('B01A',     'ANTITHROMBOTIQUES',                     3, 'B01'),
  ('B01AC',    'INHIBITEURS AGREGATION PLAQUETTAIRE',   4, 'B01A'),
  ('B01AC06',  'ACIDE ACETYLSALICYLIQUE',               5, 'B01AC');

INSERT INTO ref.cis_atc_mapping VALUES
  ('61111111', 'N02BA01', 'medicam'),
  ('61111112', 'B01AC06', 'medicam'),
  ('61111114', 'N02BE01', 'medicam'),
  ('61111119', 'N02BE01', 'medicam'),
  ('61111115', 'N02BE01', 'medicam'),
  ('61111117', 'N02BE01', 'medicam'),
  ('61111118', 'N02BE01', 'medicam'),
  -- Code sans libellé : la fiche doit afficher « ANILIDES », pas « N02BE71 ».
  ('61111116', 'N02BE71', 'medicine_sales_2023');

INSERT INTO dbpm.cis_documents VALUES
  ('61111111', 'rcp',
   '<h2>4.2 Posologie</h2><p>1 comprimé.</p><script>alert(1)</script><a href="javascript:x()">piège</a>',
   'https://ansm.sante.fr/rcp/61111111.pdf', '2025-06-01'),
  ('61111112', 'notice', '<p>Notice patient.</p>', 'https://evil.example.com/piege.pdf', '2025-06-01'),
  -- Spécialité centralisée : pas de HTML, un PDF unique en chemin relatif.
  ('61111113', 'rcp_notice', NULL, '/documents/61111113/rcp_notice.pdf', '2025-06-01');
