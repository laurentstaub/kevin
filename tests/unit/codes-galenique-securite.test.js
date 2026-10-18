import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { lireCode } from '../../src/codes.js';
import { lireSecabilite, secabiliteDeForme } from '../../src/galenique.js';
import { lireInfo } from '../../src/securite.js';
import { signaletique } from '../../src/signaletique.js';

describe('lireCode', () => {
  it('reconnaît CIP 13 et CIP 7', () => {
    assert.deepEqual(lireCode('3400934071485'), { type: 'cip13', code: '3400934071485' });
    assert.deepEqual(lireCode(' 3400 9340 71485 '), { type: 'cip13', code: '3400934071485' });
    assert.deepEqual(lireCode('3407148'), { type: 'cip7', code: '3407148' });
  });

  it('lit le CIP 13 dans la chaîne GS1 du Datamatrix', () => {
    assert.deepEqual(lireCode('010340093407148517271231101234AB'), { type: 'cip13', code: '3400934071485' });
    assert.deepEqual(lireCode('(01)03400934071485(17)271231(10)LOT1'), { type: 'cip13', code: '3400934071485' });
    assert.deepEqual(lireCode(']d201034009340714851727\u001d10LOT'), { type: 'cip13', code: '3400934071485' });
    assert.deepEqual(lireCode('03400934071485'), { type: 'cip13', code: '3400934071485' });
  });

  it('laisse passer ce qui n’est pas un code', () => {
    for (const saisie of ['doliprane 1000', '1000', '12345678', '0123456789012', '', null]) {
      assert.equal(lireCode(saisie), null, String(saisie));
    }
  });
});

describe('lireSecabilite', () => {
  it('sécable, quadrisécable, non sécable', () => {
    assert.equal(lireSecabilite('Comprimé pelliculé sécable.').valeur, 'secable');
    assert.equal(lireSecabilite('Comprimé quadrisécable.').valeur, 'quadrisecable');
    assert.equal(lireSecabilite('Comprimé rond, non sécable, gravé « 10 ».').valeur, 'non-secable');
    assert.equal(lireSecabilite('Comprimé blanc. Le comprimé peut être divisé en doses égales.').valeur, 'secable');
  });

  it('une barre de prise seule l’emporte sur « sécable »', () => {
    const texte = 'Comprimé sécable. La barre de cassure n’est pas destinée à briser le comprimé.';
    const lu = lireSecabilite(texte);
    assert.equal(lu.valeur, 'prise-seule');
    assert.match(lu.phrase, /n’est pas destinée/);
    assert.equal(
      lireSecabilite('La barre de cassure permet seulement de faciliter la prise du comprimé, elle ne le divise pas en doses égales.').valeur,
      'prise-seule',
    );
  });

  it('formulations rencontrées : pluriel, « parties égales », « peut-être », négations', () => {
    assert.equal(lireSecabilite('Comprimé. Les comprimés peuvent être divisés en deux parties égales.').valeur, 'secable');
    assert.equal(lireSecabilite('Comprimé blanc, rond. Le comprimé peut-être divisé en doses égales.').valeur, 'secable');
    assert.equal(lireSecabilite('La barre de cassure n’est là que pour faciliter la prise du comprimé, elle ne le divise pas en deux-demi doses égales.').valeur, 'prise-seule');
    assert.equal(lireSecabilite('Les comprimés pelliculés 10 mg et 20 mg ne sont pas sécables.').valeur, 'non-secable');
  });

  it('lit la consigne des rubriques 4.2 et 4.4, et dit d’où vient la phrase', () => {
    const lu = lireSecabilite('Comprimé.', { '4.2': 'Voie orale. Les comprimés doivent être avalés entiers et ne doivent pas être divisés, mâchés ou écrasés.' });
    assert.equal(lu.valeur, 'ne-pas-couper');
    assert.equal(lu.rubrique, '4.2');
    assert.match(lu.phrase, /^Les comprimés doivent/);
    assert.equal(lireSecabilite(null, { '4.4': 'Ils ne doivent être ni mâchés, ni écrasés ni cassés avant ingestion.' }).valeur, 'ne-pas-couper');
    assert.equal(lireSecabilite(null, { '4.2': 'Ne pas tenter de diviser le comprimé.' }).valeur, 'ne-pas-couper');
    assert.equal(lireSecabilite(null, { '4.2': 'La barre de cassure n’est pas destinée à diviser le comprimé.' }).valeur, 'prise-seule');
    assert.equal(lireSecabilite('Comprimé sécable.').rubrique, '3');
  });

  it('une dose divisée n’est pas un comprimé qu’on coupe', () => {
    const consignes = {
      '4.2': 'La posologie doit être divisée par deux chez l’insuffisant rénal. La dose ne doit pas être divisée en deux prises. '
        + 'Un comprimé sécable à 100 mg est disponible.',
    };
    assert.equal(lireSecabilite('Comprimé.', consignes), null);
  });

  it('se tait sur une consigne qui contredit la rubrique 3', () => {
    assert.equal(lireSecabilite('Comprimé sécable.', { '4.2': 'Le comprimé ne doit pas être cassé.' }), null);
  });

  it('se tait sur une barre de cassure seule ou un RCP qui se contredit', () => {
    assert.equal(lireSecabilite('Comprimé jaune, rond et convexe, présentant une barre de cassure.'), null);
    assert.equal(lireSecabilite('50 mg : comprimés non sécables. 100 mg : comprimés sécables.'), null);
    assert.equal(lireSecabilite(null), null);
  });
});

describe('secabiliteDeForme', () => {
  it('lit la forme BDPM, sans citer de rubrique', () => {
    assert.deepEqual(secabiliteDeForme('comprimé pelliculé sécable'), { valeur: 'secable', phrase: 'comprimé pelliculé sécable', rubrique: null });
    assert.equal(secabiliteDeForme('comprimé quadrisécable').valeur, 'quadrisecable');
    assert.equal(secabiliteDeForme('comprimé pelliculé'), null);
    assert.equal(secabiliteDeForme(null), null);
  });
});

describe('lireInfo', () => {
  const html = "<a target='_blank'  title=Lien direct vers l'information importante sur le site de l'ANSM - Nouvelle fen&ecirc;tre href='https://ansm.sante.fr/actualites/tramadol'>Tramadol : moins de comprimés</a>";

  it('extrait intitulé et adresse ANSM', () => {
    assert.deepEqual(lireInfo(html), { intitule: 'Tramadol : moins de comprimés', url: 'https://ansm.sante.fr/actualites/tramadol' });
  });

  it('écarte une adresse hors des domaines autorisés', () => {
    const autre = "<a href='https://exemple.com/x'>Titre</a>";
    assert.deepEqual(lireInfo(autre), { intitule: 'Titre', url: null });
    assert.deepEqual(lireInfo("<a href='javascript:alert(1)'>Titre</a>"), { intitule: 'Titre', url: null });
  });
});

describe('bande : sécabilité et triangle noir', () => {
  const produit = { forme_pharmaceutique: 'comprimé pelliculé', commercialise: true, cip_products: [], surveillance_renforcee: true };
  const cases = signaletique(produit, { resume: [] }, null, null, false, null, 0, { valeur: 'secable', phrase: 'Comprimé sécable.', rubrique: '3' });

  it('ajoute la sécabilité à la forme, la phrase en infobulle', () => {
    const forme = cases.find((cas) => cas.cle === 'forme');
    assert.match(forme.valeur, /· sécable$/);
    assert.match(forme.detail, /RCP 3 : « Comprimé sécable\. »/);
  });

  it('RCP muet : la forme BDPM dit « sécable », la bande le garde', () => {
    const sansRcp = signaletique({ ...produit, forme_pharmaceutique: 'comprimé pelliculé sécable' }, { resume: [] }, null, null, false);
    const forme = sansRcp.find((cas) => cas.cle === 'forme');
    assert.equal(forme.valeur, 'comprimé · sécable');
    assert.equal(forme.detail, 'comprimé pelliculé sécable');
  });

  it('affiche le triangle noir après la forme', () => {
    const cles = cases.map((cas) => cas.cle);
    assert.ok(cles.indexOf('surveillance') > cles.indexOf('forme'));
  });
});
