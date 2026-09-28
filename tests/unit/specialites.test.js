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
    const groupes = regrouperSpecialites([
      sp('1', 'ABSTRAL 100 microgrammes, comprimé sublingual', 'comprimé sublingual'),
      sp('2', 'DUROGESIC 100 microgrammes/heure, dispositif transdermique', 'dispositif transdermique'),
      sp('3', 'DUROGESIC 12 microgrammes/heure, dispositif transdermique', 'Dispositif transdermique'),
    ]);
    assert.deepEqual(groupes.map((forme) => [forme.forme, forme.total]), [['dispositif transdermique', 2], ['comprimé sublingual', 1]]);
    assert.equal(groupes[0].noms.length, 1);
  });

  // 12 avant 100 : l'ordre des valeurs, pas celui des caractères.
  it('range les dosages par valeur et écrit l’unité une fois', () => {
    const [forme] = regrouperSpecialites([
      sp('1', 'DUROGESIC 100 microgrammes/heure, patch', 'patch'),
      sp('2', 'DUROGESIC 12 microgrammes/heure, patch', 'patch'),
      sp('3', 'DUROGESIC 37,5 microgrammes/heure, patch', 'patch'),
    ]);
    assert.equal(forme.noms[0].unite, 'microgrammes/heure');
    assert.deepEqual(forme.noms[0].dosages.map((dosage) => dosage.libelle), ['12', '37,5', '100']);
  });

  // Unités différentes, ou mention après le dosage : chaque dosage s'écrit en entier.
  it('écrit les dosages en entier quand l’unité diffère', () => {
    const [forme] = regrouperSpecialites([
      sp('1', 'OXOMEMAZINE ARROW 0,33 mg/ml SANS SUCRE, solution buvable', 'solution buvable'),
      sp('2', 'OXOMEMAZINE ARROW 0,33 mg/ml, solution buvable', 'solution buvable'),
    ]);
    assert.equal(forme.noms[0].unite, null);
    assert.deepEqual(forme.noms[0].dosages.map((dosage) => dosage.libelle), ['0,33 mg/ml SANS SUCRE', '0,33 mg/ml']);
  });

  // Même nom, deux laboratoires (importation parallèle) : deux lignes.
  it('distingue les titulaires', () => {
    const [forme] = regrouperSpecialites([
      sp('1', 'X 5 mg, comprimé', 'comprimé', 'A'),
      sp('2', 'X 5 mg, comprimé', 'comprimé', 'B'),
    ]);
    assert.equal(forme.noms.length, 2);
  });

  // L'énoxaparine : « 4 000 UI (40 mg)/0,4 mL ». La tête suffit à distinguer
  // les seringues ; le reste passe en infobulle, et 2 000 vient avant 10 000.
  it('lit la tête d’un dosage composé, garde le détail', () => {
    const [forme] = regrouperSpecialites([
      sp('1', 'LOVENOX 10 000 UI (100 mg)/1 ml, solution injectable', 'solution injectable'),
      sp('2', 'LOVENOX 2 000 UI (20 mg)/0,2 ml, solution injectable', 'solution injectable'),
      sp('3', 'LOVENOX 4 000 UI (40 mg)/0,4 ml, solution injectable', 'solution injectable'),
    ]);
    const nom = forme.noms[0];
    assert.equal(nom.unite, 'UI');
    assert.deepEqual(nom.dosages.map((dosage) => dosage.libelle), ['2\u202f000', '4\u202f000', '10\u202f000']);
    assert.equal(nom.dosages[0].detail, '2 000 UI (20 mg)/0,2 ml');
  });

  // Une association : 500 mg/30 mg et 500 mg/8 mg ont la même tête — on
  // écrit tout, sans quoi deux liens porteraient « 500 ».
  it('écrit tout quand la tête ne distingue pas', () => {
    const [forme] = regrouperSpecialites([
      sp('1', 'X 500 mg/30 mg, comprimé', 'comprimé'),
      sp('2', 'X 500 mg/8 mg, comprimé', 'comprimé'),
    ]);
    assert.equal(forme.noms[0].unite, null);
    assert.deepEqual(forme.noms[0].dosages.map((dosage) => dosage.libelle), ['500 mg/30 mg', '500 mg/8 mg']);
  });
});
