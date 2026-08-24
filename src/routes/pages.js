import { Router } from 'express';
import { config } from '../config.js';
import { wrap } from '../middleware.js';
import { parseQuery, parseFilter, isValidCis } from '../validate.js';
import { searchMedications } from '../search.js';
import {
  getProduct,
  getRelatedProducts,
  getVariantes,
  genericGroupLabel,
} from '../products.js';
import { getDocuments, withSections, DOCUMENT_TYPES } from '../documents.js';
import { getSections } from '../sections.js';
import { getDelivrance, getRemboursement } from '../delivrance.js';
import {
  chercherDansDocuments, extraitDeRubrique, rechercheAbsente,
  normaliserRubrique, APERCU, COLONNES, PAR_PAGE,
} from '../recherche-texte.js';
import { estImportation, referenceNationale } from '../imports.js';
import { productLinks } from '../links.js';
import {
  getClasseAtc,
  resumerClasse,
  getClassesPrincipales,
  getClasse,
  getProduitsDeClasse,
  getMoleculesDeClasse,
  FEUILLE,
} from '../atc.js';

export function pageRoutes(pool) {
  const router = Router();

  /**
   * Le rail est sur toutes les pages, il se charge donc une fois pour toutes.
   *
   * `getClassesPrincipales` garde son résultat en mémoire — quatorze lignes
   * qui ne changent qu'au rechargement mensuel de la BDPM. Un défaut de
   * classification ne doit rien empêcher : le rail rend alors le seul lien
   * d'accueil, et la page s'affiche comme avant qu'il existe.
   */
  router.use(
    wrap(async (req, res, next) => {
      res.locals.rail = await getClassesPrincipales(pool).catch((err) => {
        console.error('[rail] classes indisponibles :', err.message);
        return [];
      });
      next();
    }),
  );

  router.get(
    '/',
    wrap(async (req, res) => {
      // Une porte d'entrée quand on ne cherche pas un nom précis. Un défaut de
      // classification ne doit pas empêcher la page de recherche de s'afficher.
      const classes = await getClassesPrincipales(pool).catch((err) => {
        console.error('[atc] classes principales indisponibles :', err.message);
        return [];
      });

      res.render('search_page', {
        query: '', filter: 'all', results: null, classes, railActif: 'accueil',
      });
    }),
  );

  /**
   * Parcours par classe thérapeutique.
   *
   * Le code ATC est validé contre la base, pas contre une expression régulière :
   * c'est la seule façon de distinguer une classe réelle d'une chaîne bien
   * formée qui ne désigne rien.
   */
  router.get(
    '/classe/:code',
    wrap(async (req, res, next) => {
      const code = String(req.params.code ?? '').toUpperCase();
      if (!/^[A-Z][0-9A-Z]{0,6}$/.test(code)) return next();

      const classe = await getClasse(pool, code);
      if (!classe) return next();

      // Les spécialités n'apparaissent qu'à la feuille. Plus haut, elles
      // doublaient les sous-classes et devaient être tronquées : sur une classe
      // de six cents produits, on n'en voyait que le début de l'alphabet, ce
      // qui n'apprend rien et laisse croire que la classe s'arrête à B.
      const feuille = classe.level === FEUILLE || classe.enfants.length === 0;

      // Les molécules ne sont rendues que si les sous-classes ne les sont pas
      // déjà : sur « J05AF », les enfants directs *sont* les molécules, et la
      // seconde liste répéterait la première mot pour mot.
      const enfantsMolecules = classe.enfants[0]?.level === FEUILLE;

      const [{ produits, total }, molecules] = await Promise.all([
        feuille ? getProduitsDeClasse(pool, code) : { produits: [], total: null },
        feuille || enfantsMolecules ? [] : getMoleculesDeClasse(pool, code),
      ]);

      res.render('classe', {
        classe, produits, total, feuille, molecules, railActif: code[0],
      });
    }),
  );

  router.get(
    '/search',
    wrap(async (req, res) => {
      const query = parseQuery(req.query.q);
      const filter = parseFilter(req.query.filter);

      if (!query.raw) return res.redirect('/');

      if (query.tooShort) {
        return res.render('search_page', {
          query: query.raw,
          filter,
          results: null,
          notice: `Saisissez au moins ${config.search.minLength} caractères.`,
        });
      }

      // Les deux recherches partent ensemble : elles répondent à la même
      // question par deux chemins, et rien ne justifie d'attendre l'une pour
      // lancer l'autre. Un défaut sur les documents ne doit pas emporter la
      // recherche par nom, qui est la plus demandée.
      let panne = null;
      const [results, documents] = await Promise.all([
        searchMedications(pool, query, filter),
        chercherDansDocuments(pool, query.raw, { limite: APERCU }).catch((err) => {
          // Une fonctionnalité absente en silence est le pire des états : on
          // cherche pourquoi elle ne trouve rien, alors qu'elle n'est pas
          // installée. Le défaut ne casse pas la recherche par nom, mais il se
          // dit — et il se distingue d'une absence de résultats.
          console.error('[recherche] plein texte indisponible :', err.message);
          // La commande se dit ici aussi : c'est le premier des deux écrans
          // qu'on voit, et renvoyer à l'autre pour lire la consigne ferait
          // chercher deux fois la même réponse.
          panne = rechercheAbsente(err)
            ? 'La recherche dans les documents n’est pas encore installée sur cette base '
              + '— exécuter « npm run db:recherche ».'
            : 'La recherche dans les documents est momentanément indisponible.';
          return null;
        }),
      ]);

      res.render('search_page', {
        query: query.raw, filter, results, documents, panne, colonnes: COLONNES,
      });
    }),
  );

  /**
   * Recherche plein texte, vue complète.
   *
   * Elle existe séparément de `/search` parce qu'elle porte ses propres
   * filtres — par rubrique — et que les mêler à ceux de la recherche par nom
   * ferait une page qui pose deux questions. Ici, une seule : où cette
   * expression figure-t-elle dans les documents.
   */
  router.get(
    '/documents',
    wrap(async (req, res) => {
      const query = parseQuery(req.query.q);
      const rubrique = normaliserRubrique(req.query.rubrique);
      // Vingt extraits par page tiennent l'écran ; il y en a des milliers. Sans
      // suite, la page annonçait « plus de 3 000 rubriques » et n'en montrait
      // que vingt, sans dire où étaient les autres.
      const page = Math.max(1, Math.trunc(Number(req.query.page)) || 1);

      if (!query.raw) return res.redirect('/');

      let panne = null;
      const documents = query.tooShort
        ? { resultats: [], total: 0, borne: false, decalage: 0, suite: false }
        : await chercherDansDocuments(pool, query.raw, {
          rubrique, limite: PAR_PAGE, decalage: (page - 1) * PAR_PAGE,
        })
          .catch((err) => {
            console.error('[recherche] plein texte indisponible :', err.message);
            panne = rechercheAbsente(err)
              ? 'La recherche dans les documents n’est pas encore installée sur cette base '
                + '— exécuter « npm run db:recherche ».'
              : 'La recherche dans les documents est momentanément indisponible.';
            return { resultats: [], total: 0, borne: false, decalage: 0, suite: false };
          });

      res.render('documents', {
        query: query.raw,
        rubrique,
        documents,
        page,
        colonnes: COLONNES,
        parPage: PAR_PAGE,
        panne,
        notice: query.tooShort
          ? `Saisissez au moins ${config.search.minLength} caractères.`
          : null,
      });
    }),
  );

  /**
   * L'extrait d'une rubrique, pour l'aperçu au survol.
   *
   * Rendu à la demande et non avec la page : `ts_headline` coûte 21 ms pour
   * cinquante extraits et 168 ms pour deux cent cinquante. Calculer d'avance
   * l'aperçu de chaque rubrique de chaque ligne ferait passer la recherche de
   * 20 ms à 170 pour des aperçus dont presque aucun ne sera survolé.
   */
  router.get(
    '/extrait',
    wrap(async (req, res) => {
      const trouvaille = await extraitDeRubrique(pool, {
        cis: req.query.cis,
        type: req.query.type,
        position: req.query.position,
        requete: req.query.q,
      }).catch((err) => {
        console.error('[extrait] indisponible :', err.message);
        return null;
      });

      if (!trouvaille) return res.status(404).json({ erreur: 'introuvable' });
      // Un aperçu se recalcule à l'identique tant que le découpage ne bouge
      // pas : autant laisser le navigateur le garder le temps d'une lecture.
      res.set('Cache-Control', 'private, max-age=300');
      return res.json(trouvaille);
    }),
  );

  router.get(
    '/product/:id',
    wrap(async (req, res, next) => {
      const cis = req.params.id;
      if (!isValidCis(cis)) return next();

      const product = await getProduct(pool, cis);
      if (!product) return next();

      const [
        substitutions, variantes, bruts, decoupe, delivrance, remboursement, classeAtc,
      ] = await Promise.all([
        getRelatedProducts(pool, cis, product.active_ingredients),
        getVariantes(pool, cis).catch((err) => {
          // Le sélecteur de dosage est un confort : son absence ne doit pas
          // emporter la fiche.
          console.error('[variantes] indisponibles pour', cis, err.message);
          return [];
        }),
        getDocuments(pool, cis).catch((err) => {
          // Un défaut sur les documents ne doit pas masquer la fiche produit.
          console.error('[documents] indisponibles pour', cis, err.message);
          return [];
        }),
        getSections(pool, cis).catch((err) => {
          // Découpage indisponible : la fiche retombe sur le texte d'un bloc.
          console.error('[rubriques] indisponibles pour', cis, err.message);
          return new Map();
        }),
        getDelivrance(pool, cis).catch((err) => {
          // Une condition de délivrance absente vaut mieux qu'une condition
          // inventée : on rend un classement vide, le bloc le dira.
          console.error('[délivrance] indisponible pour', cis, err.message);
          return { resume: [], groupes: [], liens: [] };
        }),
        // Six cent soixante-douze spécialités seulement : l'absence est le cas
        // normal, et un défaut ne doit pas emporter la fiche.
        getRemboursement(pool, cis).catch((err) => {
          console.error('[remboursement] indisponible pour', cis, err.message);
          return null;
        }),
        // 36,5 % des spécialités n'ont pas de classe ATC : l'absence est le cas
        // normal, pas une panne.
        getClasseAtc(pool, cis).catch((err) => {
          console.error('[atc] classe indisponible pour', cis, err.message);
          return [];
        }),
      ]);

      const documents = withSections(bruts, decoupe);

      // Une importation parallèle n'a qu'une fiche info : ni RCP, ni notice.
      // Le texte à lire est celui de la spécialité française dont elle est la
      // copie — on l'emprunte plutôt que de laisser la fiche muette.
      const importation = estImportation(product.type_procedure_amm);
      let reference = null;

      if (importation && documents.every((doc) => doc.rubriques.length === 0)) {
        reference = await referenceNationale(pool, cis, product.denomination_medicament).catch(
          (err) => {
            console.error('[importation] référence introuvable pour', cis, err.message);
            return null;
          },
        );
      }

      if (reference) {
        const [refBruts, refDecoupe] = await Promise.all([
          getDocuments(pool, reference.id).catch(() => []),
          getSections(pool, reference.id).catch(() => new Map()),
        ]);

        documents.push(
          ...withSections(refBruts, refDecoupe)
            .filter((doc) => doc.rubriques.length > 0)
            .map((doc) => ({ ...doc, emprunte: reference })),
        );
      }

      // Ordre d'affichage : le document le plus substantiel en premier.
      documents.sort((a, b) => DOCUMENT_TYPES.indexOf(a.type) - DOCUMENT_TYPES.indexOf(b.type));
      const hasDocuments = documents.length > 0;

      // Plan de la page : ce qui existe réellement pour ce produit. Les
      // rubriques des documents s'y imbriquent — le rail est le seul sommaire.
      const sections = [
        // Avant les documents : « puis-je le délivrer » se règle en une ligne,
        // « que fait ce médicament » demande d'ouvrir un RCP.
        { id: 'delivrance', label: 'Délivrance' },
        hasDocuments && {
          id: 'documents',
          label: 'Documents',
          // Le document sert désormais les rubriques du comptoir en tête : les
          // répéter dans le rail ferait un troisième sommaire pour rien.
          children: [],
        },
        // Après les documents : on substitue une fois qu'on sait ce qu'on
        // substitue. Le rail suit l'ordre de la page, sans quoi le sommaire
        // annonce un plan que la lecture dément.
        substitutions.length > 0 && { id: 'substituer', label: 'Substituer' },
        { id: 'references', label: 'Références' },
      ].filter(Boolean);

      const resumeAtc = resumerClasse(classeAtc);

      res.render('product', {
        product,
        importation,
        reference,
        substitutions,
        variantes,
        remboursement,
        resumeAtc,
        // La branche à laquelle appartient le produit lu — le rail montre où
        // l'on se trouve dans la classification, pas seulement où aller.
        railActif: resumeAtc?.feuille?.code?.[0] ?? null,
        genericGroup: genericGroupLabel(substitutions),
        documents,
        hasDocuments,
        delivrance,
        // Meddispar ne recense que les spécialités à dispensation particulière :
        // le lien n'a de sens que si la BDPM enregistre au moins une condition.
        links: productLinks(product, {
          dispensationParticuliere: delivrance.groupes.length > 0,
        }),
        sections,
      });
    }),
  );

  return router;
}
