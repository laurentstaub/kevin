import { config } from './config.js';

/**
 * En-têtes de sécurité. Volontairement écrits à la main : cinq en-têtes, une CSP,
 * aucune dépendance, et la politique reste lisible d'un coup d'œil.
 */
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
 * CORS restreint à une liste d'origines déclarées.
 * Par défaut : aucune origine tierce, l'application ne sert que son propre front.
 */
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
  return res.status(status).render('error', { status, message });
}
