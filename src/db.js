import pg from 'pg';
import { config } from './config.js';

const { Pool } = pg;

export function createPool(overrides = {}) {
  const { connectionString, statementTimeoutMs, ...rest } = config.db;
  const base = connectionString ? { connectionString } : rest;

  const pool = new Pool({
    ...base,
    max: config.db.max,
    statement_timeout: statementTimeoutMs,
    ...overrides,
  });

  // Une erreur sur un client inactif ne doit jamais tuer le processus.
  pool.on('error', (err) => console.error('[db] client inactif en erreur:', err.message));

  return pool;
}

/**
 * Vérifie que la base est joignable et que les prérequis SQL sont en place.
 * Ne jette pas : renvoie un rapport, le serveur décide quoi en faire.
 */
export async function checkDatabase(pool) {
  const report = { reachable: false, fUnaccent: false, trigramIndexes: 0, tables: [] };

  try {
    await pool.query('SELECT 1');
    report.reachable = true;
  } catch (err) {
    report.error = err.message;
    return report;
  }

  const { rows: fn } = await pool.query(
    `SELECT 1 FROM pg_proc WHERE proname = 'f_unaccent' LIMIT 1`,
  );
  report.fUnaccent = fn.length > 0;

  const { rows: idx } = await pool.query(
    `SELECT count(*)::int AS n FROM pg_indexes
     WHERE schemaname = 'dbpm' AND indexname LIKE '%trgm%'`,
  );
  report.trigramIndexes = idx[0].n;

  const { rows: tables } = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'dbpm' ORDER BY table_name`,
  );
  report.tables = tables.map((r) => r.table_name);

  return report;
}

/**
 * Crée les prérequis dont dépend *toute* recherche : extension unaccent et
 * wrapper f_unaccent. C'est instantané et idempotent, donc le serveur s'en
 * charge lui-même — sans eux, aucune requête ne fonctionne, et un simple
 * avertissement au démarrage ne suffit pas à l'éviter.
 *
 * Les index trigrammes restent à `npm run db:setup` : leur construction est
 * longue et n'a pas sa place dans un démarrage.
 *
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function ensurePrerequisites(pool) {
  try {
    await pool.query(`
      CREATE EXTENSION IF NOT EXISTS unaccent;
      CREATE OR REPLACE FUNCTION public.f_unaccent(text)
        RETURNS text
        LANGUAGE sql
        IMMUTABLE PARALLEL SAFE STRICT
      AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;
    `);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
