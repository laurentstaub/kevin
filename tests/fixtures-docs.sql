-- Rubriques découpées du jeu d'essai (schéma docs), chargées après sql/sections.sql et
-- sql/recherche.sql, qui créent les tables, la colonne `vecteur` et la configuration `french_nu`.
-- Voir l'ordre de chargement en tête de tests/fixtures.sql.
--
-- Ce qu'elles éprouvent :
--   - excipients (rubriques 2 et 6.1) : ASPIRINE UPSA déclare aspartam et sodium ; parmi les
--     alternatives de DOLIPRANE, DAFALGAN contient du lactose, PARACETAMOL ARROW non ;
--   - interactions (rubrique 4.5) : ASPIRINE UPSA nomme la classe des anticoagulants oraux,
--     PREVISCAN nomme l'acide acétylsalicylique ;
-- KARDEGIC n'a pas de rubriques : son RCP n'existe qu'en PDF, cas que la fiche doit afficher tel quel.
--   - recherche plein texte : « aspirine » en 4.4 ;
--   - classement : PREVISCAN porte « allongement QT » mot pour mot, mais dans son
--     surdosage (4.9) ; ASPIRINE UPSA en parle en 4.8, sans l'expression exacte.
--     Les effets indésirables passent devant le surdosage.

INSERT INTO docs.rcp_sections
  (code_cis, document_type, position, numero, libelle, profondeur, canonical, html, texte, source)
VALUES
  ('61111111', 'rcp', 1, '2', 'COMPOSITION QUALITATIVE ET QUANTITATIVE', 1, true,
   '<p>Acide acétylsalicylique 500 mg pour un comprimé effervescent.</p><p>Excipients à effet notoire : chaque comprimé contient 485 mg de sodium et 25 mg d''aspartam (E951).</p><p>Pour la liste complète des excipients, voir rubrique 6.1.</p>',
   'Acide acétylsalicylique 500 mg pour un comprimé effervescent. Excipients à effet notoire : chaque comprimé contient 485 mg de sodium et 25 mg d''aspartam (E951). Pour la liste complète des excipients, voir rubrique 6.1.',
   'bdpm_html'),
  ('61111111', 'rcp', 2, '4', 'DONNÉES CLINIQUES', 1, true, '', '', 'bdpm_html'),
  ('61111111', 'rcp', 3, '4.2', 'Posologie et mode d''administration', 2, true,
   '<p>1 comprimé, à renouveler si besoin au bout de 4 heures.</p>',
   '1 comprimé, à renouveler si besoin au bout de 4 heures.', 'bdpm_html'),
  ('61111111', 'rcp', 4, '4.4', 'Mises en garde spéciales et précautions d''emploi', 2, true,
   '<p>Ne pas associer à un autre médicament contenant de l''aspirine, pour éviter un surdosage.</p>',
   'Ne pas associer à un autre médicament contenant de l''aspirine, pour éviter un surdosage.', 'bdpm_html'),
  ('61111111', 'rcp', 5, '4.5', 'Interactions avec d''autres médicaments et autres formes d''interactions', 2, true,
   '<p>Associations déconseillées</p><p>+ Anticoagulants oraux</p><p>Majoration du risque hémorragique, notamment en cas d''antécédent d''ulcère gastroduodénal.</p>',
   'Associations déconseillées + Anticoagulants oraux Majoration du risque hémorragique, notamment en cas d''antécédent d''ulcère gastroduodénal.',
   'bdpm_html'),
  ('61111111', 'rcp', 6, '6', 'DONNÉES PHARMACEUTIQUES', 1, true, '', '', 'bdpm_html'),
  ('61111111', 'rcp', 7, '6.1', 'Liste des excipients', 2, true,
   '<p>Acide citrique anhydre, bicarbonate de sodium, carbonate de sodium anhydre, povidone, aspartam (E951), arôme orange.</p>',
   'Acide citrique anhydre, bicarbonate de sodium, carbonate de sodium anhydre, povidone, aspartam (E951), arôme orange.',
   'bdpm_html'),
  ('61111111', 'rcp', 8, '4.8', 'Effets indésirables', 2, true,
   '<p>Rares cas d''allongement de l''intervalle QT rapportés.</p>',
   'Rares cas d''allongement de l''intervalle QT rapportés.', 'bdpm_html'),

  ('61111114', 'rcp', 1, '6.1', 'Liste des excipients', 2, true,
   '<p>Amidon de maïs prégélatinisé, povidone, stéarate de magnésium.</p>',
   'Amidon de maïs prégélatinisé, povidone, stéarate de magnésium.', 'bdpm_html'),

  ('61111115', 'rcp', 1, '2', 'COMPOSITION QUALITATIVE ET QUANTITATIVE', 1, true,
   '<p>Paracétamol 1000 mg pour un comprimé pelliculé.</p><p>Excipient à effet notoire : lactose (45 mg par comprimé).</p><p>Pour la liste complète des excipients, voir rubrique 6.1.</p>',
   'Paracétamol 1000 mg pour un comprimé pelliculé. Excipient à effet notoire : lactose (45 mg par comprimé). Pour la liste complète des excipients, voir rubrique 6.1.',
   'bdpm_html'),
  ('61111115', 'rcp', 2, '6.1', 'Liste des excipients', 2, true,
   '<p>Lactose monohydraté, cellulose microcristalline, stéarate de magnésium.</p>',
   'Lactose monohydraté, cellulose microcristalline, stéarate de magnésium.', 'bdpm_html'),

  ('61111117', 'rcp', 1, '6.1', 'Liste des excipients', 2, true,
   '<p>Cellulose microcristalline, povidone, stéarate de magnésium.</p>',
   'Cellulose microcristalline, povidone, stéarate de magnésium.', 'bdpm_html'),

  ('61111120', 'rcp', 1, '4.5', 'Interactions avec d''autres médicaments et autres formes d''interactions', 2, true,
   '<p>Associations contre-indiquées</p><p>+ Acide acétylsalicylique</p><p>Pour des doses anti-inflammatoires d''acide acétylsalicylique, et en cas d''antécédent d''ulcère gastroduodénal : majoration du risque hémorragique.</p>',
   'Associations contre-indiquées + Acide acétylsalicylique Pour des doses anti-inflammatoires d''acide acétylsalicylique, et en cas d''antécédent d''ulcère gastroduodénal : majoration du risque hémorragique.',
   'bdpm_html'),
  ('61111120', 'rcp', 2, '4.9', 'Surdosage', 2, true,
   '<p>À doses massives, un allongement QT a été observé.</p>',
   'À doses massives, un allongement QT a été observé.', 'bdpm_html');

INSERT INTO docs.document_parse
  (code_cis, document_type, source_hash, parser_version, section_count, statut, manquantes, source)
VALUES
  ('61111111', 'rcp', 'fixture', 1, 7, 'ok', '{}', 'bdpm_html'),
  ('61111114', 'rcp', 'fixture', 1, 1, 'partiel', '{4.2}', 'bdpm_html'),
  ('61111115', 'rcp', 'fixture', 1, 2, 'partiel', '{4.2}', 'bdpm_html'),
  ('61111117', 'rcp', 'fixture', 1, 1, 'partiel', '{4.2}', 'bdpm_html'),
  ('61111120', 'rcp', 'fixture', 1, 1, 'partiel', '{4.2}', 'bdpm_html');
