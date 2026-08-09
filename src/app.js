import express from 'express';
import path from 'node:path';
import { readdirSync, statSync } from 'node:fs';
import { ROOT } from './config.js';
import { securityHeaders, cors, notFound, errorHandler } from './middleware.js';
import { pageRoutes } from './routes/pages.js';
import { apiRoutes } from './routes/api.js';

/**
 * Empreinte des fichiers servis : la date du plus récent, en base 36.
 *
 * Les feuilles et scripts sont mis en cache une heure par le navigateur, qui
 * ne revient donc pas les demander. Sans marque de version dans l'URL, une
 * modification de mise en page reste invisible jusqu'à l'expiration — on croit
 * à un défaut de CSS alors que c'est une feuille périmée.
 */
function empreinteAssets(racine) {
  let recent = 0;

  const parcourir = (dossier) => {
    for (const entree of readdirSync(dossier, { withFileTypes: true })) {
      const chemin = path.join(dossier, entree.name);
      if (entree.isDirectory()) parcourir(chemin);
      else recent = Math.max(recent, statSync(chemin).mtimeMs);
    }
  };

  try {
    parcourir(racine);
  } catch {
    return 'dev';
  }

  return Math.round(recent).toString(36);
}

export function createApp(pool) {
  const app = express();

  app.disable('x-powered-by');
  app.set('view engine', 'pug');
  app.set('views', path.join(ROOT, 'views'));

  app.use(securityHeaders);
  app.use(cors);
  app.use(express.json({ limit: '64kb' }));
  const publics = path.join(ROOT, 'public');
  app.locals.v = empreinteAssets(publics);
  app.use(express.static(publics, { maxAge: '1h' }));

  app.use('/api', apiRoutes(pool));
  app.use('/', pageRoutes(pool));

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
