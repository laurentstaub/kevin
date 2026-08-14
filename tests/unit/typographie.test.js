import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { listes, sousTitres, espaces, notes, interactions, renvois, structurer, rangDePuce } from '../../src/typographie.js';

describe('rangs de puce', () => {
  it('reconnaît le point médian et le tiret au premier rang', () => {
    assert.equal(rangDePuce('· tuberculose pulmonaire'), 1);
    assert.equal(rangDePuce('• arthrose'), 1);
    assert.equal(rangDePuce('- insuffisance rénale'), 1);
  });

  it('reconnaît le « o » de Word au second rang', () => {
    assert.equal(rangDePuce('o des lombalgies,'), 2);
  });

  // Aucune phrase française ne commence par « o » suivi d'une espace ; « ou »
  // en revanche est un mot, et le motif exige la limite.
  it('ne prend pas un mot pour une puce', () => {
    assert.equal(rangDePuce('ou des arthroses'), 0);
    assert.equal(rangDePuce('Elles sont limitées à :'), 0);
  });
});

describe('listes', () => {
  it('imbrique le second rang dans l’élément qui le précède', () => {
    const rendu = listes('<p>· Long cours :</p><p>o arthrose,</p><p>o lombalgie.</p>');
    assert.equal(rendu, '<ul><li>Long cours :<ul><li>arthrose,</li><li>lombalgie.</li></ul></li></ul>');
  });

  it('referme la liste dès qu’un vrai paragraphe reprend', () => {
    const rendu = listes('<p>· a</p><p>Texte.</p><p>· b</p>');
    assert.equal(rendu, '<ul><li>a</li></ul><p>Texte.</p><ul><li>b</li></ul>');
  });

  // <ul> fille directe de <ul> est un balisage invalide : sans parent où se
  // nicher, le second rang prend le premier.
  it('remonte un second rang orphelin', () => {
    assert.equal(listes('<p>o seule</p>'), '<ul><li>seule</li></ul>');
  });

  it('retrouve la puce nichée dans un span de Word', () => {
    const rendu = listes('<p><span><span>·</span> arthrose</span></p>');
    assert.match(rendu, /^<ul><li>/);
    assert.doesNotMatch(rendu, /·/);
  });

  it('laisse intact ce qui n’est pas une liste', () => {
    const html = '<p>Elles sont limitées à :</p><table><tr><td>x</td></tr></table>';
    assert.equal(listes(html), html);
  });
});

describe('sous-titres', () => {
  it('promeut un intitulé du modèle QRD', () => {
    assert.equal(sousTitres('<p>Posologie</p>'), '<h5 class="sous-titre">Posologie</h5>');
  });

  it('accepte le deux-points et les accents manquants', () => {
    assert.equal(sousTitres('<p>Personnes agées :</p>'), '<h5 class="sous-titre">Personnes agées :</h5>');
  });

  it('refuse une phrase qui commence par un intitulé', () => {
    const html = '<p>Posologie recommandée : environ 60 mg/kg/jour à répartir en plusieurs prises.</p>';
    assert.equal(sousTitres(html), html);
  });
});

describe('espaces insécables', () => {
  it('durcit une espace déjà présente', () => {
    assert.equal(espaces('<p>au :</p>'), '<p>au :</p>');
  });

  // Ne jamais en insérer : « 50% » et « http:// » doivent rester intacts.
  it('n’en insère jamais', () => {
    assert.equal(espaces('<p>50% et http://x</p>'), '<p>50% et http://x</p>');
  });

  it('ne touche pas aux attributs', () => {
    const html = '<a href="/x?a=1 ; b">lien</a>';
    assert.equal(espaces(html), html);
  });
});

describe('structurer', () => {
  // Le texte réglementaire n'est pas corrigé : ce qui est fautif à la source
  // le reste, sans quoi les deux documents ne se citent plus l'un l'autre.
  it('ne corrige pas les fautes de la source', () => {
    const html = '<p>(1 à 2 gélule(s)))</p>';
    assert.match(structurer(html), /\(1 à 2 gélule\(s\)\)\)/);
  });
});

describe('notes de bas de rubrique', () => {
  // Le modèle QRD renvoie hors du tableau d'effets indésirables par un
  // astérisque, doublé au second renvoi. La note commente le texte : composée
  // à l'identique, elle pèse autant que ce qu'elle commente.
  it('reconnaît un renvoi par astérisque', () => {
    assert.match(notes('<p>*Les prises de poids sont un facteur de risque.</p>'), /^<p class="note">/);
    assert.match(notes('<p>**Une anomalie a été rapportée.</p>'), /^<p class="note">/);
  });

  // L'appel relie la note à sa mention : le retirer romprait le renvoi.
  it('garde l’appel en tête', () => {
    assert.match(notes('<p>*Voir rubrique 4.4.</p>'), /\*Voir rubrique 4\.4\./);
  });

  it('ne prend pas une mention pour une note', () => {
    const html = '<p>Fréquence indéterminée : anomalie de Pelger-Huët**.</p>';
    assert.equal(notes(html), html, 'l’astérisque est en fin, pas en tête');
  });

  // `structurer` enchaîne les passes : un paragraphe déjà classé par l'une ne
  // doit pas recevoir un second attribut `class` de la suivante.
  it('laisse en paix un paragraphe déjà classé', () => {
    const html = '<p class="dose">*quelque chose</p>';
    assert.equal(notes(html), html);
  });
});

describe('substances en interaction', () => {
  // La rubrique 4.5 suit le thésaurus de l'ANSM : sous chaque niveau de
  // gravité, chaque substance ouvre un paragraphe préfixé d'un plus.
  it('reconnaît la ligne d’une substance', () => {
    assert.match(interactions('<p>+ Millepertuis</p>'), /^<p class="interaction">/);
    assert.match(interactions('<p>+ Pénems (carbapénèmes)</p>'), /^<p class="interaction">/);
  });

  // Le signe se lit « en association avec » : le retirer ferait dire à la
  // ligne autre chose que ce qu'elle dit.
  it('garde le signe', () => {
    assert.match(interactions('<p>+ Millepertuis</p>'), /\+ Millepertuis/);
  });

  it('ne prend pas un plus arithmétique pour une substance', () => {
    const html = '<p>Une dose de 500 mg + 30 mg par jour.</p>';
    assert.equal(interactions(html), html);
  });

  // Les quatre niveaux du thésaurus sont un répertoire clos, comme les
  // intitulés du modèle QRD.
  it('promeut les niveaux de gravité en sous-titres', () => {
    for (const n of ['Associations contre-indiquées', 'Associations déconseillées',
      "Associations faisant l'objet de précautions d'emploi", 'Associations à prendre en compte']) {
      assert.match(sousTitres(`<p>${n}</p>`), /^<h5 class="sous-titre">/, n);
    }
  });
});

describe('renvois entre rubriques', () => {
  const ancres = new Map([['4.3', 'rcp-5'], ['4.6', 'rcp-8']]);

  // « voir rubrique » est du texte réglementaire, le numéro est la référence :
  // seul le numéro devient cliquable.
  it('ne rend cliquable que le numéro', () => {
    assert.equal(
      renvois('<p>Hypersensibilité (voir rubrique 4.6).</p>', ancres),
      '<p>Hypersensibilité (voir rubrique <a class="renvoi" href="#rcp-8">4.6</a>).</p>',
    );
  });

  it('traite une énumération de rubriques', () => {
    const r = renvois('<p>Voir rubriques 4.3 et 4.6.</p>', ancres);
    assert.match(r, /href="#rcp-5">4\.3<\/a> et <a class="renvoi" href="#rcp-8">4\.6<\/a>/);
  });

  // La notice cite parfois le RCP : la rubrique visée n'est pas dans le même
  // document. Un lien mort vaut moins que pas de lien.
  it('laisse en texte un renvoi vers une rubrique absente', () => {
    const html = '<p>Voir rubrique 9.9.</p>';
    assert.equal(renvois(html, ancres), html);
  });

  it('ne touche pas aux nombres qui ne sont pas des renvois', () => {
    const html = '<p>Une dose de 4.6 mg par jour.</p>';
    assert.equal(renvois(html, ancres), html);
  });

  it('ne touche pas aux attributs', () => {
    const html = '<a href="/x?rubrique=4.6">voir rubrique 4.6</a>';
    assert.match(renvois(html, ancres), /href="\/x\?rubrique=4\.6"/);
  });

  it('rend le document intact sans table d’ancres', () => {
    const html = '<p>voir rubrique 4.6</p>';
    assert.equal(renvois(html, new Map()), html);
    assert.equal(renvois(html, null), html);
  });
});
