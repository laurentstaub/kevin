import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalLabel } from '../../src/rcp-plan.js';
import { splitHeading } from '../../src/outline.js';

describe('canonicalLabel', () => {
  it('rétablit accents et casse quand le libellé correspond', () => {
    assert.equal(canonicalLabel('4', 'DONNEES CLINIQUES'), 'Données cliniques');
    assert.equal(canonicalLabel('1', 'DENOMINATION DU MEDICAMENT'), 'Dénomination du médicament');
    assert.equal(
      canonicalLabel('6.5', "NATURE ET CONTENU DE L'EMBALLAGE EXTERIEUR"),
      "Nature et contenu de l'emballage extérieur",
    );
  });

  it('accepte les deux rédactions d’une même rubrique', () => {
    assert.equal(canonicalLabel('4.6', 'GROSSESSE ET ALLAITEMENT'), 'Grossesse et allaitement');
    assert.equal(
      canonicalLabel('4.6', 'FERTILITE, GROSSESSE ET ALLAITEMENT'),
      'Fertilité, grossesse et allaitement',
    );
  });

  it('ne substitue jamais un libellé différent', () => {
    // Rédaction propre au produit : la source fait foi.
    assert.equal(canonicalLabel('4.2', 'Posologie chez le sujet âgé'), null);
    assert.equal(canonicalLabel('1', 'AUTRE CHOSE'), null);
  });

  it('renvoie null sur une rubrique hors plan type', () => {
    assert.equal(canonicalLabel('13.4', 'QUELQUE CHOSE'), null);
  });

  it('tolère ponctuation et espaces différents', () => {
    assert.equal(canonicalLabel('4.3', 'CONTRE INDICATIONS'), 'Contre-indications');
  });
});

describe('splitHeading', () => {
  it('sépare le numéro du libellé', () => {
    const h = splitHeading('4.2 Posologie et mode d’administration');
    assert.equal(h.number, '4.2');
    assert.ok(h.label.startsWith('Posologie'));
  });

  it('absorbe le point après le numéro', () => {
    assert.equal(splitHeading('6.3. Durée de conservation').number, '6.3');
  });

  it('normalise le libellé quand il est au plan type', () => {
    const h = splitHeading('5. PROPRIETES PHARMACOLOGIQUES');
    assert.equal(h.label, 'Propriétés pharmacologiques');
    assert.equal(h.canonical, true);
  });

  it('conserve un libellé hors plan type tel quel', () => {
    const h = splitHeading('9. MENTIONS PARTICULIERES DU LABORATOIRE');
    assert.equal(h.label, 'MENTIONS PARTICULIERES DU LABORATOIRE');
    assert.equal(h.canonical, false);
  });

  it('laisse un titre non numéroté intact', () => {
    const h = splitHeading('RESUME DES CARACTERISTIQUES DU PRODUIT');
    assert.equal(h.number, null);
    assert.equal(h.label, 'RESUME DES CARACTERISTIQUES DU PRODUIT');
  });
});
