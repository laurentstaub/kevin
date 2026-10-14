import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { reparer, reparerSequences } from '../../scripts/reparer-encodage.js';

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
    // « Ã » suivi d'un caractère hors plage : pas d'UTF-8 valide.
    assert.equal(reparer('Ãge'), null);
  });
});

describe('reparerSequences', () => {
  // FORMOTEROL EG (61018059) : texte sain et texte abîmé mêlés, reparer() renonce.
  it('répare un texte qui mêle caractères sains et abîmés', () => {
    const mele = 'Fertilité, grossesse — 4.6. FertilitÃ©, grossesse et allaitement';
    assert.equal(reparer(mele), null);
    assert.equal(reparerSequences(mele), 'Fertilité, grossesse — 4.6. Fertilité, grossesse et allaitement');
  });

  // Le second octet de « à » et des espaces insécables (0xA0) s'est perdu.
  it('rétablit « à » et les espaces insécables dont il ne reste que le premier octet', () => {
    assert.equal(reparerSequences('Excipient Ã effet notoire, rÃ©servÃ© Ã l’adulte'), 'Excipient à effet notoire, réservé à l’adulte');
    assert.equal(reparerSequences('4.1.ÂÂ Indications thÃ©rapeutiques'), '4.1.\u00a0\u00a0 Indications thérapeutiques');
  });

  it('laisse un texte sans séquence abîmée, ses « Â » compris', () => {
    assert.equal(reparerSequences('Âge minimal : 12 ans, Ça va'), null);
    assert.equal(reparerSequences('Texte sain'), null);
    assert.equal(reparerSequences(''), null);
  });
});
