import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { reparer } from '../../scripts/reparer-encodage.js';

describe('reparer', () => {
  it('remet en clair un libellé de présentation', () => {
    assert.equal(
      reparer('1 flacon(s) polyÃ©thylÃ¨ne haute densitÃ© (PEHD) de 28 gÃ©lule(s)'),
      '1 flacon(s) polyéthylène haute densité (PEHD) de 28 gélule(s)',
    );
  });

  it('rattrape aussi les caractères propres à Windows-1252', () => {
    assert.equal(reparer('Câ€™est le cas'), 'C’est le cas');
    assert.equal(reparer('coeur â€” et poumon'), 'coeur — et poumon');
  });

  // Le vrai risque d'un tel script n'est pas de rater une ligne, c'est
  // d'abîmer celles qui vont bien.
  it('laisse intact un texte déjà correct', () => {
    for (const sain of [
      'Comprimé pelliculé sécable',
      'ACIDE ZOLEDRONIQUE MEDAC 4 mg/100 ml',
      'C’est déjà propre',
      'Ça va',
      'Âge minimal : 12 ans',
      'Traitement à l’unité',
    ]) {
      assert.equal(reparer(sain), null, sain);
    }
  });

  it('ne touche pas à une chaîne sans accent', () => {
    assert.equal(reparer('KEYVAX 50 mg, solution injectable'), null);
  });

  it('supporte le vide', () => {
    assert.equal(reparer(''), null);
    assert.equal(reparer(null), null);
    assert.equal(reparer(undefined), null);
  });

  it('renonce plutôt que de produire du charabia', () => {
    // « Ã » suivi d'un caractère hors plage : la séquence d'octets ne serait
    // pas de l'UTF-8 valide, on ne réécrit pas.
    assert.equal(reparer('Ãge'), null);
  });
});
