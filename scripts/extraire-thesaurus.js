/**
 * Extrait du thésaurus ANSM (PDF conservé dans sources/ansm/) les groupes de
 * substances, tels quels, dans data/thesaurus-ansm/groupes.json, et régénère
 * les listes qui en sont la copie (data/listes/torsadogenes.json).
 *
 *   npm run extraire-thesaurus
 *
 * Nécessite pdftotext (poppler). Le résultat est versionné : son diff se relit
 * comme celui d'une source, et un test vérifie que les listes n'en dévient pas.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from '../src/config.js';
import { lireGroupes, idGroupe, formulations } from '../src/thesaurus-ansm.js';
import { deaccent } from '../src/text.js';

const SOURCE = {
  titre: 'ANSM — Thésaurus des interactions médicamenteuses',
  version: '15 septembre 2023, version finale : l’ANSM a cessé de le mettre à jour et renvoie aux RCP',
  date: '15 septembre 2023',
  url: 'https://ansm.sante.fr/documents/reference/thesaurus-des-interactions-medicamenteuses-1',
  fichier: 'sources/ansm/20230915-thesaurus-interactions-medicamenteuses-septembre-2023.pdf',
};

/**
 * Abréviations que le thésaurus emploie lui-même pour un groupe. Chacune
 * n'est retenue que si le thésaurus l'écrit : le nombre d'occurrences est
 * consigné, et une abréviation absente du texte fait échouer l'extraction.
 */
const ABREVIATIONS = [
  ['AINS', 'ANTI-INFLAMMATOIRES NON STÉROÏDIENS'],
  ['IEC', 'INHIBITEURS DE L\'ENZYME DE CONVERSION'],
  ['AVK', 'ANTIVITAMINES K'],
  ['IPP', 'ANTISÉCRÉTOIRES INHIBITEURS DE LA POMPE À PROTONS'],
];

/** Listes de data/listes/ qui sont la copie d'un groupe du thésaurus. */
const LISTES = { torsadogenes: 'SUBSTANCES SUSCEPTIBLES DE DONNER DES TORSADES DE POINTES' };

const texte = execFileSync('pdftotext', ['-layout', path.join(ROOT, SOURCE.fichier), '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const groupes = lireGroupes(texte);
const parNom = new Map(groupes.map((groupe) => [groupe.nom, groupe]));

const abreviations = new Map();
for (const [abreviation, nom] of ABREVIATIONS) {
  const occurrences = (texte.match(new RegExp(`(^|[^A-Za-z])${abreviation}([^A-Za-z]|$)`, 'g')) ?? []).length;
  if (!occurrences) throw new Error(`« ${abreviation} » n'apparaît pas dans le thésaurus : retirer l'abréviation`);
  if (!parNom.has(nom)) throw new Error(`groupe introuvable : ${nom}`);
  abreviations.set(nom, [...(abreviations.get(nom) ?? []), { terme: abreviation, occurrences }]);
}

const sortie = {
  source: SOURCE,
  extrait_le: new Date().toISOString().slice(0, 10),
  note: 'Groupes de substances du thésaurus, repris tels quels (nom, membres, description). Les formulations cherchées dans les RCP sont le nom du groupe sans ses précisions entre parenthèses, l’autre nom que la parenthèse lui donne, et les abréviations que le thésaurus emploie pour lui. Fichier généré par scripts/extraire-thesaurus.js : ne pas modifier à la main.',
  groupes: groupes.map((groupe) => ({
    id: idGroupe(groupe.nom),
    nom: groupe.nom,
    membres: groupe.membres,
    description: groupe.description,
    termes: formulations(groupe.nom, (abreviations.get(groupe.nom) ?? []).map((abreviation) => abreviation.terme)),
    abreviations: abreviations.get(groupe.nom) ?? [],
  })),
};
mkdirSync(path.join(ROOT, 'data', 'thesaurus-ansm'), { recursive: true });
writeFileSync(path.join(ROOT, 'data', 'thesaurus-ansm', 'groupes.json'), `${JSON.stringify(sortie, null, 2)}\n`);
console.log(`${sortie.groupes.length} groupes → data/thesaurus-ansm/groupes.json`);

// Listes copiées d'un groupe : membres tels quels, restriction citée de la description.
const plier = (mot) => deaccent(mot).toLowerCase();
for (const [liste, nom] of Object.entries(LISTES)) {
  const groupe = parNom.get(nom);
  if (!groupe) throw new Error(`groupe introuvable pour la liste ${liste} : ${nom}`);
  const fichier = path.join(ROOT, 'data', 'listes', `${liste}.json`);
  const ancienne = JSON.parse(readFileSync(fichier, 'utf8'));
  // « Pour l'érythromycine et la vincamine, seules les formes administrées par voie intraveineuse… »
  const restrictions = groupe.description.split(/(?<=\.)\s+/).filter((phrase) => /seules? les formes/i.test(phrase));
  const nouvelle = {
    titre: ancienne.titre,
    source: { ...SOURCE, groupe: nom },
    extraite_le: sortie.extrait_le,
    note: 'Copie exacte du groupe du thésaurus : ni ajout ni retrait. C’est l’ANSM qui dit qu’une substance en fait partie. Régénérée par scripts/extraire-thesaurus.js.',
    inscriptions: groupe.membres.map((membre) => {
      const restriction = restrictions.find((phrase) => plier(phrase).includes(plier(membre)));
      return { substance: plier(membre), ...(restriction ? { restriction } : {}) };
    }),
  };
  writeFileSync(fichier, `${JSON.stringify(nouvelle, null, 2)}\n`);
  console.log(`${nouvelle.inscriptions.length} substances → data/listes/${liste}.json`);
}
