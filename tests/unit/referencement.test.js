import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resumer, metaProduit, metaClasse, robots, sitemap, origine } from '../../src/referencement.js';

describe('référencement', () => {
  it('résume sur une ligne, coupée au mot', () => {
    assert.equal(resumer('  deux\n mots '), 'deux mots');
    const long = resumer('mot '.repeat(60), 40);
    assert.ok(long.length <= 40);
    assert.match(long, /mot…$/);
  });

  it('fiche : le nom en titre, la bande en description', () => {
    const meta = metaProduit({
      nom: 'Coversyl 5 mg, comprimé pelliculé sécable', substances: 'périndopril', titulaire: 'SERVIER',
      valeurs: ['Liste I', '65 %', 'CI grossesse 2e et 3e trimestres'],
    });
    assert.equal(meta.title, 'Coversyl 5 mg, comprimé pelliculé sécable · RCP, notice, délivrance · Demander à Kevin');
    assert.match(meta.description, /^Coversyl 5 mg, comprimé pelliculé sécable \(périndopril, SERVIER\)\. Liste I · 65 % · CI grossesse/);
    assert.ok(meta.description.length <= 160);
  });

  it('classe : molécule à la feuille, classe au-dessus', () => {
    assert.match(metaClasse({ code: 'N06AB05', libelle: 'Paroxétine', molecule: true, specialites: 12 }).description, /12 spécialités commercialisées/);
    assert.equal(metaClasse({ code: 'N06A', libelle: 'Antidépresseurs', molecule: false }).title, 'Antidépresseurs (N06A) · classe ATC · Demander à Kevin');
  });

  it('robots.txt : résultats exclus, sitemap annoncé', () => {
    const texte = robots('https://kevin.test');
    assert.match(texte, /^User-agent: \*$/m);
    assert.match(texte, /^Disallow: \/search$/m);
    assert.match(texte, /^Disallow: \/documents$/m);
    assert.match(texte, /^Sitemap: https:\/\/kevin.test\/sitemap.xml$/m);
  });

  it('sitemap : adresses absolues, échappées', () => {
    const xml = sitemap('https://kevin.test', ['/', '/product/60234100', '/fiches/a&b']);
    assert.match(xml, /<loc>https:\/\/kevin.test\/product\/60234100<\/loc>/);
    assert.match(xml, /<loc>https:\/\/kevin.test\/fiches\/a&amp;b<\/loc>/);
  });

  it('origine : celle de la requête, protocole du proxy', () => {
    const requete = (entetes) => ({ protocol: 'http', get: (nom) => entetes[nom.toLowerCase()] });
    assert.equal(origine(requete({ host: 'kevin.test', 'x-forwarded-proto': 'https' })), 'https://kevin.test');
    assert.equal(origine(requete({ host: 'localhost:3001' })), 'http://localhost:3001');
  });
});
