import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { productLinks, primarySubstance, meddisparLettre } from '../../src/links.js';
import { deaccent, truncate } from '../../src/text.js';

describe('primarySubstance', () => {
  it('prend la première DCI de la liste', () => {
    assert.equal(primarySubstance('PARACÉTAMOL, CAFÉINE'), 'PARACÉTAMOL');
  });

  it('renvoie une chaîne vide si absente', () => {
    assert.equal(primarySubstance(null), '');
    assert.equal(primarySubstance(''), '');
  });
});

describe('productLinks', () => {
  const product = {
    id: '61111111',
    denomination_medicament: 'ASPIRINE UPSA 500 mg',
    active_ingredients: 'ACIDE ACETYLSALICYLIQUE',
  };

  it('construit le lien vers la fiche officielle avec le CIS', () => {
    const { official } = productLinks(product);
    assert.match(official.find((lien) => lien.key === 'bdpm').url, /61111111/);
  });

  it('construit le pont vers le suivi des ruptures', () => {
    const { official } = productLinks(product);
    assert.match(official.find((lien) => lien.key === 'availability').url, /antheosdata/);
  });

  it('encode les termes de recherche', () => {
    const pubmed = productLinks(product).scientific.find((lien) => lien.key === 'pubmed');
    assert.match(pubmed.url, /ACIDE%20ACETYLSALICYLIQUE/);
    assert.ok(!pubmed.url.includes(' '));
  });

  it('omet les liens scientifiques sans principe actif', () => {
    const { scientific, official } = productLinks({ ...product, active_ingredients: null });
    assert.equal(scientific.length, 0);
    assert.ok(official.length > 0);
  });
});

describe('deaccent', () => {
  it('retire les diacritiques comme unaccent() en base', () => {
    assert.equal(deaccent('PARACÉTAMOL'), 'PARACETAMOL');
    assert.equal(deaccent('pédiatrique'), 'pediatrique');
  });

  it('développe les ligatures', () => {
    assert.equal(deaccent('œsophage'), 'oesophage');
  });

  it('laisse le texte non accentué intact', () => {
    assert.equal(deaccent('aspirine 500'), 'aspirine 500');
  });

  it('accepte une entrée non textuelle', () => {
    assert.equal(deaccent(null), '');
  });
});

describe('truncate', () => {
  it('ne touche pas aux chaînes courtes', () => {
    assert.equal(truncate('court', 20), 'court');
  });

  it('coupe sur une limite de mot', () => {
    assert.equal(truncate('un deux trois quatre', 10), 'un deux…');
  });
});

describe('lien Meddispar', () => {
  const restreint = {
    id: '66297965',
    denomination_medicament: 'SKENAN L.P. 100 mg',
    active_ingredients: 'MORPHINE',
  };

  it('prend l’initiale, accents ôtés', () => {
    assert.equal(meddisparLettre('ÉLIQUIS 5 mg'), 'E');
    assert.equal(meddisparLettre('skenan'), 'S');
  });

  // L'index Meddispar n'a d'entrées que pour les lettres.
  it('ne fabrique pas de lettre à partir de rien', () => {
    for (const sansLettre of [null, undefined, '', '  ', '5-FLUOROURACILE']) {
      assert.equal(meddisparLettre(sansLettre), null);
    }
  });

  it('renvoie vers l’index de la lettre quand la dispensation est particulière', () => {
    const lien = productLinks(restreint, { dispensationParticuliere: true })
      .official.find((entree) => entree.key === 'meddispar');
    assert.match(lien.url, /meddispar\.fr/);
    assert.match(lien.url, /letter=S/);
  });

  // Meddispar ne recense pas les spécialités sans condition.
  it('se tait pour une spécialité sans condition de délivrance', () => {
    for (const contexte of [{}, { dispensationParticuliere: false }]) {
      const trouve = productLinks(restreint, contexte).official.find((lien) => lien.key === 'meddispar');
      assert.equal(trouve, undefined);
    }
  });
});
