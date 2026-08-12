import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { splitDocument, detaguer, PARSER_VERSION, composerDoses } from '../../src/split.js';
import { socle } from '../../src/rcp-plan.js';

const rubrique = (numero, titre, ...corps) =>
  `<p><a name="x">${numero}. ${titre}</a></p>` + corps.map((c) => `<p>${c}</p>`).join('');

const RCP_COMPLET =
  rubrique('1', 'DENOMINATION DU MEDICAMENT', 'ASPIRINE ARROW 75 mg') +
  rubrique('2', 'COMPOSITION QUALITATIVE ET QUANTITATIVE', 'Acide acétylsalicylique 75 mg') +
  rubrique('3', 'FORME PHARMACEUTIQUE', 'Comprimé gastro-résistant.') +
  rubrique('4.1', 'Indications thérapeutiques', 'Prévention secondaire.') +
  rubrique('4.2', "Posologie et mode d'administration", '75 mg par jour.', 'Avaler avec de l’eau.') +
  rubrique('4.3', 'Contre-indications', 'Ulcère en évolution.') +
  rubrique('4.4', "Mises en garde spéciales et précautions d'emploi", 'Risque hémorragique.') +
  rubrique('4.8', 'Effets indésirables', 'Troubles digestifs.') +
  rubrique('6.1', 'Liste des excipients', 'Cellulose, talc.');

describe('detaguer', () => {
  it('retire les balises et normalise les espaces', () => {
    assert.equal(detaguer('<p>Un <b>deux</b>\n  trois</p>'), 'Un deux trois');
  });

  it('décode les entités', () => {
    assert.equal(detaguer('<p>a&nbsp;&amp;&nbsp;b</p>'), 'a & b');
  });

  it('accepte une entrée vide', () => {
    assert.equal(detaguer(null), '');
  });
});

describe('splitDocument', () => {
  it('produit une rubrique par titre', () => {
    const { sections } = splitDocument(RCP_COMPLET, 'rcp');
    assert.deepEqual(
      sections.map((s) => s.numero),
      ['1', '2', '3', '4.1', '4.2', '4.3', '4.4', '4.8', '6.1'],
    );
  });

  it('rattache à chaque rubrique le contenu qui la suit, et lui seul', () => {
    const { sections } = splitDocument(RCP_COMPLET, 'rcp');
    const posologie = sections.find((s) => s.numero === '4.2');
    assert.match(posologie.texte, /75 mg par jour/);
    assert.match(posologie.texte, /Avaler avec/);
    // Le contenu de la rubrique suivante ne doit pas déborder.
    assert.ok(!posologie.texte.includes('Ulcère'));
  });

  it('conserve le HTML et le texte nu côte à côte', () => {
    const { sections } = splitDocument(RCP_COMPLET, 'rcp');
    const s = sections.find((x) => x.numero === '4.3');
    assert.match(s.html, /<p>/);
    assert.equal(s.texte, 'Ulcère en évolution.');
  });

  it('normalise les libellés sur le plan type', () => {
    const { sections } = splitDocument(RCP_COMPLET, 'rcp');
    const s = sections.find((x) => x.numero === '1');
    assert.equal(s.libelle, 'Dénomination du médicament');
    assert.equal(s.canonical, true);
  });

  it('numérote les positions dans l’ordre du document', () => {
    const { sections } = splitDocument(RCP_COMPLET, 'rcp');
    assert.deepEqual(sections.map((s) => s.position), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('déclare complet un RCP qui a toutes ses rubriques socle', () => {
    const { statut, manquantes } = splitDocument(RCP_COMPLET, 'rcp');
    assert.equal(statut, 'ok');
    assert.deepEqual(manquantes, []);
  });

  it('signale les rubriques socle absentes plutôt que de publier en silence', () => {
    const tronque =
      rubrique('1', 'DENOMINATION DU MEDICAMENT', 'X') +
      rubrique('2', 'COMPOSITION QUALITATIVE ET QUANTITATIVE', 'Y') +
      rubrique('3', 'FORME PHARMACEUTIQUE', 'Z');
    const { statut, manquantes } = splitDocument(tronque, 'rcp');
    assert.equal(statut, 'partiel');
    assert.ok(manquantes.includes('4.3'));
  });

  it('déclare en échec un document sans rubrique', () => {
    const { sections, statut } = splitDocument('<p>Texte libre.</p><p>Suite.</p>', 'rcp');
    assert.equal(sections.length, 0);
    assert.equal(statut, 'echec');
  });

  it('accepte un document vide', () => {
    assert.equal(splitDocument('', 'rcp').statut, 'echec');
  });
});

describe('socle', () => {
  it('juge la notice sur son propre plan, pas sur celui du RCP', () => {
    assert.deepEqual(socle('notice'), ['1', '2', '3', '4', '5', '6']);
    assert.ok(socle('rcp').includes('4.3'));
  });

  it('n’attend aucune rubrique d’une fiche info', () => {
    assert.deepEqual(socle('main'), []);
  });

  it('ne signale pas une notice complète comme partielle', () => {
    const notice = ['1', '2', '3', '4', '5', '6']
      .map((n) => rubrique(n, `Rubrique ${n} du produit`, 'Contenu.'))
      .join('');
    assert.equal(splitDocument(notice, 'notice').statut, 'ok');
  });
});

describe('PARSER_VERSION', () => {
  it('est un entier — il pilote le rejeu après amélioration du découpeur', () => {
    assert.ok(Number.isInteger(PARSER_VERSION) && PARSER_VERSION >= 1);
  });
});

describe('composerDoses', () => {
  // La BDPM compose la rubrique 2 comme un document imprimé :
  // « Anastrozole..................... 1,00 mg ». La conduite de points a une
  // longueur fixe, calculée pour une largeur de page ; dans un navigateur elle
  // déborde et casse en trois lignes.
  it('sépare le nom de la dose', () => {
    const rendu = composerDoses('<p>Anastrozole.......................... 1,00 mg</p>');
    assert.match(rendu, /^<p class="dose"><span class="dose-nom">Anastrozole<\/span>/);
    assert.match(rendu, /<span class="dose-valeur">1,00 mg<\/span><\/p>$/);
  });

  // Le HTML de la BDPM est indenté : la dose se trouve sur la ligne suivante.
  it('reconnaît une conduite coupée par un retour à la ligne', () => {
    const indente = '<p>\n  Anastrozole..........................\n  1,00 mg\n</p>';
    assert.match(composerDoses(indente), /dose-valeur">1,00 mg</);
  });

  it('pose de vrais points, coupés par le conteneur', () => {
    const rendu = composerDoses('<p>Oxazépam..... 10 mg</p>');
    const conduite = rendu.match(/dose-liaison"[^>]*>(\.+)<\/span>/);
    assert.ok(conduite, 'la conduite est posée');
    assert.ok(conduite[1].length > 100, 'assez longue pour la plus large des mesures');
    assert.match(rendu, /aria-hidden="true"/, 'muette pour un lecteur d’écran');
  });

  it('accepte les points de suspension', () => {
    assert.match(composerDoses('<p>Oxazépam……………… 10 mg</p>'), /dose-valeur">10 mg</);
  });

  it('garde ce qui suit la dose', () => {
    assert.match(
      composerDoses('<p>Amoxicilline............ 500 mg (sous forme de trihydrate)</p>'),
      /dose-valeur">500 mg \(sous forme de trihydrate\)</,
    );
  });

  it('conserve le balisage du nom', () => {
    assert.match(
      composerDoses('<p><a>Chlorhydrate de métformine</a>....... 500 mg</p>'),
      /dose-nom"><a>Chlorhydrate de métformine<\/a><\/span>/,
    );
  });

  // Le document de l'ANSM enveloppe parfois la ligne entière — nom, points et
  // dose — dans un seul élément. Couper au milieu laissait une balise ouverte
  // d'un côté et une fermante de l'autre ; le navigateur réparait en clonant
  // l'ouvrante, et les trois cases se retrouvaient chacune dans un élément
  // intercalé, hors de portée de la feuille de style. Le nom s'écrasait sur
  // trois lignes, le filet débordait de la page.
  it('renonce plutôt que de couper à l’intérieur d’une balise', () => {
    const enveloppe = '<p><a name="x">Sulfate de morphine ........... 5 mg</a></p>';
    assert.equal(composerDoses(enveloppe), enveloppe);
  });

  it('coupe quand même si la conduite est hors de la balise', () => {
    const rendu = composerDoses('<p><em>Sulfate de morphine</em> ........... 5 mg</p>');
    assert.match(rendu, /dose-nom"><em>Sulfate de morphine<\/em><\/span>/);
    assert.match(rendu, /dose-valeur">5 mg</);
  });

  it('ne rend jamais de balisage déséquilibré', () => {
    for (const cas of [
      '<p><a name="x">Sulfate de morphine ........... 5 mg</a></p>',
      '<p><em>Sulfate</em> ........... <strong>5 mg</strong></p>',
      '<p>Sulfate <em>de morphine ...........</em> 5 mg</p>',
    ]) {
      const rendu = composerDoses(cas);
      for (const balise of ['a', 'em', 'strong', 'span', 'p']) {
        const ouvre = (rendu.match(new RegExp(`<${balise}\\b`, 'g')) || []).length;
        const ferme = (rendu.match(new RegExp(`</${balise}>`, 'g')) || []).length;
        assert.equal(ouvre, ferme, `${balise} dans ${cas}`);
      }
    }
  });

  it('ne touche pas à un paragraphe fait de points seuls', () => {
    const points = '<p>..............</p>';
    assert.equal(composerDoses(points), points);
  });

  it('ne coupe pas une phrase sur des points de suspension', () => {
    const phrase = '<p>Suite... du texte normal</p>';
    assert.equal(composerDoses(phrase), phrase);
  });

  it('laisse intacte une phrase qui se termine par un point', () => {
    const phrase = '<p>Pour la liste complète des excipients, voir rubrique 6.1.</p>';
    assert.equal(composerDoses(phrase), phrase);
  });

  it('supporte le vide', () => {
    assert.equal(composerDoses(''), '');
    assert.equal(composerDoses(null), '');
  });
});

// Dix-huit notices échouaient à chaque passe de build-sections sur la
// contrainte NOT NULL de `numero`, et le document entier était perdu — sans
// que rien d'autre qu'une ligne d'erreur ne le signale.
describe('titre sans numéro', () => {
  // Deux conditions pour reproduire le cas : au moins trois titres numérotés —
  // sinon `outline` bascule sur les blocs, qui les exigent tous numérotés — et
  // un titre sans numéro **après** le premier numéroté. Ceux qui précèdent sont
  // retirés comme titre de document ; c'est celui du milieu qui passait, et qui
  // faisait échouer l'insertion.
  const NOTICE = `<h3>NOTICE : INFORMATION DE L'UTILISATEUR</h3>
    <p>Veuillez lire attentivement cette notice avant de prendre ce médicament.</p>
    <h3>1. Qu'est-ce que KEYVAX et dans quels cas est-il utilisé ?</h3>
    <p>Antiviral.</p>
    <h3>2. Quelles sont les informations à connaître ?</h3>
    <p>Ne prenez jamais KEYVAX si vous êtes allergique.</p>
    <h3>Enfants et adolescents</h3>
    <p>KEYVAX n'est pas recommandé avant douze ans.</p>
    <h3>3. Comment prendre KEYVAX ?</h3>
    <p>Un comprimé par jour.</p>
    <h3>4. Quels sont les effets indésirables éventuels ?</h3>
    <p>Nausées fréquentes.</p>`;

  it('lui donne une chaîne vide, jamais null', () => {
    const { sections } = splitDocument(NOTICE, 'notice');
    for (const s of sections) {
      assert.notEqual(s.numero, null, `« ${s.libelle} » sans numéro`);
      assert.equal(typeof s.numero, 'string');
    }
  });

  it('ne perd pas le texte qui suit le titre non numéroté', () => {
    const { sections } = splitDocument(NOTICE, 'notice');
    const intercalaire = sections.find((s) => s.numero === '');
    assert.ok(intercalaire, 'le titre intercalaire est conservé');
    assert.equal(intercalaire.libelle, 'Enfants et adolescents');
    assert.match(intercalaire.texte, /pas recommandé avant douze ans/);
  });

  it('ne compte pas la chaîne vide comme une rubrique du socle', () => {
    const { manquantes } = splitDocument(NOTICE, 'notice');
    assert.ok(!manquantes.includes(''), 'le socle ne réclame que des numéros réels');
  });
});
