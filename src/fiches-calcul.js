/**
 * Le calcul d'une fiche : pour chaque substance de la liste, une spécialité
 * représentative et les phrases de son RCP.
 *
 * Séparé du script de construction pour être testé sans base : la requête
 * rend des lignes, ce module décide.
 */

import { deaccent } from './text.js';
import { motifs, phrasesPertinentes, PHRASES_MAX } from './citations.js';

const echapperRegex = (texte) => texte.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Le motif Postgres qui retrouve une substance dans `denomination_substance`,
 * sel compris : « amiodarone » trouve « CHLORHYDRATE D'AMIODARONE ». Borné aux
 * limites de mot (\m \M), sans quoi « sotalol » trouverait un nom plus long.
 */
export const motifSubstance = (nom) => `\\m${echapperRegex(deaccent(String(nom)).toLowerCase())}\\M`;

/**
 * La requête : les spécialités commercialisées qui contiennent la substance,
 * avec leurs rubriques demandées. Ordonnées pour que la première qui cite
 * soit la plus représentative — monosubstance d'abord (une association parle
 * de l'autre substance autant que de celle-ci), princeps ensuite, nom le plus
 * court enfin.
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
 * Choisit, dans les lignes rendues par REQUETE_SUBSTANCE, la première
 * spécialité dont le RCP cite l'un des termes, et en garde les phrases.
 *
 * Quand aucune n'en parle, on le dit au lieu de se taire : la ligne porte
 * la première spécialité trouvée et `manque: true`. C'est une information de
 * relecture — le RCP n'est peut-être pas découpé, ou la substance n'est
 * torsadogène qu'en association — et elle doit se voir dans le diff.
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

/**
 * Une molécule trouvée par la recherche est-elle déjà dans la liste ? On
 * compare des mots, pas des chaînes : « AMIODARONE » est dans la liste si
 * « amiodarone » y est, quel que soit le sel ou l'association.
 */
export function dejaInscrite(molecule, inscriptions) {
  const mots = new Set(deaccent(String(molecule)).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  return inscriptions.some((i) => deaccent(String(i.substance)).toLowerCase()
    .split(/[^a-z0-9]+/).filter(Boolean).every((mot) => mots.has(mot)));
}
