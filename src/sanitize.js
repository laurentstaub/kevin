import sanitizeHtml from 'sanitize-html';
import { config } from './config.js';

/** Contenu scrapé, hostile par défaut : liste blanche stricte (ni script, ni style, ni événement, ni iframe). */
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
  // « //ailleurs.fr/x » est une adresse absolue, pas un chemin de la BDPM.
  allowProtocolRelative: false,
  transformTags: { a: transformerLien },
  disallowedTagsMode: 'discard',
  // « title » : la balise de la page scrapée, sinon son texte ouvrirait le document.
  nonTextTags: ['script', 'style', 'textarea', 'noscript', 'iframe', 'object', 'embed', 'title'],
};

/**
 * Résout un lien relatif du document contre le site BDPM (sinon : 404 chez nous).
 *
 * @returns {string|null} l'adresse résolue, ou null si le lien n'est pas légitime
 *   (le texte est alors conservé sans lien).
 */
export function resoudreLien(href) {
  const valeur = String(href ?? '').trim();
  if (!valeur) return null;

  // Ancre interne : reste dans la page.
  if (valeur.startsWith('#')) return valeur;

  // Déjà absolu : filtré ensuite par allowedSchemes.
  if (/^[a-z][a-z0-9+.-]*:/i.test(valeur)) return valeur;

  // « //hôte/… » : adresse absolue déguisée.
  if (valeur.startsWith('//')) return null;

  try {
    return new URL(valeur, config.documentBaseUrl).toString();
  } catch {
    return null;
  }
}

/** Résout le lien et l'ouvre dans un nouvel onglet, sauf ancre interne. */
function transformerLien(tagName, attribs) {
  const href = resoudreLien(attribs.href);

  // Lien mort : rendu sans href, puis déballé par ANCRE_SANS_LIEN.
  if (!href) return { tagName: 'a', attribs: {} };

  if (href.startsWith('#')) return { tagName: 'a', attribs: { ...attribs, href } };

  return {
    tagName: 'a',
    attribs: {
      ...attribs,
      href,
      rel: 'noopener noreferrer nofollow',
      target: '_blank',
    },
  };
}

/**
 * Ancres sans href (restes de « <a name> ») : stylées comme des liens et
 * gênantes pour le découpage. Seul le texte est gardé. Les ancres ne s'imbriquent pas.
 */
const ANCRE_SANS_LIEN = /<a\b(?![^>]*\shref=)[^>]*>([\s\S]*?)<\/a>/gi;

export function sanitizeDocument(html) {
  if (!html) return '';
  return sanitizeHtml(String(html), OPTIONS).replace(ANCRE_SANS_LIEN, '$1');
}

/**
 * Lien sortant tiré d'une donnée (BDPM, fichier de référence) : absolu, en
 * http ou https, sinon null. Écarte `javascript:` et `data:` avant le href.
 *
 * @returns {string|null}
 */
export function lienWeb(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value).trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * Valide une URL de document officiel avant redirection. Les file_path relatifs
 * sont résolus contre DOCUMENT_BASE_URL, puis filtrés par la liste blanche d'hôtes.
 *
 * @returns {string|null} l'URL si elle est sûre, sinon null
 */
export function safeDocumentUrl(value) {
  if (!value) return null;

  // Seul un chemin « /… » est résolu ; le reste doit être une URL absolue valide.
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
