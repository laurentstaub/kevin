import sanitizeHtml from 'sanitize-html';
import { config } from './config.js';

/**
 * Les RCP et notices proviennent d'un scraping ANSM : contenu externe, donc
 * hostile par défaut. On applique une liste blanche stricte — aucun script,
 * aucun style, aucun attribut d'événement, aucune iframe.
 */
const OPTIONS = {
  allowedTags: [
    'p', 'br', 'hr', 'div', 'span',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li', 'dl', 'dt', 'dd',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
    'strong', 'b', 'em', 'i', 'u', 'sub', 'sup', 'small', 'blockquote', 'a',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'rel', 'target'],
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan', 'scope'],
    '*': ['lang'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  // Tout lien externe s'ouvre isolé de la page appelante.
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer nofollow', target: '_blank' }),
  },
  disallowedTagsMode: 'discard',
  // « title » est là parce que le scraping conserve la balise de la page :
  // sans cela son texte se retrouverait en tête du document.
  nonTextTags: ['script', 'style', 'textarea', 'noscript', 'iframe', 'object', 'embed', 'title'],
};

export function sanitizeDocument(html) {
  if (!html) return '';
  return sanitizeHtml(String(html), OPTIONS);
}

/**
 * Valide une URL de document officiel avant toute redirection.
 *
 * Les file_path stockés par la BDPM sont relatifs au site source
 * (« /documents/61512595/rcp_notice.pdf ») : servis tels quels, ils pointent
 * sur notre propre origine et donnent un 404. Ils sont donc résolus contre
 * DOCUMENT_BASE_URL, puis soumis à la même liste blanche que les URL absolues
 * — ce qui bloque au passage les URL protocol-relative.
 *
 * @returns {string|null} l'URL si elle est sûre, sinon null
 */
export function safeDocumentUrl(value) {
  if (!value) return null;

  // Un chemin — et un seul — se résout contre la base du site source. Tout le
  // reste doit être une URL absolue en bonne et due forme : sans cette
  // distinction, n'importe quelle valeur douteuse deviendrait une URL
  // plausible sur un domaine autorisé.
  const relatif = value.startsWith('/') && !value.startsWith('//');

  let url;
  try {
    url = relatif ? new URL(value, config.documentBaseUrl) : new URL(value);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

  const host = url.hostname.toLowerCase();
  const allowed = config.documentHosts.some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );

  return allowed ? url.toString() : null;
}
