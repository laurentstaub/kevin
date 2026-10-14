/**
 * Saisie d'un code de présentation : CIP 13, CIP 7, ou chaîne GS1 du
 * Datamatrix que la douchette tape dans le champ comme un clavier.
 * Le GTIN d'un médicament français est le CIP 13 précédé d'un zéro
 * (`(01)03400934071485…`) ; lot et péremption qui suivent sont ignorés.
 */

/** Séparateur de groupe GS1 (FNC1), parfois émis tel quel par la douchette. */
const GS = '\u001d';

/**
 * @param {string} saisie
 * @returns {{ type: 'cip13'|'cip7', code: string }|null} null si la saisie n'est pas un code
 */
export function lireCode(saisie) {
  if (typeof saisie !== 'string') return null;
  // Préfixe d'identification de symbologie (« ]d2 ») et séparateurs retirés.
  const brut = saisie.trim().replace(/^\][a-z]\d/i, '').replaceAll(GS, '');
  const compact = brut.replace(/[\s().-]/g, '');

  // GS1 : identifiant d'application 01, GTIN-14 dont le CIP 13 est la fin.
  const gs1 = /^01(03400\d{9})/.exec(compact);
  if (gs1) return { type: 'cip13', code: gs1[1].slice(1) };
  if (/^03400\d{9}$/.test(compact)) return { type: 'cip13', code: compact.slice(1) };
  if (/^3400\d{9}$/.test(compact)) return { type: 'cip13', code: compact };
  if (/^\d{7}$/.test(compact)) return { type: 'cip7', code: compact };
  return null;
}

/** Spécialité d'une présentation ; null si le code n'existe pas dans la BDPM. */
export async function trouverParCode(pool, { type, code }) {
  const colonne = type === 'cip7' ? 'code_cip7' : 'code_cip13';
  const { rows } = await pool.query(
    `SELECT code_cis FROM dbpm.cis_cip_bdpm WHERE ${colonne} = $1 LIMIT 1`,
    [code],
  );
  return rows[0]?.code_cis ?? null;
}
