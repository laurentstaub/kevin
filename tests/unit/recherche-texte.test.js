import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { manqueIndex, normaliserRubrique, PLAFOND, PAR_PAGE } from '../../src/recherche-texte.js';

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

describe('manqueIndex', () => {
  // Les deux situations demandent des choses opposées : lancer une commande,
  // ou attendre. Une panne annoncée « momentanée » alors qu'elle est
  // définitive fait attendre pour rien.
  it('reconnaît une configuration de recherche absente', () => {
    assert.equal(manqueIndex({ code: '42704', message: 'text search configuration "french_nu" does not exist' }), true);
    assert.equal(manqueIndex({ code: '42883', message: 'function websearch_to_tsquery(unknown, unknown) does not exist' }), true);
  });

  it('ne prend pas une panne passagère pour une absence', () => {
    assert.equal(manqueIndex({ code: '57014', message: 'canceling statement due to statement timeout' }), false);
    assert.equal(manqueIndex({ code: '53300', message: 'too many connections' }), false);
    assert.equal(manqueIndex(null), false);
  });
});
