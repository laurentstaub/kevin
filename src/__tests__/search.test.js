import pkg from 'pg';
const { Pool } = pkg;
import { searchMedications } from '../search.js';

describe('searchMedications', () => {
  let pool;

  beforeAll(async () => {
    pool = new Pool({
      user: 'laurentstaub4',
      host: 'localhost',
      database: 'incidents_json',
      port: 5432,
    });

    try {
      await pool.query('SELECT NOW()');
      console.log('Database connection successful');
    } catch (error) {
      console.error('Database connection error:', error);
      throw error;
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  it('should return empty results when no query is provided', async () => {
    const results = await searchMedications(pool, '');
    expect(results).toEqual({ brandMatches: [], activeIngredientMatches: [], relatedProducts: [] });
  });

  it('should find medications with a single search term', async () => {
    const results = await searchMedications(pool, 'ASPIRINE');

    const allResults = [...results.brandMatches, ...results.activeIngredientMatches, ...results.relatedProducts];
    expect(allResults.length).toBeGreaterThan(0);
    allResults.forEach(result => {
      expect(result.denomination_medicament.toUpperCase())
        .toContain('ASPIRINE');
    });
  });

  it('should find medications with partial name or active ingredient', async () => {
    const results = await searchMedications(pool, 'aspi');

    const allResults = [...results.brandMatches, ...results.activeIngredientMatches, ...results.relatedProducts];
    expect(allResults.length).toBeGreaterThan(0);
    allResults.forEach(result => {
      const denomLower = result.denomination_medicament.toLowerCase();
      const ingredientsLower = (result.active_ingredients || '').toLowerCase();

      const containsSearchTerm = denomLower.includes('aspi') || ingredientsLower.includes('aspi');

      if (!containsSearchTerm) {
        throw new Error(
          `Neither medication name "${denomLower}" nor ingredients "${ingredientsLower}" contain "aspi"`
        );
      }
    });
  });

  it('should find specific medication with name and dosage', async () => {
    const results = await searchMedications(pool, 'aspirine 500');

    const allResults = [...results.brandMatches, ...results.activeIngredientMatches, ...results.relatedProducts];
    expect(allResults.length).toBeGreaterThan(0);
    allResults.forEach(result => {
      const denomLower = result.denomination_medicament.toLowerCase();
      expect(denomLower).toContain('aspirine');
      expect(denomLower).toContain('500');
    });
  });

  it('should handle accented characters in search', async () => {
    const results = await searchMedications(pool, 'pediatrique');

    const allResults = [...results.brandMatches, ...results.activeIngredientMatches, ...results.relatedProducts];
    expect(allResults.length).toBeGreaterThan(0);
    // At least one result should contain either "pediatrique" or "pédiatrique"
    const hasMatch = allResults.some(result => {
      const denomLower = result.denomination_medicament.toLowerCase();
      return denomLower.includes('pediatrique') || denomLower.includes('pédiatrique');
    });
    expect(hasMatch).toBe(true);
  });

  it('should return proper result structure', async () => {
    const results = await searchMedications(pool, 'aspirine');

    expect(results).toHaveProperty('brandMatches');
    expect(results).toHaveProperty('activeIngredientMatches');
    expect(results).toHaveProperty('relatedProducts');

    const allResults = [...results.brandMatches, ...results.activeIngredientMatches, ...results.relatedProducts];
    if (allResults.length > 0) {
      const firstResult = allResults[0];
      expect(firstResult).toHaveProperty('id');
      expect(firstResult).toHaveProperty('denomination_medicament');
    }
  });

  it('should find Ozempic products when searching for Semaglutide', async () => {
    const results = await searchMedications(pool, 'Semaglutide');

    const allResults = [...results.brandMatches, ...results.activeIngredientMatches, ...results.relatedProducts];
    expect(allResults.length).toBeGreaterThan(0);

    // Check if we have all three Ozempic products
    const ozempicProducts = allResults.filter(result =>
      result.denomination_medicament.toUpperCase().includes('OZEMPIC')
    );

    // Should find at least 3 Ozempic products (0.25mg, 0.5mg, and 1mg)
    expect(ozempicProducts.length).toBeGreaterThanOrEqual(3);

    // Verify we have all three dosages
    const dosages = ozempicProducts.map(product => {
      const match = product.denomination_medicament.match(/(\d+(?:,\d+)?)\s*mg/);
      return match ? match[1].replace(',', '.') : null;
    }).sort();

    expect(dosages).toContain('0.25');
    expect(dosages).toContain('0.5');
    expect(dosages).toContain('1');
  });
}); 