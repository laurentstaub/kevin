/**
 * Évaluation HAS d'une spécialité : SMR et ASMR des avis de la Commission de
 * la transparence (fichiers BDPM CIS_HAS_SMR et CIS_HAS_ASMR), lien vers l'avis.
 *
 * Les valeurs sont données par avis et par indication : un produit peut avoir
 * un SMR important dans une indication et insuffisant dans une autre. Le
 * résumé retient le dernier avis et dit quand ses valeurs divergent.
 */

import { lienWeb } from './sanitize.js';

const ROMAIN = /^(?:I{1,3}|IV|V)$/;

/**
 * Caractères de contrôle C1 laissés par un texte Windows-1252 lu en Latin-1 :
 * « d\u0092origine » s'affichait « d  origine ». Rendus à leur caractère ;
 * les autres contrôles sont retirés.
 */
const C1 = {
  0x80: '€', 0x85: '…', 0x8c: 'Œ', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”',
  0x95: '•', 0x96: '–', 0x97: '—', 0x9c: 'œ',
};

/**
 * Libellé HAS → phrase d'introduction et éléments d'énumération. La source
 * mêle des « <br> » littéraux (affichés tels quels), des puces et un « ; »
 * final de séparation entre libellés.
 * @returns {{ intro: string, items: string[] }}
 */
export function lignesLibelle(libelle) {
  const lignes = String(libelle ?? '')
    .replace(/[\u0080-\u009f]/g, (car) => C1[car.charCodeAt(0)] ?? '')
    // Caractère de remplacement entre deux lettres : l'apostrophe perdue au chargement.
    .replace(/(?<=\p{L})\uFFFD(?=\p{L})/gu, '’')
    .split(/<br\s*\/?>|\r?\n/i)
    .map((ligne) => ligne
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[\s\-–•·]+/, '')
      .replace(/[\s;,]+$/, '')
      .trim())
    .filter(Boolean);
  return { intro: lignes[0] ?? '', items: lignes.slice(1) };
}

/** Avis d'une spécialité, du plus récent au plus ancien, SMR et ASMR regroupés par dossier. */
export async function getEvaluation(pool, cis) {
  const { rows } = await pool.query(
    `WITH lignes AS (
       SELECT 'smr' AS nature, code_dossier_has, motif_evaluation,
              date_avis_commission_transparence AS date_avis, valeur_smr AS valeur, libelle_smr AS libelle
       FROM dbpm.cis_has_smr WHERE code_cis = $1
       UNION ALL
       SELECT 'asmr', code_dossier_has, motif_evaluation,
              date_avis_commission_transparence, valeur_asmr, libelle_asmr
       FROM dbpm.cis_has_asmr WHERE code_cis = $1
     )
     SELECT l.*,
            -- Une douzaine de dossiers pointent vers plusieurs avis : un seul lien.
            (SELECT min(c.lien_pages_avis_ct) FROM dbpm.has_lienspagect_bdpm c
             WHERE c.code_dossier_has = l.code_dossier_has) AS lien
     FROM lignes l
     ORDER BY l.date_avis DESC NULLS LAST, l.code_dossier_has, l.nature DESC`,
    [cis],
  );
  return regrouperAvis(rows);
}

/** Lignes SMR/ASMR → un avis par dossier et date, dans l'ordre reçu. */
export function regrouperAvis(lignes) {
  const avis = new Map();
  for (const ligne of lignes) {
    const date = ligne.date_avis instanceof Date ? ligne.date_avis : (ligne.date_avis ? new Date(ligne.date_avis) : null);
    const cle = `${ligne.code_dossier_has}|${date?.toISOString() ?? ''}`;
    if (!avis.has(cle)) {
      avis.set(cle, {
        dossier: ligne.code_dossier_has, date, motif: ligne.motif_evaluation, lien: lienWeb(ligne.lien), smr: [], asmr: [],
      });
    }
    avis.get(cle)[ligne.nature].push({
      valeur: String(ligne.valeur ?? '').trim(),
      libelle: ligne.libelle ?? '',
      lignes: lignesLibelle(ligne.libelle),
    });
  }
  return [...avis.values()];
}

/** Dernier avis portant une valeur de cette nature, et ses valeurs distinctes. */
function dernier(avis, nature) {
  const trouve = avis.find((unAvis) => unAvis[nature].some((ligne) => ligne.valeur));
  if (!trouve) return null;
  const valeurs = [...new Set(trouve[nature].map((ligne) => ligne.valeur).filter(Boolean))];
  return { avis: trouve, valeurs };
}

const dateFr = (date) => (date ? date.toLocaleDateString('fr-FR') : 'date inconnue');

/**
 * Résumé pour la bande : « SMR important · ASMR V ».
 * @param {object[]|null} avis - sortie de getEvaluation ; `null` : avis illisibles
 *   (panne), à ne pas confondre avec `[]`, aucun avis
 * @returns {{ valeur: string, detail: string|null, avis: number, indisponible?: boolean }}
 */
export function resumerEvaluation(avis) {
  if (avis === null) {
    return {
      valeur: 'Évaluation indisponible',
      detail: 'Avis de la Commission de la transparence momentanément illisibles : voir la fiche officielle BDPM',
      avis: 0,
      indisponible: true,
    };
  }
  if (!avis || avis.length === 0) return { valeur: 'Pas d’avis HAS', detail: null, avis: 0 };

  const smr = dernier(avis, 'smr');
  const asmr = dernier(avis, 'asmr');

  const morceaux = [];
  if (smr) {
    morceaux.push(smr.valeurs.length > 1 ? 'SMR selon indication' : `SMR ${smr.valeurs[0].toLowerCase()}`);
  }
  if (asmr) {
    const chiffrees = asmr.valeurs.filter((valeur) => ROMAIN.test(valeur));
    if (asmr.valeurs.length > 1) morceaux.push('ASMR selon indication');
    else if (chiffrees.length === 1) morceaux.push(`ASMR ${chiffrees[0]}`);
    else morceaux.push('ASMR non chiffrée');
  }

  const sources = [smr?.avis, asmr?.avis].filter(Boolean)
    .filter((unAvis, i, liste) => liste.indexOf(unAvis) === i)
    .map((unAvis) => `avis CT du ${dateFr(unAvis.date)} (${unAvis.motif})`);

  return {
    valeur: morceaux.length > 0 ? morceaux.join(' · ') : 'Avis HAS sans SMR',
    detail: sources.length > 0 ? `Dernier ${sources.join(', ')}` : null,
    avis: avis.length,
  };
}

export { dateFr };
