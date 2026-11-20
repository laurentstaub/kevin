/**
 * Pharmacologie d'une molécule (code ATC de niveau 5) : les rubriques 5.1
 * (propriétés pharmacodynamiques) et 5.2 (propriétés pharmacocinétiques) du
 * RCP d'une spécialité de référence. Aucune source externe n'est rangée par
 * code ATC ; le RCP fait foi et il est déjà découpé.
 *
 * Référence : commercialisée, princeps d'abord, une seule substance active
 * (une association a sa propre pharmacologie), le nom le plus court, et un
 * RCP dont la rubrique 5.1 a été découpée.
 */

/** Rubriques montrées, dans l'ordre, avec leur libellé court. */
export const RUBRIQUES_PHARMACOLOGIE = [
  { numero: '5.1', libelle: 'pharmacodynamie' },
  { numero: '5.2', libelle: 'pharmacocinétique' },
];

/**
 * @returns {Promise<{ cis: string, denomination: string, rubriques: Array<{ numero, libelle, ancre }> }|null>}
 *   null quand aucune spécialité commercialisée de la molécule n'a de 5.1 découpée
 */
export async function getPharmacologie(pool, code) {
  const { rows } = await pool.query(
    `WITH reference AS (
       SELECT m.code_cis, m.denomination_medicament
       FROM dbpm.cis_bdpm m
       WHERE m.code_cis IN (SELECT code_cis FROM ref.cis_atc_mapping WHERE atc_code = $1)
         AND m.etat_commercialisation = 'Commercialisée'
         AND EXISTS (SELECT 1 FROM docs.rcp_sections s
                     WHERE s.code_cis = m.code_cis AND s.numero = '5.1' AND s.document_type <> 'notice')
       ORDER BY EXISTS (SELECT 1 FROM dbpm.cis_gener_bdpm g
                        WHERE g.code_cis = m.code_cis AND g.type_generique = '0') DESC,
                (SELECT count(DISTINCT c.code_substance) FROM dbpm.cis_compo_bdpm c
                 WHERE c.code_cis = m.code_cis AND c.nature_composant = 'SA') = 1 DESC,
                length(m.denomination_medicament), m.code_cis
       LIMIT 1
     )
     SELECT r.code_cis, r.denomination_medicament, s.numero, s.document_type, s.position
     FROM reference r
     JOIN LATERAL (
       SELECT DISTINCT ON (numero) numero, document_type, position
       FROM docs.rcp_sections
       WHERE code_cis = r.code_cis AND numero = ANY($2::text[]) AND document_type <> 'notice'
       ORDER BY numero, (document_type = 'rcp') DESC, position
     ) s ON true
     ORDER BY s.numero`,
    [code, RUBRIQUES_PHARMACOLOGIE.map((rubrique) => rubrique.numero)],
  );
  if (rows.length === 0) return null;
  return {
    cis: rows[0].code_cis,
    denomination: rows[0].denomination_medicament,
    rubriques: RUBRIQUES_PHARMACOLOGIE
      .map((rubrique) => ({ ...rubrique, ligne: rows.find((row) => row.numero === rubrique.numero) }))
      .filter((rubrique) => rubrique.ligne)
      .map(({ numero, libelle, ligne }) => ({ numero, libelle, ancre: `${ligne.document_type}-${ligne.position}` })),
  };
}
