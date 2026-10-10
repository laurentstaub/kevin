/**
 * Compare les modèles sur l'interprétation de questions de comptoir (option A).
 * Chaque modèle reçoit les mêmes questions ; on note la rubrique et la molécule
 * trouvées, et le temps de réponse. Les modèles sans clé sont sautés.
 *   npm run comparer-ia
 *   IA_COMPARER="mistral:ministral-8b-latest,anthropic:claude-haiku-5-5" npm run comparer-ia
 */

import { config } from '../src/config.js';
import { appelerModele, validerInterpretation } from '../src/ia.js';
import { deaccent } from '../src/text.js';

const MODELES = (process.env.IA_COMPARER
  ?? 'mistral:ministral-3b-latest,mistral:ministral-8b-latest,mistral:mistral-small-latest,anthropic:claude-haiku-5-5')
  .split(',')
  .map((entree) => entree.trim().split(':'))
  .map(([fournisseur, modele]) => ({ fournisseur, modele }));

/** Questions de comptoir : rubriques et molécules acceptées. */
const QUESTIONS = [
  ['puis-je donner du tramadol à une femme qui allaite ?', ['4.6'], ['tramadol']],
  ['doliprane dose maximale par jour chez l’adulte ?', ['4.2'], ['doliprane', 'paracetamol']],
  ['le kardegic est-il contre-indiqué en cas d’ulcère ?', ['4.3'], ['kardegic', 'acetylsalicyl']],
  ['interaction entre clarithromycine et simvastatine ?', ['4.5'], ['clarithromycine', 'simvastatine']],
  ['l’amoxicilline peut-elle être prise pendant la grossesse ?', ['4.6'], ['amoxicilline']],
  ['quels effets indésirables avec la prégabaline ?', ['4.8'], ['pregabaline', 'lyrica']],
  ['levothyrox et conduite automobile ?', ['4.7'], ['levothyrox', 'levothyroxine']],
  ['que faire en cas de surdosage de paracétamol ?', ['4.9'], ['paracetamol']],
  ['faut-il adapter la dose de metformine en insuffisance rénale ?', ['4.2', '4.4'], ['metformine']],
  ['le xarelto contient-il du lactose ?', ['6.1', '4.4'], ['xarelto', 'rivaroxaban']],
  ['comment conserver la lantus après ouverture ?', ['6.4', '6.3'], ['lantus', 'insuline glargine']],
  ['la dompéridone allonge-t-elle le QT ?', ['4.4', '4.8'], ['domperidone']],
  ['ibuprofène et anticoagulants, est-ce dangereux ?', ['4.5'], ['ibuprofene']],
  ['quelle posologie d’amoxicilline chez l’enfant de 20 kg ?', ['4.2'], ['amoxicilline']],
  ['le méthotrexate se prend-il une fois par semaine ?', ['4.2'], ['methotrexate']],
  ['isotrétinoïne et contraception obligatoire ?', ['4.4', '4.6'], ['isotretinoine']],
  ['peut-on écraser les comprimés de seroplex ?', ['4.2'], ['seroplex', 'escitalopram']],
  ['codéine chez le métaboliseur ultra-rapide du CYP2D6 ?', ['4.4', '5.2'], ['codeine']],
  ['au bout de combien de temps agit le zolpidem ?', ['5.2', '5.1'], ['zolpidem']],
  ['quels médicaments sont contre-indiqués avec la colchicine ?', ['4.3', '4.5'], ['colchicine']],
];

const cle = (texte) => deaccent(String(texte ?? '')).toLowerCase();
const cleDe = (fournisseur) => (fournisseur === 'anthropic' ? config.ia.cleAnthropic : config.ia.cleMistral);

const actifs = MODELES.filter(({ fournisseur }) => cleDe(fournisseur));
for (const { fournisseur, modele } of MODELES) {
  if (!cleDe(fournisseur)) console.log(`(sauté : ${fournisseur}:${modele}, pas de clé)`);
}
if (actifs.length === 0) {
  console.log('Aucune clé : renseigner MISTRAL_API_KEY et/ou ANTHROPIC_API_KEY dans .env.');
  process.exit(1);
}

const bilan = new Map(actifs.map(({ modele }) => [modele, { rubrique: 0, molecule: 0, ms: 0, echecs: 0 }]));

console.log(`\n| Question | Attendu | ${actifs.map(({ modele }) => modele).join(' | ')} |`);
console.log(`|---|---|${actifs.map(() => '---').join('|')}|`);

for (const [question, rubriques, molecules] of QUESTIONS) {
  const cellules = [];
  for (const { fournisseur, modele } of actifs) {
    const compte = bilan.get(modele);
    const debut = Date.now();
    let criteres = null;
    try {
      criteres = validerInterpretation(await appelerModele(question, { fournisseur, modele }));
    } catch (err) {
      cellules.push(`échec (${err.message})`);
      compte.echecs += 1;
      continue;
    }
    compte.ms += Date.now() - debut;
    if (!criteres) {
      cellules.push('sortie invalide');
      compte.echecs += 1;
      continue;
    }
    const bonneRubrique = rubriques.includes(criteres.rubrique);
    const bonneMolecule = molecules.some((attendue) => cle(criteres.molecule).includes(cle(attendue)));
    if (bonneRubrique) compte.rubrique += 1;
    if (bonneMolecule) compte.molecule += 1;
    cellules.push(`${bonneRubrique ? '✓' : '✗'} ${criteres.rubrique ?? '—'} · ${bonneMolecule ? '✓' : '✗'} ${criteres.molecule ?? '—'} · « ${criteres.mots} »`);
  }
  console.log(`| ${question} | ${rubriques.join('/')} · ${molecules[0]} | ${cellules.join(' | ')} |`);
}

console.log('\n| Modèle | Rubrique juste | Molécule juste | Échecs | Temps moyen |');
console.log('|---|---|---|---|---|');
for (const [modele, compte] of bilan) {
  const reussis = QUESTIONS.length - compte.echecs;
  const moyenne = reussis ? Math.round(compte.ms / reussis) : 0;
  console.log(`| ${modele} | ${compte.rubrique}/${QUESTIONS.length} | ${compte.molecule}/${QUESTIONS.length} | ${compte.echecs} | ${moyenne} ms |`);
}
