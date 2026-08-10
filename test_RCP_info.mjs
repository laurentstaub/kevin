/**
 * test_RCP_info.mjs — banc d'essai du découpage des RCP et des notices.
 *
 * Tous les contrôles au même endroit : sur des cas construits, et sur les
 * documents réels s'ils sont accessibles.
 *
 *   node test_RCP_info.mjs                      # cas construits seulement
 *   node test_RCP_info.mjs --base               # + mesure sur la base
 *   node test_RCP_info.mjs --dump <fichier.sql> # + mesure sur un dump pg_dump
 *   node test_RCP_info.mjs --bilan              # + ce qui est déjà en base
 *   node test_RCP_info.mjs --cis 60002283       # inspecter un document précis
 *
 * Ne modifie rien : lecture seule de bout en bout.
 */

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { outline } from './src/outline.js';
import { splitDocument } from './src/split.js';
import { sanitizeDocument } from './src/sanitize.js';
import { socle, rubriqueNotice } from './src/rcp-plan.js';
import {
  pages, retirerHabillage, decouperAnnexes, versHtml, pdfEnDocuments,
  separerRepetitions, choisirBloc,
} from './src/pdf.js';

const args = process.argv.slice(2);
const opt = (nom) => {
  const i = args.indexOf(`--${nom}`);
  return i !== -1 ? (args[i + 1] ?? true) : null;
};

const G = '\x1b[32m';
const R = '\x1b[31m';
const D = '\x1b[2m';
const N = '\x1b[0m';

let reussis = 0;
let echoues = 0;

function verifier(intitule, condition, detail = '') {
  if (condition) {
    reussis += 1;
    console.log(`  ${G}✓${N} ${intitule}`);
  } else {
    echoues += 1;
    console.log(`  ${R}✗${N} ${intitule}${detail ? `\n      ${D}${detail}${N}` : ''}`);
  }
}

const titre = (t) => console.log(`\n${t}\n${'─'.repeat(t.length)}`);

// ═══════════════════════════════════════════════ cas construits

/** Balisage réel de la BDPM : titres en <p class="AmmAnnexeTitre*"> + ancre. */
const rubrique = (numero, libelle, ...corps) =>
  `<p class="AmmAnnexeTitre1"><a name="Rcp${numero.replace('.', '')}">${numero}. ${libelle}</a>&nbsp;&nbsp;</p>` +
  corps.map((c) => `<p class="AmmCorpsTexte">${c}</p>`).join('');

const RCP_REEL =
  '<title>Résumé des caractéristiques du produit - Base de données publique des médicaments</title>' +
  '<h1 class="textedeno">ASPIRINE ARROW 75 mg, comprimé gastro-résistant</h1>' +
  rubrique('1', 'DENOMINATION DU MEDICAMENT', 'ASPIRINE ARROW 75 mg') +
  rubrique('2', 'COMPOSITION QUALITATIVE ET QUANTITATIVE', 'Acide acétylsalicylique 75 mg') +
  rubrique('3', 'FORME PHARMACEUTIQUE', 'Comprimé gastro-résistant.') +
  rubrique('4', 'DONNEES CLINIQUES') +
  rubrique('4.1', 'Indications thérapeutiques', 'Prévention secondaire.') +
  rubrique('4.2', "Posologie et mode d'administration", '75 mg par jour.', 'Avaler avec de l’eau.') +
  rubrique('4.3', 'Contre-indications', 'Ulcère gastro-duodénal en évolution.') +
  rubrique('4.4', "Mises en garde spéciales et précautions d'emploi", 'Risque hémorragique.') +
  rubrique('4.8', 'Effets indésirables', 'Troubles digestifs.') +
  rubrique('6', 'DONNEES PHARMACEUTIQUES') +
  rubrique('6.1', 'Liste des excipients', 'Cellulose, talc.') +
  rubrique('6.3', 'Durée de conservation', '3 ans.') +
  rubrique('6.5', "Nature et contenu de l'emballage extérieur", '30 comprimés sous plaquettes PVC/aluminium.') +
  rubrique('7', "TITULAIRE DE L'AUTORISATION DE MISE SUR LE MARCHE", 'ARROW GENERIQUES');

titre('Détection des rubriques');
{
  const { sections } = outline(RCP_REEL, 'rcp');
  const numeros = sections.map((s) => s.number);

  verifier(
    'le <h1> titre de page ne masque pas les rubriques en <p>',
    numeros.length >= 13,
    `trouvées : ${numeros.join(', ')}`,
  );
  verifier('la première rubrique est bien la 1', numeros[0] === '1');
  verifier(
    '« 3 ans. » n’est pas pris pour la rubrique 3',
    numeros.filter((n) => n === '3').length === 1,
  );
  verifier('« 30 comprimés… » n’est pas pris pour une rubrique', !numeros.includes('30'));
  verifier(
    'le titre du document est retiré du corps',
    !outline(RCP_REEL, 'rcp').html.includes('<h1'),
  );
}

titre('Normalisation des libellés');
{
  const { sections } = outline(RCP_REEL, 'rcp');
  const par = (n) => sections.find((s) => s.number === n);

  verifier(
    'casse et accents rétablis depuis le plan QRD',
    par('4').label === 'Données cliniques',
    `obtenu : « ${par('4').label} »`,
  );
  verifier(
    'les libellés sortent sans espace résiduel',
    par('1').label === 'Dénomination du médicament',
    `obtenu : [${par('1').label}]`,
  );
  verifier('un libellé conforme est marqué canonique', par('4.3').canonical === true);
  verifier(
    'un libellé hors plan type garde sa rédaction',
    outline(
      rubrique('9', 'MENTIONS PARTICULIERES DU LABORATOIRE', 'x') +
        rubrique('10', 'AUTRE CHOSE', 'y') +
        rubrique('11', 'ENCORE UNE', 'z'),
      'rcp',
    ).sections.every((s) => s.canonical === false),
  );
}

titre('Découpage en rubriques');
{
  const { sections, statut, manquantes } = splitDocument(RCP_REEL, 'rcp');
  const par = (n) => sections.find((s) => s.numero === n);

  verifier('chaque rubrique porte son contenu', par('4.2').texte.includes('75 mg par jour'));
  verifier(
    'le contenu de la rubrique suivante ne déborde pas',
    !par('4.2').texte.includes('Ulcère'),
    `4.2 contient : « ${par('4.2').texte} »`,
  );
  verifier('le HTML est conservé pour l’affichage', par('4.3').html.includes('<p'));
  verifier(
    'le texte nu est détagué pour la recherche',
    par('4.3').texte === 'Ulcère gastro-duodénal en évolution.',
    `obtenu : « ${par('4.3').texte} »`,
  );
  verifier('les positions suivent l’ordre du document', sections.every((s, i) => s.position === i));
  verifier('un RCP complet est déclaré complet', statut === 'ok', `manquantes : ${manquantes}`);
}

titre('Contrôle qualité');
{
  const tronque =
    rubrique('1', 'DENOMINATION DU MEDICAMENT', 'X') +
    rubrique('2', 'COMPOSITION QUALITATIVE ET QUANTITATIVE', 'Y') +
    rubrique('3', 'FORME PHARMACEUTIQUE', 'Z');
  const r = splitDocument(tronque, 'rcp');

  verifier('un RCP amputé est signalé', r.statut === 'partiel');
  verifier('les rubriques absentes sont listées', r.manquantes.includes('4.3'));

  const vide = splitDocument('<p>Le médicament demandé n’existe pas dans la base</p>', 'rcp');
  verifier('un document sans rubrique est en échec', vide.statut === 'echec');

  verifier('la notice est jugée sur son propre plan', socle('notice').length === 6);
  verifier('une fiche info n’attend aucune rubrique', socle('main').length === 0);

  const nomLong =
    '2. Quelles sont les informations à connaître avant de prendre ' +
    'AMOXICILLINE/ACIDE CLAVULANIQUE ALMUS 500 mg/62,5 mg ADULTES, comprimé pelliculé ' +
    '(rapport amoxicilline/acide clavulanique : 8/1) ?';
  const notice =
    '<p><a name="a">1. Qu’est-ce que ce médicament et dans quel cas est-il utilisé ?</a></p><p>Antalgique.</p>' +
    `<p><a name="b">${nomLong}</a></p><p>Ne prenez jamais…</p>` +
    '<p><a name="c">3. Comment prendre ce médicament ?</a></p><p>Avaler.</p>';
  verifier(
    'un titre de notice long est reconnu',
    outline(notice, 'notice').sections.length === 3,
    `${nomLong.length} signes`,
  );
}

// ═══════════════════════════════════════════════ documents en PDF

/**
 * Les spécialités enregistrées à l'EMA n'ont pas de HTML : la BDPM sert un PDF
 * unique regroupant les annexes de la décision européenne. Le banc reproduit ce
 * que rend `pdftotext -layout` : pages séparées par un saut de page, en-tête
 * répété, numéro de page isolé, tableau aligné à l'espace.
 */
const PDF_EMA = [
  [
    'KEYVAX 50 mg, solution injectable', '', '',
    'ANNEXE I', '',
    'RESUME DES CARACTERISTIQUES DU PRODUIT', '', '',
    '1',
  ],
  [
    'KEYVAX 50 mg, solution injectable', '',
    '1.   DENOMINATION DU MEDICAMENT', '',
    'KEYVAX 50 mg, solution injectable', '',
    '2.   COMPOSITION QUALITATIVE ET QUANTITATIVE', '',
    'Chaque flacon contient 50 mg de kevixumab.', '',
    '3.   FORME PHARMACEUTIQUE', '',
    'Solution injectable.', '',
    '2',
  ],
  [
    'KEYVAX 50 mg, solution injectable', '',
    '4.   DONNEES CLINIQUES', '',
    '4.1  Indications therapeutiques', '',
    "Traitement de l'infection a virus X chez l'adulte.", '',
    "4.2  Posologie et mode d'administration", '',
    'La dose est adaptee au poids :', '',
    'Poids                Dose unitaire   Maximum par jour',
    '30 a 50 kg           500 mg          3 g',
    'Plus de 50 kg        1 g             3 g', '',
    '4.3  Contre-indications', '',
    'Hypersensibilite a la substance active.', '',
    '3',
  ],
  [
    'KEYVAX 50 mg, solution injectable', '',
    "4.4  Mises en garde speciales et precautions d'emploi", '',
    'Surveillance renale recommandee.', '',
    '4.8  Effets indesirables', '',
    'Cephalees, nausees.', '',
    '5.   PROPRIETES PHARMACOLOGIQUES', '',
    '6.   DONNEES PHARMACEUTIQUES', '',
    '6.1  Liste des excipients', '',
    'Chlorure de sodium, eau pour preparations injectables.', '',
    '4',
  ],
  [
    'KEYVAX 50 mg, solution injectable', '',
    'ANNEXE II', '',
    'A. FABRICANT RESPONSABLE DE LA LIBERATION DES LOTS', '',
    'Laboratoire Y, Irlande.', '',
    'ANNEXE IIIA', '',
    'ETIQUETAGE', '',
    '1.   DENOMINATION DU MEDICAMENT', '',
    'KEYVAX 50 mg, solution injectable', '',
    '2.   COMPOSITION EN SUBSTANCES ACTIVES', '',
    'Chaque flacon contient 50 mg de kevixumab.', '',
    '5',
  ],
  [
    'KEYVAX 50 mg, solution injectable', '',
    'ANNEXE IIIB', '',
    "NOTICE : INFORMATION DE L'UTILISATEUR", '',
    'KEYVAX 50 mg, solution injectable', '',
    "1.   Qu'est-ce que KEYVAX et dans quel cas est-il utilise ?", '',
    'Antiviral.', '',
    "2.   Quelles sont les informations a connaitre avant d'utiliser KEYVAX ?", '',
    "N'utilisez jamais KEYVAX en cas d'allergie.", '',
    '3.   Comment utiliser KEYVAX ?', '',
    'Respectez la posologie.', '',
    '4.   Quels sont les effets indesirables eventuels ?', '',
    'Cephalees.', '',
    '5.   Comment conserver KEYVAX ?', '',
    'A conserver au refrigerateur.', '',
    "6.   Contenu de l'emballage et autres informations", '',
    'Flacon de 10 mL.', '',
    '6',
  ],
]
  .map((p) => p.join('\n'))
  .join('\f');

titre('PDF — nettoyage de la page');
{
  verifier('les pages sont séparées par le saut de page', pages(PDF_EMA).length === 6);

  const propre = retirerHabillage(PDF_EMA);
  const nom = propre.split('\n').filter((l) => l.trim() === 'KEYVAX 50 mg, solution injectable');

  verifier(
    'l’en-tête répété est retiré',
    nom.length === 3,
    `${nom.length} occurrence(s) restantes`,
  );
  verifier(
    'la rubrique 1 garde la dénomination',
    /1\.\s+DENOMINATION DU MEDICAMENT\n+KEYVAX/.test(propre),
  );
  verifier(
    'les numéros de page sont retirés',
    !propre.split('\n').some((l) => /^\s*[1-6]\s*$/.test(l)),
  );
}

titre('PDF — séparation des annexes');
{
  const parties = decouperAnnexes(retirerHabillage(PDF_EMA));

  verifier('le RCP et la notice sont isolés', [...parties.keys()].sort().join() === 'notice,rcp');
  verifier(
    'l’étiquetage ne pollue pas le RCP',
    (parties.get('rcp').match(/DENOMINATION DU MEDICAMENT/g) ?? []).length === 1,
  );
  verifier(
    'la notice ne contient pas le RCP',
    !parties.get('notice').includes('PROPRIETES PHARMACOLOGIQUES'),
  );
}

titre('PDF — reconstruction du HTML');
{
  const html = versHtml(decouperAnnexes(retirerHabillage(PDF_EMA)).get('rcp'));

  verifier('les rubriques deviennent des titres', html.includes('<h2>4.3  Contre-indications</h2>'));
  verifier('le corps devient des paragraphes', html.includes('<p>Hypersensibilite a la substance active.</p>'));
  verifier(
    'le tableau de posologie garde son alignement',
    /<pre>Poids\s+Dose unitaire\s+Maximum par jour\n30 a 50 kg/.test(html),
  );
  verifier(
    '« 30 a 50 kg » n’est pas pris pour une rubrique',
    !html.includes('<h2>30 a 50 kg'),
  );
}

titre('PDF — découpage final');
{
  const docs = pdfEnDocuments(PDF_EMA);
  const par = (t) => docs.find((d) => d.type === t);

  verifier('un PDF donne deux documents', docs.length === 2 && par('rcp') && par('notice'));

  const rcp = splitDocument(sanitizeDocument(par('rcp').html), 'rcp');
  const notice = splitDocument(sanitizeDocument(par('notice').html), 'notice');

  verifier('le RCP issu du PDF est complet', rcp.statut === 'ok', `manque : ${rcp.manquantes}`);
  verifier('la notice issue du PDF est complète', notice.statut === 'ok', `manque : ${notice.manquantes}`);
  verifier(
    'les libellés sont rétablis depuis le plan QRD',
    rcp.sections.find((s) => s.numero === '4.2')?.libelle === "Posologie et mode d'administration",
  );
  verifier(
    'le tableau survit au découpage et à l’assainissement',
    rcp.sections.find((s) => s.numero === '4.2')?.texte.includes('Maximum par jour'),
  );
  verifier('la notice a ses six rubriques', notice.sections.length === 6);
}

titre('PDF — spécialité à plusieurs formes');
{
  // L'annexe I d'un PDF EMA enchaîne un RCP complet par forme pharmaceutique.
  const forme = (dose, texte) => [
    '1.   DENOMINATION DU MEDICAMENT', '',
    `KEYVAX ${dose}, solution injectable`, '',
    '2.   COMPOSITION QUALITATIVE ET QUANTITATIVE', '',
    `Chaque flacon contient ${dose} de kevixumab.`, '',
    '3.   FORME PHARMACEUTIQUE', '',
    'Solution injectable.', '',
    '4.   INFORMATIONS CLINIQUES', '',
    '4.1  Indications therapeutiques', '',
    'Infection a virus X.', '',
    "4.2  Posologie et mode d'administration", '',
    texte, '',
    // Ligne de corps coupée en début de ligne par la mise en page : sans
    // garde-fou elle passe pour la rubrique 12.
    '12 ans presentant une forme severe de la maladie.', '',
    '4.3  Contre-indications', '',
    'Hypersensibilite.', '',
    '4.4  Mises en garde speciales et precautions d’emploi', '',
    'Surveillance renale.', '',
    '4.8  Effets indesirables', '',
    'Cephalees.', '',
    '6.   DONNEES PHARMACEUTIQUES', '',
    '6.1  Liste des excipients', '',
    'Chlorure de sodium.', '',
    '10.  DATE DE MISE A JOUR DU TEXTE', '',
    'Janvier 2026.', '',
  ].join('\n');

  const annexe = ['ANNEXE I', '', 'RESUME DES CARACTERISTIQUES DU PRODUIT', '',
    forme('50 mg', 'Une injection par jour.'),
    forme('200 mg', 'Une injection par semaine.'),
  ].join('\n');

  const blocs = separerRepetitions(annexe, 'rcp');
  verifier('les reprises du plan sont séparées', blocs.length === 2, `${blocs.length} bloc(s)`);
  verifier(
    'la forme demandée est retenue',
    choisirBloc(blocs, 'KEYVAX 200 mg, solution injectable').includes('par semaine'),
  );
  verifier(
    'sans dénomination on garde la première forme',
    choisirBloc(blocs, null).includes('par jour'),
  );

  const html = versHtml(choisirBloc(blocs, 'KEYVAX 200 mg, solution injectable'));
  verifier('« 12 ans… » n’est pas pris pour la rubrique 12', !html.includes('<h2>12 ans'));

  const r = splitDocument(sanitizeDocument(html), 'rcp');
  verifier('le RCP de la forme retenue est complet', r.statut === 'ok', `manque : ${r.manquantes}`);
  verifier(
    'la rubrique 10 ne déborde pas sur la forme suivante',
    !r.sections.find((s) => s.numero === '10')?.texte.includes('KEYVAX'),
  );
  verifier(
    '« Informations cliniques » est reconnu comme rubrique 4',
    r.sections.find((s) => s.numero === '4')?.canonical === true,
  );
}

titre('PDF — sommaire de notice');
{
  // Structure réelle d'une notice EMA, relevée sur Keppra : le « Que contient
  // cette notice ? » énumère les six rubriques avant le corps.
  const rubrique = (n, titre, corps) => `${n}.    ${titre}\n\n${corps}\n`;
  const intitules = [
    "Qu'est-ce que Keppra et dans quels cas est-il utilise",
    'Quelles sont les informations a connaitre avant de prendre Keppra',
    'Comment prendre Keppra',
    'Quels sont les effets indesirables eventuels ?',
    'Comment conserver Keppra',
    "Contenu de l'emballage et autres informations",
  ];

  const notice = [
    'Notice : Information du patient', '',
    'Keppra 250 mg comprime pelliculé', '',
    'Veuillez lire attentivement cette notice avant de prendre ce medicament.', '',
    'Que contient cette notice ? :',
    ...intitules.map((t, i) => `${i + 1}.   ${t}`),
    '', '',
    ...intitules.map((t, i) => rubrique(i + 1, t, `Contenu de la rubrique ${i + 1}.`)),
  ].join('\n');

  const r = splitDocument(sanitizeDocument(versHtml(notice)), 'notice');

  verifier(
    'le sommaire n’est pas pris pour le corps',
    r.sections.length === 6,
    `${r.sections.length} rubrique(s)`,
  );
  verifier('la notice est complète', r.statut === 'ok', `manque : ${r.manquantes}`);
  verifier(
    'chaque rubrique porte son contenu',
    r.sections.every((s, i) => s.texte.includes(`rubrique ${i + 1}.`)),
  );
  verifier(
    'la dernière rubrique n’avale pas le reste',
    r.sections.at(-1).texte.length < 200,
    `${r.sections.at(-1).texte.length} signes`,
  );

  // Une procédure numérotée dans le corps a la forme d'un plan (relevé sur
  // ReFacto AF : six étapes de reconstitution avant les rubriques 4 à 6).
  const avecProcedure = [
    'Notice : information de l’utilisateur', '',
    "1.   Qu'est-ce que REFACTO et dans quel cas est-il utilise", '',
    'Facteur VIII de coagulation.', '',
    '2.   Quelles sont les informations a connaitre avant d’utiliser REFACTO', '',
    'Ne prenez jamais REFACTO en cas d’allergie.', '',
    '3.   Comment utiliser REFACTO', '',
    'Reconstitution :', '',
    '1.   Retirez le papier plastifie protecteur de l’emballage.', '',
    '2.   Placez le flacon sur une surface plane.', '',
    '3.   Vissez le piston sur la seringue de solvant.', '',
    '4.   En gardant la seringue au-dessus, poussez lentement le piston.', '',
    '5.   Retirez la seringue vide et repetez les etapes 3 et 4.', '',
    '6.   Retirez le connecteur de seringues.', '',
    '4.   Quels sont les effets indesirables eventuels ?', '',
    'Reactions allergiques.', '',
    '5.   Comment conserver REFACTO', '',
    'A conserver au refrigerateur.', '',
    '6.   Contenu de l’emballage et autres informations', '',
    'Flacon de poudre et seringue de solvant.', '',
  ].join('\n');

  const p = splitDocument(sanitizeDocument(versHtml(avecProcedure, 'notice')), 'notice');

  verifier(
    'une procédure numérotée n’est pas prise pour le plan',
    p.sections.length === 6,
    `${p.sections.length} rubrique(s) : ${p.sections.map((s) => s.numero).join(', ')}`,
  );
  verifier(
    'la rubrique 3 garde la procédure dans son contenu',
    p.sections.find((s) => s.numero === '3')?.texte.includes('Retirez le connecteur'),
  );
  verifier(
    'les rubriques suivantes ne sont pas décalées',
    p.sections.find((s) => s.numero === '5')?.texte.includes('refrigerateur'),
  );
}

titre('PDF — rédactions réelles du plan de notice');
{
  // Relevé sur les 851 PDF en cache : le modèle QRD est suivi, sa rédaction
  // non. Chaque variante ci-dessous a coûté une rubrique perdue.
  const attendus = [
    ['1', "Qu'est-ce que Cyanokit et dans quel cas est-il utilisé ?"],
    ['1', "Qu'est ce Naglazyme et dans quel cas est-il utilisé"], // sans tiret
    ['1', "QU'EST--CE QUE MINJUVI ET DANS QUELS CAS EST--IL UTILISÉ ?"], // tiret doublé
    ['2', 'Quelles sont les informations à connaître avant de recevoir Alofisel'],
    ['3', 'Comment Alofisel est-il administré'],
    ['3', 'Comment prendre Wakix ?'],
    ['4', 'Quels sont les effets indésirables éventuels ?'],
    ['4', 'Quels sont les événements indésirables éventuels'], // bévacizumab
    ['4', 'Quels sont les effets secondaires éventuels'], // DuoResp
    ['5', 'Comment conserver Alymsys'],
    ['5', 'Comment Cyanokit est-il conservé ?'],
    ['6', "Contenu de l'emballage et autres informations"],
    ['6', 'Contenu de la boîte et autres informations'], // Evoltra
    ['6', 'Informations supplémentaires'], // Aldara, Wakix
    ['7', "Instructions d'utilisation"],
  ];

  const rates = attendus.filter(([n, l]) => !rubriqueNotice(n, l));
  verifier(
    'toutes les rédactions relevées sont reconnues',
    rates.length === 0,
    rates.map(([n, l]) => `${n} — ${l}`).join('\n      '),
  );

  // Les étapes d'une procédure ne doivent jamais passer pour un plan.
  const procedure = [
    ['1', 'Avant de vous coucher, lavez vos mains et la zone à traiter'],
    ['2', 'Ouvrez un nouveau sachet et prenez de la crème sur le bout des doigts.'],
    ['4', 'Calculer la dose et le nombre de flacons nécessaires.'],
    ['5', 'Retirez la seringue préremplie vide et répétez les étapes 3 et 4.'],
  ];
  verifier(
    'les étapes d’une procédure restent hors plan',
    procedure.every(([n, l]) => !rubriqueNotice(n, l)),
  );
}

// ═══════════════════════════════════════════════ mesure sur documents réels

function mesurer(source, docs) {
  const parType = new Map();
  const manque = new Map();
  const echecs = [];

  for (const { cis, type, html } of docs) {
    const { sections, statut, manquantes } = splitDocument(sanitizeDocument(html), type);

    if (!parType.has(type)) parType.set(type, { ok: 0, partiel: 0, echec: 0, rubriques: 0 });
    const b = parType.get(type);
    b[statut] += 1;
    b.rubriques += sections.length;

    for (const m of manquantes) manque.set(`${type} ${m}`, (manque.get(`${type} ${m}`) ?? 0) + 1);
    if (statut === 'echec' && echecs.length < 5) {
      echecs.push({ cis, type, extrait: html.replace(/\s+/g, ' ').slice(0, 200) });
    }
  }

  titre(`Documents réels — ${source}`);

  for (const [type, b] of parType) {
    const total = b.ok + b.partiel + b.echec;
    const p = (x) => `${((x / total) * 100).toFixed(1).padStart(5)} %`;
    console.log(`\n  ${type}  (${total.toLocaleString('fr-FR')})`);
    console.log(`    complet  ${String(b.ok).padStart(6)}  ${p(b.ok)}`);
    console.log(`    partiel  ${String(b.partiel).padStart(6)}  ${p(b.partiel)}`);
    console.log(`    échec    ${String(b.echec).padStart(6)}  ${p(b.echec)}`);
    console.log(`    ${D}rubriques par document : ${(b.rubriques / total).toFixed(1)}${N}`);
  }

  if (manque.size > 0) {
    console.log('\n  Rubriques socle absentes :');
    for (const [k, v] of [...manque].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
      console.log(`    ${k.padEnd(14)} ${v.toLocaleString('fr-FR')}`);
    }
  }

  for (const e of echecs) {
    console.log(`\n  ${R}échec${N} ${e.cis} ${e.type}`);
    console.log(`    ${D}${e.extrait}${N}`);
  }
}

const TYPES = ['rcp', 'rcp_notice', 'notice'];

/** Lecture d'un dump pg_dump : le bloc COPY dbpm.cis_documents. */
async function depuisDump(fichier, max) {
  const desechapper = (s) =>
    s.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r').replace(/\\\\/g, '\\');

  const docs = [];
  let dedans = false;

  const rl = createInterface({ input: createReadStream(fichier), crlfDelay: Infinity });
  for await (const l of rl) {
    if (!dedans) {
      if (l.startsWith('COPY dbpm.cis_documents ')) dedans = true;
      continue;
    }
    if (l === '\\.') break;

    const [, cis, type, html] = l.split('\t');
    if (!TYPES.includes(type) || html === '\\N') continue;

    docs.push({ cis, type, html: desechapper(html) });
    if (docs.length >= max) break;
  }
  rl.close();
  return docs;
}

/** Lecture directe de la base. */
async function depuisBase(max) {
  const { createPool } = await import('./src/db.js');
  const pool = createPool({ statement_timeout: 0 });
  const { rows } = await pool.query(
    `SELECT code_cis AS cis, document_type AS type, html_content AS html
     FROM dbpm.cis_documents
     WHERE coalesce(html_content, '') <> '' AND document_type = ANY($1)
     ORDER BY random() LIMIT $2`,
    [TYPES, max],
  );
  await pool.end();
  return rows;
}

const MAX = Number(opt('max') ?? 6000);
const dump = opt('dump');
const cis = opt('cis');

if (typeof dump === 'string') {
  mesurer(dump.split('/').pop(), await depuisDump(dump, MAX));
}

if (opt('base')) {
  mesurer('base locale', await depuisBase(MAX));
}

// Bilan de ce qui est réellement en base, HTML et PDF confondus.
if (opt('bilan')) {
  const { createPool } = await import('./src/db.js');
  const pool = createPool({ statement_timeout: 0 });
  const { rows } = await pool.query(
    `SELECT source, document_type, statut, count(*)::int AS n, sum(section_count)::int AS rubriques
     FROM docs.document_parse
     GROUP BY 1, 2, 3
     ORDER BY 1, 2, 3`,
  );
  await pool.end();

  titre('Rubriques en base');
  console.log(
    `  ${'source'.padEnd(12)}${'type'.padEnd(12)}${'statut'.padEnd(10)}` +
      `${'documents'.padStart(10)}${'rubriques'.padStart(12)}`,
  );
  for (const r of rows) {
    console.log(
      `  ${r.source.padEnd(12)}${r.document_type.padEnd(12)}${r.statut.padEnd(10)}` +
        `${r.n.toLocaleString('fr-FR').padStart(10)}${(r.rubriques ?? 0).toLocaleString('fr-FR').padStart(12)}`,
    );
  }
}

// Inspection d'un document précis. Ce qui est en base fait foi ; si rien n'y est
// encore, on redécoupe le HTML d'origine pour comparer.
if (typeof cis === 'string') {
  const { createPool } = await import('./src/db.js');
  const pool = createPool({ statement_timeout: 0 });

  const { rows: enBase } = await pool.query(
    `SELECT document_type, numero, libelle, canonical, source, length(texte) AS signes
     FROM docs.rcp_sections WHERE code_cis = $1
     ORDER BY document_type, position`,
    [cis],
  );

  const { rows: etats } = await pool.query(
    'SELECT document_type, statut, manquantes, source FROM docs.document_parse WHERE code_cis = $1',
    [cis],
  );

  if (enBase.length > 0) {
    for (const etat of etats) {
      titre(`CIS ${cis} — ${etat.document_type} (${etat.statut}, ${etat.source})`);
      if (etat.manquantes.length) console.log(`  ${D}manquantes : ${etat.manquantes.join(', ')}${N}\n`);
      for (const r of enBase.filter((x) => x.document_type === etat.document_type)) {
        console.log(
          `  ${r.numero.padEnd(6)} ${r.libelle.slice(0, 52).padEnd(54)} ` +
            `${D}${String(r.signes).padStart(6)} signes${r.canonical ? ' ✓' : ''}${N}`,
        );
      }
    }
  } else {
    const { rows } = await pool.query(
      'SELECT document_type, html_content FROM dbpm.cis_documents WHERE code_cis = $1',
      [cis],
    );
    for (const row of rows) {
      const { sections, statut, manquantes } = splitDocument(
        sanitizeDocument(row.html_content),
        row.document_type,
      );
      titre(`CIS ${cis} — ${row.document_type} (${statut}, pas encore en base)`);
      if (manquantes.length) console.log(`  ${D}manquantes : ${manquantes.join(', ')}${N}\n`);
      for (const s of sections) {
        console.log(
          `  ${s.numero.padEnd(6)} ${s.libelle.slice(0, 52).padEnd(54)} ${D}${s.texte.length} signes${N}`,
        );
      }
      if (sections.length === 0) {
        console.log(`  ${D}${(row.html_content ?? '').replace(/\s+/g, ' ').slice(0, 400)}${N}`);
      }
    }
  }

  await pool.end();
}

console.log(`\n${'═'.repeat(52)}`);
console.log(`  ${reussis} contrôle(s) réussi(s), ${echoues} en échec`);
console.log('');

process.exitCode = echoues > 0 ? 1 : 0;
