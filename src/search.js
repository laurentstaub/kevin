/**
 * Search for medications in the database
 * @param {Object} pool - PostgreSQL pool instance
 * @param {string} query - Search term
 * @returns {Promise<Array>} Array of search results
 */

const searchMedications = async (pool, query) => {
  if (!query) return [];
  
  const terms = query.trim().toLowerCase().split(/\s+/);
  const params = terms.map(term => `%${term}%`);
  
  const whereClause = terms.length === 1 
    ? '(unaccent(LOWER(m.denomination_medicament)) LIKE unaccent($1) OR unaccent(LOWER(c.denomination_substance)) LIKE unaccent($1))'
    : '(unaccent(LOWER(m.denomination_medicament)) LIKE unaccent($1) AND unaccent(LOWER(m.denomination_medicament)) LIKE unaccent($2)) OR (unaccent(LOWER(c.denomination_substance)) LIKE unaccent($1) AND unaccent(LOWER(c.denomination_substance)) LIKE unaccent($2))';

  const result = await pool.query(`
    SELECT DISTINCT
      m.code_cis as id,
      m.denomination_medicament,
      p.libelle_presentation,
      string_agg(DISTINCT c.denomination_substance, ', ') as active_ingredients
    FROM dbpm.cis_bdpm m
    LEFT JOIN dbpm.cis_cip_bdpm p ON m.code_cis = p.code_cis
    LEFT JOIN dbpm.cis_compo_bdpm c ON m.code_cis = c.code_cis
    WHERE ${whereClause}
    GROUP BY m.code_cis, m.denomination_medicament, p.libelle_presentation
    ORDER BY m.denomination_medicament
  `, params);
  
  return result.rows;
};

module.exports = {
  searchMedications
}; 