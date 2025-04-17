/**
 * Search for medications in the database
 * @param {Object} pool - PostgreSQL pool instance
 * @param {string} query - Search term
 * @returns {Promise<Array>} Array of search results
 */
const searchMedications = async (pool, query) => {
  if (!query) {
    return [];
  }

  const terms = query.trim().toLowerCase().split(/\s+/);
  const params = terms.map(term => `%${term}%`);
  
  const whereClause = terms.length === 1 
    ? 'LOWER(m.denomination_medicament) LIKE $1'
    : 'LOWER(m.denomination_medicament) LIKE $1 AND LOWER(m.denomination_medicament) LIKE $2';

  const result = await pool.query(`
    SELECT DISTINCT
      m.code_cis as id,
      m.denomination_medicament,
      p.libelle_presentation
    FROM dbpm.cis_bdpm m
    LEFT JOIN dbpm.cis_cip_bdpm p ON m.code_cis = p.code_cis
    WHERE ${whereClause}
    ORDER BY m.denomination_medicament
  `, params);

  return result.rows;
};

module.exports = {
  searchMedications
}; 