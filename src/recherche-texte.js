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
 * La signature est l'ensemble trié des `code_substance` actifs, et non la
 * dénomination : grouper sur le nom rend 3 655 groupes au lieu de 3 352, soit
 * 8 % de groupes qui ne sont séparés que par un sel, un hydrate ou une
 * variante d'écriture. Les `FT` — fractions thérapeutiques — sont écartées,
 * sans quoi une spécialité compterait sa substance deux fois. Une association
 * fait son propre groupe : paracétamol + codéine n'est pas du paracétamol.
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
 * @param {{ rubrique?: string, limite?: number, decalage?: number }} [options]
 * @returns {Promise<{ resultats: object[], total: number, borne: boolean,
 *                     decalage: number, suite: boolean }>}
 */
export async function chercherDansDocuments(pool, requete, options = {}) {
  const vide = { resultats: [], total: 0, borne: false, decalage: 0, suite: false };
  const q = String(requete ?? '').trim();
  if (!q) return vide;

  const rubrique = normaliserRubrique(options.rubrique);
  // `Math.min` et `Math.max` propagent NaN sans broncher : borner ne suffit
  // pas, il faut d'abord constater qu'on a un nombre. Sans ce garde-fou, une
  // page « ?page=douze » envoyait NaN dans le OFFSET et Postgres refusait la
  // requête entière — une saisie d'URL faisait tomber la recherche.
  const entier = (valeur, defaut) => {
    const n = Math.trunc(Number(valeur));
    return Number.isFinite(n) ? n : defaut;
  };

  const limite = Math.min(Math.max(1, entier(options.limite ?? PAR_PAGE, PAR_PAGE)), 100);
  // Au-delà du plafond il n'y a plus rien à sauter : la page suivante serait
  // vide, et une page vide au milieu d'un jeu de résultats se lit comme une
  // panne. Le décalage est borné là où la recherche s'arrête.
  const decalage = Math.min(Math.max(0, entier(options.decalage ?? 0, 0)), PLAFOND);

  const { rows } = await pool.query(
    `WITH q AS (SELECT ${TSQUERY} AS tq),
     trouve AS (
       SELECT s.code_cis, s.document_type, s.position, s.numero, s.libelle,
              s.texte, ts_rank_cd(${VECTEUR}, q.tq) AS score
       FROM docs.rcp_sections s, q
       WHERE ${VECTEUR} @@ q.tq
         AND ($2::text IS NULL OR s.numero = $2 OR s.numero LIKE $2 || '.%')
       LIMIT ${PLAFOND}
     ),
     -- La signature moléculaire : l'ensemble trié des codes substance actifs.
     -- Les spécialités sans composition — deux sur treize mille six cents —
     -- retombent sur leur propre CIS plutôt que de se fondre dans un groupe
     -- vide commun, qui les réunirait sans qu'elles aient rien en partage.
     molecule AS (
       SELECT t.code_cis,
              coalesce(
                (SELECT string_agg(DISTINCT c.code_substance, '+' ORDER BY c.code_substance)
                 FROM dbpm.cis_compo_bdpm c
                 WHERE c.code_cis = t.code_cis AND c.nature_composant = 'SA'),
                'cis:' || t.code_cis) AS signature
       FROM (SELECT DISTINCT code_cis FROM trouve) t
     ),
     enrichi AS (SELECT t.*, m.signature FROM trouve t JOIN molecule m USING (code_cis)),
     -- Une entrée par rubrique et par molécule, portée par sa meilleure
     -- occurrence : le numéro affiché doit mener quelque part de précis.
     par_rubrique AS (
       SELECT DISTINCT ON (signature, numero)
              signature, numero, libelle, code_cis, document_type, position, score
       FROM enrichi
       WHERE coalesce(numero, '') <> ''
       ORDER BY signature, numero, score DESC, code_cis
     ),
     chapeau AS (
       SELECT signature,
              jsonb_agg(jsonb_build_object(
                'numero', numero, 'libelle', libelle, 'cis', code_cis,
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
                ORDER BY substring(numero from '^[0-9]+')::int NULLS LAST,
                         substring(numero from '[.]([0-9]+)')::int NULLS FIRST,
                         numero) AS rubriques
       FROM par_rubrique GROUP BY signature
     ),
     meilleur AS (
       SELECT DISTINCT ON (signature)
              signature, code_cis, document_type, position, numero, libelle, texte, score
       FROM enrichi ORDER BY signature, score DESC, code_cis
     ),
     resume AS (
       SELECT signature, count(DISTINCT code_cis)::int AS specialites, max(score) AS score
       FROM enrichi GROUP BY signature
     ),
     -- Les substances en jeu, pour ne nommer que celles-là.
     substances AS (
       SELECT DISTINCT c.code_substance
       FROM dbpm.cis_compo_bdpm c
       WHERE c.code_cis IN (SELECT code_cis FROM molecule)
         AND c.nature_composant = 'SA'
     ),
     -- Le nom lisible d'une substance : le plus court de ceux que la base lui
     -- donne. « QUIZARTINIB » plutôt que « DICHLORHYDRATE DE QUIZARTINIB » —
     -- un pharmacien nomme le principe actif, pas son sel.
     --
     -- Préférer systématiquement la fraction thérapeutique se retourne : sur
     -- les 723 codes qui en portent une, 25 l'ont plus longue que le sel —
     -- « CYCLOPHOSPHAMIDE » deviendrait « CYCLOPHOSPHAMIDE ANHYDRE », et
     -- « CHLORHYDRATE DE LIDOCAÏNE » gagnerait le même suffixe. Et 99 codes
     -- ont plusieurs fractions concurrentes, « METFORMINE » contre
     -- « METFORMINE BASE ». Le plus court tranche les deux d'un coup.
     --
     -- Les candidats se ramassent sur toute la table et non sur la spécialité
     -- affichée : PROGRAF et PROTOPIC ne déclarent pas la fraction que
     -- déclarent leurs vingt confrères du tacrolimus, si bien que le groupe
     -- changerait de nom selon le représentant que le classement désigne.
     --
     -- C'est aussi pourquoi la signature reste le sel : sur 13 599 spécialités,
     -- pivoter sur la fraction rend 3 218 groupes au lieu de 3 352, mais scinde
     -- le tacrolimus en deux. Les 20 % de lignes qui portent une fraction ne
     -- sont pas réparties par molécule, elles le sont par déclarant.
     noms AS (
       SELECT DISTINCT ON (code_substance) code_substance, nom
       FROM (
         SELECT sa.code_substance, sa.denomination_substance AS nom
         FROM dbpm.cis_compo_bdpm sa
         WHERE sa.nature_composant = 'SA'
           AND sa.code_substance IN (SELECT code_substance FROM substances)
         UNION
         SELECT sa.code_substance, ft.denomination_substance
         FROM dbpm.cis_compo_bdpm sa
         JOIN dbpm.cis_compo_bdpm ft
           ON ft.code_cis = sa.code_cis
          AND ft.numero_liaison_saft = sa.numero_liaison_saft
          AND ft.nature_composant = 'FT'
         WHERE sa.nature_composant = 'SA'
           AND sa.code_substance IN (SELECT code_substance FROM substances)
       ) candidats
       WHERE coalesce(nom, '') <> ''
       ORDER BY code_substance, length(nom), nom
     )
     SELECT r.signature, r.specialites, coalesce(c.rubriques, '[]'::jsonb) AS rubriques,
            b.code_cis, b.numero, b.libelle,
            b.document_type || '-' || b.position AS ancre,
            m.denomination_medicament AS denomination,
            (SELECT string_agg(DISTINCT n.nom, ', ' ORDER BY n.nom)
             FROM dbpm.cis_compo_bdpm x
             JOIN noms n ON n.code_substance = x.code_substance
             WHERE x.code_cis = b.code_cis AND x.nature_composant = 'SA') AS molecule,
            -- L'extrait ne se calcule que sur ce qu'on rend : c'est de loin la
            -- fonction la plus coûteuse de la requête.
            ts_headline('${LANGUE}', b.texte, q.tq,
              'MaxWords=38, MinWords=18, MaxFragments=1, StartSel=<mark>, StopSel=</mark>'
            ) AS extrait,
            (SELECT count(*)::int FROM trouve) AS occurrences
     FROM resume r
     JOIN meilleur b USING (signature)
     LEFT JOIN chapeau c USING (signature)
     JOIN dbpm.cis_bdpm m ON m.code_cis = b.code_cis, q
     ORDER BY r.score DESC, r.specialites DESC, b.code_cis
     LIMIT $3 OFFSET $4`,
    // Une ligne de plus que demandé : c'est ainsi qu'on sait s'il existe une
    // page suivante sans compter les molécules distinctes, ce que la requête
    // ne fait nulle part — `occurrences` compte les rubriques avant
    // regroupement, et servirait de plancher trompeur.
    [q, rubrique, limite + 1, decalage],
  );

  const occurrences = rows[0]?.occurrences ?? 0;
  const suite = rows.length > limite;
  const page = suite ? rows.slice(0, limite) : rows;

  return {
    decalage,
    suite,
    resultats: page.map(({ occurrences: _, molecule, denomination, ...r }) => ({
      ...r,
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
