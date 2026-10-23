/**
 * Recherche plein texte dans les rubriques des documents (RCP, notices).
 * Unité de résultat : la rubrique, chaque numéro ancré sur sa meilleure
 * occurrence. Regroupement par molécule : ensemble trié des noms résolus des
 * substances actives (une fraction ne remplace le sel que si tous ses mots en
 * font partie). Toutes les rubriques sont classées ; seules les MOLECULES_MAX
 * premières molécules sont détaillées, et le total le dit.
 */

import { importSql } from './groupes.js';
import { formesDuProduit } from './specialites.js';
import { elargir } from './thesaurus.js';
import { echapperLike } from './text.js';
import { isValidCis } from './validate.js';

/** La configuration de recherche est posée par sql/recherche.sql. */
const LANGUE = 'french_nu';

/**
 * Molécules détaillées au plus, après classement de toutes les rubriques
 * trouvées (quatre pages) : au-delà, la liste n'aide plus, on affine. Couper
 * avant de classer — 3 000 rubriques prises sans ordre — rendait une première
 * page en partie arbitraire (« QT » : 32 des 50 vraies premières molécules).
 */
export const MOLECULES_MAX = 200;

/** Trouvailles par page (une ligne d'écran chacune) ; le reste s'obtient en affinant. */
export const PAR_PAGE = 50;

/** Lignes en aperçu sur la page de recherche par nom. */
export const APERCU = 12;

/**
 * Longueur minimale d'un terme cherché dans les documents d'un seul médicament :
 * « QT », « IV », « AVC » y sont précis, et la recherche ne lit que ses RCP.
 * Sur toute la base, le minimum reste celui de la configuration.
 */
export const MINIMUM_CIBLE = 2;

/**
 * Rubriques qui ont leur colonne et leur onglet. Liste fixe pour que les
 * colonnes ne bougent pas d'une requête à l'autre ; le reste va dans « Autres ».
 */
export const COLONNES = [
  ['4.1', 'Indications'],
  ['4.2', 'Posologie'],
  ['4.3', 'Contre-indications'],
  ['4.4', 'Mises en garde'],
  ['4.5', 'Interactions'],
  ['4.6', 'Grossesse'],
  ['4.8', 'Effets indésirables'],
  ['5.1', 'Pharmacodynamie'],
];

/**
 * Rang d'une rubrique pour la question du comptoir (peut-on délivrer, puis à
 * quelle dose), que `ts_rank_cd` ignore. Les notices passent après le RCP.
 */
export const PRIORITE = ['4.3', '4.2', '4.4', '4.5', '4.6', '4.8', '4.1', '5.1'];

const RANG = `coalesce(array_position(ARRAY[${PRIORITE.map((numero) => `'${numero}'`).join(', ')}]::text[], s.numero), ${PRIORITE.length})
  + CASE WHEN s.document_type = 'rcp' THEN 0 ELSE ${PRIORITE.length + 1} END`;

/**
 * Un mot cherché dans le titre de la rubrique la fait passer devant les
 * autres : « excipients » mène à 6.1 Liste des excipients plutôt qu'à la
 * rubrique 2, qui mentionne un excipient à effet notoire. Écart supérieur à
 * RANG entier : le RCP reste devant la notice, la priorité du comptoir départage.
 */
const TITRE = `CASE WHEN to_tsvector('${LANGUE}', coalesce(s.libelle, '')) @@ q.titre THEN -100 ELSE 0 END`;

/** Un concept au moins dans le titre (tous, ce serait rarement). */
export function composerTitre(concepts) {
  return concepts.length ? `(${concepts.join(' || ')})` : `websearch_to_tsquery('${LANGUE}', '')`;
}

/**
 * L'expression tapée, si elle a plusieurs mots : les rubriques qui la portent
 * dans l'ordre passent devant. Null pour un mot seul, une saisie entre
 * guillemets (déjà une locution) ou avec opérateur.
 *
 * @returns {string|null}
 */
export function expressionExacte(requete) {
  const saisie = String(requete ?? '').trim();
  if (!saisie || saisie.includes('"') || /(^|\s)-\S|\sor\s/i.test(saisie)) return null;
  return saisie.split(/[^\p{L}\p{N}]+/u).filter(Boolean).length >= 2 ? saisie : null;
}

/**
 * Coupe des phrases : point suivi d'une majuscule, ou puce (listes sans point
 * final). Même règle que `citations.js`.
 */
const COUPE = String.raw`(?<=[.!?])\s+(?=[A-ZÀ-ÖØ-Ý«(])|\s*[•▪]\s*`;
/**
 * Marqueurs neutres plutôt que <mark> : `texte` est du texte décodé (« ALAT <LSN »),
 * que ts_headline n'échappe pas. `marquer` échappe, puis pose les <mark>.
 */
const OUVRE = '\u27e6';
const FERME = '\u27e7';
const MARQUES = `StartSel=${OUVRE}, StopSel=${FERME}`;
const FENETRE = `MaxWords=44, MinWords=22, MaxFragments=1, ${MARQUES}`;
/**
 * Extrait de ts_headline → HTML sûr : tout est échappé, seuls les marqueurs
 * deviennent des <mark>.
 *
 * @returns {string|null}
 */
export function marquer(extrait) {
  if (extrait === null || extrait === undefined) return null;
  return String(extrait)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
    .replaceAll(OUVRE, '<mark>').replaceAll(FERME, '</mark>');
}

/** Au-delà, la « phrase » est une énumération mal ponctuée : on la fenêtre. */
const PHRASE_MAX = 600;

/**
 * Première phrase entière qui porte la requête (l'expression exacte de
 * préférence), termes marqués. La fenêtre de ts_headline, qui coupe les
 * phrases, ne sert qu'en repli, quand les mots sont dispersés.
 */
function phraseSql(texte, requete, exacte) {
  // Parenthèses : `@@` et `&&` ont la même priorité.
  const tq = `(${requete})`;
  return `coalesce((
    SELECT CASE WHEN length(ph.p) <= ${PHRASE_MAX}
             THEN ts_headline('${LANGUE}', ph.p, ${tq}, 'HighlightAll=true, ${MARQUES}')
             ELSE ts_headline('${LANGUE}', ph.p, ${tq}, '${FENETRE}') END
    FROM regexp_split_to_table(regexp_replace(${texte}, '\\s+', ' ', 'g'), '${COUPE}')
         WITH ORDINALITY AS ph(p, ord)
    WHERE to_tsvector('${LANGUE}', ph.p) @@ ${tq}
    ORDER BY (to_tsvector('${LANGUE}', ph.p) @@ phraseto_tsquery('${LANGUE}', ${exacte})) IS TRUE DESC,
             ph.ord
    LIMIT 1),
    ts_headline('${LANGUE}', ${texte}, ${tq}, '${FENETRE}'))`;
}

/**
 * Normalise le filtre de rubrique ; « 4 » inclut ses sous-rubriques. Vérifié
 * ici car la valeur vient de l'URL.
 *
 * @returns {string|null} le numéro, ou null si l'entrée n'en est pas un
 */
export function normaliserRubrique(valeur) {
  const brut = String(valeur ?? '').trim();
  return /^\d{1,2}(\.\d{1,2})?$/.test(brut) ? brut : null;
}

/**
 * Compose la tsquery : OU entre les alternatives d'un concept, ET entre les
 * concepts. Chaque atome passe par websearch_to_tsquery (jamais d'erreur, un
 * atome vide de sens devient une requête vide) ; les valeurs sont des paramètres.
 *
 * @param {string[][]} atomes - sortie de `elargir`
 * @param {number} depart - index du premier paramètre libre (1-based)
 * @returns {{ sql: string, params: string[] }}
 */
export function composerTsquery(atomes, depart) {
  const params = [];
  const groupes = atomes.map((alternatives) => {
    const morceaux = alternatives.map((alternative) => {
      params.push(alternative);
      return `websearch_to_tsquery('${LANGUE}', $${depart + params.length - 1})`;
    });
    return morceaux.length === 1 ? morceaux[0] : `(${morceaux.join(' || ')})`;
  });
  // Sans atome : requête vide plutôt qu'erreur de syntaxe SQL.
  const sql = groupes.length ? groupes.join(' && ') : `websearch_to_tsquery('${LANGUE}', '')`;
  return { sql, params, concepts: groupes };
}

/** Écart maximal, en mots, entre deux concepts voisins de la requête. */
export const PROXIMITE = 8;

/**
 * Proximité des concepts : chaque concept à moins de PROXIMITE mots du
 * suivant, dans un sens ou dans l'autre. Sans elle, « insuffisance hépatique
 * sévère » trouvait une rubrique où « sévère » qualifie l'apnée du sommeil et
 * « hépatique » les enzymes, trois paragraphes plus loin. Vérifiée sur les
 * positions du vecteur stocké : le filtre @@ de l'index reste en amont.
 *
 * @param {string[]} concepts - `concepts` de composerTsquery
 * @returns {string|null} une tsquery SQL, null pour un seul concept
 */
export function composerProximite(concepts, ecart = PROXIMITE) {
  if (concepts.length < 2) return null;
  const pres = (gauche, droite) => {
    const termes = [];
    for (let distance = 1; distance <= ecart; distance += 1) {
      termes.push(`tsquery_phrase(${gauche}, ${droite}, ${distance})`,
        `tsquery_phrase(${droite}, ${gauche}, ${distance})`);
    }
    return `(${termes.join(' || ')})`;
  };
  const paires = concepts.slice(1).map((concept, i) => pres(concepts[i], concept));
  return paires.join(' && ');
}

/** Colonne stockée plutôt qu'index d'expression : 21 ms au lieu de 407 ms. */
const VECTEUR = 's.vecteur';

/**
 * Vrai si `sql/recherche.sql` n'a pas été (entièrement) exécuté : il faut
 * alors lancer la migration, pas attendre la fin d'une panne passagère.
 */
export function rechercheAbsente(err) {
  // 42704 undefined_object (la configuration), 42883 undefined_function,
  // 42703 undefined_column (la colonne vecteur)
  return ['42704', '42883', '42703'].includes(err?.code)
    || /french_nu|websearch_to_tsquery|vecteur/i.test(err?.message ?? '');
}

/**
 * Extrait d'une rubrique, demandé au survol : ts_headline est coûteux
 * (250 extraits : 168 ms), inutile de le calculer pour chaque ligne.
 */
export async function extraitDeRubrique(pool, { cis, type, position, requete }) {
  // Bornée comme la saisie de la recherche : chaque mot devient un paramètre.
  const saisie = String(requete ?? '').trim().slice(0, 200);
  const rang = Math.trunc(Number(position));
  if (!saisie || !isValidCis(cis) || !Number.isFinite(rang)) return null;
  if (!['rcp', 'notice'].includes(String(type))) return null;

  // Même élargissement que la recherche, pour surligner aussi les synonymes.
  const tq = composerTsquery(elargir(saisie).atomes, 5);
  const { rows } = await pool.query(
    `SELECT s.numero, s.libelle, s.document_type AS type,
            m.denomination_medicament AS denomination,
            ${phraseSql('s.texte', tq.sql, '$4::text')} AS extrait
     FROM docs.rcp_sections s
     JOIN dbpm.cis_bdpm m ON m.code_cis = s.code_cis
     WHERE s.code_cis = $1 AND s.document_type = $2 AND s.position = $3`,
    [String(cis), String(type), rang, expressionExacte(saisie), ...tq.params],
  );
  return rows[0] ? { ...rows[0], extrait: marquer(rows[0].extrait) } : null;
}

/**
 * Formes exactes des mots que Postgres a retenus dans les rubriques d'une
 * spécialité (racines, synonymes, élargissements compris), pour que la fiche
 * surligne ce qui a été trouvé et non seulement les mots tapés : une
 * expression partielle ou élargie ne contient pas forcément la saisie.
 *
 * @returns {Promise<string[]>} mots en minuscules, sans doublon, 80 au plus
 */
export async function motsTrouves(pool, cis, requete) {
  const saisie = String(requete ?? '').trim();
  if (!saisie || !isValidCis(cis)) return [];
  const tq = composerTsquery(elargir(saisie).atomes, 2);
  const { rows } = await pool.query(
    `WITH q AS (SELECT ${tq.sql} AS tq)
     SELECT ts_headline('${LANGUE}', s.texte, q.tq,
              'StartSel=${OUVRE}, StopSel=${FERME}, HighlightAll=true') AS marque
     FROM docs.rcp_sections s, q
     WHERE s.code_cis = $1 AND ${VECTEUR} @@ q.tq`,
    [String(cis), ...tq.params],
  );
  const mots = new Set();
  const motif = new RegExp(`${OUVRE}([^${FERME}]{1,60})${FERME}`, 'g');
  for (const { marque } of rows) {
    for (const [, mot] of String(marque ?? '').matchAll(motif)) {
      mots.add(mot.trim().toLowerCase());
      if (mots.size >= 80) return [...mots];
    }
  }
  return [...mots].filter(Boolean);
}

/**
 * Spécialités d'un filtre « médicament », en CTE `cis_molecule` : chaque mot
 * du filtre figure dans une substance active ou dans la dénomination (« acide
 * folique », « paracetamol codeine »). Un dosage (« doliprane 300 ») : nombre
 * entier de la dénomination, 100 n'est pas 1000. Une forme au pluriel ou dite
 * au comptoir (« comprimés », « sirop ») trouve la dénomination de la BDPM.
 * @param {string} param - le paramètre SQL qui porte le filtre (« $5 »)
 */
function cisMoleculeSql(param) {
  return `cis_molecule AS MATERIALIZED (
       SELECT m.code_cis FROM dbpm.cis_bdpm m
       WHERE (SELECT bool_and(CASE WHEN mot ~ '^[0-9]+(,[0-9]+)?$'
                THEN m.denomination_medicament ~ ('(^|[^0-9,])' || mot || '($|[^0-9,])')
                ELSE
                -- « comprimés » trouve « comprimé » ; « sirop » trouve aussi les formes buvables.
                public.f_unaccent(lower(m.denomination_medicament)) LIKE '%' || regexp_replace(mot, '(.{4})s$', '\\1') || '%'
                OR (mot = 'sirop' AND public.f_unaccent(lower(m.denomination_medicament)) LIKE '%buvable%')
                OR EXISTS (SELECT 1 FROM dbpm.cis_compo_bdpm c
                           WHERE c.code_cis = m.code_cis AND c.nature_composant = 'SA'
                             AND public.f_unaccent(lower(c.denomination_substance)) LIKE '%' || mot || '%')
                END)
              FROM unnest(string_to_array(public.f_unaccent(lower(${param}::text)), ' ')) AS mot
              WHERE mot <> '')
     )`;
}

/** Rédactions différentes d'une même rubrique montrées au plus : les plus répandues. */
export const LECTURE_VARIANTES_MAX = 4;
/** Texte cité entier : au-delà, le passage qui porte la requête, puis la rubrique entière repliée. */
const LECTURE_ENTIERE_MAX = 600;

/**
 * Une rubrique lue pour un médicament (« Doliprane 1000 comprimé », rubrique 3 ;
 * « paracétamol », rubrique 4.9), que la requête y figure ou non : le silence du
 * RCP est une réponse, et la réponse n'est pas toujours la phrase qui contient
 * le mot (« 3000 mg par jour » est dans le tableau de la 4.2). Les spécialités
 * dont la rubrique a le même texte sont regroupées : une ligne par rédaction,
 * la forme nommée d'abord, puis les plus répandues. Rien n'est déduit.
 *
 * Statuts : `trouve` (passage, termes marqués), `entiere` (texte court cité
 * entier), `muette` (texte long sans la requête), `vide`, `absente` (le RCP
 * n'a pas cette rubrique), `sans-rcp` (aucun RCP découpé). Un texte long porte
 * aussi `complet` : la rubrique entière, en HTML, à déplier.
 *
 * @returns {Promise<{ lignes: object[], specialites: number, redactions: number }|null>}
 *   null : filtre, rubrique ou requête absents, ou aucune spécialité.
 */
export async function lireRubrique(pool, { molecule, rubrique, requete }) {
  const numero = normaliserRubrique(rubrique);
  const filtre = echapperLike(String(molecule ?? '').trim().slice(0, 80));
  const saisie = String(requete ?? '').trim();
  if (!numero || !filtre || !saisie) return null;

  const { atomes } = elargir(saisie);
  // Trois paramètres fixes (rubrique, molécule, expression exacte), puis les atomes.
  const tq = composerTsquery(atomes, 4);
  const { rows } = await pool.query(
    `WITH q AS (SELECT ${tq.sql} AS tq),
     ${cisMoleculeSql('$2')},
     formes AS (
       SELECT m.code_cis, m.denomination_medicament AS denomination,
              m.etat_commercialisation ILIKE 'commercialis%' AS commercialise,
              (SELECT count(DISTINCT c.code_substance) FROM dbpm.cis_compo_bdpm c
               WHERE c.code_cis = m.code_cis AND c.nature_composant = 'SA') AS substances,
              -- Le nom tapé en tête de la dénomination : « paracetamol » → les PARACÉTAMOL d'abord.
              public.f_unaccent(lower(m.denomination_medicament)) LIKE split_part($2::text, ' ', 1) || '%' AS nommee
       FROM dbpm.cis_bdpm m WHERE m.code_cis IN (SELECT code_cis FROM cis_molecule)
     ),
     -- Commercialisées seulement, sauf s'il n'y en a aucune ; le moins de
     -- substances possible : « paracétamol » n'est pas Lamaline (paracétamol,
     -- opium, caféine), « Codoliprane » reste une association.
     commercialisees AS (
       SELECT * FROM formes
       WHERE commercialise OR NOT EXISTS (SELECT 1 FROM formes WHERE commercialise)
     ),
     retenues AS (
       SELECT * FROM commercialisees WHERE substances = (SELECT min(substances) FROM commercialisees)
     ),
     lues AS (
       SELECT f.code_cis, f.denomination, f.commercialise, f.nommee,
              r.document_type, r.position, r.libelle, r.texte, r.html, r.vecteur,
              CASE
                WHEN r.texte IS NOT NULL THEN md5(regexp_replace(r.texte, '\\s+', ' ', 'g'))
                WHEN EXISTS (SELECT 1 FROM docs.rcp_sections d
                             WHERE d.code_cis = f.code_cis AND d.document_type <> 'notice') THEN 'absente'
                ELSE 'sans-rcp'
              END AS cle
       FROM retenues f
       LEFT JOIN LATERAL (
         SELECT s.document_type, s.position, s.libelle, s.texte, s.html, s.vecteur
         FROM docs.rcp_sections s
         WHERE s.code_cis = f.code_cis AND s.document_type <> 'notice'
           AND (s.numero = $1 OR s.numero LIKE $1 || '.%')
         ORDER BY (s.document_type = 'rcp') DESC, (s.numero = $1) DESC, s.position
         LIMIT 1
       ) r ON true
     ),
     redactions AS (
       SELECT cle, count(*)::int AS nombre, bool_or(nommee) AS nommee, min(length(denomination)) AS court,
              (array_agg(denomination ORDER BY nommee DESC, length(denomination), denomination))[1:12] AS noms
       FROM lues GROUP BY cle
     ),
     -- Une spécialité par rédaction : la plus proche du nom tapé, puis la plus courte.
     choisies AS (
       SELECT DISTINCT ON (l.cle) l.*, r.nombre, r.noms, r.court, r.nommee AS redaction_nommee
       FROM lues l JOIN redactions r USING (cle)
       ORDER BY l.cle, l.nommee DESC, length(l.denomination), l.denomination
     )
     SELECT c.code_cis, c.denomination, c.cle, c.nombre, c.noms, c.document_type, c.position,
            c.libelle, c.texte, c.html,
            (SELECT count(*) FROM lues)::int AS specialites,
            (SELECT count(*) FROM redactions)::int AS redactions,
            c.vecteur @@ q.tq AS trouve,
            CASE WHEN c.vecteur @@ q.tq THEN ${phraseSql('c.texte', 'q.tq', '$3')} END AS passage,
            -- Texte court : cité entier, termes marqués partout.
            CASE WHEN c.vecteur @@ q.tq AND length(c.texte) <= ${LECTURE_ENTIERE_MAX}
                 THEN ts_headline('${LANGUE}', regexp_replace(c.texte, '\\s+', ' ', 'g'), q.tq, 'HighlightAll=true, ${MARQUES}') END AS entier
     FROM choisies c CROSS JOIN q
     -- La forme nommée d'abord (la plus courte des dénominations qui commencent
     -- par le nom tapé), puis les plus répandues.
     ORDER BY (c.redaction_nommee AND c.court = (SELECT min(court) FROM redactions WHERE nommee)) DESC,
              c.redaction_nommee DESC, c.nombre DESC, c.court
     LIMIT ${LECTURE_VARIANTES_MAX}`,
    [numero, filtre, expressionExacte(saisie), ...tq.params],
  );
  if (rows.length === 0) return null;

  const lignes = rows.map((row) => {
    const texte = String(row.texte ?? '').replace(/\s+/g, ' ').trim();
    const base = {
      cis: row.code_cis, denomination: row.denomination, autres: row.noms.slice(1), nombre: row.nombre,
      ancre: row.document_type ? `${row.document_type}-${row.position}` : null, libelle: row.libelle ?? null,
    };
    if (row.cle === 'sans-rcp') return { ...base, statut: 'sans-rcp' };
    if (row.cle === 'absente') return { ...base, statut: 'absente' };
    if (!/[\p{L}\p{N}]/u.test(texte)) return { ...base, statut: 'vide' };
    const court = texte.length <= LECTURE_ENTIERE_MAX;
    if (court) return { ...base, statut: row.trouve ? 'trouve' : 'entiere', html: marquer(row.trouve ? row.entier : texte), entier: true };
    return { ...base, statut: row.trouve ? 'trouve' : 'muette', html: row.trouve ? marquer(row.passage) : null, complet: row.html };
  });
  return { lignes, specialites: rows[0].specialites, redactions: rows[0].redactions };
}

/**
 * Rubriques dont le texte répond à la requête, regroupées par molécule.
 *
 * @param {import('pg').Pool} pool
 * @param {string} requete - saisie brute
 * @param {{ rubrique?: string, limite?: number, decalage?: number }} [options]
 * @returns {Promise<{ resultats: object[], total: number, borne: boolean,
 *                     decalage: number, suite: boolean }>}
 */
export async function chercherDansDocuments(pool, requete, options = {}) {
  const vide = {
    resultats: [], total: 0, borne: false, decalage: 0, suite: false, elargissements: [], exacte: false,
  };
  const saisie = String(requete ?? '').trim();
  if (!saisie) return vide;

  const rubrique = normaliserRubrique(options.rubrique);
  // Number() peut rendre NaN, que Math.min/max propageraient jusqu'au OFFSET.
  const entier = (valeur, defaut) => {
    const nombre = Math.trunc(Number(valeur));
    return Number.isFinite(nombre) ? nombre : defaut;
  };

  const limite = Math.min(Math.max(1, entier(options.limite ?? PAR_PAGE, PAR_PAGE)), 100);
  // Au-delà des molécules retenues, la page serait vide.
  const decalage = Math.min(Math.max(0, entier(options.decalage ?? 0, 0)), MOLECULES_MAX);

  const { atomes, elargissements } = elargir(saisie);
  // Six paramètres fixes (rubrique, limite, décalage, expression, molécule, phrases), puis les atomes.
  const tq = composerTsquery(atomes, 7);
  const proche = composerProximite(tq.concepts);
  // Chaque mot entre dans un LIKE : ses jokers sont échappés.
  const molecule = echapperLike(String(options.molecule ?? '').trim().slice(0, 80)) || null;
  // Recherche ciblée : la phrase de chaque rubrique trouvée, affichée d'office.
  const phrases = Boolean(options.phrases);
  const exacte = expressionExacte(saisie);

  const { rows } = await pool.query(
    `WITH q AS (SELECT ${tq.sql} AS tq, ${composerTitre(tq.concepts)} AS titre${proche ? `, ${proche} AS proche` : ''}),
     ${molecule ? `${cisMoleculeSql('$5')},` : ''}
     tout AS MATERIALIZED (
       -- Toutes les rubriques trouvées, notées pour le classement. Sans le
       -- texte, qui faisait dépasser le délai : il est rejoint par sa clé
       -- primaire pour la page affichée seulement.
       SELECT s.code_cis, s.document_type, s.position, s.numero, s.libelle,
              ts_rank_cd(${VECTEUR}, q.tq) AS score,
              CASE WHEN $4::text IS NULL THEN true
                   ELSE ${VECTEUR} @@ phraseto_tsquery('${LANGUE}', $4::text) END AS exact,
              ${RANG} + ${TITRE} AS rang,
              -- Rubrique du comptoir (RCP, liste PRIORITE) : le surdosage (4.9),
              -- les propriétés et la notice ne décident pas du classement.
              ${RANG} < ${PRIORITE.length} AS clinique
       FROM docs.rcp_sections s, q
       WHERE ${VECTEUR} @@ q.tq
         -- Plusieurs concepts : rapprochés, pas dispersés dans la rubrique.
         ${proche ? `AND ${VECTEUR} @@ q.proche` : ''}
         AND ($1::text IS NULL OR s.numero = $1 OR s.numero LIKE $1 || '.%')
         ${molecule
    // Liste des CIS d'abord, en tableau : l'index code_cis se croise avec
    // l'index plein texte, et seules les rubriques retenues sont lues. Filtrées
    // après coup, les 35 000 rubriques « allaitement » étaient toutes lues
    // sur disque pour en garder 474 (3,3 s).
    ? 'AND s.code_cis = ANY (ARRAY(SELECT code_cis FROM cis_molecule))'
    : 'AND $5::text IS NULL'}
     ),
     -- Les substances en jeu, pour ne nommer que celles-là.
     substances AS (
       SELECT DISTINCT c.code_substance
       FROM dbpm.cis_compo_bdpm c
       WHERE c.code_cis IN (SELECT DISTINCT code_cis FROM tout)
         AND c.nature_composant = 'SA'
     ),
     -- Les libellés du sel, découpés en mots — sans accents ni ponctuation,
     -- « BROMURE D'IPRATROPIUM » devenant {BROMURE, D, IPRATROPIUM}.
     libelles AS (
       SELECT c.code_substance, c.denomination_substance AS nom,
              string_to_array(btrim(regexp_replace(
                upper(public.f_unaccent(c.denomination_substance)),
                '[^A-Z0-9]+', ' ', 'g')), ' ') AS mots
       FROM dbpm.cis_compo_bdpm c
       WHERE c.nature_composant = 'SA'
         AND c.code_substance IN (SELECT code_substance FROM substances)
     ),
     -- Les fractions thérapeutiques rattachées au même numéro de liaison.
     fractions AS (
       SELECT sa.code_substance, ft.denomination_substance AS nom,
              string_to_array(btrim(regexp_replace(
                upper(public.f_unaccent(ft.denomination_substance)),
                '[^A-Z0-9]+', ' ', 'g')), ' ') AS mots
       FROM dbpm.cis_compo_bdpm sa
       JOIN dbpm.cis_compo_bdpm ft
         ON ft.code_cis = sa.code_cis
        AND ft.numero_liaison_saft = sa.numero_liaison_saft
        AND ft.nature_composant = 'FT'
       WHERE sa.nature_composant = 'SA'
         AND sa.code_substance IN (SELECT code_substance FROM substances)
     ),
     -- Une fraction ne peut nommer la substance que si tous ses mots sont des
     -- mots du sel. C'est toute la règle, et elle a été trouvée en constatant
     -- les dégâts de l'autre : onze produits de contraste réunis sous « IODE »,
     -- le carboxymaltose ferrique avec le sulfate ferreux, l'acétylcystéine
     -- sous « CYSTÉINE ». La fraction thérapeutique n'est pas la molécule,
     -- c'est ce qui, dans le sel, porte l'effet — parfois un simple atome.
     candidats AS (
       SELECT code_substance, nom FROM libelles
       UNION
       SELECT f.code_substance, f.nom
       FROM fractions f
       WHERE EXISTS (SELECT 1 FROM libelles l
                     WHERE l.code_substance = f.code_substance AND f.mots <@ l.mots)
     ),
     -- MATERIALIZED : calculée une fois. Inlinée, elle était retriée à chaque
     -- spécialité, et « allaitement » (3 000 occurrences) dépassait le délai.
     noms AS MATERIALIZED (
       SELECT DISTINCT ON (code_substance) code_substance, nom
       FROM candidats
       WHERE coalesce(nom, '') <> ''
       ORDER BY code_substance, length(nom), nom
     ),
     -- La signature : l'ensemble trié des noms résolus. Sur le nom et non sur
     -- le code, sans quoi DARUNAVIR sort trois fois — un code par sel, et la
     -- base elle-même leur donne le même nom.
     --
     -- Les spécialités sans composition — deux sur treize mille six cents —
     -- retombent sur leur propre CIS plutôt que de se fondre dans un groupe
     -- vide commun, qui les réunirait sans qu'elles aient rien en partage.
     -- Jointure agrégée plutôt qu'un sous-select corrélé : un seul passage
     -- sur les compositions, quel que soit le nombre d'occurrences. Les noms
     -- en table de correspondance : joints comme une CTE, mal estimée, ils
     -- étaient relus en entier pour chaque spécialité (1 813 × 10 883 lignes
     -- pour « insuffisance hépatique », 1,3 s).
     dictionnaire AS MATERIALIZED (
       SELECT jsonb_object_agg(code_substance, nom) AS noms FROM noms
     ),
     -- Le dictionnaire est lu une fois (sous-requête scalaire) : joint à
     -- chaque ligne, il était recopié dans le tri du regroupement.
     molecule AS MATERIALIZED (
       SELECT t.code_cis,
              coalesce(string_agg(DISTINCT x.nom, ' + ' ORDER BY x.nom), 'cis:' || t.code_cis) AS signature
       FROM (SELECT DISTINCT code_cis FROM tout) t
       LEFT JOIN LATERAL (
         SELECT (SELECT noms FROM dictionnaire) ->> c.code_substance::text AS nom
         FROM dbpm.cis_compo_bdpm c
         WHERE c.code_cis = t.code_cis AND c.nature_composant = 'SA'
       ) x ON true
       GROUP BY t.code_cis
     ),
     -- Le classement, sur toutes les rubriques : les molécules trouvées dans
     -- une rubrique du comptoir d'abord, puis l'expression exacte, puis la
     -- rubrique qui répond le mieux à la question du comptoir, puis le score.
     -- Exactitude et rubrique se lisent dans les rubriques du comptoir quand il
     -- y en a : « allongement QT » mot pour mot dans le seul surdosage du
     -- tamoxifène ne le place pas devant les mises en garde des autres.
     -- Par molécule et non par rubrique : un plafond en rubriques laissait une
     -- molécule à trois cents génériques occuper la place des autres.
     classement AS MATERIALIZED (
       SELECT m.signature, count(DISTINCT t.code_cis)::int AS specialites, max(t.score) AS score,
              bool_or(t.clinique) AS clinique,
              coalesce(bool_or(t.exact) FILTER (WHERE t.clinique), bool_or(t.exact)) AS exact,
              coalesce(min(t.rang) FILTER (WHERE t.exact AND t.clinique),
                       min(t.rang) FILTER (WHERE t.clinique),
                       min(t.rang) FILTER (WHERE t.exact),
                       min(t.rang)) AS rang,
              -- Nombre de substances : filtré sur un médicament, la molécule seule passe avant ses associations.
              array_length(string_to_array(m.signature, ' + '), 1) AS composants
       FROM tout t JOIN molecule m USING (code_cis)
       GROUP BY m.signature
     ),
     -- Les mieux classées seulement, détaillées ci-dessous.
     resume AS MATERIALIZED (
       SELECT * FROM classement
       ORDER BY CASE WHEN $5::text IS NULL THEN 0 ELSE composants END,
                clinique DESC, exact DESC, rang, score DESC, specialites DESC, signature
       LIMIT ${MOLECULES_MAX}
     ),
     trouve AS (
       SELECT t.* FROM tout t JOIN molecule m USING (code_cis)
       WHERE m.signature IN (SELECT signature FROM resume)
     ),
     -- Princeps (référent de groupe générique) : la spécialité la plus connue
     -- représente sa molécule et fournit ses phrases.
     enrichi AS (
       SELECT t.*, m.signature,
              EXISTS (SELECT 1 FROM dbpm.cis_gener_bdpm g
                      WHERE g.code_cis = t.code_cis AND g.type_generique = '0') AS princeps
       FROM trouve t JOIN molecule m USING (code_cis)
     ),
     -- Une entrée par rubrique et par molécule, portée par sa meilleure
     -- occurrence : le numéro affiché doit mener quelque part de précis. Le
     -- type de document fait partie de la clé : la rubrique 4 d'une notice
     -- (les effets indésirables) n'est pas le chapitre 4 d'un RCP.
     par_rubrique AS (
       SELECT DISTINCT ON (signature, document_type, numero)
              signature, numero, libelle, code_cis, document_type, position, score, exact
       FROM enrichi
       WHERE coalesce(numero, '') <> ''
       ORDER BY signature, document_type, numero, exact DESC, princeps DESC, score DESC, code_cis
     ),
     chapeau AS (
       SELECT signature,
              jsonb_agg(jsonb_build_object(
                'numero', numero, 'libelle', libelle, 'cis', code_cis,
                'type', document_type, 'exact', exact,
                'ancre', document_type || '-' || position,
                -- Le point mène à une spécialité : l'infobulle la nomme.
                'denomination', (SELECT denomination_medicament FROM dbpm.cis_bdpm WHERE code_cis = p.code_cis))
                -- 10 vient après 4.8, ce que l'ordre alphabétique ignore.
                -- substring rend NULL sur ce qui n'est pas un chiffre au lieu
                -- de lever : un numéro mal formé se range en fin de son rang
                -- au lieu de faire échouer la requête entière. C'est pour
                -- l'avoir écarté d'abord qu'on s'est retrouvé avec un extrait
                -- venu d'une rubrique absente des puces.
                -- NULLS FIRST sur le second rang : « 4 » est le chapitre, il
                -- ouvre ses sous-rubriques au lieu de les suivre. Il se rangeait
                -- entre 4.9 et 5.3, ce que l'écran a montré tout de suite.
                ORDER BY document_type <> 'rcp',
                         substring(numero from '^[0-9]+')::int NULLS LAST,
                         substring(numero from '[.]([0-9]+)')::int NULLS FIRST,
                         numero) AS rubriques
       FROM par_rubrique p GROUP BY signature
     ),
     -- Une entrée par rubrique et par spécialité : l'accordéon déplié montre
     -- les points de chaque dosage, chacun menant à son propre RCP.
     par_specialite_rubrique AS (
       SELECT DISTINCT ON (code_cis, document_type, numero)
              code_cis, document_type, numero, libelle, position, exact
       FROM enrichi
       WHERE coalesce(numero, '') <> ''
       ORDER BY code_cis, document_type, numero, exact DESC, score DESC
     ),
     meilleur AS (
       SELECT DISTINCT ON (signature)
              signature, code_cis, document_type, position, numero, libelle, score
       FROM enrichi ORDER BY signature, exact DESC, rang, princeps DESC, score DESC, code_cis
     ),
     -- Meilleur passage de chaque spécialité : l'accordéon des dosages y mène.
     par_specialite AS MATERIALIZED (
       SELECT DISTINCT ON (code_cis) signature, code_cis,
              document_type || '-' || position AS ancre
       FROM enrichi ORDER BY code_cis, exact DESC, rang, score DESC
     )
     SELECT page.*,
            -- Phrases par rubrique, pour la page affichée seulement (après le LIMIT) :
            -- une extraction par rubrique de chaque molécule, trop coûteuse sur 3 000.
            CASE WHEN $6::boolean THEN (
              SELECT jsonb_agg(jsonb_build_object(
                       'numero', p.numero, 'libelle', p.libelle, 'cis', p.code_cis,
                       'type', p.document_type, 'exact', p.exact,
                       'ancre', p.document_type || '-' || p.position,
                       -- La spécialité d'où vient la phrase : une molécule a plusieurs RCP.
                       'denomination', pm.denomination_medicament,
                       'extrait', ${phraseSql('ps.texte', 'q.tq', '$4::text')})
                     ORDER BY p.document_type <> 'rcp',
                              substring(p.numero from '^[0-9]+')::int NULLS LAST,
                              substring(p.numero from '[.]([0-9]+)')::int NULLS FIRST,
                              p.numero)
              FROM par_rubrique p
              JOIN dbpm.cis_bdpm pm ON pm.code_cis = p.code_cis
              JOIN docs.rcp_sections ps
                ON ps.code_cis = p.code_cis AND ps.document_type = p.document_type AND ps.position = p.position
              WHERE p.signature = page.signature AND coalesce(p.numero, '') <> '')
            END AS detaillees
     FROM (
     SELECT r.signature, r.specialites, r.exact, coalesce(c.rubriques, '[]'::jsonb) AS rubriques,
            b.code_cis, b.numero, b.libelle,
            b.document_type || '-' || b.position AS ancre,
            m.denomination_medicament AS denomination,
            -- La signature est déjà le nom : « PARACETAMOL + TRAMADOL » se
            -- lit tel quel, et deux lignes du même groupe ne peuvent pas
            -- s'intituler différemment selon leur représentant.
            CASE WHEN r.signature LIKE 'cis:%' THEN NULL ELSE r.signature END AS molecule,
            -- L'extrait ne se montre que filtré sur une rubrique : sans filtre,
            -- chaque point de la ligne a le sien, demandé au survol. Le
            -- calculer ici coûterait pour une phrase que personne ne verrait.
            CASE WHEN $1::text IS NULL THEN NULL
                 ELSE ${phraseSql('bt.texte', 'q.tq', '$4::text')} END AS extrait,
            (SELECT count(*)::int FROM tout) AS occurrences,
            (SELECT count(*)::int FROM classement) AS molecules,
            -- Après le LIMIT : pour la page affichée seulement.
            (SELECT json_agg(json_build_object(
                      'id', p.code_cis, 'denomination', s.denomination_medicament,
                      'forme_pharmaceutique', s.forme_pharmaceutique, 'titulaires', s.titulaires,
                      'commercialise', s.etat_commercialisation = 'Commercialisée',
                      'importation', ${importSql('s')},
                      'princeps', EXISTS (SELECT 1 FROM dbpm.cis_gener_bdpm g
                                          WHERE g.code_cis = p.code_cis AND g.type_generique = '0'),
                      'ancre', p.ancre,
                      'rubriques', (SELECT json_agg(json_build_object(
                                             'numero', r.numero, 'libelle', r.libelle, 'type', r.document_type,
                                             'exact', r.exact, 'ancre', r.document_type || '-' || r.position)
                                           ORDER BY r.document_type <> 'rcp', r.numero)
                                    FROM par_specialite_rubrique r WHERE r.code_cis = p.code_cis))
                    ORDER BY s.denomination_medicament, p.code_cis)
             FROM par_specialite p JOIN dbpm.cis_bdpm s ON s.code_cis = p.code_cis
             WHERE p.signature = r.signature) AS liste
     FROM resume r
     JOIN meilleur b USING (signature)
     LEFT JOIN chapeau c USING (signature)
     JOIN dbpm.cis_bdpm m ON m.code_cis = b.code_cis
     JOIN docs.rcp_sections bt
       ON bt.code_cis = b.code_cis AND bt.document_type = b.document_type AND bt.position = b.position, q
     ORDER BY CASE WHEN $5::text IS NULL THEN 0 ELSE r.composants END,
              r.clinique DESC, r.exact DESC, r.rang, r.score DESC, r.specialites DESC, b.code_cis
     LIMIT $2 OFFSET $3
     ) AS page, q`,
    // Une ligne de plus pour savoir s'il existe une page suivante.
    [rubrique, limite + 1, decalage, exacte, molecule, phrases, ...tq.params],
  );

  const occurrences = rows[0]?.occurrences ?? 0;
  const molecules = rows[0]?.molecules ?? 0;
  const suite = rows.length > limite;
  const page = suite ? rows.slice(0, limite) : rows;

  return {
    decalage,
    suite,
    // Plusieurs mots : la vue distingue les occurrences exactes.
    exacte: Boolean(exacte),
    // Élargissements affichés, pour que le lecteur puisse les refuser.
    elargissements,
    resultats: page.map(({ occurrences: _, molecules: __, molecule, denomination, liste, detaillees, ...reste }) => ({
      ...reste,
      extrait: marquer(reste.extrait),
      // Ciblée : les rubriques portent leur phrase.
      rubriques: detaillees?.map((rub) => ({ ...rub, extrait: marquer(rub.extrait) })) ?? reste.rubriques,
      formes: formesDuProduit(liste),
      denomination,
      // Sans composition enregistrée : la dénomination sert de titre.
      molecule: molecule || denomination,
      sansMolecule: !molecule,
    })),
    // Total exact : toutes les rubriques sont classées.
    total: occurrences,
    molecules,
    // Plus de molécules que de détaillées : à dire, avec l'invitation à affiner.
    borne: molecules > MOLECULES_MAX,
    moleculesMax: MOLECULES_MAX,
  };
}
