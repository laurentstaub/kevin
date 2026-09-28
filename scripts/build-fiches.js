/**
 * Calcule les fiches : pour chaque substance de chaque liste, la spécialité
 * représentative et les phrases de son RCP.
 *
 *   npm run build-fiches
 *
 * Écrit, pour chaque fiche portant une liste :
 *   data/fiches/<nom>.json            ce que la page publiera — à relire en diff
 *   data/fiches/<nom>.candidats.md    ce que la recherche propose d'ajouter —
 *                                     jamais publié, à trancher à la lecture
 *
 * Le calcul est versionné plutôt que stocké en base : une fiche est une
 * publication, et ce qui change d'un millésime à l'autre doit se lire avant
 * de paraître. `git diff data/fiches/` est la relecture.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from '../src/config.js';
import { createPool } from '../src/db.js';
import { listerFiches, DOSSIER_CALCULS } from '../src/fiches.js';
import {
  REQUETE_SUBSTANCE, motifSubstance, choisirCitations, dejaInscrite,
} from '../src/fiches-calcul.js';
import { chercherDansDocuments, PLAFOND } from '../src/recherche-texte.js';

const pool = createPool({ statement_timeout: 0 });
mkdirSync(DOSSIER_CALCULS, { recursive: true });

const lireListe = (nom) => {
  const chemin = path.join(ROOT, 'data', 'listes', `${nom}.json`);
  if (!existsSync(chemin)) throw new Error(`liste introuvable : data/listes/${nom}.json`);
  return JSON.parse(readFileSync(chemin, 'utf8'));
};

/** Les molécules dont les rubriques parlent des termes, page après page. */
async function toutesLesTrouvailles(termes, rubriques) {
  const vues = new Map();
  for (const rubrique of rubriques) {
    for (let decalage = 0; decalage < PLAFOND; decalage += 100) {
      const d = await chercherDansDocuments(pool, termes.join(' '), { rubrique, limite: 100, decalage });
      for (const r of d.resultats) {
        const deja = vues.get(r.molecule);
        if (deja) deja.rubriques.add(rubrique);
        else vues.set(r.molecule, { ...r, rubriques: new Set([rubrique]) });
      }
      if (!d.suite) break;
    }
  }
  return [...vues.values()];
}

let enErreur = 0;

try {
  for (const fiche of listerFiches()) {
    const blocListe = fiche.blocs.find((b) => b.type === 'directive' && b.nom === 'substances');
    if (!blocListe) continue;
    const blocCitations = fiche.blocs.find((b) => b.type === 'directive' && b.nom === 'citations');
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

    // Tri par substance : un ordre stable fait des diffs lisibles.
    lignes.sort((a, b) => a.substance.localeCompare(b.substance, 'fr'));

    writeFileSync(path.join(DOSSIER_CALCULS, `${fiche.slug}.json`), `${JSON.stringify({
      slug: fiche.slug,
      calcule_le: new Date().toISOString().slice(0, 10),
      liste: {
        titre: liste.titre, amorce: liste.amorce,
        relu_par: liste.relu_par, relu_le: liste.relu_le,
      },
      rubriques,
      termes,
      lignes,
    }, null, 2)}\n`);

    // Les candidats : ce dont la recherche parle et que la liste ne contient
    // pas. La recherche trouve des mentions, pas des affirmations — « aucun
    // allongement du QT » remonte comme le reste. D'où la phrase, pour
    // trancher à la lecture, et d'où ce fichier, qui n'est jamais publié.
    if (termes.length) {
      const trouvees = await toutesLesTrouvailles(termes, rubriques);
      const candidats = trouvees
        .filter((t) => !t.sansMolecule && !dejaInscrite(t.molecule, liste.inscriptions))
        .sort((a, b) => a.molecule.localeCompare(b.molecule, 'fr'));

      const texte = [
        `# Candidats — ${fiche.slug}`,
        '',
        `Molécules dont les rubriques ${rubriques.join(', ')} parlent de « ${termes.join(' ')} » sans être dans la liste \`${blocListe.argument}\`. **Jamais publié.**`,
        '',
        'La recherche trouve des mentions, pas des affirmations : lire la phrase avant d\'inscrire. Une négation (« aucun allongement… n\'a été observé ») ne justifie pas une inscription.',
        '',
        `${candidats.length} candidat(s), calculé le ${new Date().toISOString().slice(0, 10)}.`,
        '',
        ...candidats.flatMap((c) => [
          `## ${c.molecule}`,
          '',
          `${c.specialites} spécialité(s) · rubriques ${[...c.rubriques].join(', ')} · [${c.denomination}](/product/${c.code_cis}#${c.ancre})`,
          '',
          `> ${String(c.extrait).replace(/<\/?mark>/g, '**')}`,
          '',
        ]),
      ].join('\n');
      writeFileSync(path.join(DOSSIER_CALCULS, `${fiche.slug}.candidats.md`), `${texte}\n`);
      console.log(`  → ${candidats.length} candidat(s) à trancher : data/fiches/${fiche.slug}.candidats.md`);
    }

    console.log(`  ✓ ${Math.round((Date.now() - depart) / 1000)} s`);
  }
} catch (err) {
  console.error(`✗ ${err.message}`);
  enErreur = 1;
} finally {
  await pool.end();
}

process.exitCode = enErreur;
