const { Pool } = require('pg');
const { searchMedications } = require('../search');

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

  it('should return empty array when no query is provided', async () => {
    const results = await searchMedications(pool, '');
    expect(results).toEqual([]);
  });

  it('should find medications with a single search term', async () => {
    const results = await searchMedications(pool, 'ASPIRINE');
    
    expect(results.length).toBeGreaterThan(0);
    results.forEach(result => {
      expect(result.denomination_medicament.toUpperCase())
        .toContain('ASPIRINE');
    });
  });

  it('should find medications with partial name or active ingredient', async () => {
    const results = await searchMedications(pool, 'aspi');
    
    expect(results.length).toBeGreaterThan(0);
    results.forEach(result => {
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
    
    expect(results.length).toBeGreaterThan(0);
    results.forEach(result => {
      const denomLower = result.denomination_medicament.toLowerCase();
      expect(denomLower).toContain('aspirine');
      expect(denomLower).toContain('500');
    });
  });

  it('should handle accented characters in search', async () => {
    const results = await searchMedications(pool, 'pediatrique');
    
    expect(results.length).toBeGreaterThan(0);
    // At least one result should contain either "pediatrique" or "pédiatrique"
    const hasMatch = results.some(result => {
      const denomLower = result.denomination_medicament.toLowerCase();
      return denomLower.includes('pediatrique') || denomLower.includes('pédiatrique');
    });
    expect(hasMatch).toBe(true);
  });

  it('should return proper result structure', async () => {
    const results = await searchMedications(pool, 'aspirine');
    
    if (results.length > 0) {
      const firstResult = results[0];
      expect(firstResult).toHaveProperty('id');
      expect(firstResult).toHaveProperty('denomination_medicament');
      expect(firstResult).toHaveProperty('libelle_presentation');
    }
  });

  it('should find Ozempic products when searching for Semaglutide', async () => {
    const results = await searchMedications(pool, 'Semaglutide');
    
    expect(results.length).toBeGreaterThan(0);
    
    // Check if we have all three Ozempic products
    const ozempicProducts = results.filter(result => 
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
    
    // Verify each product has the correct presentation format
    ozempicProducts.forEach(product => {
      expect(product.denomination_medicament).toMatch(/OZEMPIC \d+(?:,\d+)? mg, solution injectable en stylo prérempli/i);
      expect(product.libelle_presentation).toMatch(/1 cartouche en verre de 1,5 mL dans stylo pré-rempli multidose jetable \+ 4 aiguilles/i);
    });
  });
}); 