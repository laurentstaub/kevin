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
import { getDelivrance } from '../delivrance.js';
import { estImportation, referenceNationale } from '../imports.js';
import { productLinks } from '../links.js';
import {
  getClasseAtc,
  resumerClasse,
  getClassesPrincipales,
  getClasse,
  getProduitsDeClasse,
  FEUILLE,
} from '../atc.js';

export function pageRoutes(pool) {
  const router = Router();

  router.get(
    '/',
    wrap(async (req, res) => {
      // Une porte d'entrée quand on ne cherche pas un nom précis. Un défaut de
      // classification ne doit pas empêcher la page de recherche de s'afficher.
      const classes = await getClassesPrincipales(pool).catch((err) => {
        console.error('[atc] classes principales indisponibles :', err.message);
        return [];
      });

      res.render('search_page', { query: '', filter: 'all', results: null, classes });
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
      const { produits, total } = feuille
        ? await getProduitsDeClasse(pool, code)
        : { produits: [], total: null };

      res.render('classe', { classe, produits, total, feuille });
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

      const results = await searchMedications(pool, query, filter);
      res.render('search_page', { query: query.raw, filter, results });
    }),
  );

  router.get(
    '/product/:id',
    wrap(async (req, res, next) => {
      const cis = req.params.id;
      if (!isValidCis(cis)) return next();

      const product = await getProduct(pool, cis);
      if (!product) return next();

      const [substitutions, variantes, bruts, decoupe, delivrance, classeAtc] = await Promise.all([
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

      res.render('product', {
        product,
        importation,
        reference,
        substitutions,
        variantes,
        resumeAtc: resumerClasse(classeAtc),
        genericGroup: genericGroupLabel(substitutions),
        documents,
        hasDocuments,
        delivrance,
        links: productLinks(product),
        sections,
      });
    }),
  );

  return router;
}
