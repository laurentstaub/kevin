/**
 * Plan d'exécution de la recherche dans les documents, sans délai.
 *
 *   node scripts/expliquer-recherche.js allaitement > _to_delete/plan.txt
 *
 * Le pool est espionné : la requête part en EXPLAIN (ANALYZE, BUFFERS)
 * et le plan s'imprime, nœud par nœud, avec le temps de chacun.
 */
import { createPool } from '../src/db.js';
import { chercherDansDocuments } from '../src/recherche-texte.js';

const saisie = process.argv[2] ?? 'allaitement';
const molecule = process.argv[3] || undefined;
const pool = createPool({ statement_timeout: 0 });

const espion = {
  async query(sql, params) {
    const depart = Date.now();
    const { rows } = await pool.query(`EXPLAIN (ANALYZE, BUFFERS) ${sql}`, params);
    console.log(`-- « ${saisie} »${molecule ? ` + ${molecule}` : ''} : ${Date.now() - depart} ms`);
    for (const ligne of rows) console.log(ligne['QUERY PLAN']);
    return { rows: [] };
  },
};

await chercherDansDocuments(espion, saisie, { limite: 8, molecule, phrases: Boolean(molecule) });
await pool.end();
