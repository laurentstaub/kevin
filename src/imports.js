import { deaccent } from './text.js';

/**
 * Importations parallèles.
 *
 * Un distributeur qui achète une spécialité dans un autre État membre pour la
 * revendre en France obtient son propre code CIS. La BDPM compte ainsi douze
 * « VENTOLINE 100 microgrammes/dose », dont onze sont le même produit importé
 * d'Espagne ou d'Italie. Deux conséquences pour une base de consultation :
 *
 * - la recherche rend douze lignes identiques, entre lesquelles rien ne permet
 *   de choisir : seul le titulaire les distingue ;
 * - ces spécialités n'ont **aucun** RCP ni notice — sur les 302 recensées, les
 *   302 n'ont qu'une fiche info. Le texte à lire est celui du produit français.
 */

/** La BDPM écrit « Autorisation d'importation parallèle ». */
export const estImportation = (procedure) => /importation\s+parall/i.test(procedure ?? '');

const cle = (denomination) => deaccent(String(denomination ?? '')).toLowerCase().trim();

/**
 * Une ligne par dénomination, le produit d'origine en tête.
 *
 * Sans ce regroupement, les huit suggestions d'un champ de recherche sont
 * mangées par un seul médicament. Le nombre d'importations est conservé : il
 * dit au lecteur pourquoi une seule ligne représente douze codes CIS.
 */
export function regrouperVariantes(resultats) {
  const parNom = new Map();

  for (const r of resultats) {
    const k = cle(r.denomination_medicament);
    const importation = estImportation(r.type_procedure_amm);

    if (!parNom.has(k)) {
      parNom.set(k, { ...r, importation, importations: importation ? 1 : 0 });
      continue;
    }

    const groupe = parNom.get(k);
    if (importation) {
      groupe.importations += 1;
      // Le produit d'origine représente le groupe, quel que soit l'ordre
      // dans lequel la recherche l'a rendu.
    } else if (groupe.importation) {
      parNom.set(k, { ...r, importation: false, importations: groupe.importations });
    }
  }

  return [...parNom.values()];
}

/**
 * Spécialité française dont l'importation parallèle est la copie.
 *
 * L'appariement se fait sur la dénomination, qui est identique par
 * construction : un importateur n'a pas le droit de renommer le produit. Sur
 * 302 importations, 294 trouvent ainsi leur référence ; les 8 restantes ont
 * une coquille dans la BDPM (« comprmé enrobé ») ou une référence radiée.
 *
 * Le classement privilégie une référence qui a réellement un RCP découpé —
 * pointer vers une fiche vide n'aiderait personne.
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
