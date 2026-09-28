const LIGATURES = { œ: 'oe', Œ: 'OE', æ: 'ae', Æ: 'AE', ß: 'ss' };

/**
 * Retire les diacritiques et développe les ligatures, en miroir de la fonction
 * unaccent() de PostgreSQL. Les termes envoyés en base sont donc déjà normalisés,
 * ce qui laisse l'index trigramme faire son travail.
 */
export function deaccent(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[œŒæÆß]/g, (ligature) => LIGATURES[ligature])
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .normalize('NFC');
}

/** Tronque proprement sur une limite de mot. */
export function truncate(value, max = 160) {
  const texte = String(value ?? '');
  if (texte.length <= max) return texte;
  return `${texte.slice(0, texte.lastIndexOf(' ', max))}…`;
}
