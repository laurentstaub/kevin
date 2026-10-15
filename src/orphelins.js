/**
 * Rubriques orphelines : dérivées d'une spécialité retirée de la BDPM.
 * dbpm.cis_documents garde les documents collectés des CIS retirés, et le
 * découpage les refaisait à chaque passage : leurs rubriques restaient
 * cherchables, gonflaient les décomptes et le plafond de la recherche, puis
 * disparaissaient à la jointure finale. Seul le dérivé (docs.*) est purgé,
 * jamais la source.
 */

/**
 * Au-delà de cette part des spécialités découpées, la purge est refusée : la
 * BDPM est vide ou en cours de rechargement, pas des retraits. Les retraits
 * réels se comptent en centaines (594 sur 15 300 au premier constat).
 */
export const PART_MAX = 0.1;

const ABSENT = `NOT EXISTS (SELECT 1 FROM dbpm.cis_bdpm m WHERE m.code_cis = %.code_cis)`;
const absent = (alias) => ABSENT.replace('%', alias);

/**
 * @param {{ query: Function }} executeur - pool ou client
 * @returns {Promise<{ total: number, orphelins: number, rubriques: number }>}
 *   spécialités découpées, celles absentes de la BDPM, et leurs rubriques
 */
export async function compterOrphelins(executeur) {
  const { rows: [compte] } = await executeur.query(
    `WITH cis AS (
       SELECT code_cis FROM docs.document_parse
       UNION
       SELECT DISTINCT code_cis FROM docs.rcp_sections
     )
     SELECT count(*)::int AS total,
            count(*) FILTER (WHERE ${absent('cis')})::int AS orphelins,
            (SELECT count(*)::int FROM docs.rcp_sections s WHERE ${absent('s')}) AS rubriques
     FROM cis`,
  );
  return compte;
}

/**
 * Purger ou non, d'après le constat. Pure, testable sans base.
 * @returns {{ purger: boolean, part: number|null, raison: string|null }}
 */
export function verdictPurge({ total, orphelins }, partMax = PART_MAX) {
  if (!orphelins) return { purger: false, part: total ? 0 : null, raison: null };
  const part = orphelins / total;
  if (part > partMax) {
    return {
      purger: false,
      part,
      raison: `${Math.round(part * 100)} % des spécialités découpées seraient purgées : `
        + 'BDPM vide ou en cours de chargement ? Rien n’est supprimé.',
    };
  }
  return { purger: true, part, raison: null };
}

/**
 * Compte, décide et supprime dans une même transaction en lecture répétable :
 * un rechargement concurrent de cis_bdpm ne peut pas passer entre le constat
 * et la suppression.
 *
 * @param {import('pg').Pool} pool
 * @param {{ aBlanc?: boolean, partMax?: number }} [options]
 * @returns {Promise<{ total, orphelins, rubriques, purger, part, raison,
 *   purge: { rubriques: number, documents: number }|null }>}
 */
export async function purgerOrphelins(pool, { aBlanc = false, partMax = PART_MAX } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    const compte = await compterOrphelins(client);
    const verdict = verdictPurge(compte, partMax);

    if (aBlanc || !verdict.purger) {
      await client.query('ROLLBACK');
      return { ...compte, ...verdict, purge: null };
    }

    const rubriques = await client.query(`DELETE FROM docs.rcp_sections s WHERE ${absent('s')}`);
    const documents = await client.query(`DELETE FROM docs.document_parse p WHERE ${absent('p')}`);
    await client.query('COMMIT');
    return { ...compte, ...verdict, purge: { rubriques: rubriques.rowCount, documents: documents.rowCount } };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
