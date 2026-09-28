import { deaccent } from './text.js';

/**
 * Importations parallèles : chacune a son propre code CIS, même dénomination
 * que le produit français, et aucun RCP ni notice. Elles sont regroupées dans
 * la recherche et renvoient au texte du produit français.
 */

/** La BDPM écrit « Autorisation d'importation parallèle ». */
export const estImportation = (procedure) => /importation\s+parall/i.test(procedure ?? '');

const cle = (denomination) => deaccent(String(denomination ?? '')).toLowerCase().trim();

/**
 * Une ligne par dénomination, le produit d'origine en tête, avec le nombre
 * d'importations regroupées.
 */
export function regrouperVariantes(resultats) {
  const parNom = new Map();

  for (const resultat of resultats) {
    const cleProduit = cle(resultat.denomination_medicament);
    const importation = estImportation(resultat.type_procedure_amm);

    if (!parNom.has(cleProduit)) {
      parNom.set(cleProduit, { ...resultat, importation, importations: importation ? 1 : 0 });
      continue;
    }

    const groupe = parNom.get(cleProduit);
    if (importation) {
      groupe.importations += 1;
      // Le produit d'origine représente le groupe, quel que soit l'ordre.
    } else if (groupe.importation) {
      parNom.set(cleProduit, { ...resultat, importation: false, importations: groupe.importations });
    }
  }

  return [...parNom.values()];
}

/**
 * Spécialité française dont l'importation est la copie, appariée sur la
 * dénomination (un importateur ne peut pas renommer). Préfère une référence
 * dont le RCP est découpé. Échoue sur les coquilles BDPM et références radiées.
 */
export async function referenceNationale(pool, cis, denomination) {
  if (!denomination) return null;

  const { rows } = await pool.query(
    `SELECT m.code_cis AS id, m.denomination_medicament, m.titulaires
     FROM dbpm.cis_bdpm m
     WHERE m.code_cis <> $1
       AND coalesce(m.type_procedure_amm, '') !~* 'importation\\s+parall'
       AND f_unaccent(lower(m.denomination_medicament)) = f_unaccent(lower($2))
     ORDER BY
       EXISTS (
         SELECT 1 FROM docs.rcp_sections r
         WHERE r.code_cis = m.code_cis AND r.document_type IN ('rcp', 'rcp_notice')
       ) DESC,
       (m.statut_administratif_amm = 'Autorisation active') DESC,
       m.code_cis
     LIMIT 1`,
    [cis, denomination],
  );

  return rows[0] ?? null;
}
