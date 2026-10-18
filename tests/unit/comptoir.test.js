import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { lireGrossesse, lireConduite, lireRepas, lireOuverture, lireComptoir } from '../../src/comptoir.js';
import { signaletique } from '../../src/signaletique.js';

// Phrases relevées dans les RCP de la base.

describe('grossesse et allaitement (rubrique 4.3)', () => {
  it('lit la contre-indication et sa période', () => {
    assert.equal(lireGrossesse('Hypersensibilité à la substance active. Deuxième et troisième trimestres de la grossesse (voir rubriques 4.4 et 4.6).').grossesse.periode, '2e et 3e trimestres');
    assert.equal(lireGrossesse('Grossesse, à partir du début du 6ème mois (24 semaines d’aménorrhée) (voir rubrique 4.6).').grossesse.periode, 'dès 24 SA');
    assert.equal(lireGrossesse('Dernier trimestre de la grossesse (voir rubrique 4.6).').grossesse.periode, '3e trimestre');
    const toute = lireGrossesse('Hypersensibilité. Grossesse et allaitement (voir rubrique 4.6).');
    assert.equal(toute.grossesse.periode, null);
    assert.equal(toute.allaitement.phrase, 'Grossesse et allaitement (voir rubrique 4.6).');
  });

  it('découpe les puces et cite le seul segment', () => {
    const lu = lireGrossesse('· hypersensibilité ; · insuffisance hépatique sévère ; · allaitement');
    assert.equal(lu.grossesse, null);
    assert.equal(lu.allaitement.phrase, 'allaitement');
  });

  it('ignore ce qui n’interdit pas', () => {
    assert.equal(lireGrossesse('Ce médicament est généralement déconseillé pendant la grossesse.'), null);
    assert.equal(lireGrossesse('Concernant l’utilisation au cours de la grossesse, se reporter à la rubrique 4.6.'), null);
    assert.equal(lireGrossesse('Hypersensibilité à la substance active.'), null);
    assert.equal(lireGrossesse(null), null);
  });
});

describe('conduite (rubrique 4.7)', () => {
  it('lit le niveau de la formule européenne, le plus fort d’abord', () => {
    assert.equal(lireConduite('La méthadone a une influence majeure sur la capacité à conduire ou à utiliser des machines.').niveau, 'importante');
    assert.equal(lireConduite('Fycompa a une influence modérée sur l’aptitude à conduire des véhicules.').niveau, 'moderee');
    assert.equal(lireConduite('X n’a aucun effet ou qu’un effet négligeable sur l’aptitude à conduire. Chez certains patients, X peut avoir une influence mineure.').niveau, 'mineure');
    assert.equal(lireConduite('Ce médicament n’a aucun effet ou qu’un effet négligeable sur l’aptitude à conduire.').niveau, 'negligeable');
  });

  it('se tait sans la formule, et sur un niveau nié', () => {
    assert.equal(lireConduite('Les effets sur l’aptitude à conduire des véhicules n’ont pas été étudiés.'), null);
    assert.equal(lireConduite('X n’a pas d’influence importante sur l’aptitude à conduire.'), null);
  });
});

describe('repas (rubrique 4.2)', () => {
  it('lit la contrainte', () => {
    assert.equal(lireRepas('Les comprimés doivent être pris au cours des repas (voir rubrique 5.2).').cle, 'au-repas');
    assert.equal(lireRepas('La dose totale journalière doit être prise le matin, à jeun et au moins une demi-heure avant le petit déjeuner.').cle, 'a-jeun');
    assert.equal(lireRepas('Il doit être pris sans nourriture, au moins une heure avant ou deux heures après un repas.').cle, 'a-jeun');
    assert.equal(lireRepas('Le répaglinide doit être administré avant les repas.').cle, 'avant-repas');
  });

  it('se tait sur l’indifférent, la permission, la négation et la contradiction', () => {
    assert.equal(lireRepas('Lyrica peut être pris au moment ou en dehors des repas.'), null);
    assert.equal(lireRepas('Les comprimés peuvent être pris avec ou sans nourriture.'), null);
    assert.equal(lireRepas('Les comprimés peuvent être pris avec les repas.'), null);
    assert.equal(lireRepas('Le comprimé ne doit pas être pris à jeun.'), null);
    assert.equal(lireRepas('Dans l’indication A, le médicament doit être pris à jeun. Dans l’indication B, il doit être pris au cours du repas.'), null);
    // Une glycémie à jeun n'est pas une prise.
    assert.equal(lireRepas('Surveiller la glycémie à jeun.'), null);
  });
});

describe('après ouverture (rubrique 6.3)', () => {
  it('lit la durée, en chiffres ou en lettres, et le froid', () => {
    assert.deepEqual(lireOuverture('3 ans. Après première ouverture du flacon : 30 jours.'),
      { duree: '30 jours', apres: 'ouverture', froid: false, phrase: 'Après première ouverture du flacon : 30 jours.' });
    assert.equal(lireOuverture('Après la première ouverture du sachet : utiliser les récipients unidose dans un délai d’un mois.').duree, '1 mois');
    const suspension = lireOuverture('Après reconstitution, la suspension se conserve pendant 14 jours au réfrigérateur (entre 2°C et 8°C).');
    assert.equal(suspension.apres, 'reconstitution');
    assert.equal(suspension.froid, true);
    // Clamoxyl : « Suspension reconstituée : 14 jours. »
    assert.deepEqual(lireOuverture('Poudre sèche : 3 ans. Suspension reconstituée : 14 jours.'),
      { duree: '14 jours', apres: 'reconstitution', froid: false, phrase: 'Suspension reconstituée : 14 jours.' });
  });

  it('se tait sans durée', () => {
    assert.equal(lireOuverture('Après ouverture : le produit doit être utilisé immédiatement.'), null);
    assert.equal(lireOuverture('3 ans.'), null);
  });
});

describe('les cases du comptoir dans la bande', () => {
  const rubriques = new Map([
    ['4.3', { texte: 'Grossesse et allaitement (voir rubrique 4.6).', ancre: 'rcp-14' }],
    ['4.7', { texte: 'Il a une influence importante sur l’aptitude à conduire des véhicules.', ancre: 'rcp-20' }],
    ['6.3', { texte: 'Après ouverture : 28 jours.', ancre: 'rcp-40' }],
  ]);
  const produit = { forme_pharmaceutique: 'solution buvable', commercialise: true, cip_products: [] };

  it('un mot, la phrase citée, la rubrique en lien', () => {
    const cases = signaletique(produit, { resume: [] }, null, false, null, 0, null, [], lireComptoir(rubriques, 'solution buvable'));
    const cas = (cle) => cases.find((entree) => entree.cle === cle);
    assert.equal(cas('grossesse').valeur, 'CI grossesse · allaitement');
    assert.equal(cas('grossesse').detail, 'RCP 4.3 : « Grossesse et allaitement (voir rubrique 4.6). »');
    assert.equal(cas('grossesse').lien, '#rcp-14');
    assert.equal(cas('conduite').valeur, 'conduite : influence importante');
    assert.equal(cas('ouverture').valeur, '28 jours après ouverture');
    assert.equal(cas('repas'), undefined);
  });

  it('une influence mineure ne prend pas de place ; une forme injectable n’a pas de durée d’officine', () => {
    const mineure = new Map([
      ['4.7', { texte: 'X a une influence mineure sur l’aptitude à conduire.', ancre: 'rcp-20' }],
      ['6.3', { texte: 'Après ouverture : 28 jours.', ancre: 'rcp-40' }],
    ]);
    const lu = lireComptoir(mineure, 'solution injectable');
    assert.equal(lu.ouverture, null);
    const cases = signaletique(produit, { resume: [] }, null, false, null, 0, null, [], lu);
    assert.equal(cases.some((entree) => entree.cle === 'conduite'), false);
  });
});
