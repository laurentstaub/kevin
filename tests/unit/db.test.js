import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { optionsPool } from '../../src/db.js';

/** Heroku Postgres exige TLS ; en local, la base n'en a pas. */
describe('optionsPool', () => {
  const base = { max: 4, statementTimeoutMs: 5000, host: 'localhost', database: 'x', port: 5432 };

  it('chiffre la connexion quand la configuration le demande, sans vérifier le certificat Heroku', () => {
    const options = optionsPool({ ...base, ssl: true });
    assert.deepEqual(options.ssl, { rejectUnauthorized: false });
    assert.equal(options.max, 4);
    assert.equal(options.statement_timeout, 5000);
  });

  it('reste en clair sinon', () => {
    assert.equal(optionsPool({ ...base, ssl: false }).ssl, false);
  });

  it('préfère l’URL complète aux variables séparées, qui ne sont pas transmises', () => {
    const options = optionsPool({ ...base, ssl: false, connectionString: 'postgres://u@h:5432/d' });
    assert.equal(options.connectionString, 'postgres://u@h:5432/d');
    assert.equal(options.host, undefined);
    assert.equal(options.database, undefined);
  });
});
