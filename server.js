import { config } from './src/config.js';
import { createPool, checkDatabase, ensurePrerequisites } from './src/db.js';
import { createApp } from './src/app.js';

const pool = createPool();

const report = await checkDatabase(pool);

if (!report.reachable) {
  console.error(`[db] injoignable : ${report.error}`);
  console.error('[db] vérifiez DATABASE_URL ou PGUSER/PGHOST/PGDATABASE dans .env');
  process.exit(1);
}

const missing = ['cis_bdpm', 'cis_compo_bdpm', 'cis_cip_bdpm'].filter(
  (t) => !report.tables.includes(t),
);
if (missing.length > 0) {
  console.error(`[db] tables BDPM manquantes dans le schéma dbpm : ${missing.join(', ')}`);
  process.exit(1);
}

// Sans f_unaccent, aucune recherche ne fonctionne : on la crée, ou on s'arrête.
if (!report.fUnaccent) {
  const created = await ensurePrerequisites(pool);
  if (created.ok) {
    console.log('[db] fonction f_unaccent créée');
  } else {
    console.error(`[db] impossible de créer f_unaccent : ${created.error}`);
    console.error("[db] l'extension unaccent demande des droits superutilisateur.");
    console.error('[db] faites exécuter une fois : npm run db:setup');
    await pool.end();
    process.exit(1);
  }
}

if (report.trigramIndexes === 0) {
  console.warn('[db] index trigrammes absents : les recherches font un scan complet.');
  console.warn('[db] pour les créer : npm run db:setup');
}

const server = createApp(pool).listen(config.port, () => {
  console.log(`bdpm • http://localhost:${config.port} (${config.env})`);
});

// Arrêt propre : on cesse d'accepter, on laisse finir, on ferme le pool.
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (closing) return process.exit(1);
    closing = true;
    console.log(`\n${signal} — arrêt en cours…`);
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
    // Les connexions keep-alive inactives ne doivent pas retenir l'arrêt.
    server.closeIdleConnections?.();
    setTimeout(() => {
      console.error('arrêt forcé après 10 s');
      process.exit(1);
    }, 10_000).unref();
  });
}
