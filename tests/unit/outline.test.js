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
    assert.ok(!sections.some((section) => section.label.startsWith('RESUME')));
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
    assert.equal(sections.find((section) => section.number === '4').depth, 1);
    assert.equal(sections.find((section) => section.number === '4.1').depth, 2);
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
  const rubriques = (html) => outline(html, 'rcp').sections.map((section) => section.number);

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
      sections.map((section) => section.number),
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

describe('outline — tableaux', () => {
  // Amoxicilline Viatris 500 mg/5 mL : table de posologie par poids en 6.6.
  const ligne = (kg) => `<tr><td><p>${kg} kg</p></td><td><p>0,50</p></td></tr>`;
  const rcp =
    '<p><a name="a">1. DENOMINATION DU MEDICAMENT</a></p><p>AMOXICILLINE</p>' +
    '<p><a name="b">6. DONNEES PHARMACEUTIQUES</a></p>' +
    '<p><a name="c">6.6. Précautions particulières d’élimination et de manipulation</a></p>' +
    `<table>${[7, 8, 9, 10, 11, 12, 13].map(ligne).join('')}</table>` +
    '<p><a name="d">7. TITULAIRE DE L’AUTORISATION DE MISE SUR LE MARCHE</a></p><p>VIATRIS</p>' +
    '<p><a name="e">8. NUMERO(S) D’AUTORISATION DE MISE SUR LE MARCHE</a></p><p>CIP</p>';

  it('ne prend pas les cellules « 7 kg », « 8 kg »… pour des rubriques', () => {
    const { sections } = outline(rcp, 'rcp');
    assert.deepEqual(sections.map((section) => section.number), ['1', '6', '6.6', '7', '8']);
  });

  it('laisse le tableau intact', () => {
    const { html } = outline(rcp, 'rcp');
    assert.ok(html.includes(`<table>${[7, 8, 9, 10, 11, 12, 13].map(ligne).join('')}</table>`));
  });

  it('se replie sur les tableaux quand le document y range ses titres', () => {
    const cellule = (titre) => `<tr><td><p>${titre}</p></td></tr>`;
    const src = `<table>${['1. Un', '2. Deux', '3. Trois'].map(cellule).join('')}</table>`;
    assert.deepEqual(outline(src, 'rcp').sections.map((section) => section.number), ['1', '2', '3']);
  });
});

describe('coherentes', () => {
  const suite = (...numeros) => coherentes(numeros.map((number) => ({ number })));
  const numeros = (resultat) => resultat.map((candidat) => candidat.number);

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
  const rubriques = (html) => outline(html, 'rcp').sections.map((section) => section.number);

  it('ne se laisse pas berner par le <h1> titre de page', () => {
    // Le seul <h1> est le titre de page ; les rubriques sont des <p class="AmmAnnexeTitre*">.
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
      outline(notice, 'notice').sections.map((section) => section.number),
      ['1', '2', '3'],
    );
  });
});

describe('outline — sommaire de notice', () => {
  // Balisage de 628 notices BDPM : sommaire puis vrais titres, tous en <p>.
  const plan = [
    'Qu’est-ce que X et dans quels cas est-il utilisé ?',
    'Quelles sont les informations à connaître avant de prendre X ?',
    'Comment prendre X ?',
    'Quels sont les effets indésirables éventuels ?',
    'Comment conserver X ?',
    'Contenu de l’emballage et autres informations',
  ];
  const sommaire = plan.map((titre, i) => `<p>${i + 1}. ${titre}</p>`).join('');
  const corps = plan.map((titre, i) => `<p>${i + 1}. ${titre.toUpperCase()}</p><p>Texte de la rubrique ${i + 1}.</p>`).join('');
  const notice = `<p>Que contient cette notice ?</p>${sommaire}${corps}`;

  it('pose les titres sur les rubriques, pas sur le sommaire', () => {
    const { html, sections } = outline(notice, 'notice');
    assert.deepEqual(sections.map((section) => section.number), ['1', '2', '3', '4', '5', '6']);
    // Entre le titre 1 et le titre suivant : le texte de la rubrique 1, pas le sommaire.
    const rubrique1 = html.split('id="notice-1"')[1].split('class="doc-heading"')[1];
    assert.match(rubrique1, /Texte de la rubrique 1\./);
  });

  it('ne retire pas une liste numérotée dont la numérotation ne reprend pas', () => {
    const etapes = '<p>1. Ouvrir le flacon</p><p>2. Pencher la tête</p><p>3. Instiller une goutte</p>';
    const { sections } = outline(etapes, 'notice');
    assert.deepEqual(sections.map((section) => section.number), ['1', '2', '3']);
  });
});

describe('outline — titres posés à leur place, pas à la première occurrence', () => {
  const poses = (html) => (html.match(/class="doc-heading"/g) ?? []).length;

  // Sommaire identique au plan : écarté par sansSommaire, mais `replace` posait les
  // titres sur ses entrées, premières occurrences du même texte.
  it('pose le titre sur la rubrique, pas sur l’entrée identique du sommaire', () => {
    const titres = ['1. Un', '2. Deux', '3. Trois'];
    const html = titres.map((titre) => `<p>${titre}</p>`).join('')
      + titres.map((titre, i) => `<p>${titre}</p><p>Texte ${i + 1}.</p>`).join('');
    const { html: sortie } = outline(html, 'notice');
    // Le sommaire reste du texte, intact, avant la première rubrique.
    assert.ok(sortie.startsWith('<p>1. Un</p><p>2. Deux</p><p>3. Trois</p><p id="notice-1"'), sortie.slice(0, 120));
  });

  it('recopie un libellé tel quel, `$` compris', () => {
    const html = '<p>1. Prix en $\' et $&amp; $1</p><p>Texte a.</p><p>2. Deux</p><p>Texte b.</p><p>3. Trois</p><p>Texte c.</p>';
    const { html: sortie } = outline(html, 'notice');
    assert.match(sortie, /<span class="lab">Prix en \$' et \$&amp; \$1<\/span>/);
    // `$'` recopiait la suite du document après le titre.
    assert.equal(sortie.split('Texte a.').length - 1, 1);
  });

  it('pose un titre dont le bloc contient un intertitre d’habillage', () => {
    const html = ['Un', 'Deux', 'Trois'].map((titre, i) => `<div>${i + 1}. <h2>${titre}</h2></div><p>Texte ${i + 1}.</p>`).join('');
    const { html: sortie, sections } = outline(html, 'notice');
    assert.equal(sections.length, 3);
    assert.equal(poses(sortie), 3, 'chaque rubrique a son ancre dans le HTML');
  });
});
