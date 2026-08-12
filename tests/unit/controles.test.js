import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { couverture, mediane, falaise, plancher, age } from '../../src/controles.js';

const c = (periode, avec, sans) => ({ periode, avec, sans });

// Les chiffres réels de la base, en août 2026. La collecte des documents s'est
// arrêtée à la charnière 2023-2024 ; le contrôle doit le dire sans qu'on lui
// souffle la date.
const DOCUMENTS = [
  c(2026, 0, 4), c(2025, 0, 228), c(2024, 65, 327), c(2023, 206, 136),
  c(2022, 309, 67), c(2021, 392, 30), c(2020, 392, 36), c(2019, 445, 19),
  c(2018, 691, 20), c(2017, 649, 8), c(2016, 366, 5), c(2015, 364, 3),
  c(2014, 347, 1), c(2013, 332, 1), c(2012, 317, 2),
];

describe('falaise', () => {
  it('reconnaît l’effondrement sur les données réelles', () => {
    const v = falaise(DOCUMENTS);
    assert.equal(v.etat, 'rupture');
    assert.deepEqual(v.ruptures.map((x) => x.periode), [2025, 2024]);
    assert.deepEqual(v.alertes.map((x) => x.periode), [2023]);
    assert.equal(v.derniereSaine, 2022);
  });

  // Le chiffre qui rend le contrôle utile : il nomme le moment de l'arrêt sans
  // qu'on ait eu à lui dire quand la collecte aurait dû tourner.
  it('établit la norme sur les anciennes, non sur l’ensemble', () => {
    const v = falaise(DOCUMENTS);
    assert.ok(v.reference > 0.95, `norme ${v.reference} — les années cassées ne doivent pas l’abaisser`);
  });

  // Un plancher global serait resté vert pendant que 2025 était à zéro : vingt
  // années pleines portent la moyenne à 84,6 %. C'est le cœur de l'affaire —
  // ce n'est pas le niveau qui alerte, c'est l'écart entre les générations.
  it('voit ce qu’un seuil global ne voit pas', () => {
    const total = DOCUMENTS.reduce((s, x) => ({ avec: s.avec + x.avec, sans: s.sans + x.sans }),
      { avec: 0, sans: 0 });
    assert.ok(couverture(total) > 0.8, `moyenne générale ${couverture(total)} — rassurante`);
    assert.equal(falaise(DOCUMENTS).etat, 'rupture', 'la comparaison par cohorte, non');
  });

  it('ignore une cohorte trop petite pour prouver quoi que ce soit', () => {
    // 2026 n'a que quatre spécialités : zéro document n'y démontre rien.
    assert.ok(!falaise(DOCUMENTS).ruptures.some((x) => x.periode === 2026));
    assert.equal(falaise([...DOCUMENTS], { volumeMin: 2 }).ruptures[0].periode, 2026);
  });

  it('ne condamne rien quand tout va bien', () => {
    const saines = Array.from({ length: 10 }, (_, i) => c(2026 - i, 300, 6));
    assert.equal(falaise(saines).etat, 'ok');
    assert.equal(falaise(saines).derniereSaine, 2026);
  });

  // Sans norme, un verdict vert serait un mensonge : on ne sait pas juger.
  it('se déclare incapable plutôt que rassurant', () => {
    assert.equal(falaise([]).etat, 'indeterminable');
    assert.equal(falaise([c(2025, 100, 100), c(2024, 100, 100)]).etat, 'indeterminable');

    const tout_casse = Array.from({ length: 10 }, (_, i) => c(2026 - i, 10, 90));
    assert.equal(falaise(tout_casse).etat, 'norme trop basse');
  });
});

describe('couverture et mediane', () => {
  it('rend null sur une cohorte vide plutôt que zéro', () => {
    assert.equal(couverture({ avec: 0, sans: 0 }), null);
    assert.equal(couverture({ avec: 1, sans: 3 }), 0.25);
  });

  it('prend le milieu, pas la moyenne — une année effondrée ne doit pas peser', () => {
    assert.equal(mediane([1, 1, 1, 1, 0]), 1);
    assert.equal(mediane([0.9, 1]), 0.95);
    assert.equal(mediane([]), null);
  });
});

describe('plancher', () => {
  it('juge une population homogène sur un seuil simple', () => {
    assert.equal(plancher({ ok: 99, total: 100 }, { minimum: 0.95 }).etat, 'ok');
    assert.equal(plancher({ ok: 80, total: 100 }, { minimum: 0.95 }).etat, 'rupture');
    assert.equal(plancher({ ok: 0, total: 0 }, { minimum: 0.95 }).etat, 'indeterminable');
  });
});

describe('age', () => {
  const maintenant = new Date('2026-08-12T00:00:00Z');

  it('compte les jours', () => {
    assert.equal(age('2026-08-02T00:00:00Z', maintenant), 10);
  });

  // Une source sans date ne peut pas être jugée périmée — c'est un défaut en
  // soi, et le contrôle doit le distinguer d'une source fraîche.
  it('rend null sur une date absente', () => {
    assert.equal(age(null, maintenant), null);
  });
});
