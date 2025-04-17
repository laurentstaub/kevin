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
  res.render('search');
});

// Search endpoint
app.get('/search', async (req, res) => {
  const query = req.query.q;
  
  if (!query) {
    return res.render('search', { results: [] });
  }

  try {
    const results = await searchMedications(pool, query);
    res.render('search', { 
      results: results,
      query: query
    });
  } catch (err) {
    console.error('Error executing query', err);
    res.render('search', { 
      error: 'Une erreur est survenue lors de la recherche',
      query: query
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

