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
  // « //ailleurs.fr/x » n'est pas un chemin : c'est une adresse absolue qui
  // emprunte notre protocole. Sans ce verrou, `resoudreLien` la prendrait
  // pour un chemin de la BDPM et la laisserait passer.
  allowProtocolRelative: false,
  transformTags: { a: transformerLien },
  disallowedTagsMode: 'discard',
  // « title » est là parce que le scraping conserve la balise de la page :
  // sans cela son texte se retrouverait en tête du document.
  nonTextTags: ['script', 'style', 'textarea', 'noscript', 'iframe', 'object', 'embed', 'title'],
};

/**
 * Résout le lien d'un document contre le site dont il provient.
 *
 * Les fiches de la BDPM renvoient les unes aux autres par des chemins relatifs
 * — « ?searchGroupeGenerique=… », « /medicament/… ». Servis tels quels depuis
 * notre origine, ils désignent des pages qui n'existent pas chez nous : le
 * lecteur cliquait sur un groupe générique et tombait sur notre 404. C'est le
 * même défaut que celui déjà corrigé pour les `file_path` des PDF, à un autre
 * endroit du même document.
 *
 * @returns {string|null} l'adresse résolue, ou null si le lien ne mène nulle
 *   part de légitime — auquel cas on garde le texte et on jette le lien.
 */
export function resoudreLien(href) {
  const valeur = String(href ?? '').trim();
  if (!valeur) return null;

  // Une ancre reste dans la page : c'est le seul cas où « relatif » ne veut
  // pas dire « chez la BDPM ».
  if (valeur.startsWith('#')) return valeur;

  // Déjà absolu : la liste des schémas s'en charge après nous.
  if (/^[a-z][a-z0-9+.-]*:/i.test(valeur)) return valeur;

  // Reste un chemin — sauf « //hôte/… », qui est une adresse absolue déguisée.
  if (valeur.startsWith('//')) return null;

  try {
    return new URL(valeur, config.documentBaseUrl).toString();
  } catch {
    return null;
  }
}

/**
 * Un lien de document : résolu, et ouvert à part s'il sort de la page.
 *
 * Une ancre interne garde son comportement : lui coller `target="_blank"`
 * ouvrirait un onglet pour descendre de trois paragraphes.
 */
function transformerLien(tagName, attribs) {
  const href = resoudreLien(attribs.href);

  // Lien mort — ancre de rubrique « <a name=…> », chemin illisible, adresse
  // absolue déguisée. On le rend sans href : le déballage qui suit s'en
  // charge, comme il le fait déjà des ancres du document source. Une seule
  // règle pour « ceci n'est pas un lien », au lieu de deux qui se croisent.
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
 * Ancres sans href.
 *
 * Le document source balise ses rubriques avec des « <a name="…"> », et
 * l'ancre enveloppe parfois le texte entier de la ligne. « name » n'étant pas
 * dans la liste blanche, il n'en reste qu'une coquille : un élément qui n'est
 * pas un lien, mais que la feuille de style peint comme tel, et qui interdit
 * de découper la ligne qu'il enveloppe. On garde le texte, on jette la
 * coquille. Les ancres ne s'imbriquent pas : une paire suffit à les décrire.
 */
const ANCRE_SANS_LIEN = /<a\b(?![^>]*\shref=)[^>]*>([\s\S]*?)<\/a>/gi;

export function sanitizeDocument(html) {
  if (!html) return '';
  return sanitizeHtml(String(html), OPTIONS).replace(ANCRE_SANS_LIEN, '$1');
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
