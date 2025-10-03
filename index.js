import express from 'express';
import pg from 'pg';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { searchMedications } from './src/search.js';
import Document from './models/Document.js';
import fs from 'fs/promises';

const { Pool } = pg;
const app = express();
const PORT = 3000;

// Get directory name for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize database schema
async function initializeDatabase() {
  try {
    const schemaSQL = await fs.readFile(path.join(__dirname, 'data', 'schema.sql'), 'utf8');
    const client = await pool.connect();
    try {
      await client.query(schemaSQL);
      console.log('Database schema initialized successfully');
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error initializing database schema:', error);
  }
}

app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, 'public')));

app.set('view engine', 'pug');
app.set('views', path.join(__dirname, 'views'));

const pool = new Pool({
  user: 'laurentstaub4',
  host: 'localhost',
  database: 'incidents_json',
  port: 5432,
});

// Serve the search page as the default route
app.get('/', (req, res) => {
  res.render('search_page');
});

// Search endpoint
app.get('/search', async (req, res) => {
  const query = req.query.q;
  const filter = req.query.filter || 'all';
  const wantsJson = req.headers.accept && req.headers.accept.includes('application/json');

  try {
    let results = { brandMatches: [], activeIngredientMatches: [], relatedProducts: [] };
    if (query) {
      results = await searchMedications(pool, query, filter);
    }

    if (wantsJson) {
      res.json({ results, query });
    } else {
      res.render('search_page', { results, query, filter });
    }
  } catch (err) {
    console.error('Error executing query', err);

    if (wantsJson) {
      res.status(500).json({
        error: 'Une erreur est survenue lors de la recherche'
      });
    } else {
      res.render('search_page', {
        error: 'Une erreur est survenue lors de la recherche',
        query,
        filter,
        results: { brandMatches: [], activeIngredientMatches: [], relatedProducts: [] }
      });
    }
  }
});


// Product details endpoint
app.get('/product/:id', async (req, res) => {
  const { id } = req.params;

  try {
    // Get product details
    const productResult = await pool.query(`
      WITH product_info AS (
        SELECT
          m.code_cis as id,
          m.denomination_medicament,
          m.forme_pharmaceutique,
          m.titulaires,
          string_agg(DISTINCT c.denomination_substance, ', ' ORDER BY c.denomination_substance) as active_ingredients
        FROM dbpm.cis_bdpm m
        LEFT JOIN dbpm.cis_compo_bdpm c ON m.code_cis = c.code_cis
        WHERE m.code_cis = $1
        GROUP BY m.code_cis, m.denomination_medicament, m.forme_pharmaceutique, m.titulaires
      ),
      cip_info AS (
        SELECT
          json_agg(json_build_object(
            'code_cip7', code_cip7,
            'code_cip13', code_cip13,
            'libelle_presentation', libelle_presentation
          ) ORDER BY libelle_presentation) as cip_products
        FROM dbpm.cis_cip_bdpm
        WHERE code_cis = $1
      ),
      incidents_info AS (
        SELECT
          json_agg(
            json_build_object(
              'status', status,
              'start_date', start_date,
              'end_date', end_date,
              'original_specialite', original_specialite
            ) ORDER BY start_date DESC
          ) FILTER (WHERE status IS NOT NULL) as incidents
        FROM incidents i
        JOIN produits p ON i.product_id = p.id
        WHERE p.cis_codes @> jsonb_build_array(($1)::numeric)
      )
      SELECT
        p.*,
        c.cip_products,
        i.incidents
      FROM product_info p
      CROSS JOIN cip_info c
      CROSS JOIN incidents_info i
    `, [id]);

    if (productResult.rows.length === 0) {
      return res.status(404).render('search_page', {
        error: 'Médicament non trouvé'
      });
    }

    const product = productResult.rows[0];

    // Get related products with generics and same active ingredients
    let relatedProducts = [];
    const relatedProductsMap = new Map();

    // Method 1: Find generics using cis_gener_bdpm table
    const genericResult = await pool.query(`
      SELECT DISTINCT
        m.code_cis as id,
        m.denomination_medicament,
        string_agg(DISTINCT c.denomination_substance, ', ' ORDER BY c.denomination_substance) as active_ingredients,
        'generic' as match_type,
        cg.type_generique,
        cg.libelle_groupe_generique
      FROM dbpm.cis_gener_bdpm cg1
      JOIN dbpm.cis_gener_bdpm cg2 ON cg1.identifiant_groupe_generique = cg2.identifiant_groupe_generique
      JOIN dbpm.cis_bdpm m ON cg2.code_cis = m.code_cis
      LEFT JOIN dbpm.cis_compo_bdpm c ON m.code_cis = c.code_cis
      LEFT JOIN dbpm.cis_gener_bdpm cg ON m.code_cis = cg.code_cis
      WHERE cg1.code_cis = $1
        AND m.code_cis != $1
      GROUP BY m.code_cis, m.denomination_medicament, cg.type_generique, cg.libelle_groupe_generique
      ORDER BY cg.type_generique, m.denomination_medicament
    `, [id]);

    genericResult.rows.forEach(row => {
      relatedProductsMap.set(row.id, row);
    });

    // Method 2: Find products with same active ingredients (if no generics found or to supplement)
    if (product.active_ingredients) {
      const activeIngredientsArray = product.active_ingredients.split(', ').map(ingredient => ingredient.trim());

      if (activeIngredientsArray.length > 0) {
        const existingIds = [id, ...Array.from(relatedProductsMap.keys())];
        const excludePlaceholders = existingIds.map((_, i) => `$${activeIngredientsArray.length + i + 1}`).join(', ');
        const ingredientPlaceholders = activeIngredientsArray.map((_, i) => `unaccent(LOWER(c.denomination_substance)) LIKE unaccent($${i + 1})`).join(' OR ');
        const ingredientParams = activeIngredientsArray.map(ingredient => `%${ingredient}%`);

        const relatedResult = await pool.query(`
          SELECT DISTINCT
            m.code_cis as id,
            m.denomination_medicament,
            string_agg(DISTINCT c.denomination_substance, ', ' ORDER BY c.denomination_substance) as active_ingredients,
            'related' as match_type,
            NULL as type_generique,
            NULL as libelle_groupe_generique
          FROM dbpm.cis_bdpm m
          JOIN dbpm.cis_compo_bdpm c ON m.code_cis = c.code_cis
          WHERE (${ingredientPlaceholders})
            AND m.code_cis NOT IN (${excludePlaceholders})
          GROUP BY m.code_cis, m.denomination_medicament
          ORDER BY m.denomination_medicament
          LIMIT 15
        `, [...ingredientParams, ...existingIds]);

        relatedResult.rows.forEach(row => {
          relatedProductsMap.set(row.id, row);
        });
      }
    }

    // Convert to array and sort (generics first, then by name)
    relatedProducts = Array.from(relatedProductsMap.values())
      .sort((a, b) => {
        if (a.match_type === 'generic' && b.match_type !== 'generic') return -1;
        if (a.match_type !== 'generic' && b.match_type === 'generic') return 1;
        if (a.match_type === 'generic' && b.match_type === 'generic') {
          // Sort generics by type_generique (0 = princeps, 1 = generic)
          if (a.type_generique !== b.type_generique) return a.type_generique - b.type_generique;
        }
        return a.denomination_medicament.localeCompare(b.denomination_medicament);
      });

    // Get documents for the product
    let documents = { rcp: [], notice: [], main: [] };
    try {
      const productDocuments = await Document.getDocumentsByProductId(pool, id);
      documents = Document.organizeDocumentsByType(productDocuments);
    } catch (error) {
      console.error('Error fetching documents:', error);
      // Continue without documents if there's an error
    }

    res.render('product', {
      product: product,
      relatedProducts: relatedProducts,
      documents: documents
    });
  } catch (err) {
    console.error('Error fetching product:', err);
    res.status(500).render('search_page', {
      error: 'Une erreur est survenue lors de la récupération du médicament'
    });
  }
});

// API route to serve documents
app.get('/api/document/:cisCode/:type', async (req, res) => {
  const { cisCode, type } = req.params;

  try {
    const documents = await Document.getDocumentsByProductId(pool, cisCode);
    const document = documents.find(doc => doc.document_type === type);

    if (!document) {
      return res.status(404).json({ error: 'Document non trouvé' });
    }

    // If we have a file_path, redirect to it
    if (document.file_path) {
      return res.redirect(document.file_path);
    }

    // If we have html_content, serve it as HTML
    if (document.html_content) {
      res.set('Content-Type', 'text/html; charset=utf-8');
      return res.send(document.html_content);
    }

    // No content available
    return res.status(404).json({ error: 'Document non trouvé' });

  } catch (error) {
    console.error('Error serving document:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// API route to get documents for a product
app.get('/api/product/:id/documents', async (req, res) => {
  const { id } = req.params;
  
  try {
    const documents = await Document.getDocumentsByProductId(pool, id);
    const organizedDocs = Document.organizeDocumentsByType(documents);
    res.json(organizedDocs);
  } catch (error) {
    console.error('Error fetching documents:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des documents' });
  }
});

app.get('/api/data', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM dbpm.cis_bdpm');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start server after initializing database
async function startServer() {
  await initializeDatabase();
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log('Test log - if you see this, logging works');
  });
}

startServer();

