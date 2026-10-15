-- Jeu de données minimal et figé pour les tests d'intégration, indépendant de la BDPM.
-- Les tables reprennent les colonnes et les types de la base réelle (schémas dbpm et ref) ;
-- à réaligner quand le chargement de la BDPM en ajoute.
--
-- Chargement, dans cet ordre (c'est ce que fait tests/integration/base.js) :
--   tests/fixtures.sql, sql/setup.sql, sql/sections.sql, sql/recherche.sql, tests/fixtures-docs.sql
-- Le schéma docs est supprimé ici et recréé par sql/sections.sql : ses rubriques sont dans fixtures-docs.sql.

DROP SCHEMA IF EXISTS docs CASCADE;
DROP SCHEMA IF EXISTS dbpm CASCADE;
CREATE SCHEMA dbpm;

CREATE TABLE dbpm.cis_bdpm (
  code_cis varchar PRIMARY KEY,
  denomination_medicament varchar,
  forme_pharmaceutique varchar,
  voies_administration varchar,
  statut_administratif_amm varchar,
  type_procedure_amm varchar,
  etat_commercialisation varchar,
  date_amm date,
  statutbdm varchar,
  numero_autorisation_europeenne varchar,
  titulaires text,
  -- Triangle noir.
  surveillance_renforcee boolean
);

CREATE TABLE dbpm.cis_compo_bdpm (
  code_cis varchar NOT NULL,
  designation_element_pharmaceutique varchar,
  code_substance varchar NOT NULL,
  denomination_substance varchar,
  dosage_substance varchar,
  reference_dosage varchar,
  -- SA : substance active ; FT : fraction thérapeutique.
  nature_composant varchar,
  numero_liaison_saft varchar,
  id serial PRIMARY KEY
);

CREATE TABLE dbpm.cis_cip_bdpm (
  code_cis varchar NOT NULL,
  code_cip7 varchar NOT NULL,
  libelle_presentation text,
  statut_administratif_presentation varchar,
  etat_commercialisation varchar,
  date_declaration_commercialisation date,
  code_cip13 varchar,
  agrement_collectivites boolean,
  taux_remboursement numeric,
  prix_medicament_euro numeric,
  prix_medicament_euro_2 numeric,
  taux_mystere numeric,
  indications_remboursement text
);

CREATE TABLE dbpm.cis_gener_bdpm (
  id serial PRIMARY KEY,
  identifiant_groupe_generique varchar,
  libelle_groupe_generique text,
  code_cis varchar,
  type_generique varchar,
  numero_tri integer
);

CREATE TABLE dbpm.cis_cpd_bdpm (
  code_cis varchar NOT NULL,
  condition_prescription_delivrance text,
  id serial PRIMARY KEY
);

CREATE TABLE dbpm.cis_has_smr (
  id serial PRIMARY KEY,
  code_cis varchar,
  code_dossier_has varchar,
  motif_evaluation text,
  date_avis_commission_transparence date,
  valeur_smr varchar,
  libelle_smr text
);

CREATE TABLE dbpm.cis_has_asmr (
  id serial PRIMARY KEY,
  code_cis varchar,
  code_dossier_has varchar,
  motif_evaluation text,
  date_avis_commission_transparence date,
  valeur_asmr varchar,
  libelle_asmr text
);

CREATE TABLE dbpm.has_lienspagect_bdpm (
  code_dossier_has varchar NOT NULL,
  lien_pages_avis_ct text
);

CREATE TABLE dbpm.cis_infos_importantes (
  id serial PRIMARY KEY,
  code_cis varchar,
  date_debut_securite timestamp,
  date_fin_securite timestamp,
  texte_securite text
);

CREATE TABLE dbpm.cis_documents (
  id serial PRIMARY KEY,
  code_cis varchar NOT NULL,
  document_type varchar NOT NULL,
  html_content text,
  file_path text,
  last_updated timestamp
);

INSERT INTO dbpm.cis_bdpm
  (code_cis, denomination_medicament, forme_pharmaceutique, voies_administration, titulaires,
   type_procedure_amm, statut_administratif_amm, etat_commercialisation, surveillance_renforcee)
VALUES
  ('61111111', 'ASPIRINE UPSA 500 mg, comprimé effervescent', 'comprimé effervescent', 'orale', 'UPSA', 'Procédure nationale', 'Autorisation active', 'Commercialisée', false),
  ('61111112', 'ASPIRINE PROTECT 100 mg, comprimé gastro-résistant', 'comprimé', 'orale', 'BAYER', 'Procédure nationale', 'Autorisation active', 'Commercialisée', false),
  ('61111113', 'KARDEGIC 75 mg, poudre pour solution buvable', 'poudre', 'orale', 'SANOFI', 'Procédure centralisée', 'Autorisation active', 'Commercialisée', false),
  -- Deux dosages : une ligne de résultat = un produit, pas un CIS.
  ('61111114', 'DOLIPRANE 1000 mg, comprimé', 'comprimé', 'orale', 'SANOFI', 'Procédure nationale', 'Autorisation active', 'Commercialisée', false),
  ('61111119', 'DOLIPRANE 500 mg, gélule', 'gélule', 'orale', 'SANOFI', 'Procédure nationale', 'Autorisation active', 'Commercialisée', false),
  ('61111115', 'DAFALGAN 1000 mg, comprimé pelliculé', 'comprimé pelliculé', 'orale', 'UPSA', 'Procédure nationale', 'Autorisation active', 'Commercialisée', false),
  ('61111116', 'SIROP PÉDIATRIQUE FRUITS ROUGES', 'sirop', 'orale', 'LABO TEST', 'Procédure nationale', 'Autorisation active', 'Commercialisée', false),
  -- « paracétamol » en dénomination et en composition : éprouve le partage entre familles de résultats.
  -- TEVA n'est pas commercialisé : il doit passer derrière ARROW.
  ('61111117', 'PARACETAMOL ARROW 1000 mg, comprimé', 'comprimé', 'orale', 'ARROW', 'Procédure nationale', 'Autorisation active', 'Commercialisée', false),
  ('61111118', 'PARACETAMOL TEVA 500 mg, comprimé', 'comprimé', 'orale', 'TEVA', 'Procédure nationale', 'Autorisation active', 'Non commercialisée', false),
  -- Antivitamine K : l'autre moitié de la paire d'interactions avec ASPIRINE UPSA ;
  -- sous surveillance renforcée pour éprouver le triangle noir (pour le jeu d'essai seulement).
  ('61111120', 'PREVISCAN 20 mg, comprimé sécable', 'comprimé sécable', 'orale', 'CHEPLAPHARM', 'Procédure nationale', 'Autorisation active', 'Commercialisée', true);

INSERT INTO dbpm.cis_compo_bdpm
  (code_cis, designation_element_pharmaceutique, code_substance, denomination_substance,
   dosage_substance, reference_dosage, nature_composant, numero_liaison_saft)
VALUES
  ('61111111', 'comprimé', '00005', 'ACIDE ACETYLSALICYLIQUE', '500 mg', 'un comprimé', 'SA', '1'),
  ('61111112', 'comprimé', '00005', 'ACIDE ACETYLSALICYLIQUE', '100 mg', 'un comprimé', 'SA', '1'),
  -- Sel et fraction thérapeutique, comme la BDPM les livre : la FT n'est pas une substance de plus.
  ('61111113', 'poudre', '01180', 'ACETYLSALICYLATE DE LYSINE', '135 mg', 'un sachet', 'SA', '1'),
  ('61111113', 'poudre', '00005', 'ACIDE ACETYLSALICYLIQUE', '75 mg', 'un sachet', 'FT', '1'),
  ('61111114', 'comprimé', '02202', 'PARACETAMOL', '1000 mg', 'un comprimé', 'SA', '1'),
  ('61111119', 'gélule', '02202', 'PARACETAMOL', '500 mg', 'une gélule', 'SA', '1'),
  ('61111115', 'comprimé', '02202', 'PARACETAMOL', '1000 mg', 'un comprimé', 'SA', '1'),
  ('61111116', 'sirop', '02202', 'PARACETAMOL', '2,4 g', '100 ml', 'SA', '1'),
  ('61111117', 'comprimé', '02202', 'PARACETAMOL', '1000 mg', 'un comprimé', 'SA', '1'),
  ('61111118', 'comprimé', '02202', 'PARACETAMOL', '500 mg', 'un comprimé', 'SA', '1'),
  ('61111120', 'comprimé', '04227', 'FLUINDIONE', '20 mg', 'un comprimé', 'SA', '1');

INSERT INTO dbpm.cis_cip_bdpm
  (code_cis, code_cip7, code_cip13, libelle_presentation, statut_administratif_presentation,
   etat_commercialisation, agrement_collectivites, taux_remboursement, prix_medicament_euro, prix_medicament_euro_2)
VALUES
  ('61111111', '3400931', '3400930000025', 'Boîte de 30 comprimés effervescents', 'Présentation active', 'Déclaration de commercialisation', true, 65, 2.18, 3.20),
  ('61111111', '3400930', '3400930000018', 'Boîte de 20 comprimés effervescents', 'Présentation active', 'Déclaration de commercialisation', true, 65, 1.73, 2.75);

-- Groupe générique : 0 = princeps, 1 = générique
INSERT INTO dbpm.cis_gener_bdpm
  (identifiant_groupe_generique, libelle_groupe_generique, code_cis, type_generique, numero_tri)
VALUES
  ('101', 'ACIDE ACETYLSALICYLIQUE 500 mg', '61111111', '0', 1),
  ('101', 'ACIDE ACETYLSALICYLIQUE 500 mg', '61111112', '1', 2);

INSERT INTO dbpm.cis_cpd_bdpm (code_cis, condition_prescription_delivrance) VALUES
  ('61111120', 'Liste I');

-- Informations de sécurité : une en cours (lien ANSM), une archivée sur un domaine non autorisé.
INSERT INTO dbpm.cis_infos_importantes (code_cis, date_debut_securite, date_fin_securite, texte_securite) VALUES
  ('61111120', '2025-03-01', NULL,
   '<a target="_blank" href="https://ansm.sante.fr/informations-de-securite/fluindione-arret">Fluindione : arr&ecirc;t de commercialisation programm&eacute;</a>'),
  ('61111120', '2019-01-15', '2019-07-15',
   '<a href="https://evil.example.com/piege">Ancienne information archivée</a>');

-- Classification ATC : SIROP PÉDIATRIQUE et KARDEGIC restent sans classe, comme une partie de la base réelle.
DROP SCHEMA IF EXISTS ref CASCADE;
CREATE SCHEMA ref;

CREATE TABLE ref.atc_classification (
  atc_code        varchar PRIMARY KEY,
  atc_label       varchar NOT NULL,
  atc_level       integer NOT NULL,
  parent_atc_code varchar
);

CREATE TABLE ref.cis_atc_mapping (
  code_cis varchar PRIMARY KEY,
  atc_code varchar NOT NULL,
  source   text NOT NULL
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
  ('B01AA',    'ANTIVITAMINES K',                       4, 'B01A'),
  ('B01AA12',  'FLUINDIONE',                            5, 'B01AA'),
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
  ('61111116', 'N02BE71', 'medicine_sales_2023'),
  -- Classe Antivitamines K (B01AA) : ASPIRINE UPSA la nomme sans nommer la fluindione.
  ('61111120', 'B01AA12', 'medicam');

INSERT INTO dbpm.cis_documents (code_cis, document_type, html_content, file_path, last_updated) VALUES
  ('61111111', 'rcp',
   '<h2>4.2 Posologie</h2><p>1 comprimé.</p><script>alert(1)</script><a href="javascript:x()">piège</a>',
   'https://ansm.sante.fr/rcp/61111111.pdf', '2025-06-01'),
  ('61111112', 'notice', '<p>Notice patient.</p>', 'https://evil.example.com/piege.pdf', '2025-06-01'),
  -- Spécialité centralisée : pas de HTML, un PDF unique en chemin relatif.
  ('61111113', 'rcp_notice', NULL, '/documents/61111113/rcp_notice.pdf', '2025-06-01'),
  ('61111120', 'rcp', '<h2>4.5 Interactions</h2><p>Associations contre-indiquées.</p>',
   'https://ansm.sante.fr/rcp/61111120.pdf', '2025-06-01');
