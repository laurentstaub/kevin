import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classer } from '../../src/delivrance.js';

/** Les libellés sont ceux de dbpm.cis_cpd_bdpm, recopiés tels quels. */
const MORPHINE = [
  'liste I',
  'stupéfiants',
  'prescription en toutes lettres sur ordonnance sécurisée',
  'prescription limitée à 28 jours',
  'délivrance fractionnée de 7 jours',
];

const courts = (c) => c.resume.map((m) => m.court);

describe('classer', () => {
  // Écrit en toutes lettres, le résumé occupait deux lignes dans l'en-tête du
  // bloc. Abrégé, il tient sur une : c'est la seule raison d'être des mentions.
  it('rend la réponse du comptoir en mentions courtes', () => {
    assert.deepEqual(courts(classer(MORPHINE)), [
      'Liste I',
      'Stupéfiant',
      'Ordo sécurisée',
      '28 j max',
      'Fractionné 7 j',
    ]);
  });

  it('garde le libellé entier derrière chaque abréviation', () => {
    const par = (court) => classer(MORPHINE).resume.find((m) => m.court === court);
    assert.equal(par('Ordo sécurisée').long, 'Ordonnance sécurisée');
    assert.equal(par('28 j max').long, 'Prescription limitée à 28 jours');
    assert.equal(par('Liste I').long, 'Liste I', 'rien à développer, long = court');
  });

  it('abrège l’unité sans la traduire', () => {
    const unite = (libelle) => classer([libelle]).resume[0].court;
    assert.equal(unite('prescription limitée à 4 semaines'), '4 sem. max');
    assert.equal(unite('prescription limitée à 12 mois'), '12 mois max');
    assert.equal(unite('prescription limitée à 28 jours'), '28 j max');
  });

  it('porte l’axe de chaque mention, pour que la vue sache la détacher', () => {
    const classement = classer(MORPHINE).resume.filter((m) => m.cle === 'classement');
    assert.deepEqual(classement.map((m) => m.court), ['Liste I', 'Stupéfiant']);
  });

  it('suit l’ordre des axes, pas celui de la base', () => {
    // La requête trie par libellé : « délivrance fractionnée » sort avant
    // « liste I ». Le résumé doit malgré tout commencer par le classement.
    const desordre = classer([...MORPHINE].sort());
    assert.equal(desordre.resume[0].court, 'Liste I');
    assert.deepEqual(courts(desordre), courts(classer(MORPHINE)));
  });

  it('range chaque condition sous son axe', () => {
    const groupes = classer(MORPHINE).groupes;
    const par = (cle) => groupes.find((g) => g.cle === cle);

    assert.deepEqual(par('classement').conditions, ['liste I', 'stupéfiants']);
    assert.equal(par('duree').conditions.length, 1);
    assert.equal(par('fractionnement').titre, 'Délivrance');
  });

  it('reprend la durée telle qu’elle est écrite', () => {
    assert.deepEqual(classer(['prescription limitée à 12 semaines']).resume[0].long,
      'Prescription limitée à 12 semaines');
  });

  // Le vrai risque : une spécialité sans condition ressemble à une spécialité
  // dont la lecture a échoué. Le vide doit être un vide net.
  it('rend un classement vide sans condition', () => {
    for (const rien of [[], null, undefined, ['', '   ']]) {
      const c = classer(rien);
      assert.deepEqual(c.resume, [], String(rien));
      assert.deepEqual(c.groupes, []);
      assert.deepEqual(c.liens, []);
    }
  });

  it('dédoublonne les libellés répétés', () => {
    const c = classer(['liste I', 'liste I']);
    assert.deepEqual(c.groupes[0].conditions, ['liste I']);
    assert.deepEqual(courts(c), ['Liste I']);
  });
});

describe('conditions non reconnues', () => {
  // Sur une donnée réglementaire, escamoter ce qu'on n'a pas su ranger serait
  // pire que de l'afficher brut : le lecteur perdrait l'information sans le
  // savoir. Les 163 libellés de la base évoluent, les règles suivront.
  it('sortent verbatim plutôt que d’être perdues', () => {
    const c = classer(['condition inédite de la BDPM 2027']);
    const autres = c.groupes.find((g) => g.cle === 'autres');

    assert.equal(autres.titre, 'Autres conditions');
    assert.deepEqual(autres.conditions, ['condition inédite de la BDPM 2027']);
  });

  it('ne polluent pas le résumé', () => {
    assert.deepEqual(classer(['condition inédite']).resume, []);
  });

  it('passent après les axes connus', () => {
    const cles = classer(['zzz inconnu', 'liste II']).groupes.map((g) => g.cle);
    assert.deepEqual(cles, ['classement', 'autres']);
  });
});

describe('liens Meddispar', () => {
  // Meddispar est édité par l'Ordre et n'est pas en accès ouvert : on renvoie
  // vers la rubrique, on ne recopie pas la conduite à tenir.
  it('accompagnent le classement stupéfiant', () => {
    const liens = classer(MORPHINE).liens;
    assert.equal(liens.length, 1);
    assert.match(liens[0].url, /^https:\/\/www\.meddispar\.fr\//);
    assert.match(liens[0].label, /[Ss]tup/);
  });

  it('ne sont rendus qu’une fois quand deux conditions pointent au même endroit', () => {
    const liens = classer(['stupéfiants', 'médicament assimilé stupéfiant']).liens;
    assert.equal(liens.length, 1);
  });

  it('couvrent la prescription restreinte', () => {
    const liens = classer([
      'prescription initiale hospitalière',
      'surveillance particulière pendant le traitement',
    ]).liens;

    assert.equal(liens.length, 2);
    for (const l of liens) assert.match(l.url, /\/Criteres$/);
  });

  it('restent absents quand rien ne les appelle', () => {
    assert.deepEqual(classer(['liste II']).liens, []);
  });
});
