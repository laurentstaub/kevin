import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normaliserRubrique, PLAFOND, PAR_PAGE } from '../../src/recherche-texte.js';

describe('normaliserRubrique', () => {
  it('accepte un numéro de rubrique, avec ou sans sous-niveau', () => {
    assert.equal(normaliserRubrique('4'), '4');
    assert.equal(normaliserRubrique('4.3'), '4.3');
    assert.equal(normaliserRubrique('10'), '10');
    assert.equal(normaliserRubrique(' 4.10 '), '4.10');
  });

  // Le numéro vient de l'URL, donc de n'importe où. Il entre dans un LIKE :
  // le vérifier ici est ce qui permet de ne pas s'en méfier plus loin.
  it('refuse tout ce qui n’est pas un numéro', () => {
    for (const piege of ['4.3.2', '%', "4' OR 1=1", '', null, undefined, 'quatre', '4;']) {
      assert.equal(normaliserRubrique(piege), null, String(piege));
    }
  });
});

describe('bornes', () => {
  // Classer par pertinence suppose d'avoir évalué chaque occurrence : sur un
  // mot courant, c'est cent mille rubriques pour un résultat que personne ne
  // lira. Le plafond est assumé, et la vue dit qu'il a été atteint.
  it('sont des valeurs, pas des nombres épars dans le code', () => {
    assert.equal(typeof PLAFOND, 'number');
    assert.ok(PLAFOND >= 1000, 'assez haut pour toute recherche utile');
    assert.ok(PAR_PAGE > 0 && PAR_PAGE <= 100);
  });
});
