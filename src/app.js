import express from 'express';
import path from 'node:path';
import { readdirSync, statSync } from 'node:fs';
import { ROOT, config } from './config.js';
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
  const production = config.env === 'production';

  if (production) {
    app.locals.v = empreinteAssets(publics);
  } else {
    // En développement, l'empreinte se recalcule à chaque rendu.
    //
    // Calculée une seule fois au démarrage, elle ne bougeait pas quand on
    // modifiait une feuille pendant que le serveur tournait : l'URL restait la
    // même, le navigateur gardait sa copie une heure, et la correction semblait
    // sans effet — on la refaisait, on la cherchait ailleurs, alors qu'elle
    // était déjà en place. C'est précisément ce que l'empreinte devait éviter.
    //
    // Le parcours ne coûte rien : une dizaine de fichiers. Et `node --watch` ne
    // redémarre pas sur du CSS, qui n'est jamais importé par le serveur.
    app.use((req, res, next) => {
      res.locals.v = empreinteAssets(publics);
      next();
    });
  }

  // Pas de cache en développement : l'empreinte suffit en production, mais elle
  // ne protège de rien si le navigateur ne revient pas demander le fichier.
  app.use(express.static(publics, { maxAge: production ? '1h' : 0 }));

  app.use('/api', apiRoutes(pool));
  app.use('/', pageRoutes(pool));

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
