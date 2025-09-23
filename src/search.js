/**
 * Enhanced search for medications with categorized results
 * @param {Object} pool - PostgreSQL pool instance
 * @param {string} query - Search term
 * @param {string} filter - Filter type ('all', 'specialty', or 'active')
 * @returns {Promise<Object>} Categorized search results
 */

const searchMedications = async (pool, query, filter = 'all') => {
  if (!query) return { brandMatches: [], activeIngredientMatches: [], relatedProducts: [] };

  const terms = query.trim().toLowerCase().split(/\s+/);
  const params = terms.map(term => `%${term}%`);

  // Phase 1: Get direct matches and identify what we're dealing with
  const directMatches = await getDirectMatches(pool, terms, params, filter);

  // Phase 2: Find related products based on shared active ingredients
  const relatedProducts = await getRelatedProducts(pool, directMatches.brandMatches, directMatches.activeIngredientMatches);

  return {
    brandMatches: directMatches.brandMatches,
    activeIngredientMatches: directMatches.activeIngredientMatches,
    relatedProducts: relatedProducts
  };
};

/**
 * Get direct matches for brand names and active ingredients
 */
const getDirectMatches = async (pool, terms, params, filter) => {
  let brandWhereClause, activeWhereClause;

  if (filter === 'specialty') {
    // Only search brand names
    brandWhereClause = terms.length === 1
      ? 'unaccent(LOWER(m.denomination_medicament)) LIKE unaccent($1)'
      : terms.map((_, i) => `unaccent(LOWER(m.denomination_medicament)) LIKE unaccent($${i + 1})`).join(' AND ');
    activeWhereClause = 'FALSE'; // No active ingredient search
  } else if (filter === 'active') {
    // Only search active ingredients
    brandWhereClause = 'FALSE'; // No brand name search
    activeWhereClause = terms.length === 1
      ? 'unaccent(LOWER(c.denomination_substance)) LIKE unaccent($1)'
      : terms.map((_, i) => `unaccent(LOWER(c.denomination_substance)) LIKE unaccent($${i + 1})`).join(' AND ');
  } else {
    // Search both
    brandWhereClause = terms.length === 1
      ? 'unaccent(LOWER(m.denomination_medicament)) LIKE unaccent($1)'
      : terms.map((_, i) => `unaccent(LOWER(m.denomination_medicament)) LIKE unaccent($${i + 1})`).join(' AND ');
    activeWhereClause = terms.length === 1
      ? 'unaccent(LOWER(c.denomination_substance)) LIKE unaccent($1)'
      : terms.map((_, i) => `unaccent(LOWER(c.denomination_substance)) LIKE unaccent($${i + 1})`).join(' AND ');
  }

  const result = await pool.query(`
    WITH brand_matches AS (
      SELECT DISTINCT
        m.code_cis as id,
        m.denomination_medicament,
        string_agg(DISTINCT c.denomination_substance, ', ') as active_ingredients,
        'brand' as match_type,
        1 as priority
      FROM dbpm.cis_bdpm m
      LEFT JOIN dbpm.cis_compo_bdpm c ON m.code_cis = c.code_cis
      WHERE ${brandWhereClause}
      GROUP BY m.code_cis, m.denomination_medicament
    ),
    active_ingredient_matches AS (
      SELECT DISTINCT
        m.code_cis as id,
        m.denomination_medicament,
        string_agg(DISTINCT c.denomination_substance, ', ') as active_ingredients,
        'active' as match_type,
        2 as priority
      FROM dbpm.cis_bdpm m
      JOIN dbpm.cis_compo_bdpm c ON m.code_cis = c.code_cis
      WHERE ${activeWhereClause}
      GROUP BY m.code_cis, m.denomination_medicament
    ),
    all_matches AS (
      SELECT * FROM brand_matches
      UNION
      SELECT * FROM active_ingredient_matches
    )
    SELECT
      id,
      denomination_medicament,
      active_ingredients,
      match_type,
      priority
    FROM all_matches
    ORDER BY priority, denomination_medicament
  `, params);

  const brandMatches = result.rows.filter(row => row.match_type === 'brand');
  const activeIngredientMatches = result.rows.filter(row => row.match_type === 'active');

  return { brandMatches, activeIngredientMatches };
};

/**
 * Find related products based on shared active ingredients
 */
const getRelatedProducts = async (pool, brandMatches, activeIngredientMatches) => {
  const allMatches = [...brandMatches, ...activeIngredientMatches];
  if (allMatches.length === 0) return [];

  // Extract all CIS codes from direct matches to exclude them from related products
  const directMatchCodes = allMatches.map(match => match.id);

  // Get unique active ingredients from all matches
  const activeIngredients = new Set();
  allMatches.forEach(match => {
    if (match.active_ingredients) {
      match.active_ingredients.split(', ').forEach(ingredient => {
        activeIngredients.add(ingredient.trim());
      });
    }
  });

  if (activeIngredients.size === 0) return [];

  // Create placeholders for excluding direct match CIS codes
  const excludePlaceholders = directMatchCodes.length > 0 ?
    `AND m.code_cis NOT IN (${directMatchCodes.map((_, i) => `$${Array.from(activeIngredients).length + i + 1}`).join(', ')})` :
    '';

  // Find products that contain any of these active ingredients but weren't direct matches
  const ingredientParams = Array.from(activeIngredients).map(ingredient => `%${ingredient}%`);
  const placeholders = ingredientParams.map((_, i) => `unaccent(LOWER(c.denomination_substance)) LIKE unaccent($${i + 1})`).join(' OR ');

  const result = await pool.query(`
    SELECT DISTINCT
      m.code_cis as id,
      m.denomination_medicament,
      string_agg(DISTINCT c.denomination_substance, ', ') as active_ingredients,
      'related' as match_type
    FROM dbpm.cis_bdpm m
    JOIN dbpm.cis_compo_bdpm c ON m.code_cis = c.code_cis
    WHERE (${placeholders})
      ${excludePlaceholders}
    GROUP BY m.code_cis, m.denomination_medicament
    ORDER BY m.denomination_medicament
    LIMIT 50
  `, [...ingredientParams, ...directMatchCodes]);

  return result.rows;
};

export { searchMedications }; 