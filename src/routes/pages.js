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
import { getSections, raccourcis } from '../sections.js';
import { estImportation, referenceNationale } from '../imports.js';
import { productLinks } from '../links.js';

export function pageRoutes(pool) {
  const router = Router();

  router.get('/', (req, res) => {
    res.render('search_page', { query: '', filter: 'all', results: null });
  });

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

      const [substitutions, variantes, bruts, decoupe] = await Promise.all([
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
        product.cip_products?.length > 0 && { id: 'presentations', label: 'Présentations' },
        hasDocuments && {
          id: 'documents',
          label: 'Documents',
          children: documents.flatMap((doc) => {
            const plan = raccourcis(doc);
            return plan.length > 0
              ? [{ id: doc.anchor, titre: 'Au comptoir', sections: plan }]
              : [];
          }),
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
        genericGroup: genericGroupLabel(substitutions),
        documents,
        hasDocuments,
        links: productLinks(product),
        sections,
      });
    }),
  );

  return router;
}
