import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extraireDocument, lienPdf, pageSansDocument, rubriquesVues, equilibrer,
} from '../../src/document-bdpm.js';

/** Une page de la BDPM : de l'habillage, le document, du pied de page. */
const page = (corps) => `<!doctype html><html><head><title>BDPM</title>
<script>var suivi = 1;</script><style>.x{color:red}</style></head><body>
<nav><a href="/">Accueil</a><a href="/1">1. Recherche</a></nav>
<header><h1>Base de données publique des médicaments</h1></header>
<div class="fil">Accueil › Médicaments › 2. Résultats</div>
${corps}
<footer><p>3. Mentions légales</p><p>Ministère de la Santé</p></footer>
</body></html>`;

const RCP = page(`<div class="doc">
<p>1. DENOMINATION DU MEDICAMENT</p><p>AMOXICILLINE ALMUS 1 g, comprimé dispersible</p>
<p>2. COMPOSITION QUALITATIVE ET QUANTITATIVE</p><p>Amoxicilline ....... 1 g</p>
<p>3. FORME PHARMACEUTIQUE</p><p>Comprimé dispersible.</p>
<p>4. DONNEES CLINIQUES</p>
<p>4.1. Indications thérapeutiques</p><p>AMOXICILLINE ALMUS est indiqué dans le traitement
des infections suivantes chez l'adulte et l'enfant. ${'Texte clinique. '.repeat(60)}</p>
<p>4.2. Posologie et mode d'administration</p><p>${'Posologie détaillée. '.repeat(40)}</p>
</div>`);

describe('extraireDocument', () => {
  it('coupe au premier titre du plan, non à un conteneur', () => {
    const doc = extraireDocument(RCP, 'rcp');
    assert.ok(doc, 'document trouvé');
    assert.match(doc.html.slice(0, 80), /1\. DENOMINATION/);
  });

  // C'est tout l'objet du module : le site vient de migrer, un sélecteur appris
  // aujourd'hui mourrait à la prochaine refonte comme l'ancien collecteur.
  it('laisse dehors la navigation et l’en-tête', () => {
    const doc = extraireDocument(RCP, 'rcp');
    assert.doesNotMatch(doc.html, /Accueil/);
    assert.doesNotMatch(doc.html, /Base de données publique/);
    assert.doesNotMatch(doc.html, /var suivi/);
  });

  it('n’ouvre pas une balise sans la fermer', () => {
    const doc = extraireDocument(RCP, 'rcp');
    const ouvrants = (doc.html.match(/<div\b/g) || []).length;
    const fermants = (doc.html.match(/<\/div>/g) || []).length;
    assert.equal(ouvrants, fermants, 'les div sont équilibrés');
  });

  it('compte les rubriques et les signes', () => {
    const doc = extraireDocument(RCP, 'rcp');
    assert.ok(doc.rubriques >= 6, `rubriques vues : ${doc.rubriques}`);
    assert.ok(doc.signes > 800);
  });

  // Une page qui contient par hasard « 1. Dénomination » dans un menu ne doit
  // pas être prise pour un RCP : sans ce plancher, on stockerait l'habillage.
  it('refuse ce qui n’a ni volume ni numérotation', () => {
    assert.equal(extraireDocument(page('<p>1. DENOMINATION DU MEDICAMENT</p>'), 'rcp'), null);
    assert.equal(extraireDocument(page('<p>Rien à voir ici.</p>'), 'rcp'), null);
    assert.equal(extraireDocument('', 'rcp'), null);
  });

  it('reconnaît le plan propre à la notice', () => {
    const notice = page(`<div>
      <p>NOTICE : INFORMATION DE L'UTILISATEUR</p>
      <p>1. Qu'est-ce que AMOXICILLINE ALMUS et dans quels cas est-il utilisé</p>
      <p>${'Texte. '.repeat(80)}</p>
      <p>2. Quelles sont les informations à connaître</p><p>${'Texte. '.repeat(50)}</p>
      <p>3. Comment prendre AMOXICILLINE ALMUS</p><p>${'Texte. '.repeat(50)}</p>
      <p>4. Quels sont les effets indésirables éventuels</p><p>${'Texte. '.repeat(50)}</p>
    </div>`);
    const doc = extraireDocument(notice, 'notice');
    assert.ok(doc, 'notice trouvée');
    assert.match(doc.html.slice(0, 120), /NOTICE/);
  });
});

describe('pageSansDocument', () => {
  // La BDPM ne renvoie pas d'erreur HTTP : elle sert une page qui l'explique.
  it('reconnaît la page d’excuse', () => {
    assert.equal(pageSansDocument(page(
      "<p>Le médicament demandé n'existe pas ou n'entre pas dans le périmètre.</p>")), true);
  });

  it('ne confond pas un document avec une absence', () => {
    assert.equal(pageSansDocument(RCP), false);
  });
});

describe('lienPdf', () => {
  it('trouve le PDF européen des spécialités centralisées', () => {
    assert.equal(
      lienPdf(page('<a href="https://ema.europa.eu/docs/fr_FR/keppra.pdf">Vers le RCP</a>')),
      'https://ema.europa.eu/docs/fr_FR/keppra.pdf',
    );
  });

  it('rend null quand la page porte le texte', () => {
    assert.equal(lienPdf(RCP), null);
  });
});

describe('rubriquesVues', () => {
  it('compte les numéros distincts, non les occurrences', () => {
    assert.equal(rubriquesVues('<p>1. UN</p><p>1. UN</p><p>2. DEUX</p>'), 2);
    assert.equal(rubriquesVues('<p>4.1 A</p><p>4.2 B</p><p>4 C</p>'), 3);
  });
});

describe('equilibrer', () => {
  // La leçon du jour : un fragment déséquilibré n'est pas rendu tel quel, il
  // est recollé par le navigateur — qui clone l'ouvrante et déplace tout.
  it('retire une fermante orpheline', () => {
    assert.equal(equilibrer('<p>texte</p></div>'), '<p>texte</p>');
  });

  it('referme une ouvrante restée béante', () => {
    assert.equal(equilibrer('<div><p>texte</p>'), '<div><p>texte</p></div>');
  });

  it('respecte l’ordre d’imbrication en refermant', () => {
    assert.equal(equilibrer('<div><ul><li>a'), '<div><ul><li>a</li></ul></div>');
  });

  it('ne compte pas les balises vides', () => {
    assert.equal(equilibrer('<p>a<br>b</p>'), '<p>a<br>b</p>');
    assert.equal(equilibrer('<p>a<br/>b'), '<p>a<br/>b</p>');
  });

  it('laisse intact ce qui est déjà équilibré', () => {
    const sain = '<div><p>un</p><p>deux</p></div>';
    assert.equal(equilibrer(sain), sain);
  });
});
