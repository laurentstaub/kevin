import { sanitizeDocument, safeDocumentUrl } from './sanitize.js';
import { outline } from './outline.js';
import { config } from './config.js';

/**
 * Ordre d'affichage, et non simple liste : le document le plus substantiel
 * vient en premier.
 *
 * `rcp_notice` couvre les spécialités enregistrées en procédure centralisée,
 * pour lesquelles la BDPM ne publie pas de HTML mais un PDF unique regroupant
 * les annexes. Environ 15 % des CIS.
 */
export const DOCUMENT_TYPES = ['rcp', 'rcp_notice', 'notice', 'main'];

export const DOCUMENT_LABELS = {
  rcp: 'Résumé des caractéristiques du produit',
  rcp_notice: 'Résumé des caractéristiques et notice',
  notice: 'Notice patient',
  main: 'Fiche info',
};

/**
 * Lien vers le document officiel.
 *
 * Le `file_path` des spécialités centralisées vaut toujours
 * « /documents/<CIS>/rcp_notice.pdf » — un emplacement local que l'ancien
 * scraper n'a jamais rempli, et qui rend 404 une fois résolu contre la BDPM.
 * La fiche document du site, elle, est stable et porte le vrai lien.
 */
// L'ancienne forme — affichageDoc.php?specid=…&typedoc=R — répond encore, par
// une redirection 301 vers celle-ci. Autant viser l'arrivée : un aller-retour
// de moins pour le lecteur, et le lien survit au jour où la redirection sera
// retirée.
const ficheDocument = (cis) =>
  `${config.documentBaseUrl}/medicament/${encodeURIComponent(cis)}/extrait`;

function lienOfficiel(cis, filePath) {
  if (!filePath) return null;
  return /^\/documents\//.test(filePath) ? ficheDocument(cis) : safeDocumentUrl(filePath);
}

/**
 * Documents officiels d'une spécialité. Le HTML est assaini ici, une fois,
 * avant de sortir de la couche données — aucune vue ne reçoit de HTML brut.
 */
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
      const { html, sections } = outline(sanitizeDocument(row.html_content), row.document_type);
      return {
        cis: row.code_cis,
        type: row.document_type,
        anchor: `doc-${row.document_type}`,
        label: DOCUMENT_LABELS[row.document_type] ?? row.document_type,
        html,
        sections,
        url: lienOfficiel(row.code_cis, row.file_path),
        lastUpdated: row.last_updated,
      };
    })
    // Un document vide après assainissement et sans URL valide n'a rien à afficher.
    .filter((doc) => doc.html || doc.url)
    // Une seule version par type : la plus récente (tri SQL last_updated DESC).
    .filter((doc) => !seen.has(doc.type) && seen.add(doc.type));
}

/**
 * Greffe les rubriques déjà découpées sur les documents.
 *
 * Le document garde ses métadonnées — libellé, date, lien vers la version
 * officielle — et gagne son plan. Quand le découpage n'existe pas encore pour
 * ce type, il reste servi d'un bloc : la fiche ne doit pas dépendre de
 * l'avancement d'un traitement par lots.
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

  // Un PDF européen unique donne deux documents — un RCP et une notice — qui
  // n'existent pas dans cis_documents : celle-ci ne connaît que la ligne
  // « rcp_notice » qui les portait. Sans cette reprise, les 2 052 spécialités
  // centralisées affichent un lien vers un PDF au lieu de leurs rubriques.
  const presents = new Set(greffes.map((doc) => doc.type));
  const porteur = greffes.find((doc) => doc.type === 'rcp_notice');

  const derives = [...parType]
    .filter(([type]) => !presents.has(type))
    .map(([type, decoupe]) => ({
      cis: porteur?.cis ?? null,
      type,
      anchor: `doc-${type}`,
      label: DOCUMENT_LABELS[type] ?? type,
      html: '',
      sections: [],
      url: porteur?.url ?? null,
      lastUpdated: porteur?.lastUpdated ?? null,
      rubriques: decoupe.rubriques,
      statut: decoupe.statut,
      manquantes: decoupe.manquantes,
      source: decoupe.source,
    }));

  // Le document porteur n'a plus rien à montrer une fois découpé : ses
  // rubriques sont ailleurs, et son lien est repris par les documents dérivés.
  const restants =
    derives.length > 0
      ? greffes.filter((doc) => !(doc.type === 'rcp_notice' && doc.rubriques.length === 0))
      : greffes;

  return [...restants, ...derives];
}

/** Regroupe par type, dans l'ordre d'affichage voulu. */
export function groupByType(documents) {
  const grouped = Object.fromEntries(DOCUMENT_TYPES.map((t) => [t, []]));
  for (const doc of documents) {
    if (grouped[doc.type]) grouped[doc.type].push(doc);
  }
  return grouped;
}

export function isEmpty(grouped) {
  return DOCUMENT_TYPES.every((t) => grouped[t].length === 0);
}
