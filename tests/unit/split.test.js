import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { splitDocument, detaguer, PARSER_VERSION } from '../../src/split.js';
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
