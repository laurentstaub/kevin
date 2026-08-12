/**
 * check-donnees.js — les données sont-elles encore fraîches ?
 *
 * Sort en erreur si un contrôle est en rupture. C'est tout l'intérêt : un
 * rapport qu'on lit quand on soupçonne déjà quelque chose n'aurait rien
 * empêché. La collecte des documents s'est arrêtée à la charnière 2023-2024 et
 * deux ans ont passé sans qu'un indicateur ne bouge.
 *
 *   npm run check-donnees
 *   npm run check-donnees -- --tolerant   n'échoue pas, se contente de dire
 *
 * À enchaîner après chaque chargement, pas à lancer quand on s'inquiète.
 */

import { createPool } from '../src/db.js';
import { falaise, plancher, age } from '../src/controles.js';

const TOLERANT = process.argv.includes('--tolerant');
const MAINTENANT = new Date();
const pool = createPool({ statement_timeout: 0 });

const pct = (x) => (x === null ? '—' : `${(x * 100).toFixed(1)} %`);
const verdicts = [];

const dire = (etat, titre, detail) => {
  const marque = { ok: '  ok   ', alerte: '  alerte', rupture: '  RUPTURE' }[etat] ?? '  ?    ';
  console.log(`${marque}  ${titre}`);
  if (detail) console.log(`          ${detail}`);
  verdicts.push({ etat, titre });
};

/** Cohortes d'AMM : « ce qui est entré récemment a-t-il été traité comme le reste ». */
async function cohortes(condition) {
  const { rows } = await pool.query(
    `SELECT extract(year FROM m.date_amm)::int AS periode,
            count(*) FILTER (WHERE ${condition})::int     AS avec,
            count(*) FILTER (WHERE NOT (${condition}))::int AS sans
     FROM dbpm.cis_bdpm m
     WHERE m.date_amm IS NOT NULL
       AND EXISTS (SELECT 1 FROM dbpm.cis_cip_bdpm p
                   WHERE p.code_cis = m.code_cis
                     AND p.etat_commercialisation ILIKE 'Déclaration de commercialisation%')
       AND coalesce(m.type_procedure_amm, '') !~* 'importation\\s+parall|hom[ée]o|phyto'
     GROUP BY 1`,
  );
  return rows;
}

try {
  console.log('\nFraîcheur des données\n');

  // ---- 1. La collecte des documents tourne-t-elle encore ? ----------------
  const docs = falaise(await cohortes(
    `EXISTS (SELECT 1 FROM dbpm.cis_documents d WHERE d.code_cis = m.code_cis)`,
  ));
  dire(
    docs.etat === 'ok' ? 'ok' : docs.etat === 'alerte' ? 'alerte' : 'rupture',
    `Collecte des documents — norme ${pct(docs.reference)}`,
    docs.ruptures.length > 0
      ? `effondrement sur ${docs.ruptures.map((c) => `${c.periode} (${pct(c.couverture)})`).join(', ')}`
        + ` — dernière année conforme : ${docs.derniereSaine ?? 'aucune'}`
      : docs.alertes.length > 0
        ? `en retrait sur ${docs.alertes.map((c) => `${c.periode} (${pct(c.couverture)})`).join(', ')}`
        : null,
  );

  // ---- 2. La classification ATC suit-elle ? ------------------------------
  // Sa source est annuelle : les AMM de l'année en cours y sont légitimement
  // absentes. C'est une alerte, jamais une rupture — sauf effondrement franc.
  const atc = falaise(
    await cohortes(`EXISTS (SELECT 1 FROM ref.cis_atc_mapping a WHERE a.code_cis = m.code_cis)`),
    { seuilRupture: 0.25, seuilAlerte: 0.7 },
  );
  dire(
    atc.etat === 'ok' ? 'ok' : atc.etat === 'alerte' ? 'alerte' : 'rupture',
    `Classification ATC — norme ${pct(atc.reference)}`,
    atc.ruptures.length > 0
      ? `effondrement sur ${atc.ruptures.map((c) => `${c.periode} (${pct(c.couverture)})`).join(', ')}`
      : atc.alertes.length > 0
        ? `en retrait sur ${atc.alertes.map((c) => `${c.periode} (${pct(c.couverture)})`).join(', ')}`
        : null,
  );

  // ---- 3. Ce qui a été collecté a-t-il été découpé ? ---------------------
  const { rows: [decoupe] } = await pool.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM docs.rcp_sections r
                                           WHERE r.code_cis = d.code_cis))::int AS ok
     FROM (SELECT DISTINCT code_cis FROM dbpm.cis_documents
           WHERE coalesce(html_content, '') <> '' OR coalesce(file_path, '') <> '') d`,
  );
  const v = plancher(decoupe, { minimum: 0.95, libelle: 'Découpage des documents collectés' });
  dire(v.etat, `${v.libelle} — ${pct(v.part)}`,
    v.etat === 'rupture' ? `attendu au moins ${pct(v.minimum)} — relancer build-sections` : null);

  // ---- 4. Depuis quand rien n'a été écrit ? ------------------------------
  // La date de la dernière écriture est le seul chiffre qui ne se laisse pas
  // tromper par une moyenne : elle dit tout net quand le robinet s'est fermé.
  const { rows: [dates] } = await pool.query(
    `SELECT (SELECT max(last_updated) FROM dbpm.cis_documents)  AS collecte,
            (SELECT max(parsed_at)    FROM docs.document_parse) AS decoupage,
            (SELECT max(date_amm)     FROM dbpm.cis_bdpm)       AS amm`,
  );
  for (const [cle, libelle, alerte, rupture] of [
    ['collecte', 'Dernière collecte de document', 90, 365],
    ['decoupage', 'Dernier découpage', 90, 365],
    ['amm', 'AMM la plus récente en base', 120, 365],
  ]) {
    const jours = age(dates[cle], MAINTENANT);
    const etat = jours === null ? 'indeterminable'
      : jours >= rupture ? 'rupture' : jours >= alerte ? 'alerte' : 'ok';
    dire(etat, `${libelle} — ${jours === null ? 'date absente' : `il y a ${jours} jours`}`,
      etat === 'rupture' ? `au-delà de ${rupture} jours, la chaîne est à l'arrêt` : null);
  }

  const ruptures = verdicts.filter((x) => x.etat === 'rupture');
  console.log(`\n${verdicts.length} contrôles — ${ruptures.length} en rupture, `
    + `${verdicts.filter((x) => x.etat === 'alerte').length} en alerte\n`);

  if (ruptures.length > 0 && !TOLERANT) process.exitCode = 1;
} finally {
  await pool.end();
}
