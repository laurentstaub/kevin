/**
 * Couverture des groupes du thésaurus ANSM dans les RCP : pour chaque groupe,
 * combien de rubriques 4.5 emploient ses formulations, terme par terme. Un
 * terme à 0 n'est employé par aucun RCP. Lecture seule ; les groupes eux-mêmes
 * viennent du thésaurus (npm run extraire-thesaurus) et ne se corrigent pas ici.
 *
 *   npm run couverture-classes                  tous les groupes
 *   npm run couverture-classes -- antivitamines-k   un groupe (par son id)
 */

import { createPool } from '../src/db.js';
import { GROUPES, motif } from '../src/interactions.js';

const filtre = process.argv[2];
const groupes = GROUPES.filter((groupe) => !filtre || groupe.id === filtre);
// Un balayage complet des rubriques 4.5 : au-delà du délai des requêtes de l'application.
const pool = createPool({ statement_timeout: 0 });

const nombre = (valeur) => Number(valeur).toLocaleString('fr-FR');

try {
  // Texte plié une fois, puis un décompte par terme dans le même balayage.
  const motifs = groupes.flatMap((groupe) => groupe.termes.map((terme) => ({ groupe: groupe.id, terme, source: motif([], [terme]) })));
  const colonnes = motifs.map((_, i) => `count(DISTINCT code_cis) FILTER (WHERE t ~ $${i + 1})::int AS m${i}`);
  const { rows: [usages] } = await pool.query(
    `WITH r AS (
       SELECT code_cis, public.f_unaccent(lower(texte)) AS t
       FROM docs.rcp_sections WHERE numero = '4.5' AND document_type = 'rcp'
     )
     SELECT count(DISTINCT code_cis)::int AS total, ${colonnes.join(', ')} FROM r`,
    motifs.map((entree) => entree.source),
  );

  console.log(`${nombre(usages.total)} rubriques 4.5 lues, ${groupes.length} groupe(s)\n`);
  for (const groupe of groupes) {
    console.log(`${groupe.nom} — ${groupe.membres.length} membre(s)`);
    motifs.forEach((entree, i) => {
      if (entree.groupe === groupe.id) console.log(`   ${String(nombre(usages[`m${i}`])).padStart(6)}  ${entree.terme}`);
    });
  }
} finally {
  await pool.end();
}
