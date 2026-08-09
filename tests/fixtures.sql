-- Jeu de données minimal et figé pour les tests d'intégration.
-- Il ne dépend d'aucune mise à jour BDPM : les tests restent stables dans le temps.
-- Chargement : psql -d <base_de_test> -f tests/fixtures.sql

DROP SCHEMA IF EXISTS dbpm CASCADE;
CREATE SCHEMA dbpm;

CREATE TABLE dbpm.cis_bdpm (
  code_cis text PRIMARY KEY,
  denomination_medicament text NOT NULL,
  forme_pharmaceutique text,
  titulaires text,
  -- Lues par la recherche et la fiche produit : sans elles, toute requête
  -- part en 500. Les colonnes sont nommées dans les INSERT ci-dessous pour
  -- qu'un ajout ultérieur ne casse pas le chargement en silence.
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
  -- DOLIPRANE porte deux dosages : c'est ce qui permet de vérifier qu'une
  -- ligne de résultat représente un produit et non un code CIS.
  ('61111114', 'DOLIPRANE 1000 mg, comprimé', 'comprimé', 'SANOFI', 'Procédure nationale', 'Autorisation active', 'Commercialisée'),
  ('61111119', 'DOLIPRANE 500 mg, gélule', 'gélule', 'SANOFI', 'Procédure nationale', 'Autorisation active', 'Commercialisée'),
  ('61111115', 'DAFALGAN 1000 mg, comprimé pelliculé', 'comprimé pelliculé', 'UPSA', 'Procédure nationale', 'Autorisation active', 'Commercialisée'),
  ('61111116', 'SIROP PÉDIATRIQUE FRUITS ROUGES', 'sirop', 'LABO TEST', 'Procédure nationale', 'Autorisation active', 'Commercialisée'),
  -- Ces deux-là portent « paracétamol » dans leur dénomination *et* dans leur
  -- composition : c'est ce qui permet d'éprouver le partage entre les deux
  -- familles de résultats, sans quoi la recherche par substance n'a pas de
  -- concurrent et le défaut d'éviction reste invisible.
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

INSERT INTO dbpm.cis_documents VALUES
  ('61111111', 'rcp',
   '<h2>4.2 Posologie</h2><p>1 comprimé.</p><script>alert(1)</script><a href="javascript:x()">piège</a>',
   'https://ansm.sante.fr/rcp/61111111.pdf', '2025-06-01'),
  ('61111112', 'notice', '<p>Notice patient.</p>', 'https://evil.example.com/piege.pdf', '2025-06-01'),
  -- Spécialité centralisée : pas de HTML, un PDF unique en chemin relatif.
  ('61111113', 'rcp_notice', NULL, '/documents/61111113/rcp_notice.pdf', '2025-06-01');
