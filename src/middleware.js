import { gzipSync } from 'node:zlib';
import { config } from './config.js';

/** En-têtes de sécurité, écrits à la main pour rester lisibles et sans dépendance. */
const CSP = [
  "default-src 'self'",
  // Font Awesome et Google Fonts sont chargés par les vues.
  "style-src 'self' 'unsafe-inline' https://site-assets.fontawesome.com",
  "font-src 'self' https://site-assets.fontawesome.com data:",
  // Aucun script inline dans les vues : la politique peut rester stricte.
  "script-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
].join('; ');

export function securityHeaders(req, res, next) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
  next();
}

/**
 * En production, derrière le routeur Heroku (qui termine le TLS et le dit dans
 * X-Forwarded-Proto) : HTTP redirigé vers HTTPS, puis HSTS. PUBLIC_URL posée,
 * l'adresse de secours (dr-kevin.herokuapp.com) y est redirigée aussi : une
 * seule adresse pour les moteurs et les favoris.
 */
export function https(req, res, next) {
  if (config.env !== 'production') return next();
  const protocole = req.get('x-forwarded-proto')?.split(',')[0].trim();
  const hote = req.get('host');
  const publique = config.publicUrl ? new URL(config.publicUrl) : null;
  if (protocole === 'http' || (publique && hote !== publique.host)) {
    return res.redirect(301, `${publique?.origin ?? `https://${hote}`}${req.originalUrl}`);
  }
  res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  next();
}

/** Types compressés : pages, données, XML ; pas les images. */
const COMPRESSIBLE = /^(?:text\/|application\/(?:json|xml|[a-z+.-]*\+xml))/;

/**
 * Pages compressées en gzip : le routeur Heroku ne compresse pas, et une fiche
 * pèse 100 à 600 Ko de HTML (une recherche dans les documents, jusqu'à 1 Mo).
 * Seules les réponses de res.send (gabarits, JSON, XML) passent ici ; les
 * fichiers statiques, empreintés et mis en cache, partent tels quels.
 */
export function compresser(req, res, next) {
  const envoyer = res.send.bind(res);
  res.send = (corps) => {
    const texte = typeof corps === 'string' || Buffer.isBuffer(corps);
    // res.send fixe text/html pour une chaîne sans type : le dire avant d'envoyer des octets.
    if (typeof corps === 'string' && !res.get('Content-Type')) res.type('html');
    if (texte && corps.length >= 1024 && !res.get('Content-Encoding')
      && COMPRESSIBLE.test(res.get('Content-Type') ?? '') && /\bgzip\b/.test(req.get('accept-encoding') ?? '')) {
      res.vary('Accept-Encoding');
      res.set('Content-Encoding', 'gzip');
      return envoyer(gzipSync(corps));
    }
    return envoyer(corps);
  };
  next();
}

/** CORS restreint aux origines déclarées ; par défaut, aucune origine tierce. */
export function cors(req, res, next) {
  const origin = req.headers.origin;
  if (origin && config.corsOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Accept, Content-Type');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
}

/** Enveloppe un handler async pour que toute erreur parte dans next(). */
export const wrap = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

const wantsJson = (req) =>
  req.path.startsWith('/api/') || (req.headers.accept ?? '').includes('application/json');

export function notFound(req, res) {
  if (wantsJson(req)) return res.status(404).json({ error: 'Ressource introuvable' });
  return res.status(404).render('error', {
    // Une page d'erreur n'a pas d'adresse canonique et n'entre pas dans l'index.
    canonique: null, noindex: true,
    status: 404,
    message: 'Cette page n’existe pas.',
  });
}

// eslint-disable-next-line no-unused-vars -- Express identifie le handler d'erreur à ses 4 arguments
export function errorHandler(err, req, res, next) {
  const status = err.status ?? 500;
  if (status >= 500) console.error('[erreur]', req.method, req.originalUrl, err);

  if (res.headersSent) return;

  const message =
    status >= 500 ? 'Une erreur est survenue.' : err.message || 'Requête invalide.';

  if (wantsJson(req)) return res.status(status).json({ error: message });
  return res.status(status).render('error', { canonique: null, noindex: true, status, message });
}
