import { socle } from './rcp-plan.js';

/**
 * Lecture des rubriques déjà découpées (schéma `docs`).
 * `organiser`, pure, décide de ce qui s'ouvre ; le SQL ne fournit que les lignes.
 */

/** Provenance du texte affiché, à indiquer au lecteur. */
export const SOURCES = {
  bdpm_html: 'texte officiel de la BDPM',
  bdpm_pdf: 'reconstruit depuis le PDF européen',
};

/**
 * @param {object[]} rubriques - lignes de docs.rcp_sections, triées par position
 * @param {object[]} etats - lignes de docs.document_parse
 * @returns {Map<string, object>} type de document -> document prêt à afficher
 */
export function organiser(rubriques, etats) {
  const parType = new Map();

  const creer = (type) => ({
    type,
    statut: 'ok',
    manquantes: [],
    source: null,
    parsedAt: null,
    rubriques: [],
  });

  for (const etat of etats) {
    parType.set(etat.document_type, {
      ...creer(etat.document_type),
      statut: etat.statut,
      manquantes: etat.manquantes ?? [],
      source: etat.source,
      parsedAt: etat.parsed_at ?? null,
    });
  }

  for (const rubrique of rubriques) {
    if (!parType.has(rubrique.document_type)) parType.set(rubrique.document_type, creer(rubrique.document_type));

    const essentielles = socle(rubrique.document_type);
    const texte = rubrique.texte ?? '';

    parType.get(rubrique.document_type).rubriques.push({
      id: `${rubrique.document_type}-${rubrique.position}`,
      numero: rubrique.numero,
      libelle: rubrique.libelle,
      profondeur: rubrique.profondeur,
      canonical: rubrique.canonical,
      html: rubrique.html,
      // Rubrique sans contenu propre (« 4. Données cliniques ») : ne se déplie pas.
      charniere: texte.trim() === '',
      // Sert au contraste du libellé, pas à l'ouverture.
      essentielle: essentielles.includes(rubrique.numero),
      // Rubrique 4 (partie clinique) : dépliée d'office.
      clinique: /^4(\.|$)/.test(rubrique.numero),
    });
  }

  // Document sans rubrique : masqué (l'échec concerne l'exploitant, pas le lecteur).
  for (const [type, doc] of parType) {
    if (doc.rubriques.length === 0) parType.delete(type);
  }

  return parType;
}

/** Rubriques d'une spécialité, par type de document. */
export async function getSections(pool, cis) {
  const [rubriques, etats] = await Promise.all([
    pool.query(
      `SELECT document_type, position, numero, libelle, profondeur, canonical, html, texte
       FROM docs.rcp_sections
       WHERE code_cis = $1
       ORDER BY document_type, position`,
      [cis],
    ),
    pool.query(
      `SELECT document_type, statut, manquantes, source, parsed_at
       FROM docs.document_parse
       WHERE code_cis = $1`,
      [cis],
    ),
  ]);

  return organiser(rubriques.rows, etats.rows);
}

/** Entrées de sommaire d'un document découpé, plan entier. */
export function planDe(doc) {
  return doc.rubriques.map((rubrique) => ({
    id: rubrique.id,
    number: rubrique.numero,
    label: rubrique.libelle,
    depth: rubrique.profondeur,
    canonical: rubrique.canonical,
  }));
}
