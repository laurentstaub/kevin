/**
 * Couverture de data/classes-interactions.json, pour la relecture : pour chaque
 * classe, combien de spécialités elle rattache, et combien de rubriques 4.5 la
 * nomment, terme par terme. Un terme à 0 n'est employé par aucun RCP ; un terme
 * très fréquent mérite qu'on vérifie qu'il désigne bien la classe. Lecture seule.
 *
 *   npm run couverture-classes            toutes les classes
 *   npm run couverture-classes -- ains    une classe (par son id)
 */

import { createPool } from '../src/db.js';
import { CLASSES, motif } from '../src/interactions.js';

const filtre = process.argv[2];
const classes = CLASSES.filter((classe) => !filtre || classe.id === filtre);
// Un balayage complet des rubriques 4.5 : au-delà du délai des requêtes de l'application.
const pool = createPool({ statement_timeout: 0 });

const nombre = (valeur) => Number(valeur).toLocaleString('fr-FR');

try {
  // Texte plié une fois, puis un décompte par motif dans le même balayage.
  const motifs = classes.flatMap((classe) => [
    { classe: classe.id, terme: null, source: motif([], classe.termes) },
    ...classe.termes.map((terme) => ({ classe: classe.id, terme, source: motif([], [terme]) })),
  ]);
  const colonnes = motifs.map((_, i) => `count(DISTINCT code_cis) FILTER (WHERE t ~ $${i + 1})::int AS m${i}`);
  const { rows: [usages] } = await pool.query(
    `WITH r AS (
       SELECT code_cis, public.f_unaccent(lower(texte)) AS t
       FROM docs.rcp_sections WHERE numero = '4.5' AND document_type = 'rcp'
     )
     SELECT count(DISTINCT code_cis)::int AS total, ${colonnes.join(', ')} FROM r`,
    motifs.map((entree) => entree.source),
  );

  const membres = await Promise.all(classes.map(async (classe) => {
    if (!classe.atc?.length) return null;
    const { rows } = await pool.query(
      `SELECT count(DISTINCT a.code_cis)::int AS n
       FROM ref.cis_atc_mapping a
       JOIN dbpm.cis_bdpm m ON m.code_cis = a.code_cis AND m.etat_commercialisation = 'Commercialisée'
       WHERE a.atc_code LIKE ANY($1::text[]) AND NOT a.atc_code LIKE ANY($2::text[])`,
      [classe.atc.map((prefixe) => `${prefixe}%`), (classe.exclure ?? []).map((prefixe) => `${prefixe}%`)],
    );
    return rows[0].n;
  }));

  console.log(`\nRubriques 4.5 lues : ${nombre(usages.total)} RCP\n`);
  console.log('| Classe | Rattachement | Spécialités commercialisées | RCP qui la nomment |');
  console.log('|---|---|---|---|');
  classes.forEach((classe, i) => {
    const rang = motifs.findIndex((entree) => entree.classe === classe.id && entree.terme === null);
    const rattachement = classe.liste ? `liste ${classe.liste}` : classe.atc.join(', ');
    const effectif = membres[i] === null ? '—' : nombre(membres[i]);
    console.log(`| ${classe.nom} | ${rattachement} | ${effectif} | ${nombre(usages[`m${rang}`])} |`);
  });

  console.log('\nPar terme :\n');
  for (const classe of classes) {
    console.log(`  ${classe.nom}`);
    motifs.forEach((entree, rang) => {
      if (entree.classe !== classe.id || entree.terme === null) return;
      console.log(`    ${entree.terme.padEnd(64)} ${nombre(usages[`m${rang}`]).padStart(6)}`);
    });
  }
} finally {
  await pool.end();
}
