import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from '../src/config.js';
import { createPool } from '../src/db.js';

const pool = createPool({ statement_timeout: 0 });
const sql = await readFile(path.join(ROOT, 'sql', 'setup.sql'), 'utf8');

console.log('Application de sql/setup.sql…');

try {
  await pool.query(sql);
  console.log('✓ extensions, fonction f_unaccent et index en place');
} catch (err) {
  console.error('✗ échec :', err.message);
  if (err.message.includes('permission denied')) {
    console.error('  CREATE EXTENSION demande des droits superutilisateur.');
    console.error('  Faites-le exécuter une fois par un administrateur de la base.');
  }
  process.exitCode = 1;
} finally {
  await pool.end();
}
