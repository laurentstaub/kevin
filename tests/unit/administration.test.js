import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { lireAdministration, raisonDeglutition, filtrerDeglutition } from '../../src/galenique.js';
import { lienAlternatives } from '../../src/excipients.js';

const cles = (...textes) => lireAdministration(textes).map((mention) => mention.cle);

describe('administration lue dans le RCP', () => {
  it('interdictions : écraser, croquer, mâcher, ouvrir une gélule', () => {
    assert.deepEqual(cles('Il ne doit être ni mâché ni écrasé.'), ['ne-pas-ecraser']);
    assert.deepEqual(cles('Les comprimés doivent être avalés sans être croqués avec un grand verre d’eau.'), ['ne-pas-ecraser']);
    assert.deepEqual(cles('Les gélules ne doivent être ni ouvertes, ni cassées, ni mâchées.'), ['ne-pas-ecraser', 'ne-pas-ouvrir']);
    assert.deepEqual(cles('Avaler avec un verre d’eau sans ouvrir la gélule.'), ['ne-pas-ouvrir']);
  });

  it('« ne pas ouvrir » ne vaut que pour une gélule', () => {
    assert.deepEqual(cles('Le flacon ne doit jamais être ouvert.'), []);
    assert.deepEqual(cles('Il est recommandé de ne pas ouvrir la plaquette avant d’être prêt.'), []);
  });

  it('avaler entier quand c’est une consigne, pas une possibilité', () => {
    assert.deepEqual(cles('Les gélules doivent être avalées entières avec une boisson.'), ['avaler-entier']);
    assert.deepEqual(cles('Les comprimés sont à avaler tels quels avec un verre d’eau.'), ['avaler-entier']);
    assert.ok(!cles('Les comprimés dispersibles peuvent être croqués, dissous dans un peu d’eau ou avalés entiers.').includes('avaler-entier'));
  });

  it('permissions, dont le sujet est le médicament', () => {
    assert.deepEqual(cles('Les comprimés d’Eliquis peuvent être écrasés et mis en suspension dans de l’eau.'), ['ecrasable', 'dispersible']);
    assert.deepEqual(cles('Les gélules peuvent aussi être ouvertes et leur contenu dispersé dans un demi-verre d’eau.'), ['ouvrable', 'dispersible']);
    // L'enrobage n'est pas le médicament ; « utilisé » ne contient pas le sujet « il ».
    assert.deepEqual(cles('Aucun autre liquide ne doit être utilisé car l’enrobage entérique peut être dissous.'), []);
    // Une permission niée n'en est pas une.
    assert.deepEqual(cles('Les comprimés ne peuvent pas être écrasés.'), ['ne-pas-ecraser']);
  });

  it('« leur contenu peut être administré » : la gélule s’ouvre, sonde comprise', () => {
    const skenan = 'Dans le cas où les gélules ne peuvent être avalées, leur contenu peut être administré directement dans une alimentation semi-solide (purée, confiture, yaourt), ou encore dans des sondes gastriques ou de gastrostomie de diamètre supérieur à 16 F.';
    assert.deepEqual(cles(skenan), ['ouvrable', 'sonde']);
  });

  it('sonde digestive seulement, sans mise en garde', () => {
    assert.deepEqual(cles('Le mélange peut également être administré via une sonde naso-gastrique.'), ['sonde']);
    assert.deepEqual(cles('L’administration par sonde endotrachéale n’est pas recommandée.'), []);
    assert.deepEqual(cles('Rincer la sonde avec 20 ml d’eau.'), []);
  });

  it('une gomme qu’on mâche moins fort n’est pas interdite de mâcher', () => {
    assert.deepEqual(cles('Il est donc important de ne pas mâcher la gomme trop vigoureusement.'), []);
  });

  it('cite la phrase, dans l’ordre d’affichage, et se tait sans mention', () => {
    const [mention] = lireAdministration(['Mode d’administration. Il ne doit être ni mâché ni écrasé.']);
    assert.equal(mention.phrase, 'Il ne doit être ni mâché ni écrasé.');
    assert.deepEqual(lireAdministration(['Voie orale.', null]), []);
  });
});

describe('déglutition difficile', () => {
  it('par la forme (BDPM), sinon par ce que le RCP permet', () => {
    assert.equal(raisonDeglutition('solution buvable'), 'buvable');
    assert.equal(raisonDeglutition('comprimé orodispersible'), 'orodispersible');
    assert.equal(raisonDeglutition('granulés gastro-résistants en sachet'), 'granulés');
    // Une gélule de microgranules reste une gélule : seul son RCP dit qu'elle s'ouvre.
    assert.equal(raisonDeglutition('microgranules à libération prolongée en gélule'), null);
    assert.equal(raisonDeglutition('comprimé pelliculé', [{ cle: 'ne-pas-ecraser', libelle: 'ne pas écraser' }, { cle: 'ecrasable', libelle: 'écrasable' }]), 'écrasable (RCP)');
    assert.equal(raisonDeglutition('comprimé pelliculé', [{ cle: 'ne-pas-ecraser', libelle: 'ne pas écraser' }]), null);
  });

  const categories = [
    { cle: 'SUBSTITUABLE', lignes: [{ id: '1', forme: 'comprimé pelliculé' }, { id: '2', forme: 'comprimé pelliculé' }, { id: '3', forme: 'solution buvable' }] },
    { cle: 'BLOQUE', lignes: [{ id: '9', forme: 'comprimé' }] },
  ];
  const mentions = new Map([['2', [{ cle: 'ecrasable', libelle: 'écrasable' }]]]);

  it('proposé s’il sépare les candidats ; actif, masque et compte', () => {
    assert.equal(filtrerDeglutition(categories, mentions, false).propose, true);
    const actif = filtrerDeglutition(categories, mentions, true);
    assert.deepEqual(actif.categories[0].lignes.map((ligne) => [ligne.id, ligne.deglutition]), [['2', 'écrasable (RCP)'], ['3', 'buvable']]);
    assert.equal(actif.masques, 1);
    assert.equal(actif.categories[1].cle, 'BLOQUE');
  });

  it('les liens gardent les autres filtres', () => {
    assert.equal(lienAlternatives(['lactose'], true), '?sans=lactose&deglutition=1#alternatives');
    assert.equal(lienAlternatives([], false), '?#alternatives');
  });
});
