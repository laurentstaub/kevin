/**
 * Applique un fichier de sql/ sans le `statement_timeout` de 5 s du pool (un index GIN prend des minutes).
 *   npm run db:sections     schéma docs
 *   npm run db:recherche    configuration de langue et index plein texte
 * Relaie les `NOTICE` : sql/recherche.sql y indique si la recherche ignore les accents.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from '../src/config.js';
import { createPool } from '../src/db.js';

const fichier = process.argv[2];

if (!fichier) {
  console.error('Usage : node scripts/db-migrer.js <fichier.sql>');
  process.exit(1);
}

const chemin = path.join(ROOT, 'sql', fichier);
const sql = await readFile(chemin, 'utf8');

const pool = createPool({ statement_timeout: 0 });
const client = await pool.connect();

client.on('notice', (avis) => console.log(`  ${avis.message}`));

console.log(`Application de sql/${fichier}…`);
const depart = Date.now();

try {
  await client.query(sql);
  console.log(`✓ terminé en ${Math.round((Date.now() - depart) / 1000)} s`);
} catch (err) {
  console.error(`✗ échec : ${err.message}`);
  if (err.code === '57014') {
    console.error("  Délai dépassé — le pool a-t-il bien été créé avec statement_timeout: 0 ?");
  }
  if (/permission denied|must be owner/i.test(err.message)) {
    console.error('  Droits insuffisants : à faire exécuter une fois par un administrateur.');
  }
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
