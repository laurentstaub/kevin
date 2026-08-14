import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { listes, sousTitres, espaces, notes, structurer, rangDePuce } from '../../src/typographie.js';

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
