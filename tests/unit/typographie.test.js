import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  listes, sousTitres, espaces, notes, interactions, renvois, structurer, rangDePuce,
  insecables, amorces, lisibilite,
} from '../../src/typographie.js';

describe('rangs de puce', () => {
  it('reconnaît le point médian et le tiret au premier rang', () => {
    assert.equal(rangDePuce('· tuberculose pulmonaire'), 1);
    assert.equal(rangDePuce('• arthrose'), 1);
    assert.equal(rangDePuce('- insuffisance rénale'), 1);
  });

  it('reconnaît le « o » de Word au second rang', () => {
    assert.equal(rangDePuce('o des lombalgies,'), 2);
  });

  // « ou » est un mot : le motif exige « o » suivi d'une espace.
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

  // <ul> fille directe de <ul> est invalide.
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

  it('n’en insère jamais', () => {
    assert.equal(espaces('<p>50% et http://x</p>'), '<p>50% et http://x</p>');
  });

  it('ne touche pas aux attributs', () => {
    const html = '<a href="/x?a=1 ; b">lien</a>';
    assert.equal(espaces(html), html);
  });
});

describe('structurer', () => {
  // Sinon le document ne cite plus la source à l'identique.
  it('ne corrige pas les fautes de la source', () => {
    const html = '<p>(1 à 2 gélule(s)))</p>';
    assert.match(structurer(html), /\(1 à 2 gélule\(s\)\)\)/);
  });
});

describe('notes de bas de rubrique', () => {
  // Renvois QRD par astérisque (doublé au second) : la note doit peser moins que le texte.
  it('reconnaît un renvoi par astérisque', () => {
    assert.match(notes('<p>*Les prises de poids sont un facteur de risque.</p>'), /^<p class="note">/);
    assert.match(notes('<p>**Une anomalie a été rapportée.</p>'), /^<p class="note">/);
  });

  it('garde l’appel en tête', () => {
    assert.match(notes('<p>*Voir rubrique 4.4.</p>'), /\*Voir rubrique 4\.4\./);
  });

  it('ne prend pas une mention pour une note', () => {
    const html = '<p>Fréquence indéterminée : anomalie de Pelger-Huët**.</p>';
    assert.equal(notes(html), html, 'l’astérisque est en fin, pas en tête');
  });

  // Pas de second attribut `class` d'une passe suivante.
  it('laisse en paix un paragraphe déjà classé', () => {
    const html = '<p class="dose">*quelque chose</p>';
    assert.equal(notes(html), html);
  });
});

describe('substances en interaction', () => {
  // Rubrique 4.5 (thésaurus ANSM) : un paragraphe « + substance » par niveau de gravité.
  it('reconnaît la ligne d’une substance', () => {
    assert.match(interactions('<p>+ Millepertuis</p>'), /^<p class="interaction">/);
    assert.match(interactions('<p>+ Pénems (carbapénèmes)</p>'), /^<p class="interaction">/);
  });

  // Le signe signifie « en association avec ».
  it('garde le signe', () => {
    assert.match(interactions('<p>+ Millepertuis</p>'), /\+ Millepertuis/);
  });

  it('ne prend pas un plus arithmétique pour une substance', () => {
    const html = '<p>Une dose de 500 mg + 30 mg par jour.</p>';
    assert.equal(interactions(html), html);
  });

  // Répertoire clos de quatre niveaux.
  it('promeut les niveaux de gravité en sous-titres', () => {
    for (const libelle of ['Associations contre-indiquées', 'Associations déconseillées',
      "Associations faisant l'objet de précautions d'emploi", 'Associations à prendre en compte']) {
      assert.match(sousTitres(`<p>${libelle}</p>`), /^<h5 class="sous-titre">/, libelle);
    }
  });
});

describe('renvois entre rubriques', () => {
  const ancres = new Map([
    ['4.3', { id: 'rcp-5', libelle: 'Contre-indications' }],
    ['4.6', { id: 'rcp-8', libelle: 'Fertilité, grossesse et allaitement' }],
  ]);

  it('ne rend cliquable que le numéro', () => {
    assert.equal(
      renvois('<p>Hypersensibilité (voir rubrique 4.6).</p>', ancres),
      '<p>Hypersensibilité (voir rubrique <a class="renvoi" href="#rcp-8"'
        + ' title="4.6 — Fertilité, grossesse et allaitement">4.6</a>).</p>',
    );
  });

  it('traite une énumération de rubriques', () => {
    const rendu = renvois('<p>Voir rubriques 4.3 et 4.6.</p>', ancres);
    assert.match(rendu, /href="#rcp-5"[^>]*>4\.3<\/a> et <a class="renvoi" href="#rcp-8"[^>]*>4\.6<\/a>/);
  });

  // Ex. une notice qui cite le RCP : pas de lien mort.
  it('laisse en texte un renvoi vers une rubrique absente', () => {
    const html = '<p>Voir rubrique 9.9.</p>';
    assert.equal(renvois(html, ancres), html);
  });

  // Tournures relevées sur un RCP entier.
  it('reconnaît toutes les tournures du corpus', () => {
    const ancres = new Map([
      ['4.4', { id: 'rcp-1', libelle: 'Mises en garde' }],
      ['4.6', { id: 'rcp-2', libelle: 'Grossesse' }],
      ['6.1', { id: 'rcp-9', libelle: 'Liste des excipients' }],
    ]);
    const lie = (texte) => (renvois(`<p>${texte}</p>`, ancres).match(/class="renvoi"/g) ?? []).length;

    assert.equal(lie('mentionnés à la rubrique 6.1.'), 1, 'à la rubrique');
    assert.equal(lie('Voir rubrique 4.4.'), 1, 'majuscule initiale');
    assert.equal(lie('voir la rubrique 4.4'), 1, 'voir la rubrique');
    assert.equal(lie('voir rubriques 4.4 et 4.6'), 2, 'pluriel, deux numéros');
    assert.equal(lie('voir rubrique 4.4 et 4.6'), 2, 'singulier, deux numéros');
    assert.equal(lie('voir rubriques 4.4'), 1, 'pluriel, un numéro');
  });

  it('ne touche pas aux nombres qui ne sont pas des renvois', () => {
    const html = '<p>Une dose de 4.6 mg par jour.</p>';
    assert.equal(renvois(html, ancres), html);
  });

  it('ne touche pas aux attributs', () => {
    const html = '<a href="/x?rubrique=4.6">voir rubrique 4.6</a>';
    assert.match(renvois(html, ancres), /href="\/x\?rubrique=4\.6"/);
  });

  it('nomme sa destination en infobulle', () => {
    const rendu = renvois('<p>voir rubrique 4.6</p>', ancres);
    assert.match(rendu, /title="4\.6 — Fertilité, grossesse et allaitement"/);
  });

  it('échappe l’intitulé mis en attribut', () => {
    const piege = new Map([['4.1', { id: 'rcp-0', libelle: 'Guillemet " et esperluette &' }]]);
    const rendu = renvois('<p>voir rubrique 4.1</p>', piege);
    assert.match(rendu, /title="4\.1 — Guillemet &quot; et esperluette &amp;"/);
  });

  it('lie sans infobulle quand l’intitulé manque', () => {
    const sansLibelle = new Map([['4.1', { id: 'rcp-0' }]]);
    const rendu = renvois('<p>voir rubrique 4.1</p>', sansLibelle);
    assert.match(rendu, /<a class="renvoi" href="#rcp-0">4\.1<\/a>/);
  });

  it('rend le document intact sans table d’ancres', () => {
    const html = '<p>voir rubrique 4.6</p>';
    assert.equal(renvois(html, new Map()), html);
    assert.equal(renvois(html, null), html);
  });
});

describe('lisibilité, couche A', () => {
  const NBSP = '\u00a0';

  it('ne sépare plus un nombre de son unité', () => {
    assert.equal(insecables('<p>de 10 mg/jour à 4 000 UI</p>'), `<p>de 10${NBSP}mg/jour à 4${NBSP}000${NBSP}UI</p>`);
  });

  it('ne touche ni aux attributs ni aux mots qui commencent comme une unité', () => {
    assert.equal(insecables('<a href="/x?a=1 mg">2 grammes</a>'), '<a href="/x?a=1 mg">2 grammes</a>');
  });

  it('met en gras l’amorce d’un paragraphe', () => {
    assert.equal(
      amorces('<p>Schizophrénie : la posologie initiale est de 10 mg.</p>'),
      '<p><strong class="amorce">Schizophrénie</strong> : la posologie initiale est de 10 mg.</p>',
    );
  });

  it('accepte une amorce longue avec un chiffre', () => {
    assert.match(amorces('<p>Enfants de 6 à 12 ans : 5 mg</p>'), /<strong class="amorce">Enfants de 6 à 12 ans<\/strong>/);
  });

  // Une phrase qui annonce la suite n'est pas une amorce.
  it('laisse les phrases', () => {
    for (const html of [
      '<p>Les effets suivants ont été rapportés : x</p>',
      '<p>Il est recommandé : x</p>',
      '<p>la dose : x</p>',
      '<p>Elles sont limitées à : x</p>',
      '<p class="note">Note : y</p>',
    ]) assert.equal(amorces(html), html);
  });

  it('ne s’applique qu’aux RCP', () => {
    const html = '<p>Schizophrénie : x</p>';
    assert.equal(lisibilite(html, { type: 'notice', numero: '3' }), html);
    assert.match(lisibilite(html, { type: 'rcp', numero: '4.2' }), /amorce/);
  });

  it('rejoue les intitulés sur une base ancienne', () => {
    assert.match(lisibilite('<p>Posologie</p>', { type: 'rcp_notice', numero: '4.2' }), /<h5 class="sous-titre">/);
  });
});
