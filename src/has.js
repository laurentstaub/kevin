/**
 * Évaluation HAS d'une spécialité : SMR et ASMR des avis de la Commission de
 * la transparence (fichiers BDPM CIS_HAS_SMR et CIS_HAS_ASMR), lien vers l'avis.
 *
 * Les valeurs sont données par avis et par indication : un produit peut avoir
 * un SMR important dans une indication et insuffisant dans une autre. Le
 * résumé retient le dernier avis et dit quand ses valeurs divergent.
 */

const ROMAIN = /^(?:I{1,3}|IV|V)$/;

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
        dossier: ligne.code_dossier_has, date, motif: ligne.motif_evaluation, lien: ligne.lien ?? null, smr: [], asmr: [],
      });
    }
    avis.get(cle)[ligne.nature].push({ valeur: String(ligne.valeur ?? '').trim(), libelle: ligne.libelle ?? '' });
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
 * @returns {{ valeur: string, detail: string|null, avis: number }}
 */
export function resumerEvaluation(avis) {
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
