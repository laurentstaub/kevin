/**
 * Candidats à la substitution d'une spécialité : son groupe générique, les
 * spécialités de mêmes substances actives et celles de sa sous-classe ATC
 * (niveau 4). Commercialisées seulement, sauf dans le groupe générique.
 * Le classement est fait par les règles de substitution.js, sans accès base.
 */
import { decomposer } from './specialites.js';
import { regrouperAlternatives } from './substitution.js';

/** Au-delà, une sous-classe très peuplée (IEC, statines) noierait la fiche. */
const PLAFOND = 400;

const ATC = `(SELECT a.atc_code FROM ref.cis_atc_mapping a
              WHERE a.code_cis = m.code_cis ORDER BY length(a.atc_code) DESC, a.atc_code LIMIT 1)`;
const SUBSTANCES = `array(SELECT DISTINCT c.denomination_substance FROM dbpm.cis_compo_bdpm c
                          WHERE c.code_cis = m.code_cis AND c.nature_composant = 'SA'
                          ORDER BY c.denomination_substance)`;

/** Ligne SQL → forme attendue par `classer`. */
const versRegle = (ligne) => ({
  id: String(ligne.id),
  code_cis: String(ligne.id),
  denomination: ligne.denomination_medicament,
  forme: ligne.forme_pharmaceutique ?? '',
  voies: ligne.voies_administration ?? '',
  atc5: ligne.atc ?? '',
  substances: ligne.substances ?? [],
  dosage: decomposer(ligne.denomination_medicament ?? '').dosage,
  meme_groupe_generique: Boolean(ligne.meme_groupe),
  role: ligne.meme_groupe ? (String(ligne.type_generique) === '0' ? 'Princeps' : 'Générique') : null,
  groupe: ligne.libelle_groupe_generique ?? null,
});

/**
 * @returns {Promise<{ categories: object[], groupe: string|null }>}
 */
export async function getAlternatives(pool, cis) {
  const { rows: [base] } = await pool.query(
    `SELECT m.code_cis AS id, m.denomination_medicament, m.forme_pharmaceutique,
            m.voies_administration, ${ATC} AS atc, ${SUBSTANCES} AS substances
     FROM dbpm.cis_bdpm m WHERE m.code_cis = $1`,
    [cis],
  );
  if (!base) return { categories: [], groupe: null };

  const { rows } = await pool.query(
    `WITH base AS (
       SELECT $2::text AS atc,
              (SELECT array_agg(g.identifiant_groupe_generique) FROM dbpm.cis_gener_bdpm g
               WHERE g.code_cis = $1) AS groupes,
              (SELECT array_agg(DISTINCT c.code_substance) FROM dbpm.cis_compo_bdpm c
               WHERE c.code_cis = $1 AND c.nature_composant = 'SA') AS substances
     ),
     candidats AS (
       SELECT g.code_cis FROM dbpm.cis_gener_bdpm g, base
       WHERE g.identifiant_groupe_generique = ANY (base.groupes)
       UNION
       SELECT c.code_cis FROM dbpm.cis_compo_bdpm c, base
       WHERE c.nature_composant = 'SA' AND c.code_substance = ANY (base.substances)
       UNION
       SELECT a.code_cis FROM ref.cis_atc_mapping a, base
       WHERE length(base.atc) >= 5 AND a.atc_code LIKE left(base.atc, 5) || '%'
     )
     SELECT m.code_cis AS id, m.denomination_medicament, m.forme_pharmaceutique,
            m.voies_administration, ${ATC} AS atc, ${SUBSTANCES} AS substances,
            g.type_generique, g.libelle_groupe_generique, (g.code_cis IS NOT NULL) AS meme_groupe
     FROM candidats
     JOIN dbpm.cis_bdpm m ON m.code_cis = candidats.code_cis
     LEFT JOIN LATERAL (
       SELECT g.code_cis, g.type_generique, g.libelle_groupe_generique
       FROM dbpm.cis_gener_bdpm g, base
       WHERE g.code_cis = m.code_cis AND g.identifiant_groupe_generique = ANY (base.groupes)
       LIMIT 1
     ) g ON true
     WHERE m.code_cis <> $1
       AND (m.etat_commercialisation = 'Commercialisée' OR g.code_cis IS NOT NULL)
     LIMIT ${PLAFOND}`,
    [cis, base.atc ?? ''],
  );

  const candidats = rows.map(versRegle);
  return {
    categories: regrouperAlternatives(versRegle(base), candidats),
    groupe: candidats.find((cand) => cand.groupe)?.groupe ?? null,
  };
}
