import { importSql } from './groupes.js';

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
 * L'unité de compte des pages de classe : la spécialité commercialisée.
 *
 * Trois niveaux, et trois seulement, parce que ce sont ceux du métier et de la
 * réglementation : la molécule (la DCI), la spécialité (un dosage et une
 * forme — un code CIS), la présentation (une boîte — un code CIP). Les pages
 * comptaient d'abord des « produits » — un nom commercial, tous dosages
 * confondus — unité maison que rien ne définissait, et qui côtoyait sous le
 * même titre des pourcentages calculés sur les spécialités.
 *
 * Commercialisées seulement : une classe se lit pour ce qu'on peut délivrer.
 * Les spécialités retirées restent listées à la feuille, marquées comme
 * telles, mais ne gonflent pas les décomptes.
 */
const SPECIALITES = `count(DISTINCT m.code_cis) FILTER (WHERE m.etat_commercialisation = 'Commercialisée')`;

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
            ${SPECIALITES}::int AS specialites
     FROM ref.atc_classification c
     JOIN ref.cis_atc_mapping a ON a.atc_code LIKE c.atc_code || '%'
     JOIN dbpm.cis_bdpm m ON m.code_cis = a.code_cis
     WHERE c.atc_level = 1
     GROUP BY 1, 2
     ORDER BY 3 DESC`,
  );

  const valeur = rows;
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
    `SELECT c.atc_code AS code, c.atc_label AS label, c.atc_level AS level,
            ${SPECIALITES}::int AS specialites
     FROM ref.atc_classification c
     JOIN ref.cis_atc_mapping a ON a.atc_code LIKE c.atc_code || '%'
     JOIN dbpm.cis_bdpm m ON m.code_cis = a.code_cis
     WHERE c.atc_code LIKE $1 || '%'
       AND c.atc_code <> $1
       AND c.atc_level = (SELECT min(atc_level) FROM ref.atc_classification
                          WHERE atc_code LIKE $1 || '%' AND atc_code <> $1)
     GROUP BY 1, 2, 3
     ORDER BY c.atc_code`,
    [code],
  );

  // Le total de la classe est compté ici, et non additionné depuis les enfants :
  // une association classée sous deux codes serait comptée deux fois.
  const { rows: compte } = await pool.query(
    `SELECT ${SPECIALITES}::int AS specialites
     FROM ref.cis_atc_mapping a
     JOIN dbpm.cis_bdpm m ON m.code_cis = a.code_cis
     WHERE a.atc_code LIKE $1 || '%'`,
    [code],
  );

  return {
    ...classe,
    chaine,
    specialites: compte[0]?.specialites ?? 0,
    enfants,
  };
}

/**
 * Les spécialités d'une molécule — une ligne par code CIS.
 *
 * Elles étaient regroupées par nom commercial, comme dans la recherche : douze
 * lignes pour douze laboratoires, chacune annonçant « 3 dosages et formes ».
 * Mais à la feuille, c'est la spécialité qu'on cherche — le 5 mg ou le 10 mg,
 * la gélule ou le comprimé — et le regroupement la cachait derrière un clic.
 *
 * Commercialisées d'abord, puis par dénomination : l'ordre alphabétique met
 * côte à côte les dosages d'un même nom.
 */
export async function getSpecialitesDeClasse(pool, code) {
  const { rows } = await pool.query(
    `SELECT DISTINCT m.code_cis AS id, m.denomination_medicament AS denomination,
            m.titulaires,
            (m.etat_commercialisation = 'Commercialisée') AS commercialise,
            ${importSql('m')} AS importation
     FROM ref.cis_atc_mapping a
     JOIN dbpm.cis_bdpm m ON m.code_cis = a.code_cis
     WHERE a.atc_code LIKE $1 || '%'
     ORDER BY commercialise DESC, denomination, id`,
    [code],
  );
  return rows;
}


/**
 * Molécules d'une classe, la plus répandue d'abord.
 *
 * Les sous-classes disent comment la classe est découpée ; elles ne disent pas
 * ce qu'elle contient. « Antiviraux à action directe » n'apprend rien à qui
 * cherche à savoir quels antiviraux existent — et redescendre quatre étages
 * pour l'apprendre est un parcours, pas une réponse. Cette liste aplatit
 * l'arbre : toutes les feuilles de la classe, d'un coup.
 *
 * L'ordre est le nombre de spécialités commercialisées, faute de mieux. Ce n'est pas l'usage
 * réel — pour cela il faudrait les volumes de l'Assurance Maladie, qui ne sont
 * pas dans cette base — mais c'en est un indice honnête : une molécule qui
 * porte quinze génériques est ancienne et répandue. Le défaut connu de ce
 * classement est le produit récent sous brevet, une seule marque et gros
 * volume, qui se retrouve plus bas qu'il ne le mérite. Le jour où les ventes
 * seront joignables, seul l'ORDER BY change.
 */
export async function getMoleculesDeClasse(pool, code) {
  const { rows } = await pool.query(
    `SELECT c.atc_code AS code, c.atc_label AS label,
            ${SPECIALITES}::int AS specialites
     FROM ref.atc_classification c
     JOIN ref.cis_atc_mapping a ON a.atc_code = c.atc_code
     JOIN dbpm.cis_bdpm m ON m.code_cis = a.code_cis
     WHERE c.atc_level = $1 AND c.atc_code LIKE $2 || '%' AND c.atc_code <> $2
     GROUP BY 1, 2
     ORDER BY 3 DESC, c.atc_label, c.atc_code`,
    [FEUILLE, code],
  );

  return rows;
}

/**
 * Le portrait chiffré d'une classe.
 *
 * Une page de classe listait des codes et des libellés : juste, mais sec. Ce
 * qu'un pharmacien veut savoir d'une classe tient pourtant en quelques
 * chiffres que la base connaît déjà — la part de génériques, la part
 * remboursable, le régime de délivrance. Pas une définition : une physionomie.
 *
 * Le dénominateur est la **spécialité commercialisée**, celle de l'en-tête :
 * le statut générique, le remboursement et la liste se portent spécialité par
 * spécialité. Les spécialités retirées ne comptent pas — une classe dont on
 * a cessé de commercialiser les princeps paraîtrait moins générique qu'elle
 * ne l'est au comptoir.
 *
 * Les motifs de délivrance reprennent ceux de `delivrance.js`, qui classe ces
 * mêmes libellés sur la fiche produit : une spécialité comptée « liste I » ici
 * s'affiche « Liste I » là-bas.
 *
 * @returns {Promise<null|{ specialites: number, generiques: number,
 *   remboursables: number, liste1: number, liste2: number,
 *   stupefiants: number, assimiles: number, hopital: number }>}
 */
export async function getPortraitClasse(pool, code) {
  const { rows } = await pool.query(
    `WITH cis AS (
       SELECT DISTINCT m.code_cis
       FROM ref.cis_atc_mapping a
       JOIN dbpm.cis_bdpm m ON m.code_cis = a.code_cis
       WHERE a.atc_code LIKE $1 || '%'
         AND m.etat_commercialisation = 'Commercialisée'
     ),
     cpd AS (
       SELECT p.code_cis,
              bool_or(p.condition_prescription_delivrance ~* '^\\s*liste I\\s*$') AS liste1,
              bool_or(p.condition_prescription_delivrance ~* '^\\s*liste II\\s*$') AS liste2,
              bool_or(p.condition_prescription_delivrance ~* '^\\s*stup[ée]fiants?\\s*$') AS stupefiant,
              bool_or(p.condition_prescription_delivrance
                      ~* 'assimil[ée].*stup[ée]fiant|stup[ée]fiant.*assimil') AS assimile,
              bool_or(p.condition_prescription_delivrance ~* 'usage hospitalier') AS hopital
       FROM dbpm.cis_cpd_bdpm p
       WHERE p.code_cis IN (SELECT code_cis FROM cis)
       GROUP BY p.code_cis
     )
     SELECT count(*)::int AS specialites,
            -- 1 générique, 2 complémentarité posologique, 4 substituable :
            -- tout ce qui n'est pas le princeps (0) d'un groupe.
            count(*) FILTER (WHERE EXISTS (
              SELECT 1 FROM dbpm.cis_gener_bdpm g
              WHERE g.code_cis = c.code_cis AND g.type_generique IN ('1', '2', '4')))::int AS generiques,
            count(*) FILTER (WHERE EXISTS (
              SELECT 1 FROM dbpm.cis_cip_bdpm p
              WHERE p.code_cis = c.code_cis
                AND nullif(btrim(p.taux_remboursement::text), '') IS NOT NULL))::int AS remboursables,
            count(*) FILTER (WHERE d.liste1)::int AS liste1,
            count(*) FILTER (WHERE d.liste2)::int AS liste2,
            count(*) FILTER (WHERE d.stupefiant)::int AS stupefiants,
            count(*) FILTER (WHERE d.assimile)::int AS assimiles,
            count(*) FILTER (WHERE d.hopital)::int AS hopital
     FROM cis c
     LEFT JOIN cpd d USING (code_cis)`,
    [code],
  );
  const p = rows[0];
  return p && p.specialites > 0 ? p : null;
}

/**
 * Ce que le portrait affiche, et dans quel ordre.
 *
 * Deux proportions toujours — elles décrivent toute classe — puis le régime
 * de délivrance, qui ne se dit que s'il concerne quelqu'un : « 0 stupéfiant »
 * sur la page des antigoutteux est une ligne pour ne rien apprendre. Les
 * régimes rares se comptent en spécialités plutôt qu'en pourcentage :
 * « 0 % » arrondi cacherait les trois stupéfiants d'une classe de six cents.
 *
 * Pure, pour être testée sans base.
 *
 * @returns {{ valeur: string, libelle: string }[]}
 */
export function lirePortrait(p) {
  if (!p?.specialites) return [];
  const part = (n) => `${Math.round((100 * n) / p.specialites)} %`;
  const compte = (n) => n.toLocaleString('fr-FR');
  const pluriel = (n, un, plusieurs) => (n > 1 ? plusieurs : un);

  return [
    { valeur: part(p.generiques), libelle: 'génériques' },
    { valeur: part(p.remboursables), libelle: 'remboursables' },
    p.liste1 && { valeur: part(p.liste1), libelle: 'liste I' },
    p.liste2 && { valeur: part(p.liste2), libelle: 'liste II' },
    p.stupefiants && { valeur: compte(p.stupefiants), libelle: pluriel(p.stupefiants, 'stupéfiant', 'stupéfiants') },
    p.assimiles && { valeur: compte(p.assimiles), libelle: pluriel(p.assimiles, 'assimilé stupéfiant', 'assimilés stupéfiants') },
    p.hopital && { valeur: compte(p.hopital), libelle: 'usage hospitalier' },
  ].filter(Boolean);
}
