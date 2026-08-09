const LIGATURES = { œ: 'oe', Œ: 'OE', æ: 'ae', Æ: 'AE', ß: 'ss' };

/**
 * Retire les diacritiques et développe les ligatures, en miroir de la fonction
 * unaccent() de PostgreSQL. Les termes envoyés en base sont donc déjà normalisés,
 * ce qui laisse l'index trigramme faire son travail.
 */
export function deaccent(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[œŒæÆß]/g, (c) => LIGATURES[c])
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .normalize('NFC');
}

/** Tronque proprement sur une limite de mot. */
export function truncate(value, max = 160) {
  const s = String(value ?? '');
  if (s.length <= max) return s;
  return `${s.slice(0, s.lastIndexOf(' ', max))}…`;
}
