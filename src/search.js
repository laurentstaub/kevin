/**
 * Search for medications in the database
 * @param {Object} pool - PostgreSQL pool instance
 * @param {string} query - Search term
 * @param {string} filter - Filter type ('all', 'specialty', or 'active')
 * @returns {Promise<Array>} Array of search results
 */

const searchMedications = async (pool, query, filter = 'all') => {
  if (!query) return [];
  
  const terms = query.trim().toLowerCase().split(/\s+/);
  const params = terms.map(term => `%${term}%`);
  
  let whereClause;
  if (filter === 'active') {
    // Search only in active ingredients
    whereClause = terms.length === 1 
      ? 'unaccent(LOWER(c.denomination_substance)) LIKE unaccent($1)'
      : terms.map((_, i) => `unaccent(LOWER(c.denomination_substance)) LIKE unaccent($${i + 1})`).join(' AND ');
  } else if (filter === 'specialty') {
    // Search only in medication names
    whereClause = terms.length === 1
      ? 'unaccent(LOWER(m.denomination_medicament)) LIKE unaccent($1)'
      : terms.map((_, i) => `unaccent(LOWER(m.denomination_medicament)) LIKE unaccent($${i + 1})`).join(' AND ');
  } else {
    // Search in both medication names and active ingredients
    whereClause = terms.length === 1 
      ? '(unaccent(LOWER(m.denomination_medicament)) LIKE unaccent($1) OR unaccent(LOWER(c.denomination_substance)) LIKE unaccent($1))'
      : `(${terms.map((_, i) => `unaccent(LOWER(m.denomination_medicament)) LIKE unaccent($${i + 1})`).join(' AND ')}) OR 
         (${terms.map((_, i) => `unaccent(LOWER(c.denomination_substance)) LIKE unaccent($${i + 1})`).join(' AND ')})`;
  }

  const result = await pool.query(`
    WITH results AS (
      SELECT DISTINCT
        m.code_cis as id,
        m.denomination_medicament,
        p.libelle_presentation,
        string_agg(DISTINCT c.denomination_substance, ', ') as active_ingredients,
        CASE 
          WHEN $${terms.length + 1} = 'active' AND (${terms.map((_, i) => 
            `unaccent(LOWER(string_agg(DISTINCT c.denomination_substance, ', '))) LIKE unaccent($${i + 1})`
          ).join(' OR ')}) THEN 0
          WHEN $${terms.length + 1} = 'specialty' AND (${terms.map((_, i) => 
            `unaccent(LOWER(m.denomination_medicament)) LIKE unaccent($${i + 1})`
          ).join(' OR ')}) THEN 0
          ELSE 1
        END as sort_order
      FROM dbpm.cis_bdpm m
      LEFT JOIN dbpm.cis_cip_bdpm p ON m.code_cis = p.code_cis
      LEFT JOIN dbpm.cis_compo_bdpm c ON m.code_cis = c.code_cis
      WHERE ${whereClause}
      GROUP BY m.code_cis, m.denomination_medicament, p.libelle_presentation
    )
    SELECT 
      id,
      denomination_medicament,
      libelle_presentation,
      active_ingredients
    FROM results
    ORDER BY sort_order, denomination_medicament
  `, [...params, filter]);
  
  return result.rows;
};

module.exports = {
  searchMedications
}; 