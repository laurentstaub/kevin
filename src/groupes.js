/**
 * Regroupement des spécialités en produits.
 *
 * Le code CIS est un triplet (marque × dosage × forme) : DOLIPRANE en compte
 * dix-sept. Rendre des CIS, c'est donc rendre dix-sept fois le même produit et
 * noyer tout le reste — aucun classement n'y remédie, puisque les dix-sept
 * lignes sont réellement aussi pertinentes les unes que les autres. C'est
 * l'unité de résultat qu'il faut changer, pas l'ordre.
 *
 * Ces fragments SQL sont la définition unique du regroupement. Ils sont
 * assemblés dans la requête de recherche plutôt qu'appliqués après coup :
 * regrouper après le LIMIT rendrait un nombre de produits imprévisible.
 */

/**
 * Racine de marque : ce qui reste de la dénomination une fois le dosage et la
 * forme retirés. « DOLIPRANE 1000 mg, comprimé » → « DOLIPRANE ».
 *
 * 99,3 % des dénominations de la BDPM suivent « NOM dosage, forme » : la
 * virgule isole la forme, et la coupe se fait ensuite au premier mot commençant
 * par un chiffre. Exiger que le chiffre **ouvre** le mot est ce qui préserve
 * « VITAMINE D3 » et « ACIDE ALENDRONIQUE/CHOLECALCIFEROL (VITAMINE D3) EG » :
 * une coupe au premier chiffre rencontré les amputerait. Et parce que la coupe
 * demande une espace devant, « 5-FLUOROURACILE ACCORD » garde son nom.
 *
 * La racine ne fusionne que ce qui porte le même nom : DOLIPRANECAPS et
 * DOLIPRANE restent deux produits, ce qu'ils sont.
 */
export const racineSql = (alias) =>
  `regexp_replace(split_part(${alias}.denomination_medicament, ',', 1), '\\s+[0-9].*$', '')`;

/** La BDPM écrit « Autorisation d'importation parallèle ». */
export const importSql = (alias) =>
  `coalesce(${alias}.type_procedure_amm, '') ~* 'importation\\s+parall'`;

/**
 * Le titulaire entre dans la clé de regroupement — sans lui, les neuf
 * « GLUCOSE 10 % <laboratoire> » se confondent en un seul produit, parce que
 * chez eux le laboratoire est écrit *après* le dosage et disparaît avec lui.
 * Il ne coûte que 2,6 % de groupes en plus sur l'ensemble de la base.
 *
 * Sauf pour les importations parallèles : la loi interdit à l'importateur de
 * renommer le produit, donc PERMIXON importé d'Italie porte le nom de PERMIXON
 * mais le titulaire de l'importateur. Les distinguer par titulaire rendrait
 * cinq lignes de PERMIXON — précisément le défaut qu'on corrige. Elles
 * empruntent donc le titulaire du produit d'origine présent dans la sélection.
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
 * Ordre de classement des produits, du plus probablement cherché au moins.
 *
 * Écrit en paliers explicites plutôt qu'en score pondéré : sur un outil
 * médical, on doit pouvoir répondre à « pourquoi cette ligne est-elle en
 * tête ». Chaque critère est grossier (un booléen, un petit entier), ce qui en
 * fait un tri par étages et non une cascade où le premier critère décide de
 * tout.
 *
 * 1. `rank`  — la correspondance lexicale : exact, puis préfixe, puis occurrence.
 * 2. commercialisé — 2 245 spécialités ne le sont pas ; on ne les cherche
 *    presque jamais, mais on les cherche parfois, d'où une rétrogradation et
 *    non un filtre.
 * 3. autorisation active — même raisonnement, 955 spécialités concernées.
 * 4. spécificité — le nombre de substances. Qui cherche « paracétamol » veut
 *    DOLIPRANE avant PARACETAMOL/CODEINE, et qui cherche « glucose » ne veut
 *    sûrement pas OLIMEL, une nutrition parentérale à vingt-sept composants.
 * 5. princeps — à spécificité égale, la marque de référence est celle par
 *    laquelle on nomme le produit.
 * 6. longueur, puis alphabétique, puis CIS — départage stable.
 *
 * La spécificité passe **avant** le princeps : l'inverse mettait en tête
 * DAFALGAN CODEINE plutôt que DAFALGAN sur une recherche « paracétamol ».
 *
 * `princeps` est ternaire et non booléen — vrai, faux, ou nul quand la
 * spécialité n'appartient à aucun groupe générique. Trier dessus directement
 * classait un générique (faux) devant un produit sans groupe (nul), ce qui n'a
 * pas de sens : ne pas avoir de générique n'est pas être un générique. Seul le
 * princeps est distingué, le reste est à égalité.
 *
 * Le jour où les journaux de clics existeront, ces paliers deviendront les
 * termes d'un score ajusté sur des données plutôt que sur une intuition.
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
 * Pourquoi trois critères là où le princeps devrait suffire.
 *
 * Sur « oxazépam », la BDPM sait répondre : SERESTA porte `type_generique = 0`,
 * les OXAZEPAM <labo> portent 1. Le princeps tranche, et c'est le bon critère.
 *
 * Mais il ne couvre que la moitié de la base, et il est muet précisément là où
 * la question se pose le plus : aucune des 149 spécialités de paracétamol
 * n'appartient à un groupe générique, parce qu'un groupe encode une
 * *substituabilité* — un princeps sous brevet et ses génériques — et que
 * DOLIPRANE, EFFERALGAN et DAFALGAN sont chacun leur propre référence.
 *
 * D'où les deux relais, dans cet ordre :
 *
 * - `marque_propre` — le produit a été trouvé par sa substance et non par son
 *   nom, donc il ne s'appelle pas comme la molécule. C'est ce qui distingue une
 *   marque (DOLIPRANE, SERESTA) d'un générique de commodité (PARACETAMOL EG,
 *   OXAZEPAM ARROW). Qui tape une molécule pense d'abord à la marque.
 * - `presentations` — l'étendue de la gamme. DOLIPRANE couvre dix-sept
 *   présentations contre cinq à PARACETAMOL EG : le leader porte la gamme la
 *   plus large. C'est un corrélat de la notoriété, pas la notoriété — il place
 *   DOLIPRANE en tête, mais il ferait aussi passer PARACETAMOL ARROW devant
 *   DAFALGAN. D'où sa place en dernier recours, après les critères sûrs.
 *
 * Seules des données de volume (Open Medic) sauraient réellement départager
 * DOLIPRANE de PARACETAMOL ARROW. Ces deux relais en tiennent lieu.
 */

/**
 * Départage les spécialités d'un même groupe pour en désigner une : celle vers
 * laquelle pointe le lien. On veut la plus représentative — commercialisée,
 * autorisée, d'origine plutôt qu'importée, au nom le plus court.
 */
export const ORDRE_REPRESENTANT = `
  commercialise DESC,
  actif DESC,
  import,
  length(denomination_medicament),
  code_cis`;

/**
 * Étiquette d'affichage d'un groupe.
 *
 * La racine suffit presque toujours — « DOLIPRANE ». Elle ne suffit pas quand
 * le laboratoire est écrit *après* le dosage : les neuf « GLUCOSE 10 %
 * <laboratoire> » ont tous « GLUCOSE » pour racine, et une liste de six lignes
 * identiques ne renseigne personne. Dans ce cas seulement, le titulaire est
 * accolé — c'est la seule chose qui les distingue.
 *
 * Le calcul se fait sur le lot rendu, pas produit par produit : c'est la
 * présence d'un homonyme *dans la même liste* qui rend la précision utile.
 *
 * @param {object[]} groupes - lignes d'une même famille de résultats
 * @returns {object[]} les mêmes, avec un champ `libelle`
 */
export function etiqueter(groupes) {
  const occurrences = new Map();
  for (const g of groupes) {
    const cle = g.racine ?? '';
    occurrences.set(cle, (occurrences.get(cle) ?? 0) + 1);
  }

  return groupes.map((g) => {
    const racine = g.racine ?? g.denomination_medicament ?? '';
    const homonyme = occurrences.get(g.racine ?? '') > 1;
    const titulaire = g.titulaires?.trim();
    return {
      ...g,
      libelle: homonyme && titulaire ? `${racine} — ${titulaire}` : racine,
    };
  });
}
