/**
 * Regroupement des spécialités en produits : un CIS (marque × dosage × forme)
 * ferait rendre dix-sept fois DOLIPRANE. Fragments SQL assemblés dans la
 * requête de recherche : regrouper après le LIMIT rendrait un nombre de
 * produits imprévisible.
 */

/**
 * Racine de marque : « DOLIPRANE 1000 mg, comprimé » → « DOLIPRANE ».
 * Coupe à la virgule, puis au premier mot qui commence par un chiffre après une
 * espace, pour préserver « VITAMINE D3 » et « 5-FLUOROURACILE ».
 */
export const racineSql = (alias) =>
  `regexp_replace(split_part(${alias}.denomination_medicament, ',', 1), '\\s+[0-9].*$', '')`;

/** La BDPM écrit « Autorisation d'importation parallèle ». */
export const importSql = (alias) =>
  `coalesce(${alias}.type_procedure_amm, '') ~* 'importation\\s+parall'`;

/**
 * Le titulaire distingue les « GLUCOSE 10 % <laboratoire> », dont le labo est
 * écrit après le dosage. Une importation parallèle emprunte celui du produit
 * d'origine : l'importateur n'a pas le droit de renommer le produit.
 */
export const titulaireCleSql = (alias) => `
  CASE WHEN ${alias}.import
    THEN coalesce(
      min(${alias}.titulaires) FILTER (WHERE NOT ${alias}.import)
        OVER (PARTITION BY ${alias}.match_type, ${alias}.racine_cle),
      '')
    ELSE coalesce(${alias}.titulaires, '')
  END`;

/**
 * Classement des produits, en paliers explicites plutôt qu'en score pondéré
 * pour rester explicable. Non commercialisé ou inactif : rétrogradé, pas filtré.
 * Spécificité avant princeps, sinon DAFALGAN CODEINE devance DAFALGAN.
 * `princeps` est nul hors groupe générique : seul `true` est distingué.
 */
export const ORDRE_PERTINENCE = `
  rank,
  commercialise DESC,
  actif DESC,
  nb_substances,
  (CASE WHEN princeps THEN 0 ELSE 1 END),
  (CASE WHEN marque_propre THEN 0 ELSE 1 END),
  presentations DESC,
  length(denomination_medicament),
  denomination_medicament,
  id`;

/**
 * Relais du princeps, absent de la moitié de la base (aucun paracétamol n'est
 * dans un groupe générique) :
 * - `marque_propre` : trouvé par sa substance, donc nommé autrement que la molécule ;
 * - `presentations` : étendue de la gamme, corrélat imparfait de la notoriété,
 *   d'où son rang en dernier. Seul Open Medic départagerait vraiment.
 */

/** Choix du représentant d'un groupe, cible du lien. */
export const ORDRE_REPRESENTANT = `
  commercialise DESC,
  actif DESC,
  import,
  length(denomination_medicament),
  code_cis`;

/**
 * Étiquette d'affichage : la racine, plus le titulaire seulement si une autre
 * ligne du lot a la même racine (les « GLUCOSE 10 % <laboratoire> »).
 *
 * @param {object[]} groupes - lignes d'une même famille de résultats
 * @returns {object[]} les mêmes, avec un champ `libelle`
 */
export function etiqueter(groupes) {
  const occurrences = new Map();
  for (const groupe of groupes) {
    const cle = groupe.racine ?? '';
    occurrences.set(cle, (occurrences.get(cle) ?? 0) + 1);
  }

  return groupes.map((groupe) => {
    const racine = groupe.racine ?? groupe.denomination_medicament ?? '';
    const homonyme = occurrences.get(groupe.racine ?? '') > 1;
    const titulaire = groupe.titulaires?.trim();
    return {
      ...groupe,
      libelle: homonyme && titulaire ? `${racine} — ${titulaire}` : racine,
    };
  });
}
