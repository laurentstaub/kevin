import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dci, specialite, phrase } from '../../src/casse.js';

describe('casse d’affichage', () => {
  it('met la DCI en bas de casse, sigles et chiffres épargnés', () => {
    assert.equal(dci('PARACÉTAMOL'), 'paracétamol');
    assert.equal(dci('CHLORHYDRATE DE TRAMADOL + PARACÉTAMOL'), 'chlorhydrate de tramadol + paracétamol');
    assert.equal(dci('INSULINE NPH'), 'insuline NPH');
    assert.equal(dci('VITAMINE B12'), 'vitamine B12');
    assert.equal(dci('VITAMINE A'), 'vitamine A');
    assert.equal(dci('IMMUNOGLOBULINE IGG'), 'immunoglobuline IgG');
    assert.equal(dci("BROMURE D'IPRATROPIUM"), "bromure d'ipratropium");
  });

  it('laisse ce qui n’est pas crié', () => {
    assert.equal(dci('paracétamol'), 'paracétamol');
    assert.equal(dci(''), '');
    assert.equal(dci(null), '');
  });

  it('met la spécialité en nom propre, dosage et forme intacts', () => {
    assert.equal(specialite('DOLIPRANE 1000 mg, comprimé'), 'Doliprane 1000 mg, comprimé');
    assert.equal(specialite('PARACETAMOL TEVA 500 mg, gélule'), 'Paracetamol Teva 500 mg, gélule');
    assert.equal(specialite('CHLORHYDRATE DE TRAMADOL MYLAN 50 mg'), 'Chlorhydrate de Tramadol Mylan 50 mg');
    assert.equal(specialite('ACIDE FOLIQUE CCD 5 mg'), 'Acide Folique CCD 5 mg');
    assert.equal(specialite('DAFALGAN-CODEINE'), 'Dafalgan-Codeine');
    assert.equal(specialite('INSULINE NPH LILLY'), 'Insuline NPH Lilly');
  });

  it('met un libellé de classe en phrase', () => {
    assert.equal(phrase('MEDICAMENTS EN CARDIOLOGIE'), 'Medicaments en cardiologie');
    assert.equal(phrase('Système nerveux'), 'Système nerveux');
  });
});
