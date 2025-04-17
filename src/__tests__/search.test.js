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

  it('should find medications with partial name', async () => {
    const results = await searchMedications(pool, 'aspi');
    
    expect(results.length).toBeGreaterThan(0);
    results.forEach(result => {
      expect(result.denomination_medicament.toLowerCase())
        .toContain('aspi');
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
}); 