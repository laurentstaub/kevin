/**
 * Calcul d'une fiche : pour chaque substance, une spécialité représentative et
 * les phrases de son RCP. Sans base, pour être testable.
 */

import { deaccent } from './text.js';
import { motifs, phrasesPertinentes, PHRASES_MAX } from './citations.js';

const echapperRegex = (texte) => texte.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Motif Postgres d'une substance dans `denomination_substance`, sel compris,
 * borné aux limites de mot (\m \M).
 */
export const motifSubstance = (nom) => `\\m${echapperRegex(deaccent(String(nom)).toLowerCase())}\\M`;

/**
 * Spécialités commercialisées contenant la substance, avec les rubriques
 * demandées. Ordre de représentativité : monosubstance, princeps, nom court.
 */
export const REQUETE_SUBSTANCE = `
  WITH cis AS (
    SELECT DISTINCT c.code_cis
    FROM dbpm.cis_compo_bdpm c
    WHERE public.f_unaccent(lower(c.denomination_substance)) ~ $1
  )
  SELECT m.code_cis, m.denomination_medicament,
         (SELECT count(DISTINCT x.code_substance) FROM dbpm.cis_compo_bdpm x
          WHERE x.code_cis = m.code_cis AND x.nature_composant = 'SA') AS nb_substances,
         EXISTS (SELECT 1 FROM dbpm.cis_gener_bdpm g
                 WHERE g.code_cis = m.code_cis AND g.type_generique = '0') AS princeps,
         s.document_type, s.position, s.numero, s.libelle, s.texte
  FROM cis
  JOIN dbpm.cis_bdpm m ON m.code_cis = cis.code_cis
  JOIN docs.rcp_sections s ON s.code_cis = m.code_cis
   AND s.document_type = 'rcp' AND s.numero = ANY($2::text[])
  WHERE m.etat_commercialisation = 'Commercialisée'
  ORDER BY nb_substances, princeps DESC, length(m.denomination_medicament),
           m.code_cis, array_position($2::text[], s.numero), s.position`;

/**
 * Première spécialité dont le RCP cite l'un des termes, avec ses phrases.
 * Sinon, la première trouvée avec `manque: true`, pour que la relecture le voie.
 */
export function choisirCitations(lignes, termes, max = PHRASES_MAX) {
  if (!lignes.length) return { specialite: null, citations: [], manque: true };
  const regexes = motifs(termes);

  const parCis = new Map();
  for (const ligne of lignes) {
    if (!parCis.has(ligne.code_cis)) parCis.set(ligne.code_cis, []);
    parCis.get(ligne.code_cis).push(ligne);
  }

  for (const [cis, sections] of parCis) {
    const citations = [];
    for (const section of sections) {
      for (const phrase of phrasesPertinentes(section.texte, regexes, max - citations.length)) {
        citations.push({
          numero: section.numero, libelle: section.libelle,
          ancre: `${section.document_type}-${section.position}`, phrase,
        });
      }
      if (citations.length >= max) break;
    }
    if (citations.length) {
      return {
        specialite: { cis, denomination: sections[0].denomination_medicament },
        citations,
        manque: false,
      };
    }
  }

  const [premier] = lignes;
  return {
    specialite: { cis: premier.code_cis, denomination: premier.denomination_medicament },
    citations: [],
    manque: true,
  };
}
