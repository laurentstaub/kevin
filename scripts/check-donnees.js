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

/**
 * Un état que la marque ne connaît pas n'est pas une rupture.
 *
 * `falaise` prend soin de distinguer « effondrement » de « je n'ai pas su
 * juger » — norme introuvable, norme trop basse. L'appel écrasait la nuance
 * d'un `etat === 'ok' ? … : 'rupture'`, et l'on a lu « RUPTURE — norme — »
 * là où il fallait lire « pas de norme, donc pas de verdict ». Un contrôle qui
 * crie faute de savoir est pire qu'un contrôle absent : on cherche la panne
 * qu'il annonce au lieu de celle qui l'empêche de juger.
 */
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
    verdict(docs.etat),
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
    verdict(atc.etat),
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

  // « AMM la plus récente en base » a été retirée des contrôles : elle mesurait
  // le monde, pas notre chaîne.
  //
  // Une AMM octroyée le 2 avril reste la plus récente quel que soit le nombre
  // de rechargements — les octrois sont rares et publiés avec du retard, si
  // bien que l'indicateur vieillit tout seul et réclamerait un rechargement
  // qui ne le rajeunirait pas. Il a fait perdre du temps une fois ; il ne le
  // fera pas deux.
  //
  // La fraîcheur réelle se mesure ailleurs et autrement : le millésime du
  // dernier fichier téléchargé, comparé à celui publié par la BDPM. Ce
  // décompte-là vit dans incident_scraper (`.bdpm_version.json`,
  // `npm run check-bdpm`), qui est le dépôt qui charge `dbpm.*`. On l'affiche
  // ici pour mémoire, sans seuil, parce qu'un chiffre sans verdict ne peut pas
  // se faire passer pour une panne.
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

  // Pour mémoire, sans verdict : c'est une propriété du monde pharmaceutique,
  // pas de notre chaîne. La fraîcheur du chargement se contrôle avec
  // `npm run check-bdpm`, dans incident_scraper.
  console.log(`         AMM la plus récente octroyée — ${
    dates.amm ? `${age(dates.amm, MAINTENANT)} jours` : 'date absente'
  } (indicatif ; fraîcheur du chargement : check-bdpm)`);

  const ruptures = verdicts.filter((x) => x.etat === 'rupture');
  const flous = verdicts.filter((x) => x.etat === 'indeterminable');
  console.log(`\n${verdicts.length} contrôles — ${ruptures.length} en rupture, `
    + `${verdicts.filter((x) => x.etat === 'alerte').length} en alerte`
    + `${flous.length > 0 ? `, ${flous.length} sans verdict` : ''}\n`);

  if (ruptures.length > 0 && !TOLERANT) process.exitCode = 1;
} finally {
  await pool.end();
}
