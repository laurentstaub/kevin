import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rattacher, nomAffiche, nomCourt, citations, citeeEnClair, ficheVaccin, lireCalendrier, calendrierDe, resumeTopo,
} from '../../src/vaccins.js';

// Substances recopiées de la base publique des médicaments (inventaire du 23 novembre 2026).
const HEXYON = ['ANATOXINE DIPHTÉRIQUE', 'ANATOXINE TÉTANIQUE', 'ANTIGÈNE COQUELUCHEUX : ANATOXINE',
  "ANTIGÈNE DE SURFACE DE L'HÉPATITE B RECOMBINANT", "POLYOSIDE HAEMOPHILUS INFLUENZAE TYPE B CONJUGUÉ À L'ANATOXINE TÉTANIQUE",
  'VIRUS POLIOMYELITIQUE SOUCHE MAHONEY DE TYPE 1 INACTIVÉ'];
const MENQUADFI = ["POLYOSIDE DE NEISSERIA MENINGITIDIS DE GROUPE A CONJUGUÉ À L'ANATOXINE TÉTANIQUE"];
const ACT_HIB = ['HAEMOPHILUS TYPE B (POLYOSIDE) CONJUGUÉ À LA PROTÉINE TÉTANIQUE'];
const FLUCELVAX = ['ANTIGÈNES DE SURFACE DU VIRUS DE LA GRIPPE, INACTIVÉ, SOUCHE B/ARIZONA/2025'];
const SHINGRIX = ['ANTIGÈNE GLYCOPROTÉINE E DU VIRUS VARICELLE-ZONA (VZV) (RECOMBINANT, AVEC ADJUVANT)'];
const BEXSERO = ['PROTÉINE RECOMBINANTE NADA DE NEISSERIA MENINGITIDIS GROUPE B'];

test('rattacher : un hexavalent couvre trois lignes', () => {
  assert.deepEqual(rattacher(HEXYON), ['dtcap', 'hib', 'hepb']);
});

test('rattacher : la protéine porteuse ne fait pas un vaccin diphtérie-tétanos', () => {
  assert.deepEqual(rattacher(MENQUADFI), ['menacwy']);
  assert.deepEqual(rattacher(ACT_HIB), ['hib']);
});

test('rattacher : « Arizona » n\'est pas le zona ; groupe B n\'est pas ACWY', () => {
  assert.deepEqual(rattacher(FLUCELVAX), ['grippe']);
  assert.deepEqual(rattacher(SHINGRIX), ['zona']);
  assert.deepEqual(rattacher(BEXSERO), ['menb']);
});

test('noms : affiché avec le dosage, court sans', () => {
  const engerix = 'ENGERIX B 10 microgrammes/0,5 mL, suspension injectable en seringue préremplie.';
  assert.equal(nomAffiche(engerix), 'ENGERIX B 10 microgrammes/0,5 mL');
  assert.equal(nomCourt(engerix), 'ENGERIX B');
  assert.equal(nomCourt('PREVENAR 13 suspension injectable. Vaccin pneumococcique'), 'PREVENAR 13');
  assert.equal(nomCourt('BEYFORTUS 100 mg, solution injectable'), 'BEYFORTUS');
});

test('citations : négation et dosage départagent', () => {
  const evenement = {
    de_mois: 12, a_mois: 191, nature: 'rattrapage', obligation: 'recommande', texte: '3 doses',
    precision: "Possible avec Engerix B20 µg. Le vaccin Engerix B10 µg n'est pas adapté au schéma à 2 doses.",
  };
  const b20 = 'ENGERIX B 20 microgrammes/1 mL, suspension';
  const b10 = 'ENGERIX B 10 microgrammes/0,5 mL, suspension';
  assert.equal(citations(b20, [evenement], ['engerixb10']).length, 1);
  assert.equal(citations(b10, [evenement], ['engerixb20']).length, 0);
  const beyfortus = { ...evenement, texte: 'anticorps monoclonal Beyfortus', precision: null,
    condition: "Mère n'ayant pas reçu Abrysvo : la mère n'a pas reçu le vaccin Abrysvo" };
  assert.equal(citations('ABRYSVO, poudre', [beyfortus]).length, 0);
  assert.equal(citations('BEYFORTUS 50 mg, solution', [beyfortus], ['beyfortus100']).length, 1);
});

test('citeeEnClair : âges regroupés par statut', () => {
  const dose = (age, obligation) => ({ de_mois: age, a_mois: age, nature: 'calendrier', obligation });
  assert.equal(citeeEnClair([dose(2, 'obligatoire'), dose(4, 'obligatoire'), dose(11, 'obligatoire')]),
    '2 mois, 4 mois et 11 mois (obligatoire)');
  assert.equal(citeeEnClair([]), '');
});

test('ficheVaccin : vaccin inconnu, liste vide, cités en tête', () => {
  const calendrier = lireCalendrier();
  assert.equal(ficheVaccin(calendrier, 'inconnu', []), null);
  assert.deepEqual(ficheVaccin(calendrier, 'covid', []).specialites, []);
  const fiche = ficheVaccin(calendrier, 'hepb', [
    { id: '1', denomination: 'HEXYON, suspension injectable', atc: 'J07CA09', substances: HEXYON },
    { id: '2', denomination: 'ENGERIX B 20 microgrammes/1 mL, suspension', atc: 'J07BC01', substances: ["ANTIGÈNE DE SURFACE DE L'HÉPATITE B RECOMBINANT"] },
  ]);
  assert.equal(fiche.specialites[0].id, '2', 'Engerix B 20, cité par le calendrier, en tête');
  assert.deepEqual(fiche.specialites[1].aussi, ['Diphtérie, tétanos, coqueluche, poliomyélite', 'Haemophilus influenzae b']);
});

test('calendrierDe : lignes de la spécialité, groupées quand les âges cités sont les mêmes', () => {
  const hexyon = { id: '1', denomination: 'HEXYON, suspension injectable en seringue préremplie', atc: 'J07CA09', substances: HEXYON };
  const groupes = calendrierDe(lireCalendrier(), '1', [hexyon]);
  const ids = groupes.flatMap((groupe) => groupe.lignes.map((ligne) => ligne.id));
  assert.deepEqual(ids.sort(), ['dtcap', 'hepb', 'hib']);
  assert.ok(groupes.length <= ids.length);
  assert.deepEqual(calendrierDe(lireCalendrier(), '2', [hexyon]), []);
});

test('resumeTopo : la maladie sans intitulé, une phrase par maladie, notes vers la fiche', () => {
  const appel = (rang) => `<sup class="appel"><a href="#ref-${rang}">${rang}</a></sup>`;
  const simple = { blocs: [{ type: 'html', html: `<p><strong>La maladie.</strong> Une infection${appel(1)}. Elle tue.</p>` }] };
  assert.equal(resumeTopo(simple, '/vaccins/x'),
    '<p>Une infection<sup class="appel"><a href="/vaccins/x#ref-1">1</a></sup>. Elle tue.</p>');
  const liste = { blocs: [
    { type: 'html', html: '<p><strong>Les maladies.</strong></p>' },
    { type: 'html', html: `<ul><li><strong>Rougeole.</strong> Très contagieuse${appel(2)}. Incubation longue.</li></ul>` },
  ] };
  assert.equal(resumeTopo(liste, '/vaccins/ror'),
    '<ul><li><strong>Rougeole.</strong> Très contagieuse<sup class="appel"><a href="/vaccins/ror#ref-2">2</a></sup>.</li></ul>');
  assert.equal(resumeTopo(null, '/vaccins/x'), '');
});
