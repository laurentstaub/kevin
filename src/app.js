import express from 'express';
import path from 'node:path';
import { readdirSync, statSync } from 'node:fs';
import { ROOT, config } from './config.js';
import { lien } from './etat-recherche.js';
import { dci, specialite, phrase } from './casse.js';
import { CONCEPTS_DOCUMENT_JSON } from './concepts-document.js';
import { securityHeaders, cors, notFound, errorHandler } from './middleware.js';
import { pageRoutes } from './routes/pages.js';
import { apiRoutes } from './routes/api.js';

/**
 * Empreinte des fichiers servis (date du plus récent, en base 36), ajoutée aux
 * URL pour contourner le cache navigateur d'une heure après une modification.
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

  // Aide de gabarit posée globalement pour qu'aucune route ne puisse l'omettre.
  app.locals.lien = lien;
  // Casse d'affichage des noms BDPM : DCI en bas de casse, spécialité en nom propre.
  Object.assign(app.locals, { dci, specialite, phrase });
  // Mots du comptoir et expressions des RCP, pour le filtre du document.
  app.locals.conceptsDocument = CONCEPTS_DOCUMENT_JSON;

  // Pas de cache en développement, sinon le navigateur ne redemande pas le fichier.
  app.use(express.static(publics, { maxAge: production ? '1h' : 0 }));

  if (production) {
    app.locals.v = empreinteAssets(publics);
  } else {
    // En développement, recalcul à chaque rendu : `node --watch` ne redémarre
    // pas sur du CSS. Après les fichiers statiques : seules les pages paient le
    // parcours, pas chaque feuille de style ou script qu'elles demandent.
    app.use((req, res, next) => {
      res.locals.v = empreinteAssets(publics);
      next();
    });
  }

  app.use('/api', apiRoutes(pool));
  app.use('/', pageRoutes(pool));

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
