import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXCIPIENTS, motifExcipient, partieNotoire, quantite, lireExcipients,
  lireSans, cisDesAlternatives, filtrerAlternatives,
} from '../../src/excipients.js';

const ids = (lu) => lu.presents.map((present) => present.id);
const trouve = (lu, id) => lu.presents.find((present) => present.id === id);

describe('déclaration des excipients à effet notoire', () => {
  it('isole la déclaration, jusqu’au renvoi vers la 6.1', () => {
    const r2 = 'Chaque comprimé contient 500 mg de paracétamol. Excipient à effet notoire : lactose. Pour la liste complète des excipients, voir rubrique 6.1.';
    assert.equal(partieNotoire(r2), 'effet notoire : lactose.');
    assert.equal(partieNotoire('Chaque comprimé contient 500 mg de paracétamol.'), '');
  });

  it('lit la quantité qui accompagne le terme, avec sa base', () => {
    const regex = (id) => new RegExp(motifExcipient(EXCIPIENTS.find((excipient) => excipient.id === id)));
    assert.equal(quantite('Chaque comprimé contient 28 mg de saccharose.', regex('saccharose')), '28 mg');
    assert.equal(quantite('sorbitol (E420) (500 mg/ml) et benzoate de sodium', regex('fructose')), '500 mg/ml');
    assert.equal(quantite('Chaque sachet contient 13 mg d’éthanol, 22,5 mg de propylène glycol.', regex('propylene')), '22,5 mg');
    assert.equal(quantite('Excipient à effet notoire : lactose.', regex('lactose')), null);
  });
});

describe('excipients d’un RCP', () => {
  it('cite la déclaration de la rubrique 2, complète par la 6.1', () => {
    const lu = lireExcipients(
      'Excipient à effet notoire : chaque comprimé contient 45 mg de lactose monohydraté. Pour la liste complète des excipients, voir rubrique 6.1.',
      'Lactose monohydraté, amidon de blé, stéarate de magnésium, gélatine.',
    );
    assert.equal(lu.lu, true);
    assert.equal(lu.declares, true);
    assert.deepEqual(ids(lu), ['lactose', 'gluten', 'gelatine']);
    assert.equal(trouve(lu, 'lactose').source, 'notoire');
    assert.equal(trouve(lu, 'lactose').quantite, '45 mg');
    assert.equal(trouve(lu, 'gluten').source, '6.1');
  });

  it('ne prend pas l’amidon prégélatinisé pour de la gélatine, ni le maïs pour du gluten', () => {
    const lu = lireExcipients(null, 'Amidon de maïs prégélatinisé, povidone, talc.');
    assert.deepEqual(ids(lu), []);
    assert.equal(lu.lu, true);
  });

  it('sans 6.1, rien ne permet de dire « sans »', () => {
    assert.equal(lireExcipients('Excipient à effet notoire : saccharose.', null).lu, false);
  });

  it('retient le sodium déclaré au-dessus d’1 mmol, pas le benzoate de sodium', () => {
    const efferv = lireExcipients('Excipients à effet notoire : un comprimé contient 100 mg de benzoate de sodium (E211), 394 mg de sodium, 252 mg de sorbitol.', 'Sorbitol, bicarbonate de sodium.');
    assert.equal(trouve(efferv, 'sodium').quantite, '394 mg');
    const benzoate = lireExcipients('Excipients à effet notoire : sorbitol (E420) (500 mg/ml) et benzoate de sodium (E211) (3 mg/ml).', 'Sorbitol, benzoate de sodium.');
    assert.equal(trouve(benzoate, 'sodium'), undefined);
    const traces = lireExcipients('Excipient à effet notoire : moins de 1 mmol (23 mg) de sodium, c.-à-d. essentiellement « sans sodium ».', 'Croscarmellose sodique.');
    assert.equal(trouve(traces, 'sodium'), undefined);
  });
});

describe('alternatives sans un excipient', () => {
  const categories = [
    { cle: 'SUBSTITUABLE', lignes: [{ id: '1' }, { id: '2' }, { id: '3' }] },
    { cle: 'ALTERNATIVE_CLASSE', molecules: [{ nom: 'x', specialites: [{ id: '4' }, { id: '5' }] }], total: 2 },
    { cle: 'BLOQUE', lignes: [{ id: '9' }] },
  ];
  const profils = new Map([
    ['1', { lu: true, presents: new Set(['lactose']) }],
    ['2', { lu: true, presents: new Set() }],
    // '3' : 6.1 non lue
    ['4', { lu: true, presents: new Set(['lactose', 'gelatine']) }],
    ['5', { lu: true, presents: new Set(['gelatine']) }],
  ]);

  it('lit le paramètre et ignore l’inconnu', () => {
    assert.deepEqual(lireSans('gluten,lactose,zzz'), ['lactose', 'gluten']);
    assert.deepEqual(lireSans(['lactose', 'aspartam']), ['lactose', 'aspartam']);
    assert.deepEqual(lireSans(''), []);
  });

  it('liste les candidats hors écartés', () => {
    assert.deepEqual(cisDesAlternatives(categories), ['1', '2', '3', '4', '5']);
  });

  it('ne propose que les filtres qui séparent les candidats, le produit d’abord', () => {
    const { filtres } = filtrerAlternatives(categories, profils, [], new Set(['gelatine']));
    assert.deepEqual(filtres.map((filtre) => [filtre.id, filtre.avec, filtre.sans, filtre.dansProduit]),
      [['gelatine', 2, 2, true], ['lactose', 2, 2, false]]);
  });

  it('masque ce qui en contient, garde le non lu, compte', () => {
    const resultat = filtrerAlternatives(categories, profils, ['lactose']);
    assert.equal(resultat.masques, 2);
    assert.deepEqual(resultat.categories[0].lignes.map((ligne) => ligne.id), ['2', '3']);
    assert.equal(resultat.categories[0].lignes[1].excipients.lu, false);
    assert.deepEqual(resultat.categories[1].molecules[0].specialites.map((sp) => sp.id), ['5']);
    assert.equal(resultat.categories[1].total, 1);
    assert.equal(resultat.categories[2].cle, 'BLOQUE');
    assert.deepEqual(resultat.categories[1].molecules[0].specialites[0].excipients.courts, ['gélatine']);
  });
});
