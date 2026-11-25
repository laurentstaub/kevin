import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  position, ranger, marque, frise, lireCalendrier, periodeEnClair, AGE_MAX, PALIERS,
} from '../../src/vaccins.js';

test('position : paliers exacts, bornes, croissance', () => {
  for (const [mois, pourcent] of PALIERS) assert.equal(position(mois), pourcent);
  assert.equal(position(-3), 0);
  assert.equal(position(AGE_MAX + 100), 100);
  for (let mois = 1; mois <= AGE_MAX; mois++) assert.ok(position(mois) > position(mois - 1));
});

test('marque : point pour une dose à âge fixe, barre ouverte sans limite', () => {
  const base = { obligation: 'recommande', nature: 'calendrier', texte: 'x', pages: [58] };
  assert.equal(marque({ ...base, type: 'dose', de_mois: 2, a_mois: 2 }).point, true);
  const ouverte = marque({ ...base, type: 'periode', de_mois: 780, a_mois: null });
  assert.equal(ouverte.ouvert, true);
  assert.equal(Math.round(ouverte.gauche + ouverte.largeur), 100);
});

test('ranger : un point reste sur sa barre, deux barres qui se recouvrent se séparent', () => {
  const point = { point: true, gauche: 12, largeur: 0 };
  const a = { point: false, gauche: 10, largeur: 20 };
  const b = { point: false, gauche: 15, largeur: 5 };
  const loin = { point: false, gauche: 40, largeur: 5 };
  assert.equal(ranger([point, a, loin]).length, 1);
  const voies = ranger([point, a, b, loin]);
  assert.equal(voies.length, 2);
  assert.equal(voies[0].at(-1), point, 'le point est rendu après les barres');
});

test('données : chaque événement est daté, sourcé et dans l\'axe', () => {
  const donnees = lireCalendrier();
  assert.match(donnees.source.sha256, /^[0-9a-f]{64}$/);
  for (const vaccin of donnees.vaccins) {
    for (const e of vaccin.evenements) {
      const ou = `${vaccin.id} ${e.de_mois}`;
      assert.ok(e.pages.length > 0, `${ou} : page manquante`);
      assert.ok(e.texte || e.precision, `${ou} : ni texte ni précision`);
      assert.ok(['obligatoire', 'recommande', 'propose'].includes(e.obligation), ou);
      assert.ok(['calendrier', 'rattrapage'].includes(e.nature), ou);
      assert.ok(e.a_mois === null || e.a_mois >= e.de_mois, `${ou} : bornes inversées`);
    }
  }
  assert.equal(frise(donnees).lignes.length, donnees.vaccins.length);
});

test('periodeEnClair : âges dits comme dans le tableau', () => {
  const cas = [
    [0, 0, 'Naissance'], [2, 2, '2 mois'], [16, 18, '16 à 18 mois'], [12, 24, '12 à 24 mois'],
    [12, 191, '12 mois à 15 ans'], [132, 179, '11 à 14 ans'], [780, null, '65 ans et plus'],
  ];
  for (const [de, a, attendu] of cas) assert.equal(periodeEnClair({ de_mois: de, a_mois: a }), attendu);
});
