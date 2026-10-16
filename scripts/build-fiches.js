/**
 * Calcule, pour chaque substance de chaque liste, la spécialité représentative et ses phrases de RCP.
 *   npm run build-fiches
 * Écrit data/fiches/<nom>.json. Les listes sont la copie d'un groupe du thésaurus ANSM :
 * aucune molécule n'y est proposée ni ajoutée ici (scripts/extraire-thesaurus.js).
 * Versionné plutôt qu'en base : `git diff data/fiches/` sert de relecture avant publication.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from '../src/config.js';
import { createPool } from '../src/db.js';
import { listerFiches, DOSSIER_CALCULS } from '../src/fiches.js';
import { REQUETE_SUBSTANCE, motifSubstance, choisirCitations } from '../src/fiches-calcul.js';

const pool = createPool({ statement_timeout: 0 });
mkdirSync(DOSSIER_CALCULS, { recursive: true });

const lireListe = (nom) => {
  const chemin = path.join(ROOT, 'data', 'listes', `${nom}.json`);
  if (!existsSync(chemin)) throw new Error(`liste introuvable : data/listes/${nom}.json`);
  return JSON.parse(readFileSync(chemin, 'utf8'));
};

let enErreur = 0;

try {
  for (const fiche of listerFiches()) {
    const blocListe = fiche.blocs.find((bloc) => bloc.type === 'directive' && bloc.nom === 'substances');
    if (!blocListe) continue;
    const blocCitations = fiche.blocs.find((bloc) => bloc.type === 'directive' && bloc.nom === 'citations');
    const rubriques = blocCitations?.options.rubriques ?? ['4.4', '4.5'];
    const termes = blocCitations?.options.termes ?? [];

    const liste = lireListe(blocListe.argument);
    const depart = Date.now();
    console.log(`\n${fiche.slug} — ${liste.inscriptions.length} inscription(s), rubriques ${rubriques.join(', ')}`);

    const lignes = [];
    for (const inscription of liste.inscriptions) {
      const { rows } = await pool.query(REQUETE_SUBSTANCE, [motifSubstance(inscription.substance), rubriques]);
      const choix = choisirCitations(rows, termes);
      lignes.push({ ...inscription, ...choix });
      const etat = choix.manque ? (choix.specialite ? 'aucune phrase' : 'aucune spécialité commercialisée') : `${choix.citations.length} phrase(s)`;
      console.log(`  ${inscription.substance.padEnd(28)} ${etat}`);
    }

    // Ordre stable pour des diffs lisibles.
    lignes.sort((a, b) => a.substance.localeCompare(b.substance, 'fr'));

    writeFileSync(path.join(DOSSIER_CALCULS, `${fiche.slug}.json`), `${JSON.stringify({
      slug: fiche.slug,
      calcule_le: new Date().toISOString().slice(0, 10),
      liste: {
        // Copie d'un groupe du thésaurus : la source et sa date d'extraction, pas de relecture.
        titre: liste.titre, source: liste.source, extraite_le: liste.extraite_le,
      },
      rubriques,
      termes,
      lignes,
    }, null, 2)}\n`);

    console.log(`  ✓ ${Math.round((Date.now() - depart) / 1000)} s`);
  }
} catch (err) {
  console.error(`✗ ${err.message}`);
  enErreur = 1;
} finally {
  await pool.end();
}

process.exitCode = enErreur;
