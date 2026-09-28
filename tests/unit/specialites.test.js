import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decomposer, regrouperSpecialites } from '../../src/specialites.js';

describe('decomposer', () => {
  it('sépare le nom, le dosage et la forme', () => {
    assert.deepEqual(decomposer('DUROGESIC 100 microgrammes/heure, dispositif transdermique'),
      { nom: 'DUROGESIC', dosage: '100 microgrammes/heure' });
  });

  // La virgule décimale n'est pas celle de la forme.
  it('ne coupe pas sur la virgule décimale', () => {
    assert.deepEqual(decomposer('OXOMEMAZINE ARROW 0,33 mg/ml, sirop'),
      { nom: 'OXOMEMAZINE ARROW', dosage: '0,33 mg/ml' });
  });

  it('garde un chiffre collé au nom dans le nom', () => {
    assert.equal(decomposer('VITAMINE B12 GERDA 1000 microgrammes/4 ml, solution').nom, 'VITAMINE B12 GERDA');
  });

  it('accepte une dénomination sans dosage', () => {
    assert.deepEqual(decomposer('DRILL TOUX SECHE, sirop'), { nom: 'DRILL TOUX SECHE', dosage: '' });
  });
});

describe('regrouperSpecialites', () => {
  const sp = (id, denomination, forme, titulaires = 'L') => ({ id, denomination, forme_pharmaceutique: forme, titulaires });

  it('regroupe par forme, la plus fournie d’abord, puis par nom', () => {
    const g = regrouperSpecialites([
      sp('1', 'ABSTRAL 100 microgrammes, comprimé sublingual', 'comprimé sublingual'),
      sp('2', 'DUROGESIC 100 microgrammes/heure, dispositif transdermique', 'dispositif transdermique'),
      sp('3', 'DUROGESIC 12 microgrammes/heure, dispositif transdermique', 'Dispositif transdermique'),
    ]);
    assert.deepEqual(g.map((f) => [f.forme, f.total]), [['dispositif transdermique', 2], ['comprimé sublingual', 1]]);
    assert.equal(g[0].noms.length, 1);
  });

  // 12 avant 100 : l'ordre des valeurs, pas celui des caractères.
  it('range les dosages par valeur et écrit l’unité une fois', () => {
    const [f] = regrouperSpecialites([
      sp('1', 'DUROGESIC 100 microgrammes/heure, patch', 'patch'),
      sp('2', 'DUROGESIC 12 microgrammes/heure, patch', 'patch'),
      sp('3', 'DUROGESIC 37,5 microgrammes/heure, patch', 'patch'),
    ]);
    assert.equal(f.noms[0].unite, 'microgrammes/heure');
    assert.deepEqual(f.noms[0].dosages.map((d) => d.libelle), ['12', '37,5', '100']);
  });

  // Unités différentes, ou mention après le dosage : chaque dosage s'écrit en entier.
  it('écrit les dosages en entier quand l’unité diffère', () => {
    const [f] = regrouperSpecialites([
      sp('1', 'OXOMEMAZINE ARROW 0,33 mg/ml SANS SUCRE, solution buvable', 'solution buvable'),
      sp('2', 'OXOMEMAZINE ARROW 0,33 mg/ml, solution buvable', 'solution buvable'),
    ]);
    assert.equal(f.noms[0].unite, null);
    assert.deepEqual(f.noms[0].dosages.map((d) => d.libelle), ['0,33 mg/ml SANS SUCRE', '0,33 mg/ml']);
  });

  // Même nom, deux laboratoires (importation parallèle) : deux lignes.
  it('distingue les titulaires', () => {
    const [f] = regrouperSpecialites([
      sp('1', 'X 5 mg, comprimé', 'comprimé', 'A'),
      sp('2', 'X 5 mg, comprimé', 'comprimé', 'B'),
    ]);
    assert.equal(f.noms.length, 2);
  });
});
