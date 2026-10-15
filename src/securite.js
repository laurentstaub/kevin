/**
 * Informations de sécurité de l'ANSM rattachées à une spécialité
 * (`dbpm.cis_infos_importantes`, fichier BDPM CIS_InfoImportantes). La source
 * livre un lien HTML tout fait : seuls l'intitulé et l'adresse en sont lus, et
 * l'adresse doit pointer vers un domaine autorisé, sinon l'intitulé sort sans lien.
 * La période est celle de l'affichage sur la BDPM : passée, l'information reste
 * vraie, elle est seulement dite « archivée ».
 */
import { config } from './config.js';
import { dateFr } from './has.js';

/** Au-delà, les plus anciennes sont comptées, pas listées. */
export const INFOS_MAX = 5;

const HREF = /href\s*=\s*(['"])(.*?)\1/i;
const INTITULE = />([^<]+)<\/a>/i;

/** Entités nommées présentes dans la source. */
const ENTITES = { '&ecirc;': 'ê', '&eacute;': 'é', '&egrave;': 'è', '&agrave;': 'à', '&amp;': '&', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };
const entites = (texte) => texte.replace(/&[a-z#0-9]+;/gi, (entite) => ENTITES[entite.toLowerCase()] ?? entite);

/** Adresse https vers un domaine autorisé, ou null. */
function adresseSure(brute) {
  try {
    const url = new URL(entites(brute));
    const hote = url.hostname.replace(/^www\./, '');
    const permis = config.documentHosts.some((domaine) => hote === domaine || hote.endsWith(`.${domaine}`));
    return permis && (url.protocol === 'https:' || url.protocol === 'http:') ? url.href.replace(/^http:/, 'https:') : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} html  texte_securite brut
 * @returns {{ intitule: string, url: string|null }|null}
 */
export function lireInfo(html) {
  if (!html) return null;
  const intitule = INTITULE.exec(html)?.[1] ?? html.replace(/<[^>]*>/g, '');
  const propre = entites(intitule).replace(/\s+/g, ' ').trim();
  if (!propre) return null;
  const href = HREF.exec(html)?.[2];
  return { intitule: propre, url: href ? adresseSure(href) : null };
}

/**
 * Informations d'une spécialité, la plus récente d'abord.
 * @returns {Promise<{ infos: object[], total: number }>}
 */
export async function getInfosSecurite(pool, cis, maintenant = new Date()) {
  const { rows } = await pool.query(
    `SELECT date_debut_securite AS debut, date_fin_securite AS fin, texte_securite AS html
       FROM dbpm.cis_infos_importantes
      WHERE code_cis = $1
      ORDER BY date_debut_securite DESC NULLS LAST, id DESC`,
    [cis],
  );
  const infos = rows
    .map((row) => {
      const info = lireInfo(row.html);
      if (!info) return null;
      return { ...info, debut: row.debut, date: dateFr(row.debut), enCours: !row.fin || row.fin >= maintenant };
    })
    .filter(Boolean);
  return { infos: infos.slice(0, INFOS_MAX), total: infos.length };
}
