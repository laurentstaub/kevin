import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import request from 'supertest';
import pg from 'pg';
import { ROOT } from '../../src/config.js';
import { createApp } from '../../src/app.js';
import { searchMedications } from '../../src/search.js';
import { parseQuery } from '../../src/validate.js';
import { oublierClasses, getClasseAtc } from '../../src/atc.js';

/**
 * Tests d'intégration sur un jeu de données figé (tests/fixtures.sql).
 * Ils ne dépendent d'aucune donnée BDPM réelle : la mise à jour mensuelle
 * de la base ne peut pas les casser.
 *
 * Base cible : TEST_DATABASE_URL, sinon la suite est ignorée proprement.
 */

const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : 'TEST_DATABASE_URL absent — intégration ignorée';

describe('API', { skip }, () => {
  let pool;
  let app;

  before(async () => {
    pool = new pg.Pool({ connectionString: url });
    await pool.query(await readFile(path.join(ROOT, 'tests', 'fixtures.sql'), 'utf8'));
    await pool.query(await readFile(path.join(ROOT, 'sql', 'setup.sql'), 'utf8'));
    // Le décompte des classes est gardé en mémoire une heure : sans cette
    // remise à zéro, une suite hériterait du jeu de données de la précédente.
    oublierClasses();
    app = createApp(pool);
  });

  after(async () => {
    await pool?.end();
  });

  describe('GET /api/search', () => {
    it('trouve une spécialité par sa dénomination', async () => {
      const res = await request(app).get('/api/search?q=aspirine').expect(200);
      const noms = res.body.results.brandMatches.map((r) => r.denomination_medicament);
      assert.ok(noms.some((n) => n.includes('ASPIRINE UPSA')));
      // Les correspondances de marque contiennent toutes le terme cherché.
      for (const nom of noms) assert.match(nom.toLowerCase(), /aspirine/);
    });

    it('classe la correspondance par préfixe avant les autres', async () => {
      const res = await request(app).get('/api/search?q=doliprane').expect(200);
      assert.match(res.body.results.brandMatches[0].denomination_medicament, /^DOLIPRANE/);
    });

    it('trouve par principe actif, dans une catégorie distincte', async () => {
      const res = await request(app).get('/api/search?q=paracetamol').expect(200);
      const actifs = res.body.results.activeIngredientMatches;
      assert.ok(actifs.length >= 3);
      // Ces produits ne portent pas le terme dans leur nom : c'est attendu.
      for (const r of actifs) assert.match(r.active_ingredients.toLowerCase(), /paracetamol/);
    });

    it('remonte les spécialités qui ne portent pas la substance dans leur nom', async () => {
      const res = await request(app).get('/api/search?q=paracetamol').expect(200);
      const actifs = res.body.results.activeIngredientMatches.map((r) => r.denomination_medicament);

      // La promesse du produit : « paracétamol » doit mener à DOLIPRANE.
      assert.ok(actifs.some((n) => n.startsWith('DOLIPRANE')));
      assert.ok(actifs.some((n) => n.startsWith('DAFALGAN')));

      // Et ceux que la dénomination rend déjà n'ont rien à faire ici : ce
      // serait un doublon, et surtout ils évinceraient les précédents.
      for (const nom of actifs) assert.doesNotMatch(nom.toLowerCase(), /paracetamol/);
    });

    it('ignore les accents', async () => {
      const res = await request(app).get('/api/search?q=pediatrique').expect(200);
      assert.ok(res.body.results.brandMatches.length > 0);
    });

    it('exige tous les termes d’une requête multi-mots', async () => {
      const res = await request(app).get('/api/search?q=aspirine%20500').expect(200);
      for (const r of res.body.results.brandMatches) {
        const nom = r.denomination_medicament.toLowerCase();
        assert.match(nom, /aspirine/);
        assert.match(nom, /500/);
      }
    });

    it('respecte le filtre "specialty"', async () => {
      const res = await request(app).get('/api/search?q=paracetamol&filter=specialty').expect(200);
      assert.equal(res.body.results.activeIngredientMatches.length, 0);
    });

    it('respecte le filtre "active"', async () => {
      const res = await request(app).get('/api/search?q=aspirine&filter=active').expect(200);
      assert.equal(res.body.results.brandMatches.length, 0);
    });

    it('refuse les requêtes trop courtes sans toucher la base', async () => {
      const res = await request(app).get('/api/search?q=as').expect(200);
      assert.equal(res.body.results, null);
    });

    it('ne casse pas sur un paramètre répété', async () => {
      await request(app).get('/api/search?q=aspirine&q=doliprane').expect(200);
    });

    /**
     * Le défaut qu'on ferme ici : les génériques qui portent le nom de la
     * molécule évinçaient la marque.
     *
     * « paracétamol » remontait soixante PARACETAMOL <labo> et zéro DOLIPRANE ;
     * « oxazépam » mettait trois OXAZEPAM <labo> avant SERESTA, qui en est
     * pourtant le princeps. Une limite de 2 sur un jeu où deux spécialités
     * s'appellent « PARACETAMOL … » reproduit la situation à l'échelle : si le
     * classement est mauvais, elles prennent les deux places.
     */
    it('place la marque devant les génériques homonymes de la molécule', async () => {
      const resultats = await searchMedications(pool, parseQuery('paracetamol'), 'all', {
        limit: 2,
      });

      assert.equal(resultats.dci, true, 'le terme est reconnu comme une molécule');

      const noms = resultats.produits.map((r) => r.libelle);
      assert.equal(noms.length, 2);
      for (const nom of noms) assert.doesNotMatch(nom, /^PARACETAMOL /);
      assert.ok(noms.includes('DOLIPRANE'), `DOLIPRANE attendu, reçu : ${noms.join(', ')}`);
    });

    it('garde les deux sections quand le terme est une marque', async () => {
      const resultats = await searchMedications(pool, parseQuery('doliprane'));
      assert.equal(resultats.dci, false);
    });

    /**
     * On tape « parace » avant « paracétamol » : la molécule doit être reconnue
     * dès le préfixe, sinon la page change de forme — et de classement — au
     * dernier caractère saisi.
     */
    it('reconnaît la molécule sur un début de mot', async () => {
      for (const debut of ['parac', 'paraceta', 'paracetamol']) {
        const resultats = await searchMedications(pool, parseQuery(debut));
        assert.equal(resultats.dci, true, `« ${debut} » doit être reconnu`);
        assert.equal(resultats.substance, 'PARACETAMOL');
        assert.equal(resultats.produits[0].libelle, 'DOLIPRANE', `en tête pour « ${debut} »`);
      }
    });
  });

  describe('Classe thérapeutique (ATC)', () => {
    /**
     * L'en-tête ne porte que le contexte — les cinq niveaux en toutes lettres
     * font cent six signes en capitales et rompent le bandeau. La chaîne
     * complète reste accessible : c'est le fil d'Ariane de la page de classe.
     */
    it('résume la classe dans l’en-tête, sans la chaîne entière', async () => {
      const res = await request(app).get('/product/61111114').expect(200);
      const fil = res.text.match(/<nav class="atc"[\s\S]*?<\/nav>/)?.[0] ?? '';
      const maillons = [...fil.matchAll(/class="atc-maillon"[^>]*>([^<]+)</g)].map((m) => m[1]);

      assert.deepEqual(maillons, ['Système nerveux', 'ANALGESIQUES']);

      // La taxonomie chimique n'a pas sa place au comptoir.
      assert.doesNotMatch(fil, /ANILIDES/);
      assert.doesNotMatch(fil, /AUTRES ANALGESIQUES/);
      // Ni la DCI, déjà affichée deux lignes plus haut.
      assert.doesNotMatch(fil, />PARACETAMOL</);

      // Le code identifie la feuille et y mène.
      assert.match(fil, /class="atc-code"[^>]*>N02BE01</);
      assert.match(fil, /href="\/classe\/N02BE01"/);
    });

    /**
     * Vingt-quatre codes de niveau 5 n'ont pas de libellé dans la source : le
     * leur recopie le code. Afficher « N02BE71 » à un pharmacien ne lui apprend
     * rien — on reprend le libellé du parent.
     */
    it('reprend le libellé du parent quand le code n’en a pas', async () => {
      const { rows } = await pool.query(
        `SELECT atc_code, atc_label, atc_level FROM ref.atc_classification
         WHERE 'N02BE71' LIKE atc_code || '%' ORDER BY atc_level`,
      );
      const chaine = rows.map((r) => ({
        code: r.atc_code,
        label: r.atc_label,
        level: r.atc_level,
      }));

      // La feuille N02BE71 n'a pas de libellé : getClasseAtc reprend celui du
      // parent, ANILIDES, plutôt que d'afficher le code en guise de nom.
      const via = await getClasseAtc(pool, '61111116');
      assert.equal(via.at(-1).code, 'N02BE71');
      assert.equal(via.at(-1).label, 'ANILIDES');
      assert.equal(chaine.at(-1).label, 'N02BE71', 'la source, elle, n’est pas modifiée');
    });

    it('n’affiche rien pour une spécialité sans classe', async () => {
      // KARDEGIC n'est pas dans le mapping : un tiers de la base est dans ce cas.
      const res = await request(app).get('/product/61111113').expect(200);
      assert.doesNotMatch(res.text, /<nav class="atc"/);
    });

    it('propose les grandes classes sur la page d’accueil', async () => {
      const res = await request(app).get('/').expect(200);
      assert.match(res.text, /Parcourir par classe thérapeutique/);
      assert.match(res.text, /href="\/classe\/N"/);
      assert.match(res.text, /Système nerveux/);
    });

    it('parcourt une classe, ses sous-classes et ses produits', async () => {
      const res = await request(app).get('/classe/N02B').expect(200);

      // Sous-classes de N02B, avec leur décompte.
      assert.match(res.text, /href="\/classe\/N02BE"/);
      assert.match(res.text, /href="\/classe\/N02BA"/);
      // Et les produits de la classe, DOLIPRANE compris.
      assert.match(res.text, /DOLIPRANE/);
    });

    it('compte les produits, pas les codes CIS', async () => {
      // Les deux DOLIPRANE et les deux PARACETAMOL <labo> partagent N02BE01 ;
      // DAFALGAN aussi. Cinq CIS pour quatre produits.
      const res = await request(app).get('/classe/N02BE01').expect(200);
      const noms = [...res.text.matchAll(/<span class="resultat-nom">\s*([A-Z][^<\n]*)/g)]
        .map((m) => m[1].trim());

      assert.deepEqual(noms.sort(), [
        'DAFALGAN',
        'DOLIPRANE',
        'PARACETAMOL ARROW',
        'PARACETAMOL TEVA',
      ]);
    });

    it('renvoie 404 sur une classe inexistante', async () => {
      await request(app).get('/classe/ZZZZ').expect(404);
      await request(app).get('/classe/N02BE99').expect(404);
    });
  });

  describe('Choix du dosage', () => {
    /**
     * Le regroupement rend la liste lisible, mais il retire un choix : arrivé
     * sur DOLIPRANE on obtient la présentation désignée comme représentante,
     * et rien ne dit que c'est celle qu'on cherche. La fiche doit donc offrir
     * les autres dosages et formes.
     */
    it('propose les autres dosages et formes du produit', async () => {
      const res = await request(app).get('/product/61111114').expect(200);

      // Les deux DOLIPRANE de la fixture, libellés par ce que la racine a retiré.
      assert.match(res.text, /1000 mg, comprimé/);
      assert.match(res.text, /500 mg, gélule/);
      assert.match(res.text, /href="\/product\/61111119"/);
    });

    it('n’affiche pas le sélecteur pour un produit à présentation unique', async () => {
      const res = await request(app).get('/product/61111113').expect(200);
      assert.doesNotMatch(res.text, /class="formes"/);
    });

    it('place Substituer après Documents, dans la page comme dans le rail', async () => {
      const res = await request(app).get('/product/61111111').expect(200);

      const blocs = [...res.text.matchAll(/<details class="bloc" id="(\w+)"/g)].map((m) => m[1]);
      const rail = [...res.text.matchAll(/<a class="rail-lien" href="#(\w+)">/g)].map((m) => m[1]);

      for (const ordre of [blocs, rail]) {
        const documents = ordre.indexOf('documents');
        const substituer = ordre.indexOf('substituer');
        if (documents !== -1 && substituer !== -1) {
          assert.ok(documents < substituer, `attendu documents avant substituer : ${ordre.join(' → ')}`);
        }
      }
    });
  });

  describe('GET /api/suggest — ordre', () => {
    /**
     * L'autocomplétion reconstituait les deux familles pour les concaténer,
     * marques ensuite : SERESTA arrivait après ses trois génériques, et
     * DOLIPRANE après les PARACETAMOL <labo>. Elle rend maintenant la liste
     * telle que la recherche l'a classée.
     */
    it('propose la marque avant les génériques homonymes de la molécule', async () => {
      const res = await request(app).get('/api/suggest?q=paracetamol').expect(200);
      const noms = res.body.suggestions.map((s) => s.name);

      assert.ok(noms.length > 0);
      assert.equal(noms[0], 'DOLIPRANE', `reçu : ${noms.join(', ')}`);
    });

    /**
     * Le défaut suivant : l'unité de résultat.
     *
     * Un CIS est un triplet marque × dosage × forme. DOLIPRANE en compte
     * dix-sept en base réelle : les rendre un par un remplit l'écran d'un seul
     * médicament, et aucun classement n'y peut rien puisque les dix-sept lignes
     * sont d'égale pertinence. Une ligne doit donc valoir un produit.
     */
    it('rend un produit par ligne, pas un code CIS', async () => {
      const res = await request(app).get('/api/search?q=doliprane').expect(200);
      const noms = res.body.results.brandMatches;

      assert.equal(noms.length, 1, 'les deux dosages de DOLIPRANE ne font qu’une ligne');
      assert.equal(noms[0].libelle, 'DOLIPRANE');
      assert.equal(noms[0].presentations, 2, 'et la ligne dit ce qu’elle recouvre');
    });

    it('rétrograde ce qui n’est plus commercialisé', async () => {
      const res = await request(app).get('/api/search?q=paracetamol&filter=specialty').expect(200);
      const noms = res.body.results.brandMatches.map((r) => r.libelle);

      // ARROW et TEVA sont par ailleurs identiques : seul l'état de
      // commercialisation les départage.
      assert.ok(
        noms.indexOf('PARACETAMOL ARROW') < noms.indexOf('PARACETAMOL TEVA'),
        `ARROW (commercialisé) doit précéder TEVA : ${noms.join(', ')}`,
      );
    });

    it('classe les trouvailles par substance sur la substance, pas sur le nom', async () => {
      // Toutes ces spécialités contiennent exactement « PARACETAMOL » : elles
      // sont donc à égalité de rang, et rien ne doit les départager par un
      // critère emprunté à la dénomination.
      const resultats = await searchMedications(pool, parseQuery('paracetamol'));
      for (const r of resultats.activeIngredientMatches) assert.equal(r.rank, 0);
    });
  });

  describe('GET /api/suggest', () => {
    it('renvoie une liste courte et plate', async () => {
      const res = await request(app).get('/api/suggest?q=aspirine').expect(200);
      assert.ok(Array.isArray(res.body.suggestions));
      assert.ok(res.body.suggestions.length <= 8);
      assert.ok('name' in res.body.suggestions[0]);
    });
  });

  describe('GET /api/product/:id', () => {
    it('renvoie la fiche, ses présentations et ses liens', async () => {
      const res = await request(app).get('/api/product/61111111').expect(200);
      assert.match(res.body.product.denomination_medicament, /ASPIRINE UPSA/);
      assert.equal(res.body.product.cip_products.length, 2);
      assert.ok(res.body.links.official.length > 0);
    });

    it('remonte le groupe générique avec le type', async () => {
      const res = await request(app).get('/api/product/61111111').expect(200);
      const generique = res.body.related.find((p) => p.match_type === 'generic');
      assert.match(generique.denomination_medicament, /ASPIRINE PROTECT/);
      assert.equal(generique.type_generique, '1');
    });

    it('remonte les produits partageant le principe actif', async () => {
      const res = await request(app).get('/api/product/61111114').expect(200);
      const noms = res.body.related.map((p) => p.denomination_medicament);
      assert.ok(noms.some((n) => n.includes('DAFALGAN')));
      assert.ok(!noms.includes('DOLIPRANE 1000 mg, comprimé'));
    });

    it('renvoie 404 sur un CIS inconnu', async () => {
      await request(app).get('/api/product/60000000').expect(404);
    });

    it('renvoie 404 — pas 500 — sur un identifiant malformé', async () => {
      for (const bad of ['abc', '123', '1234567890', '6111111a']) {
        await request(app).get(`/api/product/${bad}`).expect(404);
      }
    });
  });

  describe('documents', () => {
    it('assainit le HTML du RCP', async () => {
      const res = await request(app).get('/api/product/61111111/documents/rcp').expect(200);
      assert.ok(!res.body.html.includes('script'));
      assert.ok(!res.body.html.includes('javascript:'));
      assert.match(res.body.html, /4\.2 Posologie/);
    });

    it('conserve une URL de document sur un domaine autorisé', async () => {
      const res = await request(app).get('/api/product/61111111/documents/rcp').expect(200);
      assert.match(res.body.url, /ansm\.sante\.fr/);
    });

    it('écarte une URL de document sur un domaine non autorisé', async () => {
      const res = await request(app).get('/api/product/61111112/documents/notice').expect(200);
      assert.equal(res.body.url, null);
    });

    it('renvoie 404 sur un type de document inconnu', async () => {
      await request(app).get('/api/product/61111111/documents/exploit').expect(404);
    });

    it('sert les documents rcp_notice, qui n’ont qu’un PDF', async () => {
      const res = await request(app).get('/api/product/61111113/documents/rcp_notice').expect(200);
      assert.equal(res.body.html, '');
      assert.match(res.body.url, /^https:\/\/base-donnees-publique/);
    });

    it('affiche le PDF sur la fiche plutôt qu’un bloc vide', async () => {
      const res = await request(app).get('/product/61111113').expect(200);
      assert.match(res.text, /format PDF/);
      assert.match(res.text, /base-donnees-publique/);
    });
  });

  describe('transversal', () => {
    it('expose un healthcheck', async () => {
      const res = await request(app).get('/api/health').expect(200);
      assert.equal(res.body.status, 'ok');
    });

    it('ne renvoie pas d’en-tête CORS permissif', async () => {
      const res = await request(app)
        .get('/api/health')
        .set('Origin', 'https://evil.example.com')
        .expect(200);
      assert.equal(res.headers['access-control-allow-origin'], undefined);
    });

    it('pose les en-têtes de sécurité', async () => {
      const res = await request(app).get('/').expect(200);
      assert.match(res.headers['content-security-policy'], /default-src 'self'/);
      assert.equal(res.headers['x-content-type-options'], 'nosniff');
      assert.equal(res.headers['x-powered-by'], undefined);
    });

    it('renvoie une page 404 sur une route inconnue', async () => {
      await request(app).get('/nimportequoi').expect(404);
    });

    it('rend la page de recherche et la fiche produit', async () => {
      await request(app).get('/search?q=aspirine').expect(200);
      await request(app).get('/product/61111111').expect(200);
    });

    it('n’injecte jamais de script dans la page produit', async () => {
      const res = await request(app).get('/product/61111111').expect(200);
      assert.ok(!res.text.includes('alert(1)'));
    });

    it('affiche les métadonnées du produit une seule fois', async () => {
      const res = await request(app).get('/product/61111111').expect(200);
      const occurrences = res.text.split('CIS 61111111').length - 1;
      assert.equal(occurrences, 1);
    });

    it('n’applique aucun coin arrondi au-delà de 2 px', async () => {
      const css = await request(app).get('/css/product.css').expect(200);
      const rayons = [...css.text.matchAll(/border-radius:\s*(\d+)px/g)].map((m) => Number(m[1]));
      assert.ok(rayons.every((r) => r <= 2), `rayons trouvés : ${rayons}`);
    });

    it('trie les présentations par quantité, pas par ordre alphabétique', async () => {
      const res = await request(app).get('/api/product/61111111').expect(200);
      const libelles = res.body.product.cip_products.map((c) => c.libelle_presentation);
      assert.deepEqual(libelles, [
        'Boîte de 20 comprimés effervescents',
        'Boîte de 30 comprimés effervescents',
      ]);
    });
  });
});
