/**
 * Référencement : titre, description et adresse canonique de chaque page,
 * robots.txt et sitemap. La description est faite des valeurs déjà affichées
 * (la bande de la fiche) : ce qu'un moteur montre est ce que la page dit.
 */
import { config } from './config.js';

export const MARQUE = 'Médipile';

/** Origine publique : PUBLIC_URL, sinon celle de la requête (derrière Heroku, X-Forwarded-Proto). */
export function origine(req) {
  if (config.publicUrl) return config.publicUrl;
  const protocole = req.get('x-forwarded-proto')?.split(',')[0].trim() || req.protocol;
  return `${protocole}://${req.get('host')}`;
}

/** Une ligne, coupée au mot sous `max` caractères. */
export function resumer(texte, max = 160) {
  const ligne = String(texte ?? '').replace(/\s+/g, ' ').trim();
  if (ligne.length <= max) return ligne;
  const coupe = ligne.slice(0, max - 1);
  return `${coupe.slice(0, coupe.lastIndexOf(' ') > max / 2 ? coupe.lastIndexOf(' ') : coupe.length).replace(/[\s,;:·.–-]+$/, '')}…`;
}

/**
 * Fiche d'une spécialité : le nom, puis ce que la bande dit (liste, prise en
 * charge, générique, forme, contre-indication…).
 * @param {{ nom: string, substances?: string|null, titulaire?: string|null, valeurs?: string[] }} fiche
 */
export function metaProduit({ nom, substances = null, titulaire = null, valeurs = [] }) {
  const qui = [substances, titulaire].filter(Boolean).join(', ');
  return {
    title: `${nom} · RCP, notice, délivrance · ${MARQUE}`,
    description: resumer(`${nom}${qui ? ` (${qui})` : ''}. ${valeurs.filter(Boolean).join(' · ')}. RCP et notice cités par rubrique.`),
  };
}

/**
 * Classe ATC ; à la feuille, une molécule et ses spécialités.
 * @param {{ code: string, libelle: string, molecule: boolean, specialites?: number }} classe
 */
export function metaClasse({ code, libelle, molecule, specialites = 0 }) {
  const nombre = specialites > 0 ? `${specialites} spécialité${specialites > 1 ? 's' : ''} commercialisée${specialites > 1 ? 's' : ''}` : null;
  return molecule
    ? {
      title: `${libelle} (${code}) · spécialités, RCP, grossesse · ${MARQUE}`,
      description: resumer(`${libelle}, classe ATC ${code}${nombre ? ` : ${nombre}` : ''}. Pour chacune, RCP et notice cités par rubrique, conditions de délivrance, alternatives.`),
    }
    : {
      title: `${libelle} (${code}) · classe ATC · ${MARQUE}`,
      description: resumer(`Classe ATC ${code}, ${libelle} : sous-classes et molécules, spécialités de la BDPM.`),
    };
}

export const DESCRIPTION_ACCUEIL = 'Les médicaments de la BDPM pour le comptoir : RCP et notices cités par rubrique, '
  + 'interactions, conditions de délivrance, grossesse, sécabilité, alternatives.';

/** Pages de résultats, d'extraits et d'API : hors index, et non explorées. */
export const NON_INDEXEES = ['/search', '/documents', '/interactions', '/extrait', '/api/'];

export function robots(base) {
  return ['User-agent: *', ...NON_INDEXEES.map((chemin) => `Disallow: ${chemin}`), '', `Sitemap: ${base}/sitemap.xml`, ''].join('\n');
}

const echapperXml = (texte) => texte.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Sitemap : accueil, fiches thématiques, classes ATC peuplées, spécialités (moins de 50 000 adresses). */
export function sitemap(base, chemins) {
  const urls = chemins.map((chemin) => `<url><loc>${echapperXml(`${base}${chemin}`)}</loc></url>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>\n`;
}

/** Chemins du sitemap, lus en base. */
export async function cheminsIndexables(pool, fiches = []) {
  const [{ rows: classes }, { rows: specialites }] = await Promise.all([
    pool.query(
      `SELECT c.atc_code AS code FROM ref.atc_classification c
       WHERE EXISTS (SELECT 1 FROM ref.cis_atc_mapping a WHERE a.atc_code LIKE c.atc_code || '%')
       ORDER BY c.atc_code`,
    ),
    pool.query('SELECT code_cis AS cis FROM dbpm.cis_bdpm ORDER BY code_cis'),
  ]);
  return [
    '/',
    ...(fiches.length > 0 ? ['/fiches', ...fiches.map((slug) => `/fiches/${encodeURIComponent(slug)}`)] : []),
    ...classes.map((ligne) => `/classe/${ligne.code}`),
    ...specialites.map((ligne) => `/product/${ligne.cis}`),
  ];
}
