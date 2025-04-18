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
  const wantsJson = req.headers.accept && req.headers.accept.includes('application/json');
  
  try {
    let results = [];
    if (query) {
      results = await searchMedications(pool, query);
    }
    
    if (wantsJson) {
      res.json({ results, query });
    } else {
      res.render('search', { results, query });
    }
  } catch (err) {
    console.error('Error executing query', err);
    
    if (wantsJson) {
      res.status(500).json({ 
        error: 'Une erreur est survenue lors de la recherche'
      });
    } else {
      res.render('search', { 
        error: 'Une erreur est survenue lors de la recherche',
        query,
        results: []
      });
    }
  }
});

// Product details endpoint
app.get('/product/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    const result = await pool.query(`
      SELECT 
        m.code_cis as id,
        m.denomination_medicament,
        p.libelle_presentation
      FROM dbpm.cis_bdpm m
      LEFT JOIN dbpm.cis_cip_bdpm p ON m.code_cis = p.code_cis
      WHERE m.code_cis = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).render('search', { 
        error: 'Médicament non trouvé'
      });
    }

    res.render('product', { product: result.rows[0] });
  } catch (err) {
    console.error('Error fetching product:', err);
    res.status(500).render('search', { 
      error: 'Une erreur est survenue lors de la récupération du médicament'
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

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

