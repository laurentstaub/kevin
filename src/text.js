const LIGATURES = { œ: 'oe', Œ: 'OE', æ: 'ae', Æ: 'AE', ß: 'ss' };

/**
 * Retire les diacritiques et développe les ligatures, comme unaccent() de
 * PostgreSQL, pour que l'index trigramme serve.
 */
export function deaccent(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[œŒæÆß]/g, (ligature) => LIGATURES[ligature])
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .normalize('NFC');
}

/**
 * Échappe les jokers de LIKE (`%`, `_`, et `\` qui les échappe) : une saisie
 * « %%% » ne doit pas valoir « tout ».
 */
export function echapperLike(value) {
  return String(value ?? '').replace(/[\\%_]/g, '\\$&');
}

/** Tronque proprement sur une limite de mot. */
export function truncate(value, max = 160) {
  const texte = String(value ?? '');
  if (texte.length <= max) return texte;
  return `${texte.slice(0, texte.lastIndexOf(' ', max))}…`;
}
