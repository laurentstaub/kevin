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
 * l'ancre posée par le découpeur y conduit directement.
 *
 * **Les reprises littérales se comptent au lieu de se répéter.** Une molécule
 * a trente génériques dont les RCP sont souvent identiques au mot près :
 * trente lignes pour la même phrase noieraient les autres résultats. On groupe
 * sur l'empreinte du texte — c'est licite parce que la reprise est littérale,
 * pas approchée — et l'on dit combien de spécialités la partagent.
 *
 * **On borne, et on le dit.** Classer par pertinence suppose d'avoir évalué
 * chaque occurrence : sur un mot courant comme « traitement », c'est cent
 * mille rubriques pour un résultat que personne ne lira. La recherche s'arrête
 * donc à PLAFOND occurrences et l'annonce, plutôt que de faire attendre pour
 * un chiffre faux.
 */

/** La configuration de recherche est posée par sql/recherche.sql. */
const LANGUE = 'french_nu';

/**
 * Au-delà, la question est mal posée et le classement n'a plus de sens.
 * Les recherches utiles — « hypocarnitinémie », « anomalie de Pelger-Huët » —
 * rendent quelques centaines d'occurrences.
 */
export const PLAFOND = 3000;

/** Ce qu'on rend d'un coup ; le reste s'obtient en affinant. */
export const PAR_PAGE = 20;

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
const TSQUERY = `websearch_to_tsquery('${LANGUE}', $1)`;
const VECTEUR = `to_tsvector('${LANGUE}', s.texte)`;

/**
 * L'index de recherche n'est pas en place sur cette base.
 *
 * `sql/recherche.sql` n'a pas été exécuté : la configuration `french_nu`
 * n'existe pas, et Postgres le dit par un `undefined_object`. La distinction
 * compte, parce que les deux situations demandent des choses opposées — dans
 * un cas il faut lancer une commande, dans l'autre attendre ou lire les
 * journaux. Une panne annoncée « momentanée » alors qu'elle est définitive
 * fait attendre pour rien.
 */
export function manqueIndex(err) {
  // 42704 undefined_object, 42883 undefined_function
  return err?.code === '42704' || err?.code === '42883'
    || /french_nu|websearch_to_tsquery/i.test(err?.message ?? '');
}

/**
 * Rubriques dont le texte répond à la requête.
 *
 * @param {import('pg').Pool} pool
 * @param {string} requete - saisie brute
 * @param {{ rubrique?: string, limite?: number }} [options]
 * @returns {Promise<{ resultats: object[], total: number, borne: boolean }>}
 */
export async function chercherDansDocuments(pool, requete, options = {}) {
  const vide = { resultats: [], total: 0, borne: false };
  const q = String(requete ?? '').trim();
  if (!q) return vide;

  const rubrique = normaliserRubrique(options.rubrique);
  const limite = Math.min(Math.max(1, options.limite ?? PAR_PAGE), 100);

  const { rows } = await pool.query(
    `WITH q AS (SELECT ${TSQUERY} AS tq),
     trouve AS (
       SELECT s.code_cis, s.document_type, s.position, s.numero, s.libelle,
              s.texte, md5(s.texte) AS empreinte,
              ts_rank_cd(${VECTEUR}, q.tq) AS score
       FROM docs.rcp_sections s, q
       WHERE ${VECTEUR} @@ q.tq
         AND ($2::text IS NULL OR s.numero = $2 OR s.numero LIKE $2 || '.%')
       LIMIT ${PLAFOND}
     ),
     -- Une empreinte = une formulation. On garde la mieux classée et l'on
     -- compte les spécialités qui la reprennent mot pour mot.
     groupe AS (
       SELECT DISTINCT ON (empreinte)
              empreinte, code_cis, document_type, position, numero, libelle,
              texte, score,
              count(*) OVER (PARTITION BY empreinte)::int AS specialites
       FROM trouve
       ORDER BY empreinte, score DESC, code_cis
     )
     SELECT g.code_cis, g.document_type, g.position, g.numero, g.libelle,
            g.specialites, g.score,
            m.denomination_medicament AS denomination,
            -- L'extrait ne se calcule que sur ce qu'on rend : c'est de loin la
            -- fonction la plus coûteuse de la requête.
            ts_headline('${LANGUE}', g.texte, q.tq,
              'MaxWords=38, MinWords=18, MaxFragments=1, StartSel=<mark>, StopSel=</mark>'
            ) AS extrait,
            (SELECT count(*)::int FROM trouve) AS occurrences
     FROM groupe g
     JOIN dbpm.cis_bdpm m ON m.code_cis = g.code_cis, q
     ORDER BY g.score DESC, g.specialites DESC, g.code_cis
     LIMIT $3`,
    [q, rubrique, limite],
  );

  const occurrences = rows[0]?.occurrences ?? 0;

  return {
    resultats: rows.map(({ occurrences: _, ...r }) => ({
      ...r,
      // L'ancre est celle que le découpeur a posée : type et position.
      ancre: `${r.document_type}-${r.position}`,
    })),
    total: occurrences,
    // Le plafond est atteint : le décompte est un plancher, pas un total.
    borne: occurrences >= PLAFOND,
  };
}
