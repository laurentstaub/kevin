import express from 'express';
import pg from 'pg';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { searchMedications } from './src/search.js';
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
    let results = [];
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
        results: []
      });
    }
  }
});

// Function to get nearby pharmacies
const getNearbyPharmacies = async (pool, lat, lng, radiusKm) => {
  const result = await pool.query(`
    WITH selected_pharmacy AS (
      SELECT 
        id,
        raison_sociale,
        adresse,
        code_postal,
        ville,
        departement,
        latitude,
        longitude,
        0 as distance_km
      FROM officines.etablissements
      WHERE latitude = $1 AND longitude = $2
    ),
    nearby_pharmacies AS (
      SELECT 
        id,
        raison_sociale,
        adresse,
        code_postal,
        ville,
        departement,
        latitude,
        longitude,
        ROUND(CAST((point($2, $1) <-> point(longitude, latitude)) * 111.32 AS NUMERIC), 1) as distance_km
      FROM officines.etablissements
      WHERE (latitude != $1 OR longitude != $2)
        AND point($2, $1) <-> point(longitude, latitude) <= ($3 / 111.32)
    )
    SELECT *
    FROM (
      SELECT * FROM selected_pharmacy
      UNION ALL
      SELECT * FROM nearby_pharmacies
    ) combined
    ORDER BY distance_km;
  `, [lat, lng, radiusKm]);
  
  return result.rows;
};

// Product details endpoint
app.get('/product/:id', async (req, res) => {
  const { id } = req.params;
  const radius = parseFloat(req.query.radius) || 5; // Default 5km radius
  const selectedLat = req.query.lat ? parseFloat(req.query.lat) : null;
  const selectedLng = req.query.lng ? parseFloat(req.query.lng) : null;
  
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

    // Get all pharmacies for initial list
    const allPharmaciesResult = await pool.query(`
      SELECT DISTINCT 
        id,
        raison_sociale,
        adresse,
        code_postal,
        ville,
        departement,
        latitude,
        longitude
      FROM officines.etablissements
      WHERE raison_sociale IS NOT NULL
        AND latitude IS NOT NULL 
        AND longitude IS NOT NULL
      ORDER BY raison_sociale
    `);

    // Get nearby pharmacies if coordinates are provided
    let nearbyPharmacies = [];
    if (selectedLat && selectedLng) {
      nearbyPharmacies = await getNearbyPharmacies(pool, selectedLat, selectedLng, radius);
    }

    res.render('product', { 
      product: productResult.rows[0],
      pharmacies: allPharmaciesResult.rows,
      nearbyPharmacies,
      selectedRadius: radius
    });
  } catch (err) {
    console.error('Error fetching product:', err);
    res.status(500).render('search_page', { 
      error: 'Une erreur est survenue lors de la récupération du médicament'
    });
  }
});

// Add endpoint to get nearby pharmacies
app.get('/api/nearby-pharmacies', async (req, res) => {
  const { lat, lng, radius } = req.query;
  
  try {
    const pharmacies = await getNearbyPharmacies(pool, lat, lng, radius);
    
    // 2. Get stock data
    const stockData = await getPharmacyStockData();
    console.log('Stock data from file:', stockData);
    
    // 3. Merge pharmacy data with stock data
    const pharmaciesWithStock = pharmacies.map(pharmacy => {
      // Convert pharmacy.id to number since it might be a string from the database
      const pharmacyId = parseInt(pharmacy.id);
      console.log('Looking for stock data for pharmacy:', pharmacyId);
      return {
        ...pharmacy,
        stock: stockData[pharmacyId] || {}
      };
    });
    
    console.log('Pharmacies with stock:', pharmaciesWithStock);
    res.json(pharmaciesWithStock);
  } catch (error) {
    console.error('Error fetching nearby pharmacies:', error);
    res.status(500).json({ error: 'Internal server error' });
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

// Function to get pharmacy stock data
async function getPharmacyStockData() {
  console.log('getPharmacyStockData called');
  try {
    console.log('Reading file from:', path.join(__dirname, 'data', 'stocks.json'));
    const stocksData = await fs.readFile(path.join(__dirname, 'data', 'stocks.json'), 'utf8');
    console.log('Raw file contents:', stocksData);
    const { pharmacies } = JSON.parse(stocksData);
    console.log('Parsed pharmacies:', pharmacies);
    const result = pharmacies.reduce((acc, p) => {
      acc[p.id] = p.stock;
      return acc;
    }, {});
    console.log('Final processed stock data:', result);
    return result;
  } catch (error) {
    console.error('Error reading stocks.json:', error);
    console.error('Stack trace:', error.stack);
    return {};
  }
}

app.get('/test', (req, res) => {
  console.log('Test endpoint called');
  res.json({ message: 'Test successful' });
});

// Message API endpoints
app.post('/api/messages', async (req, res) => {
  try {
    const { pharmacyId, productId, messageText, isSent } = req.body;
    const conversationId = `${pharmacyId}_${productId}`;
    
    // Start a transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // Ensure conversation exists
      await client.query(`
        INSERT INTO chat.conversations (id, pharmacy_id, product_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (id) DO UPDATE
        SET updated_at = CURRENT_TIMESTAMP
        RETURNING id
      `, [conversationId, pharmacyId, productId]);
      
      // Insert message
      const result = await client.query(`
        INSERT INTO chat.messages (conversation_id, pharmacy_id, product_id, message_text, is_sent)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, created_at
      `, [conversationId, pharmacyId, productId, messageText, isSent]);
      
      // Update unread count if message is received
      if (!isSent) {
        await client.query(`
          UPDATE chat.conversations
          SET unread_count = unread_count + 1
          WHERE id = $1
        `, [conversationId]);
      }
      
      await client.query('COMMIT');
      res.json(result.rows[0]);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error saving message:', error);
    res.status(500).json({ error: 'Failed to save message' });
  }
});

app.get('/api/conversations/:pharmacyId/:productId', async (req, res) => {
  try {
    const { pharmacyId, productId } = req.params;
    const conversationId = `${pharmacyId}_${productId}`;
    
    const result = await pool.query(`
      SELECT m.*, c.unread_count
      FROM chat.messages m
      LEFT JOIN chat.conversations c ON c.id = m.conversation_id
      WHERE m.conversation_id = $1
      ORDER BY m.created_at DESC
      LIMIT 50
    `, [conversationId]);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

app.put('/api/conversations/:conversationId/read', async (req, res) => {
  try {
    const { conversationId } = req.params;
    
    await pool.query(`
      UPDATE chat.conversations
      SET unread_count = 0
      WHERE id = $1
    `, [conversationId]);
    
    await pool.query(`
      UPDATE chat.messages
      SET status = 'read'
      WHERE conversation_id = $1 AND NOT is_sent
    `, [conversationId]);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error marking conversation as read:', error);
    res.status(500).json({ error: 'Failed to update conversation' });
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

