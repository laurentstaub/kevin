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
 * Find related products based on shared active ingredients and generics
 */
const getRelatedProducts = async (pool, brandMatches, activeIngredientMatches) => {
  const allMatches = [...brandMatches, ...activeIngredientMatches];
  if (allMatches.length === 0) return [];

  // Extract all CIS codes from direct matches to exclude them from related products
  const directMatchCodes = allMatches.map(match => match.id);

  // Get related products through two methods: generics and active ingredients
  const relatedProducts = new Map(); // Use Map to avoid duplicates

  // Method 1: Find generics using cis_gener_bdpm table
  for (const match of allMatches) {
    // Find all products in the same generic group(s) as this product
    const genericResult = await pool.query(`
      SELECT DISTINCT
        m.code_cis as id,
        m.denomination_medicament,
        string_agg(DISTINCT c.denomination_substance, ', ') as active_ingredients,
        'generic' as match_type
      FROM dbpm.cis_gener_bdpm cg1
      JOIN dbpm.cis_gener_bdpm cg2 ON cg1.identifiant_groupe_generique = cg2.identifiant_groupe_generique
      JOIN dbpm.cis_bdpm m ON cg2.code_cis = m.code_cis
      LEFT JOIN dbpm.cis_compo_bdpm c ON m.code_cis = c.code_cis
      WHERE cg1.code_cis = $1
        AND m.code_cis != $1
      GROUP BY m.code_cis, m.denomination_medicament
    `, [match.id]);

    genericResult.rows.forEach(row => {
      relatedProducts.set(row.id, row);
    });
  }

  // Method 2: Find products with same active ingredients (existing logic)
  const activeIngredients = new Set();
  allMatches.forEach(match => {
    if (match.active_ingredients) {
      match.active_ingredients.split(', ').forEach(ingredient => {
        activeIngredients.add(ingredient.trim());
      });
    }
  });

  if (activeIngredients.size > 0) {
    // Create placeholders for excluding direct match CIS codes and already found generics
    const existingCodes = [...directMatchCodes, ...Array.from(relatedProducts.keys())];
    const excludePlaceholders = existingCodes.length > 0 ?
      `AND m.code_cis NOT IN (${existingCodes.map((_, i) => `$${Array.from(activeIngredients).length + i + 1}`).join(', ')})` :
      '';

    // Find products that contain any of these active ingredients
    const ingredientParams = Array.from(activeIngredients).map(ingredient => `%${ingredient}%`);
    const placeholders = ingredientParams.map((_, i) => `unaccent(LOWER(c.denomination_substance)) LIKE unaccent($${i + 1})`).join(' OR ');

    const ingredientResult = await pool.query(`
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
      LIMIT 30
    `, [...ingredientParams, ...existingCodes]);

    ingredientResult.rows.forEach(row => {
      relatedProducts.set(row.id, row);
    });
  }

  // Convert Map back to array and sort
  return Array.from(relatedProducts.values())
    .sort((a, b) => {
      // Put generics first, then related products
      if (a.match_type === 'generic' && b.match_type !== 'generic') return -1;
      if (a.match_type !== 'generic' && b.match_type === 'generic') return 1;
      return a.denomination_medicament.localeCompare(b.denomination_medicament);
    })
    .slice(0, 50);
};

export { searchMedications }; 