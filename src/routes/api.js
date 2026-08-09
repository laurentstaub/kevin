import { Router } from 'express';
import { wrap } from '../middleware.js';
import { parseQuery, parseFilter, isValidCis } from '../validate.js';
import { searchMedications, suggest } from '../search.js';
import { getProduct, getRelatedProducts } from '../products.js';
import { getDocuments, groupByType, DOCUMENT_TYPES } from '../documents.js';
import { productLinks } from '../links.js';

export function apiRoutes(pool) {
  const router = Router();

  router.get(
    '/health',
    wrap(async (req, res) => {
      await pool.query('SELECT 1');
      res.json({ status: 'ok', uptime: Math.round(process.uptime()) });
    }),
  );

  /** Autocomplétion : requête bornée à quelques lignes, sans produits liés. */
  router.get(
    '/suggest',
    wrap(async (req, res) => {
      const query = parseQuery(req.query.q);
      if (query.tooShort) return res.json({ query: query.raw, suggestions: [] });

      const { produits } = await suggest(pool, query);
      // Une suggestion = un produit, dans l'ordre de pertinence rendu par la
      // recherche. `libelle` porte la racine de marque, précisée du titulaire
      // quand deux produits la partagent (les neuf GLUCOSE).
      const suggestions = produits.map((row) => ({
        id: row.id,
        name: row.libelle,
        substances: row.active_ingredients,
        type: row.match_type,
        holder: row.titulaires?.trim() || null,
        parallel: row.importation === true,
        variants: row.importations ?? 0,
        presentations: row.presentations ?? 1,
      }));

      res.json({ query: query.raw, suggestions });
    }),
  );

  router.get(
    '/search',
    wrap(async (req, res) => {
      const query = parseQuery(req.query.q);
      const filter = parseFilter(req.query.filter);
      if (query.tooShort) {
        return res.json({ query: query.raw, filter, results: null, total: 0 });
      }

      const results = await searchMedications(pool, query, filter);
      res.json({ query: query.raw, filter, results, total: results.total });
    }),
  );

  router.get(
    '/product/:id',
    wrap(async (req, res, next) => {
      const cis = req.params.id;
      if (!isValidCis(cis)) return next();

      const product = await getProduct(pool, cis);
      if (!product) return next();

      const related = await getRelatedProducts(pool, cis, product.active_ingredients);
      res.json({ product, related, links: productLinks(product) });
    }),
  );

  router.get(
    '/product/:id/documents',
    wrap(async (req, res, next) => {
      const cis = req.params.id;
      if (!isValidCis(cis)) return next();
      res.json(groupByType(await getDocuments(pool, cis)));
    }),
  );

  /**
   * Contenu d'un document. Le HTML est déjà assaini par la couche données ;
   * il est servi en JSON — jamais en text/html sur l'origine de l'application.
   */
  router.get(
    '/product/:id/documents/:type',
    wrap(async (req, res, next) => {
      const { id: cis, type } = req.params;
      if (!isValidCis(cis) || !DOCUMENT_TYPES.includes(type)) return next();

      const doc = (await getDocuments(pool, cis)).find((d) => d.type === type);
      if (!doc) return next();

      res.json({
        cis: doc.cis,
        type: doc.type,
        label: doc.label,
        html: doc.html,
        url: doc.url,
        lastUpdated: doc.lastUpdated,
      });
    }),
  );

  return router;
}
