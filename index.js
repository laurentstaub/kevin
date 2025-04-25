import express from 'express';
import pg from 'pg';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { searchMedications } from './src/search.js';

const { Pool } = pg;
const app = express();
const PORT = 3000;

// Get directory name for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
        raison_sociale,
        adresse,
        code_postal,
        ville,
        departement,
        latitude,
        longitude,
        (point($2, $1) <-> point(longitude, latitude)) * 111.32 as distance_km
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
  console.log("Stock data:");
  console.log(getPharmacyStockData());
  
  try {
    const nearbyPharmacies = await getNearbyPharmacies(
      pool,
      parseFloat(lat),
      parseFloat(lng),
      parseFloat(radius) || 5
    );
    res.json(nearbyPharmacies);
  } catch (err) {
    console.error('Error fetching nearby pharmacies:', err);
    res.status(500).json({ 
      error: 'Une erreur est survenue lors de la recherche des pharmacies'
    });
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
  try {
    const stocksData = await fs.readFile(path.join(__dirname, 'data', 'stocks.json'), 'utf8');
    const { pharmacies } = JSON.parse(stocksData);
    return pharmacies.reduce((acc, p) => {
      acc[p.id] = p.stock;
      return acc;
    }, {});
  } catch (error) {
    console.error('Error reading stocks.json:', error);
    return {};
  }
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

