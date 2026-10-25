import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dci, specialite, phrase } from '../../src/casse.js';

describe('casse d’affichage', () => {
  it('met la DCI en bas de casse, capitale initiale, sigles et chiffres épargnés', () => {
    assert.equal(dci('PARACÉTAMOL'), 'Paracétamol');
    assert.equal(dci('CHLORHYDRATE DE TRAMADOL + PARACÉTAMOL'), 'Chlorhydrate de tramadol + paracétamol');
    assert.equal(dci('INSULINE NPH'), 'Insuline NPH');
    assert.equal(dci('VITAMINE B12'), 'Vitamine B12');
    assert.equal(dci('VITAMINE A'), 'Vitamine A');
    assert.equal(dci('IMMUNOGLOBULINE IGG'), 'Immunoglobuline IgG');
    assert.equal(dci("BROMURE D'IPRATROPIUM"), "Bromure d'ipratropium");
  });

  // Les accents omis par la BDPM, rendus d'après data/accents.json.
  it('rend les accents de la table', () => {
    assert.equal(dci('ATORVASTATINE ET EZETIMIBE'), 'Atorvastatine et ézétimibe');
    assert.equal(specialite('PARACETAMOL TEVA 500 mg'), 'Paracétamol Teva 500 mg');
    assert.equal(phrase('MEDICAMENTS EN CARDIOLOGIE'), 'Médicaments en cardiologie');
  });

  it('traite un accent combinant comme une capitale', () => {
    assert.equal(dci('ACE\u0301TYLSALICYLIQUE'), 'Acétylsalicylique');
  });

  it('laisse ce qui n’est pas crié', () => {
    assert.equal(dci('paracétamol'), 'Paracétamol');
    // Un sigle en tête garde sa forme : seule une minuscule prend la capitale.
    assert.equal(dci('IgG humaine'), 'IgG humaine');
    assert.equal(dci(''), '');
    assert.equal(dci(null), '');
  });

  it('met la spécialité en nom propre, dosage et forme intacts', () => {
    assert.equal(specialite('DOLIPRANE 1000 mg, comprimé'), 'Doliprane 1000 mg, comprimé');
    assert.equal(specialite('PARACETAMOL TEVA 500 mg, gélule'), 'Paracétamol Teva 500 mg, gélule');
    assert.equal(specialite('CHLORHYDRATE DE TRAMADOL MYLAN 50 mg'), 'Chlorhydrate de Tramadol Mylan 50 mg');
    assert.equal(specialite('ACIDE FOLIQUE CCD 5 mg'), 'Acide Folique CCD 5 mg');
    assert.equal(specialite('DAFALGAN-CODEINE'), 'Dafalgan-Codéine');
    assert.equal(specialite('INSULINE NPH LILLY'), 'Insuline NPH Lilly');
  });

  it('met un libellé de classe en phrase', () => {
    assert.equal(phrase('MEDICAMENTS EN CARDIOLOGIE'), 'Médicaments en cardiologie');
    assert.equal(phrase('Système nerveux'), 'Système nerveux');
    assert.equal(phrase('INHIBITEURS DE LA POMPE A PROTONS'), 'Inhibiteurs de la pompe à protons');
    assert.equal(phrase('SUBSTANCES À ABSORPTION RÉDUITE'), 'Substances à absorption réduite');
    assert.equal(phrase("INHIBITEURS DE L'AGREGATION PLAQUETTAIRE, HEPARINE EXCLUE").includes('plaquettaire, héparine exclue'), true);
    assert.equal(phrase('CORTICOIDES A USAGE SYSTEMIQUE').endsWith('à usage systémique'), true);
    assert.equal(phrase('VITAMINE A NON ASSOCIEE').startsWith('Vitamine A '), true);
    assert.equal(phrase('VITAMINES A ET D, ASSOCIATIONS DES DEUX INCLUSES').startsWith('Vitamines A et D'), true);
  });
});
