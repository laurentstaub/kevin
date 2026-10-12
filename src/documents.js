import { sanitizeDocument, safeDocumentUrl } from './sanitize.js';
import { outline } from './outline.js';
import { config } from './config.js';

/**
 * Ordre d'affichage : le plus substantiel d'abord.
 * `rcp_notice` : PDF unique des spécialités centralisées (environ 15 % des CIS).
 */
export const DOCUMENT_TYPES = ['rcp', 'rcp_notice', 'notice', 'main'];

export const DOCUMENT_LABELS = {
  rcp: 'Résumé des caractéristiques du produit',
  rcp_notice: 'Résumé des caractéristiques et notice',
  notice: 'Notice patient',
  main: 'Fiche info',
};

/** Libellés courts : titre de la section Documents (onglets). */
export const DOCUMENT_COURTS = {
  rcp: 'RCP',
  rcp_notice: 'RCP et notice',
  notice: 'Notice',
  main: 'Fiche info',
};

/**
 * Lien vers le document officiel. Un file_path « /documents/<CIS>/rcp_notice.pdf »
 * rend 404 sur la BDPM : il est remplacé par la fiche document du site.
 */
// Vise directement la cible de la redirection 301 de affichageDoc.php.
const ficheDocument = (cis) =>
  `${config.documentBaseUrl}/medicament/${encodeURIComponent(cis)}/extrait`;

function lienOfficiel(cis, filePath) {
  if (!filePath) return null;
  return /^\/documents\//.test(filePath) ? ficheDocument(cis) : safeDocumentUrl(filePath);
}

/**
 * Fiche info BDPM : le titre est posé dans un tableau de mise en page (cellules
 * vides autour, rangées vides dessus et dessous), qui le décalait et l'encadrait
 * de filets ; le mode d'emploi des pictogrammes du site BDPM n'a pas d'objet ici.
 * Un tableau dont le seul contenu est un titre devient ce titre.
 */
const TABLEAU = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
const TITRE = /<(h[1-6])\b[^>]*>[\s\S]*?<\/\1>/gi;
const PICTOGRAMMES = /<p\b[^>]*>\s*Cliquez sur un pictogramme[\s\S]*?<\/p>\s*(?:<br\s*\/?>)?/i;
const texte = (html) => html.replace(/<[^>]+>/g, '').replace(/&nbsp;|\s/g, '');

export function nettoyerFicheInfo(html) {
  return String(html ?? '')
    .replace(TABLEAU, (tableau, interieur) => {
      const titres = interieur.match(TITRE) ?? [];
      return titres.length === 1 && texte(interieur) === texte(titres[0]) ? titres[0] : tableau;
    })
    .replace(PICTOGRAMMES, '');
}

/** Documents officiels d'une spécialité, HTML assaini ici : aucune vue ne reçoit de HTML brut. */
export async function getDocuments(pool, cis) {
  const { rows } = await pool.query(
    `SELECT code_cis, document_type, html_content, file_path, last_updated
     FROM dbpm.cis_documents
     WHERE code_cis = $1
     ORDER BY document_type, last_updated DESC`,
    [cis],
  );

  const seen = new Set();

  return rows
    .map((row) => {
      const propre = sanitizeDocument(row.html_content);
      const { html, sections } = outline(
        row.document_type === 'main' ? nettoyerFicheInfo(propre) : propre, row.document_type);
      return {
        cis: row.code_cis,
        type: row.document_type,
        anchor: `doc-${row.document_type}`,
        label: DOCUMENT_LABELS[row.document_type] ?? row.document_type,
        court: DOCUMENT_COURTS[row.document_type] ?? row.document_type,
        html,
        sections,
        url: lienOfficiel(row.code_cis, row.file_path),
        lastUpdated: row.last_updated,
      };
    })
    // Rien à afficher : vide après assainissement et sans URL valide.
    .filter((doc) => doc.html || doc.url)
    // Une seule version par type : la plus récente (tri SQL last_updated DESC).
    .filter((doc) => !seen.has(doc.type) && seen.add(doc.type));
}

/**
 * Greffe les rubriques découpées sur les documents. Sans découpage, le document
 * reste servi d'un bloc.
 */
export function withSections(documents, parType) {
  const greffes = documents.map((doc) => {
    const decoupe = parType.get(doc.type);
    if (!decoupe) return { ...doc, rubriques: [] };

    return {
      ...doc,
      rubriques: decoupe.rubriques,
      statut: decoupe.statut,
      manquantes: decoupe.manquantes,
      source: decoupe.source,
    };
  });

  // Le PDF « rcp_notice » donne un RCP et une notice absents de cis_documents : les ajouter.
  const presents = new Set(greffes.map((doc) => doc.type));
  const porteur = greffes.find((doc) => doc.type === 'rcp_notice');

  const derives = [...parType]
    .filter(([type]) => !presents.has(type))
    .map(([type, decoupe]) => ({
      cis: porteur?.cis ?? null,
      type,
      anchor: `doc-${type}`,
      label: DOCUMENT_LABELS[type] ?? type,
      court: DOCUMENT_COURTS[type] ?? type,
      html: '',
      sections: [],
      url: porteur?.url ?? null,
      lastUpdated: porteur?.lastUpdated ?? null,
      rubriques: decoupe.rubriques,
      statut: decoupe.statut,
      manquantes: decoupe.manquantes,
      source: decoupe.source,
    }));

  // Porteur vide une fois découpé : son lien est repris par les documents dérivés.
  const restants =
    derives.length > 0
      ? greffes.filter((doc) => !(doc.type === 'rcp_notice' && doc.rubriques.length === 0))
      : greffes;

  return [...restants, ...derives];
}

/** Regroupe par type, dans l'ordre d'affichage voulu. */
export function groupByType(documents) {
  const grouped = Object.fromEntries(DOCUMENT_TYPES.map((type) => [type, []]));
  for (const doc of documents) {
    if (grouped[doc.type]) grouped[doc.type].push(doc);
  }
  return grouped;
}

export function isEmpty(grouped) {
  return DOCUMENT_TYPES.every((type) => grouped[type].length === 0);
}
