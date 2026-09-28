/**
 * Contrôle la fraîcheur des données ; sort en erreur si un contrôle est en rupture.
 * À enchaîner après chaque chargement.
 *   npm run check-donnees
 *   npm run check-donnees -- --tolerant   n'échoue pas, se contente de dire
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from '../src/config.js';
import { createPool } from '../src/db.js';
import { falaise, plancher, age } from '../src/controles.js';

const TOLERANT = process.argv.includes('--tolerant');
const MAINTENANT = new Date();
const pool = createPool({ statement_timeout: 0 });

const pct = (part) => (part === null ? '—' : `${(part * 100).toFixed(1)} %`);
const verdicts = [];

/** Un état inconnu (ex. « pas de norme » de `falaise`) donne « indéterminable », jamais « rupture ». */
const verdict = (etat) => (['ok', 'alerte', 'rupture'].includes(etat) ? etat : 'indeterminable');

const dire = (etat, titre, detail) => {
  const marque = {
    ok: '  ok   ',
    alerte: '  alerte',
    rupture: '  RUPTURE',
    indeterminable: '  ?    ',
  }[etat] ?? '  ?    ';
  console.log(`${marque}  ${titre}`);
  if (detail) console.log(`          ${detail}`);
  verdicts.push({ etat, titre });
};

/** Cohortes d'AMM : les entrées récentes sont-elles traitées comme le reste ? */
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
    verdict(docs.etat),
    `Collecte des documents — norme ${pct(docs.reference)}`,
    docs.ruptures.length > 0
      ? `effondrement sur ${docs.ruptures.map((rupture) => `${rupture.periode} (${pct(rupture.couverture)})`).join(', ')}`
        + ` — dernière année conforme : ${docs.derniereSaine ?? 'aucune'}`
      : docs.alertes.length > 0
        ? `en retrait sur ${docs.alertes.map((alerte) => `${alerte.periode} (${pct(alerte.couverture)})`).join(', ')}`
        : null,
  );

  // ---- 2. La classification ATC suit-elle ? ------------------------------
  // Source annuelle : les AMM de l'année manquent légitimement. Alerte, rupture seulement si effondrement.
  const atc = falaise(
    await cohortes(`EXISTS (SELECT 1 FROM ref.cis_atc_mapping a WHERE a.code_cis = m.code_cis)`),
    { seuilRupture: 0.25, seuilAlerte: 0.7 },
  );
  dire(
    verdict(atc.etat),
    `Classification ATC — norme ${pct(atc.reference)}`,
    atc.ruptures.length > 0
      ? `effondrement sur ${atc.ruptures.map((rupture) => `${rupture.periode} (${pct(rupture.couverture)})`).join(', ')}`
      : atc.alertes.length > 0
        ? `en retrait sur ${atc.alertes.map((alerte) => `${alerte.periode} (${pct(alerte.couverture)})`).join(', ')}`
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
  const verdictDecoupe = plancher(decoupe, { minimum: 0.95, libelle: 'Découpage des documents collectés' });
  dire(verdictDecoupe.etat, `${verdictDecoupe.libelle} — ${pct(verdictDecoupe.part)}`,
    verdictDecoupe.etat === 'rupture' ? `attendu au moins ${pct(verdictDecoupe.minimum)} — relancer build-sections` : null);

  // ---- 4. Depuis quand rien n'a été écrit ? ------------------------------
  // Seule la date de dernière écriture n'est pas masquée par une moyenne.
  const { rows: [dates] } = await pool.query(
    `SELECT (SELECT max(last_updated) FROM dbpm.cis_documents)  AS collecte,
            (SELECT max(parsed_at)    FROM docs.document_parse) AS decoupage,
            (SELECT max(date_amm)     FROM dbpm.cis_bdpm)       AS amm`,
  );

  // Pas de contrôle sur l'AMM la plus récente : elle vieillit d'elle-même, rechargement ou non.
  // La fraîcheur du chargement se vérifie dans incident_scraper (`npm run check-bdpm`).
  for (const [cle, libelle, alerte, rupture] of [
    ['collecte', 'Dernière collecte de document', 90, 365],
    ['decoupage', 'Dernier découpage', 90, 365],
  ]) {
    const jours = age(dates[cle], MAINTENANT);
    const etat = jours === null ? 'indeterminable'
      : jours >= rupture ? 'rupture' : jours >= alerte ? 'alerte' : 'ok';
    dire(etat, `${libelle} — ${jours === null ? 'date absente' : `il y a ${jours} jours`}`,
      etat === 'rupture' ? `au-delà de ${rupture} jours, la chaîne est à l'arrêt` : null);
  }

  // Listes relevées à la main, sans source rechargeable : alerte si non vérifiées
  // ou relevées il y a 60 jours ou plus (l'ANSM les modifie souvent).
  {
    const biosimilaires = JSON.parse(readFileSync(path.join(ROOT, 'data', 'biosimilaires.json'), 'utf8'));
    for (const [libelle, bloc, date] of [
      ['Liste des biosimilaires (ANSM)', biosimilaires.source, biosimilaires.source.mise_a_jour],
      ['Biosimilaires substituables (arrêté)', biosimilaires.substitution, biosimilaires.substitution?.arrete_le],
    ]) {
      const jours = age(bloc?.extraite_le ?? date, MAINTENANT);
      const etat = !bloc?.verifiee_le || jours === null || jours >= 60 ? 'alerte' : 'ok';
      dire(etat, `${libelle} — texte du ${date ?? '?'}, relevé il y a ${jours ?? '?'} jours`,
        !bloc?.verifiee_le ? 'jamais vérifiée contre la source : dater verifiee_le dans data/biosimilaires.json'
          : jours >= 60 ? 'à relever de nouveau sur le site de l\'ANSM' : null);
    }
  }

  // Indicatif, sans verdict : mesure le rythme des octrois, pas la chaîne.
  console.log(`         AMM la plus récente octroyée — ${
    dates.amm ? `${age(dates.amm, MAINTENANT)} jours` : 'date absente'
  } (indicatif ; fraîcheur du chargement : check-bdpm)`);

  const ruptures = verdicts.filter((constat) => constat.etat === 'rupture');
  const flous = verdicts.filter((constat) => constat.etat === 'indeterminable');
  console.log(`\n${verdicts.length} contrôles — ${ruptures.length} en rupture, `
    + `${verdicts.filter((constat) => constat.etat === 'alerte').length} en alerte`
    + `${flous.length > 0 ? `, ${flous.length} sans verdict` : ''}\n`);

  if (ruptures.length > 0 && !TOLERANT) process.exitCode = 1;
} finally {
  await pool.end();
}
