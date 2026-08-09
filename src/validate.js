import { config } from './config.js';

/** Un code CIS BDPM est un entier à 8 chiffres. */
export const CIS_PATTERN = /^\d{8}$/;

export function isValidCis(value) {
  return typeof value === 'string' && CIS_PATTERN.test(value);
}

/**
 * Express renvoie un tableau quand un paramètre est répété (?q=a&q=b).
 * Toujours normaliser avant tout appel de méthode de chaîne.
 */
export function firstString(value) {
  if (Array.isArray(value)) return firstString(value[0]);
  return typeof value === 'string' ? value : '';
}

/**
 * Normalise une requête de recherche en une liste de termes exploitables.
 * @returns {{ raw: string, normalized: string, terms: string[], tooShort: boolean }}
 */
export function parseQuery(value, { minLength = config.search.minLength, maxTerms = config.search.maxTerms } = {}) {
  const raw = firstString(value).slice(0, 120).trim();
  const normalized = raw.toLowerCase();
  const terms = normalized.split(/\s+/).filter(Boolean).slice(0, maxTerms);
  const meaningful = terms.join('');

  return {
    raw,
    normalized,
    terms,
    tooShort: meaningful.length < minLength,
  };
}

const FILTERS = new Set(['all', 'specialty', 'active']);

export function parseFilter(value) {
  const filter = firstString(value);
  return FILTERS.has(filter) ? filter : 'all';
}
