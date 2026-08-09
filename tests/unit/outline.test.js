import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { outline, coherentes } from '../../src/outline.js';

const rcp = `
  <h1>RESUME DES CARACTERISTIQUES DU PRODUIT</h1>
  <h2>1. DENOMINATION DU MEDICAMENT</h2><p>a</p>
  <h2>4. DONNEES CLINIQUES</h2>
  <h3>4.1 Indications thérapeutiques</h3><p>b</p>
  <h3>4.2 Posologie et mode d'administration</h3><p>c</p>`;

describe('outline', () => {
  it('extrait les rubriques et pose les ancres', () => {
    const { html, sections } = outline(rcp, 'rcp');
    assert.equal(sections.length, 4);
    assert.match(html, /id="rcp-2"/);
    assert.equal(sections[0].number, '1');
    assert.equal(sections[0].label, 'Dénomination du médicament');
  });

  it('écarte le titre du document quand les rubriques sont numérotées', () => {
    const { sections } = outline(rcp, 'rcp');
    assert.ok(!sections.some((s) => s.label.startsWith('RESUME')));
  });

  it('sort le numéro du libellé dans le corps du document', () => {
    const { html } = outline(rcp, 'rcp');
    assert.match(html, /<span class="num">4\.1<\/span>/);
    assert.match(html, /<span class="lab">Indications thérapeutiques<\/span>/);
  });

  it('échappe le libellé réinjecté', () => {
    const { html } = outline(
      '<h2>1. A &lt;b&gt;x</h2><h2>2. B</h2><h2>3. C</h2>'.replace('x', 'y'),
      'rcp',
    );
    assert.ok(!html.includes('<b>y'));
  });

  it('déduit la profondeur de la numérotation', () => {
    const { sections } = outline(rcp, 'rcp');
    assert.equal(sections.find((s) => s.number === '4').depth, 1);
    assert.equal(sections.find((s) => s.number === '4.1').depth, 2);
  });

  it('ne produit pas de plan sous trois entrées', () => {
    const { sections } = outline('<h2>1. Un</h2><h2>2. Deux</h2>', 'rcp');
    assert.equal(sections.length, 0);
  });

  it('reconnaît les faux titres en gras des documents convertis du PDF', () => {
    const converti =
      '<p><strong>1. DENOMINATION</strong></p><p>x</p>' +
      '<p><strong>4.1 Indications</strong></p><p>y</p>' +
      '<p><strong>4.2 Posologie</strong></p><p>z</p>';
    const { html, sections } = outline(converti, 'rcp');
    assert.equal(sections.length, 3);
    assert.match(html, /class="doc-heading"/);
  });

  it('ignore un paragraphe en gras non numéroté', () => {
    const { sections } = outline('<p><strong>Attention</strong></p>'.repeat(4), 'rcp');
    assert.equal(sections.length, 0);
  });

  it('accepte un document vide', () => {
    assert.deepEqual(outline('', 'rcp'), { html: '', sections: [] });
  });

  it('n’altère pas le HTML quand il n’y a pas de plan', () => {
    const src = '<p>Notice courte.</p>';
    assert.equal(outline(src, 'notice').html, src);
  });
});

describe('outline — en-tête du document', () => {
  it('retire le titre du document du corps quand les rubriques sont numérotées', () => {
    const src =
      '<h1>RESUME DES CARACTERISTIQUES DU PRODUIT</h1>' +
      '<h2>1. DENOMINATION DU MEDICAMENT</h2><p>a</p>' +
      '<h2>2. COMPOSITION QUALITATIVE ET QUANTITATIVE</h2><p>b</p>' +
      '<h2>3. FORME PHARMACEUTIQUE</h2><p>c</p>';
    const { html, sections } = outline(src, 'rcp');
    assert.ok(!html.includes('RESUME DES CARACTERISTIQUES'));
    assert.equal(sections.length, 3);
    assert.ok(html.includes('Dénomination du médicament'));
  });

  it('conserve le contenu qui suit le titre retiré', () => {
    const src =
      '<h1>TITRE</h1><p>garde-moi</p>' +
      '<h2>1. Un</h2><h2>2. Deux</h2><h2>3. Trois</h2>';
    const { html } = outline(src, 'rcp');
    assert.ok(html.includes('garde-moi'));
  });
});

describe('outline — balisages réels', () => {
  const rubriques = (html) => outline(html, 'rcp').sections.map((s) => s.number);

  it('reconnaît les titres en <p> avec ancre, balisage de la BDPM', () => {
    const bdpm =
      '<p><a name="a">1. DENOMINATION DU MEDICAMENT</a></p><p>ASPIRINE ARROW 75 mg</p>' +
      '<p><a name="b">4.1. Indications thérapeutiques</a></p><p>Prévention secondaire.</p>' +
      '<p><a name="c">4.2. Posologie et mode d’administration</a></p><p>Voie orale.</p>';
    assert.deepEqual(rubriques(bdpm), ['1', '4.1', '4.2']);
  });

  it('normalise ces titres comme les autres', () => {
    const { sections } = outline(
      '<p><a name="a">1. DENOMINATION DU MEDICAMENT</a></p>' +
        '<p><a name="b">3. FORME PHARMACEUTIQUE</a></p>' +
        '<p><a name="c">4. DONNEES CLINIQUES</a></p>',
      'rcp',
    );
    assert.equal(sections[0].label, 'Dénomination du médicament');
    assert.equal(sections[2].label, 'Données cliniques');
  });

  it('ne se laisse pas déborder par un paragraphe court entre deux titres', () => {
    const src =
      '<p><strong>1. Un</strong></p><p>x</p>' +
      '<p><strong>2. Deux</strong></p><p>y</p>' +
      '<p><strong>3. Trois</strong></p><p>z</p>';
    assert.deepEqual(rubriques(src), ['1', '2', '3']);
  });

  it('ignore un paragraphe long même s’il commence par un numéro', () => {
    const src =
      '<p>4.2 La posologie doit être adaptée au poids du patient, ' +
      'et cette phrase dépasse volontairement la longueur admise pour un titre ' +
      'de rubrique afin de vérifier que le filtre de longueur fait son office.</p>' +
      '<p><strong>1. Un</strong></p><p><strong>2. Deux</strong></p><p><strong>3. Trois</strong></p>';
    assert.deepEqual(rubriques(src), ['1', '2', '3']);
  });

  it('n’altère pas un document sans rubrique reconnaissable', () => {
    const src = '<p>Texte libre.</p><p>Autre paragraphe.</p><p>Encore un.</p>';
    const { html, sections } = outline(src, 'rcp');
    assert.equal(sections.length, 0);
    assert.equal(html, src);
  });
});

describe('outline — faux positifs du corps de texte', () => {
  const rcp = `<p>ANSM - Mis à jour le : 19/09/2024</p>
    <p><a name="a">1. DENOMINATION DU MEDICAMENT</a></p><p>ASPIRINE ARROW 75 mg</p>
    <p><a name="b">6. DONNEES PHARMACEUTIQUES</a></p>
    <p><a name="c">6.3. Durée de conservation</a></p><p>3 ans.</p>
    <p><a name="d">6.4. Précautions particulières de conservation</a></p><p>25°C.</p>
    <p><a name="e">6.5. Nature et contenu de l'emballage extérieur</a></p>
    <p>30 comprimés sous plaquettes PVC/aluminium.</p>
    <p><a name="f">7. TITULAIRE DE L'AUTORISATION DE MISE SUR LE MARCHE</a></p><p>ARROW</p>`;

  it('n’érige pas « 3 ans. » en rubrique 3', () => {
    const { sections } = outline(rcp, 'rcp');
    assert.deepEqual(
      sections.map((s) => s.number),
      ['1', '6', '6.3', '6.4', '6.5', '7'],
    );
  });

  it('laisse ces phrases dans le corps du document', () => {
    const { html } = outline(rcp, 'rcp');
    assert.ok(html.includes('3 ans.'));
    assert.ok(html.includes('30 comprimés sous plaquettes'));
  });

  it('ne traite pas ces phrases comme des titres', () => {
    const { html } = outline(rcp, 'rcp');
    assert.ok(!/doc-heading[^>]*><span class="num">3<\/span>/.test(html));
    assert.ok(!/doc-heading[^>]*><span class="num">30<\/span>/.test(html));
  });

  it('conserve la ligne de date, qui est du contenu et non un titre', () => {
    assert.ok(outline(rcp, 'rcp').html.includes('19/09/2024'));
  });
});

describe('coherentes', () => {
  const suite = (...numeros) => coherentes(numeros.map((number) => ({ number })));
  const numeros = (r) => r.map((c) => c.number);

  it('garde une progression complète', () => {
    assert.deepEqual(numeros(suite('1', '2', '4', '4.1', '4.2', '5')), [
      '1',
      '2',
      '4',
      '4.1',
      '4.2',
      '5',
    ]);
  });

  it('écarte un numéro qui rompt la progression', () => {
    assert.deepEqual(numeros(suite('1', '2', '6.3', '3', '6.4', '7')), [
      '1',
      '2',
      '6.3',
      '6.4',
      '7',
    ]);
  });

  it('écarte un numéro hors du plan type', () => {
    assert.deepEqual(numeros(suite('1', '2', '30', '3')), ['1', '2', '3']);
  });

  it('accepte une liste vide', () => {
    assert.deepEqual(coherentes([]), []);
  });
});

describe('outline — pièges du balisage BDPM', () => {
  const rubriques = (html) => outline(html, 'rcp').sections.map((s) => s.number);

  it('ne se laisse pas berner par le <h1> titre de page', () => {
    // Une page BDPM contient un seul <h1> — son titre — et les rubriques sont
    // des <p class="AmmAnnexeTitre*">. Se fier au <h1> faisait conclure « ce
    // document a de vrais titres » et manquer 93 % des RCP.
    const page =
      '<h1 class="textedeno">ANASTROZOLE ACCORD 1 mg, comprimé pelliculé</h1>' +
      '<p class="AmmAnnexeTitre1"><a name="RcpDenomination">1. DENOMINATION DU MEDICAMENT</a></p>' +
      '<p class="AmmCorpsTexte">ANASTROZOLE ACCORD 1 mg</p>' +
      '<p class="AmmAnnexeTitre1"><a name="RcpCompo">2. COMPOSITION QUALITATIVE ET QUANTITATIVE</a></p>' +
      '<p class="AmmCorpsTexte">Anastrozole 1 mg</p>' +
      '<p class="AmmAnnexeTitre2"><a name="RcpIndic">4.1. Indications thérapeutiques</a>&nbsp;&nbsp;<a href="#HautDePage"></a></p>' +
      '<p class="AmmCorpsTexte">Traitement du cancer du sein.</p>';
    assert.deepEqual(rubriques(page), ['1', '2', '4.1']);
  });

  it('nettoie les espaces insécables collés au libellé', () => {
    const page =
      '<p><a name="a">1. DENOMINATION DU MEDICAMENT</a>&nbsp;&nbsp;</p>' +
      '<p><a name="b">2. COMPOSITION QUALITATIVE ET QUANTITATIVE</a>&nbsp;</p>' +
      '<p><a name="c">3. FORME PHARMACEUTIQUE</a>&nbsp;</p>';
    const { sections } = outline(page, 'rcp');
    assert.equal(sections[0].label, 'Dénomination du médicament');
  });

  it('admet un titre long : une notice porte le nom complet du produit', () => {
    const long =
      '2. Quelles sont les informations à connaître avant de prendre ' +
      'AMOXICILLINE/ACIDE CLAVULANIQUE ALMUS 500 mg/62,5 mg ADULTES, comprimé pelliculé ' +
      '(rapport amoxicilline/acide clavulanique : 8/1) ?';
    assert.ok(long.length > 120);
    const notice =
      '<p><a name="a">1. Qu’est-ce que ce médicament et dans quel cas est-il utilisé ?</a></p>' +
      `<p><a name="b">${long}</a></p>` +
      '<p><a name="c">3. Comment prendre ce médicament ?</a></p>';
    assert.deepEqual(
      outline(notice, 'notice').sections.map((s) => s.number),
      ['1', '2', '3'],
    );
  });
});
