import { importSql } from './groupes.js';
import { nomsBiosimilaires } from './biosimilaires.js';

/**
 * Classification ATC (schéma `ref`), dérivée des données CNAM : seules 63,5 %
 * des spécialités ont une classe, l'absence est normale. L'arbre a des trous
 * (parents manquants, libellés égaux au code) : ne pas supposer une chaîne complète.
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

  return rows.map((row, i) => ({
    code: row.atc_code,
    // Libellé absent : celui du parent plutôt que le code brut.
    label: utilisable(row) ? row.atc_label : (rows[i - 1]?.atc_label ?? row.atc_code),
    level: row.atc_level,
  }));
}

/**
 * Unité de compte des pages de classe : la spécialité (CIS) commercialisée.
 * Les retirées restent listées à la feuille mais ne comptent pas.
 */
const SPECIALITES = `count(DISTINCT m.code_cis) FILTER (WHERE m.etat_commercialisation = 'Commercialisée')`;

/**
 * En-tête de fiche : niveaux 1-2 (ce que fait le médicament) et code de la
 * feuille. Les niveaux 3-4 sont de la taxonomie chimique, le 5 répète la DCI ;
 * la chaîne complète reste dans le fil d'Ariane de la page de classe.
 *
 * @returns {{ contexte: object[], feuille: object }|null}
 */
export function resumerClasse(chaine) {
  if (!Array.isArray(chaine) || chaine.length === 0) return null;

  const feuille = chaine.at(-1);
  const contexte = chaine.filter((niveau) => niveau.level <= 2 && niveau.code !== feuille.code);

  // Chaîne trop courte : la feuille sert de contexte.
  return { contexte: contexte.length > 0 ? contexte : [feuille], feuille };
}

let cacheClasses = null;
const DUREE_CACHE_MS = 60 * 60 * 1000;

export async function getClassesPrincipales(pool) {
  // Cache : 56 ms de décompte pour des données mensuelles, sur la page la plus
  // demandée. L'expiration évite un redémarrage après rechargement.
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

let cacheMolecules = null;

/**
 * Molécules (niveau 5) les plus fournies en spécialités commercialisées, toutes
 * classes confondues : entrée de l'accueil. Même cache que les classes.
 */
export async function getMoleculesPrincipales(pool, limite = 20) {
  if (cacheMolecules && cacheMolecules.limite === limite
      && Date.now() - cacheMolecules.a < DUREE_CACHE_MS) {
    return cacheMolecules.valeur;
  }

  const { rows } = await pool.query(
    `SELECT c.atc_code AS code, c.atc_label AS label,
            ${SPECIALITES}::int AS specialites
     FROM ref.atc_classification c
     JOIN ref.cis_atc_mapping a ON a.atc_code = c.atc_code
     JOIN dbpm.cis_bdpm m ON m.code_cis = a.code_cis
     WHERE c.atc_level = $1
     GROUP BY 1, 2
     ORDER BY 3 DESC, c.atc_label, c.atc_code
     LIMIT $2`,
    [FEUILLE, limite],
  );

  cacheMolecules = { a: Date.now(), limite, valeur: rows };
  return rows;
}

/** Vide le cache — les tests changent de jeu de données sous le même processus. */
export function oublierClasses() {
  cacheClasses = null;
  cacheMolecules = null;
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

  const classe = chaine.find((niveau) => niveau.code === code);
  if (!classe) return null;

  // Enfants déduits du code (préfixe strict), au premier niveau existant et non
  // à `level + 1` : l'arbre a des étages manquants.
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
 * Spécialités d'une molécule, une ligne par CIS, dans l'ordre du comptoir :
 * princeps (type 0 du Répertoire), puis noms de fantaisie (ne commençant pas
 * par la DCI, ce qui rattrape les marques hors Répertoire), puis les autres.
 *
 * @param {string} dci - le libellé de la feuille ATC, « OXOMEMAZINE »
 */
export async function getSpecialitesDeClasse(pool, code, dci = '') {
  const { rows } = await pool.query(
    `SELECT m.code_cis AS id, m.denomination_medicament AS denomination,
            m.titulaires, m.forme_pharmaceutique,
            (m.etat_commercialisation = 'Commercialisée') AS commercialise,
            ${importSql('m')} AS importation,
            EXISTS (SELECT 1 FROM dbpm.cis_gener_bdpm g
                    WHERE g.code_cis = m.code_cis AND g.type_generique = '0') AS princeps,
            -- Nommée par sa DCI : « OXOMEMAZINE ARROW », et non « TOPLEXIL ».
            ($2 <> '' AND public.f_unaccent(upper(m.denomination_medicament))
                          LIKE public.f_unaccent(upper($2)) || '%') AS nom_dci
     FROM dbpm.cis_bdpm m
     WHERE m.code_cis IN (SELECT code_cis FROM ref.cis_atc_mapping WHERE atc_code LIKE $1 || '%')
     ORDER BY commercialise DESC, princeps DESC, nom_dci, denomination, id`,
    [code, String(dci ?? '')],
  );
  return rows;
}


/**
 * Molécules d'une classe (toutes ses feuilles), la plus répandue d'abord.
 * Indice : nombre de spécialités commercialisées, qui sous-classe les molécules
 * récentes sous brevet ; à remplacer par les volumes de vente.
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
 * Portrait chiffré d'une classe : génériques, remboursables, régime de
 * délivrance, rapportés aux spécialités commercialisées. Motifs de délivrance
 * alignés sur `delivrance.js`.
 *
 * @returns {Promise<null|{ specialites: number, generiques: number,
 *   remboursables: number, liste1: number, liste2: number,
 *   stupefiants: number, assimiles: number, hopital: number }>}
 */
export async function getPortraitClasse(pool, code, biosimilaires = nomsBiosimilaires()) {
  const { rows } = await pool.query(
    `WITH cis AS (
       SELECT DISTINCT m.code_cis, upper(public.f_unaccent(m.denomination_medicament)) AS nom
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
            -- Les biosimilaires ne sont pas au Répertoire : on les reconnaît
            -- à leur nom, sur la liste de référence de l'ANSM (biosimilaires.js).
            count(*) FILTER (WHERE EXISTS (
              SELECT 1 FROM unnest($2::text[]) b(n)
              WHERE c.nom = b.n OR c.nom LIKE b.n || ' %' OR c.nom LIKE b.n || ',%'))::int AS biosimilaires,
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
    [code, biosimilaires],
  );
  const portrait = rows[0];
  return portrait && portrait.specialites > 0 ? portrait : null;
}

/**
 * Lignes affichées du portrait. Un régime de délivrance nul est omis ; les
 * régimes rares se comptent en unités (« 0 % » arrondi cacherait trois
 * stupéfiants sur six cents). Pure, testable sans base.
 *
 * @returns {{ valeur: string, libelle: string }[]}
 */
export function lirePortrait(portrait) {
  if (!portrait?.specialites) return [];
  const part = (nombre) => `${Math.round((100 * nombre) / portrait.specialites)}\u00A0%`;
  const compte = (nombre) => nombre.toLocaleString('fr-FR');
  const pluriel = (nombre, un, plusieurs) => (nombre > 1 ? plusieurs : un);

  return [
    // Classe de biologiques : « 0 % génériques » serait trompeur, les biosimilaires le remplacent.
    (portrait.generiques || !portrait.biosimilaires) && { valeur: part(portrait.generiques), libelle: 'génériques' },
    portrait.biosimilaires && { valeur: part(portrait.biosimilaires), libelle: 'biosimilaires' },
    { valeur: part(portrait.remboursables), libelle: 'remboursables' },
    portrait.liste1 && { valeur: part(portrait.liste1), libelle: 'liste I' },
    portrait.liste2 && { valeur: part(portrait.liste2), libelle: 'liste II' },
    portrait.stupefiants && { valeur: compte(portrait.stupefiants), libelle: pluriel(portrait.stupefiants, 'stupéfiant', 'stupéfiants') },
    portrait.assimiles && { valeur: compte(portrait.assimiles), libelle: pluriel(portrait.assimiles, 'assimilé stupéfiant', 'assimilés stupéfiants') },
    portrait.hopital && { valeur: compte(portrait.hopital), libelle: 'usage hospitalier' },
  ].filter(Boolean);
}
