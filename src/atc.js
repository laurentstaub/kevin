import { config } from './config.js';
import { racineSql, importSql, ORDRE_REPRESENTANT } from './groupes.js';

/**
 * Classification ATC (schéma `ref`).
 *
 * `ref.cis_atc_mapping` donne un code par spécialité, `ref.atc_classification`
 * porte l'arbre sur cinq niveaux. Deux propriétés de cette source commandent
 * tout ce qui suit :
 *
 * - **Elle est dérivée des données CNAM, pas de la BDPM.** Un médicament jamais
 *   remboursé n'a donc pas de classe : 63,5 % des spécialités seulement en ont
 *   une. L'absence est un cas normal, pas une anomalie à signaler au lecteur.
 * - **L'arbre a quelques trous** — cinq codes de niveau 5 dont le parent de
 *   niveau 4 manque, vingt-quatre dont le libellé recopie le code. On remonte
 *   donc ce qui existe, sans supposer une chaîne complète.
 */

/** Le libellé vaut le code quand la source n'en fournit pas. */
const utilisable = (ligne) => ligne.atc_label && ligne.atc_label !== ligne.atc_code;

/**
 * Chaîne complète d'une spécialité, du groupe anatomique à la molécule.
 * « N · N02 · N02B · N02BE · N02BE01 » pour DOLIPRANE.
 *
 * @returns {{ code: string, label: string, level: number }[]} vide si sans classe
 */
export async function getClasseAtc(pool, cis) {
  const { rows } = await pool.query(
    `SELECT c.atc_code, c.atc_label, c.atc_level
     FROM ref.cis_atc_mapping a
     JOIN ref.atc_classification c ON a.atc_code LIKE c.atc_code || '%'
     WHERE a.code_cis = $1
     ORDER BY c.atc_level`,
    [cis],
  );

  return rows.map((r, i) => ({
    code: r.atc_code,
    // Vingt-quatre codes de niveau 5 n'ont pas de libellé. Afficher « B03AC01 »
    // à un pharmacien ne lui apprend rien : on reprend celui du parent.
    label: utilisable(r) ? r.atc_label : (rows[i - 1]?.atc_label ?? r.atc_code),
    level: r.atc_level,
  }));
}

/**
 * Les quatorze groupes anatomiques, avec le nombre de produits de chacun.
 *
 * Le décompte porte sur les produits — la racine de marque — et non sur les
 * codes CIS : annoncer « 2 327 » là où la classe mène à 960 produits ferait
 * attendre une liste quatre fois plus longue qu'elle ne l'est.
 */
/**
 * Ce qu'on garde de la chaîne pour l'en-tête d'une fiche.
 *
 * Les cinq niveaux affichés en entier font cent six signes en capitales, entre
 * la ligne d'identité et les dosages : le bandeau se rompt, et l'œil bute avant
 * d'atteindre le produit. Or tout n'y sert pas au comptoir.
 *
 * - Niveaux 1 et 2 — « Système nerveux », « Analgésiques » : ce que fait le
 *   médicament. C'est le renseignement utile, et il tient en deux mots.
 * - Niveaux 3 et 4 — « Autres analgésiques et antipyrétiques », « Anilides » :
 *   de la taxonomie chimique, verbeuse et sans usage devant un patient.
 * - Niveau 5 — « PARACETAMOL » : la DCI, déjà affichée deux lignes plus haut.
 *   La répéter n'ajoute rien.
 *
 * Reste le code lui-même, qui identifie la feuille sans l'écrire en toutes
 * lettres et mène à la classe complète. La chaîne entière n'est pas perdue :
 * elle est le fil d'Ariane de la page de classe.
 *
 * @returns {{ contexte: object[], feuille: object }|null}
 */
export function resumerClasse(chaine) {
  if (!Array.isArray(chaine) || chaine.length === 0) return null;

  const feuille = chaine.at(-1);
  const contexte = chaine.filter((n) => n.level <= 2 && n.code !== feuille.code);

  // Chaîne trop courte pour avoir un contexte distinct de la feuille : on
  // montre la feuille elle-même plutôt qu'une ligne vide.
  return { contexte: contexte.length > 0 ? contexte : [feuille], feuille };
}

let cacheClasses = null;
const DUREE_CACHE_MS = 60 * 60 * 1000;

export async function getClassesPrincipales(pool) {
  // Gardé en mémoire : 56 ms de décompte sur toute la base, pour un résultat
  // qui ne change qu'au rechargement mensuel de la BDPM — et sur la page la
  // plus demandée du site. L'expiration évite d'avoir à redémarrer après un
  // rechargement des données.
  if (cacheClasses && Date.now() - cacheClasses.a < DUREE_CACHE_MS) {
    return cacheClasses.valeur;
  }

  const { rows } = await pool.query(
    `SELECT c.atc_code AS code, c.atc_label AS label,
            count(DISTINCT ${racineSql('m')}) AS produits
     FROM ref.atc_classification c
     JOIN ref.cis_atc_mapping a ON a.atc_code LIKE c.atc_code || '%'
     JOIN dbpm.cis_bdpm m ON m.code_cis = a.code_cis
     WHERE c.atc_level = 1
     GROUP BY 1, 2
     ORDER BY count(DISTINCT ${racineSql('m')}) DESC`,
  );

  const valeur = rows.map((r) => ({ ...r, produits: Number(r.produits) }));
  cacheClasses = { a: Date.now(), valeur };
  return valeur;
}

/** Vide le cache — les tests changent de jeu de données sous le même processus. */
export function oublierClasses() {
  cacheClasses = null;
}

/** Le dernier niveau de l'arbre : une molécule, ou une association. */
export const FEUILLE = 5;

/** Une classe, son fil d'Ariane et ses sous-classes. */
export async function getClasse(pool, code) {
  const { rows: chaine } = await pool.query(
    `SELECT atc_code AS code, atc_label AS label, atc_level AS level
     FROM ref.atc_classification
     WHERE $1 LIKE atc_code || '%'
     ORDER BY atc_level`,
    [code],
  );

  const classe = chaine.find((c) => c.code === code);
  if (!classe) return null;

  // Les enfants se déduisent du code, pas de `parent_atc_code`. La hiérarchie
  // ATC est un préfixe strict — 1, 3, 4, 5 puis 7 signes — donc la filiation
  // est déjà écrite dans « J05AF06 » ; la colonne n'en est qu'un doublon.
  //
  // Et non pas « le niveau suivant » mais « le premier niveau qui existe » :
  // l'arbre a des étages manquants, des molécules dont le sous-groupe chimique
  // n'a jamais été inséré. Exiger `level + 1` les rendrait introuvables — elles
  // n'apparaîtraient dans aucune liste, alors que leur code dit exactement d'où
  // elles descendent. On saute donc l'étage absent au lieu de buter dessus.
  const { rows: enfants } = await pool.query(
    `SELECT c.atc_code AS code, c.atc_label AS label,
            count(DISTINCT ${racineSql('m')}) AS produits
     FROM ref.atc_classification c
     JOIN ref.cis_atc_mapping a ON a.atc_code LIKE c.atc_code || '%'
     JOIN dbpm.cis_bdpm m ON m.code_cis = a.code_cis
     WHERE c.atc_code LIKE $1 || '%'
       AND c.atc_code <> $1
       AND c.atc_level = (SELECT min(atc_level) FROM ref.atc_classification
                          WHERE atc_code LIKE $1 || '%' AND atc_code <> $1)
     GROUP BY 1, 2
     HAVING count(DISTINCT ${racineSql('m')}) > 0
     ORDER BY c.atc_code`,
    [code],
  );

  // Le total de la classe est compté ici, et non additionné depuis les enfants :
  // un produit dont les codes CIS se répartissent sur deux sous-classes serait
  // compté deux fois par la somme. Le décompte porte sur la racine de marque —
  // annoncer les CIS ferait attendre une liste quatre fois plus longue.
  const { rows: compte } = await pool.query(
    `SELECT count(DISTINCT ${racineSql('m')})::int AS produits
     FROM ref.cis_atc_mapping a
     JOIN dbpm.cis_bdpm m ON m.code_cis = a.code_cis
     WHERE a.atc_code LIKE $1 || '%'`,
    [code],
  );

  return {
    ...classe,
    chaine,
    produits: compte[0]?.produits ?? 0,
    enfants: enfants.map((e) => ({ ...e, produits: Number(e.produits) })),
  };
}

/**
 * Produits d'une classe, regroupés comme dans la recherche.
 *
 * Classés commercialisés d'abord, puis par ordre alphabétique : on parcourt une
 * classe pour voir ce qu'elle contient, et un ordre alphabétique se retrouve,
 * là où un classement par pertinence n'aurait ici rien à mesurer.
 */
export async function getProduitsDeClasse(pool, code, { limit = config.search.limit } = {}) {
  const { rows } = await pool.query(
    `
    WITH lignes AS (
      SELECT
        m.code_cis,
        m.denomination_medicament,
        m.forme_pharmaceutique,
        m.titulaires,
        ${racineSql('m')} AS racine,
        f_unaccent(lower(${racineSql('m')})) AS racine_cle,
        ${importSql('m')} AS import,
        (m.etat_commercialisation = 'Commercialisée') AS commercialise,
        (m.statut_administratif_amm = 'Autorisation active') AS actif,
        (SELECT string_agg(DISTINCT denomination_substance, ', '
                           ORDER BY denomination_substance)
         FROM dbpm.cis_compo_bdpm WHERE code_cis = m.code_cis) AS active_ingredients
      FROM ref.cis_atc_mapping a
      JOIN dbpm.cis_bdpm m ON m.code_cis = a.code_cis
      WHERE a.atc_code LIKE $1 || '%'
    ),
    representants AS (
      SELECT DISTINCT ON (racine_cle, coalesce(titulaires, ''))
        racine_cle, coalesce(titulaires, '') AS titulaire_cle,
        code_cis AS id, racine, denomination_medicament,
        forme_pharmaceutique, titulaires, active_ingredients
      FROM lignes
      ORDER BY racine_cle, coalesce(titulaires, ''), ${ORDRE_REPRESENTANT}
    ),
    agregats AS (
      SELECT racine_cle, coalesce(titulaires, '') AS titulaire_cle,
             bool_or(commercialise) AS commercialise,
             count(*)::int AS presentations,
             count(*) FILTER (WHERE import)::int AS importations,
             bool_and(import) AS importation
      FROM lignes
      GROUP BY racine_cle, coalesce(titulaires, '')
    )
    SELECT r.id, r.racine, r.denomination_medicament, r.forme_pharmaceutique,
           r.titulaires, r.active_ingredients,
           a.commercialise, a.presentations, a.importations, a.importation,
           count(*) OVER () AS total
    FROM agregats a
    JOIN representants r USING (racine_cle, titulaire_cle)
    ORDER BY a.commercialise DESC, r.racine, r.denomination_medicament
    LIMIT $2
    `,
    [code, limit],
  );

  return {
    produits: rows.map(({ total, ...r }) => r),
    total: rows.length > 0 ? Number(rows[0].total) : 0,
  };
}
