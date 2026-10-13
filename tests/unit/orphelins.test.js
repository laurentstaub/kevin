import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { verdictPurge, purgerOrphelins, PART_MAX } from '../../src/orphelins.js';

describe('verdictPurge', () => {
  it('purge des retraits ordinaires (594 sur 15 300 au premier constat)', () => {
    const verdict = verdictPurge({ total: 15300, orphelins: 594 });
    assert.equal(verdict.purger, true);
    assert.ok(verdict.part < PART_MAX);
  });

  // BDPM vide ou en cours de rechargement : tout paraîtrait orphelin.
  it('refuse au-delà de la part maximale, et dit pourquoi', () => {
    for (const compte of [{ total: 15300, orphelins: 15300 }, { total: 15300, orphelins: 2000 }]) {
      const verdict = verdictPurge(compte);
      assert.equal(verdict.purger, false, JSON.stringify(compte));
      assert.match(verdict.raison, /Rien n’est supprimé/);
    }
  });

  it('ne fait rien sans orphelin, ni sur une base vide', () => {
    assert.equal(verdictPurge({ total: 15300, orphelins: 0 }).purger, false);
    assert.equal(verdictPurge({ total: 0, orphelins: 0 }).purger, false);
  });
});

describe('purgerOrphelins', () => {
  /** Pool factice : rend le constat demandé, compte les suppressions, retient les ordres. */
  const pool = (compte) => {
    const ordres = [];
    const client = {
      query: async (sql) => {
        ordres.push(sql.trim().split(/\s+/).slice(0, 3).join(' '));
        if (sql.includes('WITH cis AS')) return { rows: [compte] };
        if (sql.startsWith('DELETE FROM docs.rcp_sections')) return { rowCount: compte.rubriques };
        if (sql.startsWith('DELETE FROM docs.document_parse')) return { rowCount: compte.orphelins * 2 };
        return { rows: [] };
      },
      release() {},
    };
    return { ordres, connect: async () => client };
  };

  it('constate et supprime dans une même transaction en lecture répétable', async () => {
    const factice = pool({ total: 15300, orphelins: 594, rubriques: 21398 });
    const resultat = await purgerOrphelins(factice);
    assert.deepEqual(resultat.purge, { rubriques: 21398, documents: 1188 });
    assert.equal(factice.ordres[0], 'BEGIN ISOLATION LEVEL');
    assert.equal(factice.ordres.at(-1), 'COMMIT');
  });

  it('ne supprime rien quand le garde-fou refuse', async () => {
    const factice = pool({ total: 15300, orphelins: 15300, rubriques: 525384 });
    const resultat = await purgerOrphelins(factice);
    assert.equal(resultat.purge, null);
    assert.ok(!factice.ordres.some((ordre) => ordre.startsWith('DELETE')));
    assert.equal(factice.ordres.at(-1), 'ROLLBACK');
  });

  it('à blanc, constate sans supprimer', async () => {
    const factice = pool({ total: 15300, orphelins: 594, rubriques: 21398 });
    const resultat = await purgerOrphelins(factice, { aBlanc: true });
    assert.equal(resultat.purge, null);
    assert.equal(resultat.orphelins, 594);
    assert.ok(!factice.ordres.some((ordre) => ordre.startsWith('DELETE')));
  });
});
