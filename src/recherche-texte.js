/**
 * Recherche plein texte dans les rubriques des documents.
 *
 * La question à laquelle elle répond n'a pas de réponse ailleurs en accès
 * libre : « quels médicaments mentionnent l'allongement de l'intervalle QT, et
 * dans quelle rubrique ». La BDPM sert ses documents un par un ; ici ils sont
 * découpés, indexés, et interrogeables d'un bloc.
 *
 * Trois décisions commandent tout ce qui suit.
 *
 * **L'unité de résultat est la rubrique, pas le produit.** « DOLIPRANE » ne
 * répond pas à la question ; « DOLIPRANE · 4.4 Mises en garde » y répond, et
 * l'ancre posée par le découpeur y conduit directement. Chaque numéro annoncé
 * porte donc sa propre ancre, prise sur sa meilleure occurrence — un numéro
 * qui mènerait à une spécialité tirée au sort du groupe serait pire qu'absent.
 *
 * **L'unité de regroupement est la molécule.** Grouper sur l'empreinte du
 * texte, comme on l'a d'abord fait, ne réunit que les reprises au mot près :
 * un princeps et son générique dont les RCP diffèrent d'une virgule faisaient
 * deux lignes. Sur le millésime d'août 2026, les 13 599 spécialités
 * commercialisées composées se ramènent à 3 352 molécules — olanzapine 66
 * spécialités, aripiprazole 63, rispéridone 62, soit exactement les familles
 * qui remplissent une recherche « intervalle QT ».
 *
 * La signature est l'ensemble trié des noms résolus, un par substance active.
 * Trois pivots ont été essayés sur le millésime d'août 2026 :
 *
 *   `code_substance` brut          3 352 groupes, mais DARUNAVIR sort trois
 *                                  fois — un code par sel.
 *   dénomination la plus courte    3 119 groupes, et onze produits de
 *                                  contraste réunis sous « IODE », le fer
 *                                  intraveineux avec le sulfate ferreux oral,
 *                                  l'acétylcystéine sous « CYSTÉINE ».
 *   nom résolu (retenu)            3 158 groupes, aucune fusion douteuse.
 *
 * La fraction thérapeutique n'est pas « la même molécule » : pour un produit
 * de contraste c'est l'atome d'iode, pour un sel de fer c'est l'élément. Elle
 * ne remplace donc le sel que si **tous ses mots sont des mots du sel** —
 * QUIZARTINIB dans DICHLORHYDRATE DE QUIZARTINIB, TACROLIMUS dans TACROLIMUS
 * MONOHYDRATÉ. IODE n'est pas un mot de IOHEXOL, CYSTÉINE n'en est pas un
 * d'ACÉTYLCYSTÉINE : ces deux-là gardent leur nom, et leur groupe.
 *
 * Les `FT` ne comptent jamais comme substance : sans quoi une spécialité
 * compterait la sienne deux fois. Une association fait son propre groupe :
 * paracétamol + codéine n'est pas du paracétamol.
 *
 * Une molécule n'a pas un seul RCP — tramadol LP et tramadol à libération
 * immédiate ont des textes différents. L'extrait rendu est celui de la
 * meilleure occurrence, et la vue dit de quelle spécialité il vient : sans
 * quoi l'on attribuerait à la molécule une phrase qui n'est vraie que d'une
 * forme.
 *
 * **On borne, et on le dit.** Classer par pertinence suppose d'avoir évalué
 * chaque occurrence : sur un mot courant comme « traitement », c'est cent
 * mille rubriques pour un résultat que personne ne lira. La recherche s'arrête
 * donc à PLAFOND occurrences et l'annonce, plutôt que de faire attendre pour
 * un chiffre faux.
 */

import { elargir } from './thesaurus.js';

/** La configuration de recherche est posée par sql/recherche.sql. */
const LANGUE = 'french_nu';

/**
 * Au-delà, la question est mal posée et le classement n'a plus de sens.
 * Les recherches utiles — « hypocarnitinémie », « anomalie de Pelger-Huët » —
 * rendent quelques centaines d'occurrences.
 */
export const PLAFOND = 3000;

/**
 * Ce qu'on rend d'un coup ; le reste s'obtient en affinant.
 *
 * Vingt tenait quand une trouvaille occupait cinq lignes d'écran — produit,
 * rubrique, extrait sur trois lignes. Groupée par molécule et l'extrait replié,
 * elle en occupe une : la page montrait un vingtième de ce qu'elle pouvait.
 */
export const PAR_PAGE = 50;

/**
 * Ce qu'en montre la page de recherche par nom, où le bloc n'est qu'un second
 * temps. Cinq lignes suffisaient à peine à faire deviner qu'il y en avait
 * d'autres ; douze remplissent l'écran sans prendre la place des spécialités.
 */
export const APERCU = 12;

/**
 * Les rubriques qui font colonne, et onglet.
 *
 * Une liste fixe plutôt que l'union de ce qu'une recherche a trouvé : des
 * colonnes qui changent de place d'une requête à l'autre ne s'apprennent
 * jamais, et le lecteur relit l'en-tête à chaque fois. Ce sont les huit
 * rubriques qu'on interroge au comptoir ; tout le reste — la composition, les
 * données précliniques, la conservation — tombe dans la colonne « Autres »,
 * qui les nomme sans leur réserver de place.
 *
 * Même liste pour les onglets et pour les colonnes : elle vivait en double,
 * écrite une fois dans le gabarit et une fois nulle part.
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
 * L'ordre dans lequel une rubrique répond à la question du comptoir.
 *
 * Une molécule contre-indiquée en cas d'insuffisance hépatique sévère passe
 * avant celle dont le 5.2 décrit sa pharmacocinétique chez l'insuffisant : la
 * première réponse est « peut-on la délivrer », la seconde « à quelle dose »,
 * le reste vient ensuite. Le score de `ts_rank_cd` ne sait rien de cela — il
 * compte des mots, et une rubrique de pharmacocinétique en compte beaucoup.
 * Les notices viennent après toutes les rubriques du RCP : elles disent la
 * même chose en d'autres mots.
 */
export const PRIORITE = ['4.3', '4.2', '4.4', '4.5', '4.6', '4.8', '4.1', '5.1'];

const RANG = `coalesce(array_position(ARRAY[${PRIORITE.map((numero) => `'${numero}'`).join(', ')}]::text[], s.numero), ${PRIORITE.length})
  + CASE WHEN s.document_type = 'rcp' THEN 0 ELSE ${PRIORITE.length + 1} END`;

/**
 * L'expression telle qu'elle a été tapée, quand elle a plusieurs mots.
 *
 * « insuffisance hépatique sévère » cherche les trois mots, où qu'ils soient
 * dans la rubrique : c'est ce qui fait trois mille résultats, dont une bonne
 * part de 4.2 qui énumèrent « insuffisance hépatique légère, modérée ou
 * sévère ». Les deux sont utiles, mais pas au même rang : la rubrique qui
 * porte l'expression dans l'ordre vient d'abord, et se distingue à l'écran.
 *
 * Rien à distinguer quand la saisie est entre guillemets — websearch la
 * cherche déjà comme locution — ni quand elle porte un opérateur, ni pour un
 * mot seul : on rend alors null, et toutes les occurrences comptent comme
 * exactes.
 *
 * @returns {string|null}
 */
export function expressionExacte(requete) {
  const saisie = String(requete ?? '').trim();
  if (!saisie || saisie.includes('"') || /(^|\s)-\S|\sor\s/i.test(saisie)) return null;
  return saisie.split(/[^\p{L}\p{N}]+/u).filter(Boolean).length >= 2 ? saisie : null;
}

/**
 * Où couper les phrases : un point suivi d'une majuscule, ou une puce. La
 * règle est celle de `citations.js`, qui cite les RCP dans les fiches ; les
 * contre-indications sont souvent une liste à puces sans point final, que la
 * seule ponctuation laissait d'un bloc.
 */
const COUPE = String.raw`(?<=[.!?])\s+(?=[A-ZÀ-ÖØ-Ý«(])|\s*[•▪]\s*`;
const MARQUES = 'StartSel=<mark>, StopSel=</mark>';
const FENETRE = `MaxWords=44, MinWords=22, MaxFragments=1, ${MARQUES}`;
/** Au-delà, la « phrase » est une énumération mal ponctuée : on la fenêtre. */
const PHRASE_MAX = 600;

/**
 * La phrase du document qui porte la requête, entière, termes marqués.
 *
 * Un aperçu qui commence par « polysorbate 80 ou à l'un des excipients » et
 * s'arrête sur « (voir rubrique » a perdu son début et sa fin : `ts_headline`
 * découpe une fenêtre de mots sans rien savoir des phrases. On découpe donc
 * d'abord en phrases, on garde la première qui répond — celle qui porte
 * l'expression exacte si l'une la porte — et on ne marque qu'à l'intérieur.
 *
 * Quand aucune phrase ne répond seule — les mots sont dans la rubrique, mais
 * dispersés sur plusieurs phrases — on retombe sur la fenêtre de ts_headline.
 */
function phraseSql(texte, requete, exacte) {
  // Entre parenthèses : `@@` et `&&` ont la même priorité, et la requête
  // composée « a && b » se lirait « (vecteur @@ a) && b ».
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
 * Normalise le filtre de rubrique.
 *
 * « 4 » doit rendre 4 et toutes ses sous-rubriques — c'est ainsi qu'on cherche
 * « dans les données cliniques ». La forme est vérifiée ici plutôt que dans la
 * requête : un numéro vient de l'URL, donc de n'importe où.
 *
 * @returns {string|null} le numéro, ou null si l'entrée n'en est pas un
 */
export function normaliserRubrique(valeur) {
  const brut = String(valeur ?? '').trim();
  return /^\d{1,2}(\.\d{1,2})?$/.test(brut) ? brut : null;
}

/**
 * La requête de l'utilisateur, telle que Postgres l'attend.
 *
 * `websearch_to_tsquery` et non `to_tsquery` : il accepte une saisie humaine
 * sans jamais lever d'erreur, et il comprend les guillemets — « "allongement
 * de l'intervalle QT" » cherché comme locution et non comme quatre mots
 * indépendants, ce qui change tout sur une expression de cette longueur.
 */
/**
 * La requête tsquery, composée à partir des atomes du thésaurus.
 *
 * Une liste d'alternatives par concept, un ET entre les concepts :
 *   (websearch($4) || websearch($5)) && websearch($6)
 * Chaque alternative passe séparément par websearch_to_tsquery et en garde la
 * sûreté — un atome hostile ou vide de sens (« de ») devient une requête vide,
 * que `&&` et `||` absorbent au lieu de propager. Seule la *forme* de
 * l'expression dépend de la saisie ; toutes les valeurs sont des paramètres.
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
  // Sans atome, une requête qui ne trouve rien — le même comportement qu'une
  // saisie de mots vides de sens, plutôt qu'une erreur de syntaxe SQL.
  const sql = groupes.length ? groupes.join(' && ') : `websearch_to_tsquery('${LANGUE}', '')`;
  return { sql, params };
}

/**
 * Le vecteur est une colonne, pas une expression.
 *
 * `sql/recherche.sql` le stocke sur la table. L'index d'expression qu'on avait
 * d'abord indexait le résultat sans le conserver : `to_tsvector` se recalculait
 * sur chacune des 3 000 rubriques candidates, une fois pour la revérification
 * et une fois pour le classement. Mesuré sur 120 000 rubriques : 407 ms contre
 * 21 ms, pour un balayage d'index qui prend 0,6 ms dans les deux cas.
 */
const VECTEUR = 's.vecteur';

/**
 * La recherche n'est pas installée sur cette base.
 *
 * `sql/recherche.sql` n'a pas été exécuté. La distinction compte, parce que
 * les deux situations demandent des choses opposées — dans un cas il faut
 * lancer une commande, dans l'autre attendre ou lire les journaux. Une panne
 * annoncée « momentanée » alors qu'elle est définitive fait attendre pour rien.
 *
 * Trois formes selon ce qui manque, et la troisième a été apprise à la
 * dure : en passant l'index d'expression en colonne stockée, la requête s'est
 * mise à demander `s.vecteur` sur des bases qui ne l'avaient pas encore. Le
 * code n'était plus reconnu, et la page annonçait une indisponibilité
 * passagère pour une migration qui attendait d'être lancée.
 */
export function rechercheAbsente(err) {
  // 42704 undefined_object (la configuration), 42883 undefined_function,
  // 42703 undefined_column (la colonne vecteur)
  return ['42704', '42883', '42703'].includes(err?.code)
    || /french_nu|websearch_to_tsquery|vecteur/i.test(err?.message ?? '');
}

/**
 * Rubriques dont le texte répond à la requête.
 *
 * @param {import('pg').Pool} pool
 * @param {string} requete - saisie brute
 * @param {{ rubrique?: string, limite?: number, decalage?: number }} [options]
 * @returns {Promise<{ resultats: object[], total: number, borne: boolean,
 *                     decalage: number, suite: boolean }>}
 */
/**
 * L'extrait d'une rubrique précise, à la demande.
 *
 * Pourquoi une seconde requête plutôt qu'un extrait par rubrique dans la
 * première : `ts_headline` est de loin la fonction la plus chère de tout
 * l'appareil. Mesuré sur le banc, à chaud — 50 extraits 21 ms, 250 extraits
 * 168 ms. Cinquante lignes portant chacune quatre rubriques, c'est donc une
 * recherche qui passerait de 20 ms à 170, pour des aperçus dont la plupart ne
 * seront jamais survolés. Ici, c'est un extrait par survol, et rien pour les
 * autres.
 *
 * La rubrique est désignée par sa clé primaire — CIS, type de document,
 * position — et non par un identifiant qu'il faudrait inventer.
 */
export async function extraitDeRubrique(pool, { cis, type, position, requete }) {
  const saisie = String(requete ?? '').trim();
  const rang = Math.trunc(Number(position));
  if (!saisie || !/^\d{6,10}$/.test(String(cis ?? '')) || !Number.isFinite(rang)) return null;
  if (!['rcp', 'notice'].includes(String(type))) return null;

  // Le même élargissement que la recherche : sans quoi l'aperçu surlignerait
  // « QT » et pas « torsade de pointes », qui est pourtant ce qui a fait
  // remonter la rubrique.
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
  return rows[0] ?? null;
}

export async function chercherDansDocuments(pool, requete, options = {}) {
  const vide = {
    resultats: [], total: 0, borne: false, decalage: 0, suite: false, elargissements: [], exacte: false,
  };
  const saisie = String(requete ?? '').trim();
  if (!saisie) return vide;

  const rubrique = normaliserRubrique(options.rubrique);
  // `Math.min` et `Math.max` propagent NaN sans broncher : borner ne suffit
  // pas, il faut d'abord constater qu'on a un nombre. Sans ce garde-fou, une
  // page « ?page=douze » envoyait NaN dans le OFFSET et Postgres refusait la
  // requête entière — une saisie d'URL faisait tomber la recherche.
  const entier = (valeur, defaut) => {
    const nombre = Math.trunc(Number(valeur));
    return Number.isFinite(nombre) ? nombre : defaut;
  };

  const limite = Math.min(Math.max(1, entier(options.limite ?? PAR_PAGE, PAR_PAGE)), 100);
  // Au-delà du plafond il n'y a plus rien à sauter : la page suivante serait
  // vide, et une page vide au milieu d'un jeu de résultats se lit comme une
  // panne. Le décalage est borné là où la recherche s'arrête.
  const decalage = Math.min(Math.max(0, entier(options.decalage ?? 0, 0)), PLAFOND);

  const { atomes, elargissements } = elargir(saisie);
  // Les quatre paramètres fixes d'abord, les atomes ensuite : leur nombre varie.
  const tq = composerTsquery(atomes, 5);
  const exacte = expressionExacte(saisie);

  const { rows } = await pool.query(
    `WITH q AS (SELECT ${tq.sql} AS tq),
     trouve AS (
       SELECT s.code_cis, s.document_type, s.position, s.numero, s.libelle,
              s.texte, ts_rank_cd(${VECTEUR}, q.tq) AS score,
              CASE WHEN $4::text IS NULL THEN true
                   ELSE ${VECTEUR} @@ phraseto_tsquery('${LANGUE}', $4::text) END AS exact,
              ${RANG} AS rang
       FROM docs.rcp_sections s, q
       WHERE ${VECTEUR} @@ q.tq
         AND ($1::text IS NULL OR s.numero = $1 OR s.numero LIKE $1 || '.%')
       LIMIT ${PLAFOND}
     ),
     -- Les substances en jeu, pour ne nommer que celles-là.
     substances AS (
       SELECT DISTINCT c.code_substance
       FROM dbpm.cis_compo_bdpm c
       WHERE c.code_cis IN (SELECT DISTINCT code_cis FROM trouve)
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
     noms AS (
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
     molecule AS (
       SELECT t.code_cis,
              coalesce(
                (SELECT string_agg(DISTINCT n.nom, ' + ' ORDER BY n.nom)
                 FROM dbpm.cis_compo_bdpm c
                 JOIN noms n ON n.code_substance = c.code_substance
                 WHERE c.code_cis = t.code_cis AND c.nature_composant = 'SA'),
                'cis:' || t.code_cis) AS signature
       FROM (SELECT DISTINCT code_cis FROM trouve) t
     ),
     enrichi AS (SELECT t.*, m.signature FROM trouve t JOIN molecule m USING (code_cis)),
     -- Une entrée par rubrique et par molécule, portée par sa meilleure
     -- occurrence : le numéro affiché doit mener quelque part de précis. Le
     -- type de document fait partie de la clé : la rubrique 4 d'une notice
     -- (les effets indésirables) n'est pas le chapitre 4 d'un RCP.
     par_rubrique AS (
       SELECT DISTINCT ON (signature, document_type, numero)
              signature, numero, libelle, code_cis, document_type, position, score, exact
       FROM enrichi
       WHERE coalesce(numero, '') <> ''
       ORDER BY signature, document_type, numero, exact DESC, score DESC, code_cis
     ),
     chapeau AS (
       SELECT signature,
              jsonb_agg(jsonb_build_object(
                'numero', numero, 'libelle', libelle, 'cis', code_cis,
                'type', document_type, 'exact', exact,
                'ancre', document_type || '-' || position)
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
       FROM par_rubrique GROUP BY signature
     ),
     meilleur AS (
       SELECT DISTINCT ON (signature)
              signature, code_cis, document_type, position, numero, libelle, texte, score
       FROM enrichi ORDER BY signature, exact DESC, rang, score DESC, code_cis
     ),
     -- Le classement : l'expression exacte d'abord, puis la rubrique qui
     -- répond le mieux à la question du comptoir, puis le score.
     resume AS (
       SELECT signature, count(DISTINCT code_cis)::int AS specialites, max(score) AS score,
              bool_or(exact) AS exact,
              coalesce(min(rang) FILTER (WHERE exact), min(rang)) AS rang
       FROM enrichi GROUP BY signature
     )
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
                 ELSE ${phraseSql('b.texte', 'q.tq', '$4::text')} END AS extrait,
            (SELECT count(*)::int FROM trouve) AS occurrences
     FROM resume r
     JOIN meilleur b USING (signature)
     LEFT JOIN chapeau c USING (signature)
     JOIN dbpm.cis_bdpm m ON m.code_cis = b.code_cis, q
     ORDER BY r.exact DESC, r.rang, r.score DESC, r.specialites DESC, b.code_cis
     LIMIT $2 OFFSET $3`,
    // Une ligne de plus que demandé : c'est ainsi qu'on sait s'il existe une
    // page suivante sans compter les molécules distinctes, ce que la requête
    // ne fait nulle part — `occurrences` compte les rubriques avant
    // regroupement, et servirait de plancher trompeur.
    [rubrique, limite + 1, decalage, exacte, ...tq.params],
  );

  const occurrences = rows[0]?.occurrences ?? 0;
  const suite = rows.length > limite;
  const page = suite ? rows.slice(0, limite) : rows;

  return {
    decalage,
    suite,
    // Une expression à plusieurs mots : la vue distingue alors les
    // occurrences exactes des mots dispersés. Sinon, rien à distinguer.
    exacte: Boolean(exacte),
    // Ce qu'on a cherché en plus de ce qui a été tapé : le lecteur doit le
    // savoir, et pouvoir le refuser en citant sa requête.
    elargissements,
    resultats: page.map(({ occurrences: _, molecule, denomination, ...reste }) => ({
      ...reste,
      denomination,
      // Deux spécialités sur treize mille six cents n'ont pas de composition
      // enregistrée : leur dénomination tient lieu de titre, faute de mieux.
      molecule: molecule || denomination,
      sansMolecule: !molecule,
    })),
    total: occurrences,
    // Le plafond est atteint : le décompte est un plancher, pas un total.
    borne: occurrences >= PLAFOND,
  };
}
