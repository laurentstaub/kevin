import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import pg from 'pg';
import { createApp } from '../../src/app.js';
import { searchMedications } from '../../src/search.js';
import { parseQuery } from '../../src/validate.js';
import { oublierClasses, getClasseAtc } from '../../src/atc.js';
import { chargerBase } from './base.js';

/**
 * Tests d'intégration sur le jeu figé tests/fixtures.sql (et fixtures-docs.sql), indépendant des mises à jour BDPM.
 * Base cible : TEST_DATABASE_URL, sinon la suite est ignorée.
 */

const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : 'TEST_DATABASE_URL absent — intégration ignorée';

describe('API', { skip }, () => {
  let pool;
  let app;

  before(async () => {
    pool = new pg.Pool({ connectionString: url });
    await chargerBase(pool);
    // Le décompte des classes est mis en cache une heure : à vider entre suites.
    oublierClasses();
    app = createApp(pool);
  });

  after(async () => {
    await pool?.end();
  });

  describe('GET /api/search', () => {
    it('trouve une spécialité par sa dénomination', async () => {
      const res = await request(app).get('/api/search?q=aspirine').expect(200);
      const noms = res.body.results.brandMatches.map((resultat) => resultat.denomination_medicament);
      assert.ok(noms.some((nom) => nom.includes('ASPIRINE UPSA')));
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
      for (const actif of actifs) assert.match(actif.active_ingredients.toLowerCase(), /paracetamol/);
    });

    it('remonte les spécialités qui ne portent pas la substance dans leur nom', async () => {
      const res = await request(app).get('/api/search?q=paracetamol').expect(200);
      const actifs = res.body.results.activeIngredientMatches.map((resultat) => resultat.denomination_medicament);

      assert.ok(actifs.some((actif) => actif.startsWith('DOLIPRANE')));
      assert.ok(actifs.some((actif) => actif.startsWith('DAFALGAN')));

      // Déjà rendus par la dénomination : ici, ils feraient doublon et évinceraient les marques.
      for (const nom of actifs) assert.doesNotMatch(nom.toLowerCase(), /paracetamol/);
    });

    it('ignore les accents', async () => {
      const res = await request(app).get('/api/search?q=pediatrique').expect(200);
      assert.ok(res.body.results.brandMatches.length > 0);
    });

    it('exige tous les termes d’une requête multi-mots', async () => {
      const res = await request(app).get('/api/search?q=aspirine%20500').expect(200);
      for (const resultat of res.body.results.brandMatches) {
        const nom = resultat.denomination_medicament.toLowerCase();
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

    /** Limite 2 avec deux « PARACETAMOL … » : un mauvais classement leur donne les deux places. */
    it('place la marque devant les génériques homonymes de la molécule', async () => {
      const resultats = await searchMedications(pool, parseQuery('paracetamol'), 'all', {
        limit: 2,
      });

      assert.equal(resultats.dci, true, 'le terme est reconnu comme une molécule');

      const noms = resultats.produits.map((produit) => produit.libelle);
      assert.equal(noms.length, 2);
      for (const nom of noms) assert.doesNotMatch(nom, /^PARACETAMOL /);
      assert.ok(noms.includes('DOLIPRANE'), `DOLIPRANE attendu, reçu : ${noms.join(', ')}`);
    });

    it('garde les deux sections quand le terme est une marque', async () => {
      const resultats = await searchMedications(pool, parseQuery('doliprane'));
      assert.equal(resultats.dci, false);
    });

    /** Sinon la page change de forme et de classement au dernier caractère saisi. */
    it('reconnaît la molécule sur un début de mot', async () => {
      for (const debut of ['parac', 'paraceta', 'paracetamol']) {
        const resultats = await searchMedications(pool, parseQuery(debut));
        assert.equal(resultats.dci, true, `« ${debut} » doit être reconnu`);
        assert.equal(resultats.substance, 'PARACETAMOL');
        assert.equal(resultats.produits[0].libelle, 'DOLIPRANE', `en tête pour « ${debut} »`);
      }
    });
  });

  describe('Champ de recherche', () => {
    /** Au comptoir, les recherches s'enchaînent sans repasser par l'accueil. */
    for (const [page, url] of [
      ['la fiche produit', '/product/61111114'],
      ['la page de classe', '/classe/N02'],
      ['l’accueil', '/'],
      // Même destination depuis les documents : une saisie repart par nom.
      ['la recherche dans les documents', '/documents?q=surdosage'],
    ]) {
      it(`est présent sur ${page}, avec de quoi l’autocompléter`, async () => {
        const res = await request(app).get(url).expect(200);

        assert.match(res.text, /<form class="search-form"[^>]*action="\/search"/);
        assert.match(res.text, /class="search-input"/);
        // Requis par public/js/search.js, sinon l'autocomplétion échoue en silence.
        assert.match(res.text, /id="suggestions"/);
        assert.match(res.text, /id="loading"/);
        assert.match(res.text, /js\/search\.js/);
      });
    }

    it('garde la version pleine sur l’accueil, compacte ailleurs', async () => {
      const accueil = await request(app).get('/').expect(200);
      const fiche = await request(app).get('/product/61111114').expect(200);

      assert.doesNotMatch(accueil.text, /search-compacte/);
      assert.match(fiche.text, /search-compacte/);
    });
  });

  describe('Classe thérapeutique (ATC)', () => {
    /** Les cinq niveaux en toutes lettres rompraient le bandeau ; la chaîne complète est sur la page de classe. */
    it('résume la classe dans l’en-tête, sans la chaîne entière', async () => {
      const res = await request(app).get('/product/61111114').expect(200);
      const fil = res.text.match(/<nav class="atc"[\s\S]*?<\/nav>/)?.[0] ?? '';
      const maillons = [...fil.matchAll(/class="atc-maillon"[^>]*>([^<]+)</g)].map((correspondance) => correspondance[1]);

      // Libellés ATC en phrase, plus en capitales (casse d'affichage, src/casse.js).
      assert.deepEqual(maillons, ['Système nerveux', 'Analgésiques']);

      // Ni taxonomie chimique…
      assert.doesNotMatch(fil, /anilides/i);
      assert.doesNotMatch(fil, /autres analg[ée]siques/i);
      // …ni DCI, déjà affichée plus haut.
      assert.doesNotMatch(fil, />parac[ée]tamol</i);

      assert.match(fil, /class="atc-code"[^>]*>N02BE01</);
      assert.match(fil, /href="\/classe\/N02BE01"/);
    });

    it('reprend le libellé du parent quand le code n’en a pas', async () => {
      const { rows } = await pool.query(
        `SELECT atc_code, atc_label, atc_level FROM ref.atc_classification
         WHERE 'N02BE71' LIKE atc_code || '%' ORDER BY atc_level`,
      );
      const chaine = rows.map((row) => ({
        code: row.atc_code,
        label: row.atc_label,
        level: row.atc_level,
      }));

      const via = await getClasseAtc(pool, '61111116');
      assert.equal(via.at(-1).code, 'N02BE71');
      assert.equal(via.at(-1).label, 'ANILIDES');
      assert.equal(chaine.at(-1).label, 'N02BE71', 'la source, elle, n’est pas modifiée');
    });

    it('n’affiche rien pour une spécialité sans classe', async () => {
      // KARDEGIC est absent du mapping, comme un tiers de la base.
      const res = await request(app).get('/product/61111113').expect(200);
      assert.doesNotMatch(res.text, /<nav class="atc"/);
    });

    it('propose les grandes classes sur la page d’accueil', async () => {
      const res = await request(app).get('/').expect(200);
      assert.match(res.text, /Parcourir par classe thérapeutique/);
      assert.match(res.text, /href="\/classe\/N"/);
      assert.match(res.text, /Système nerveux/);
    });

    /** Seule la feuille (la molécule) liste ses spécialités ; au-dessus, sous-classes et molécules. */
    it('parcourt une classe, ses sous-classes, ses molécules et leurs produits', async () => {
      const res = await request(app).get('/classe/N02B').expect(200);

      assert.match(res.text, /href="\/classe\/N02BE"/);
      assert.match(res.text, /href="\/classe\/N02BA"/);
      assert.match(res.text, /href="\/classe\/N02BE01"/);
      assert.doesNotMatch(res.text, /class="specialite-nom"/);

      const feuille = await request(app).get('/classe/N02BE01').expect(200);
      assert.match(feuille.text, /<span class="specialite-nom">Doliprane/);
    });

    it('regroupe les dosages d’un même produit, chaque CIS une seule fois', async () => {
      // Cinq CIS pour quatre produits sous N02BE01 ; une ligne par nom et par forme,
      // les dosages en liens (DOLIPRANE : comprimé et gélule).
      const res = await request(app).get('/classe/N02BE01').expect(200);
      const noms = [...res.text.matchAll(/<span class="specialite-nom">([^<]+)</g)]
        .map((correspondance) => correspondance[1].trim());

      assert.deepEqual([...new Set(noms)].sort(), [
        'Dafalgan',
        'Doliprane',
        'Paracétamol Arrow',
        'Paracétamol Teva',
      ]);
      for (const cis of ['61111114', '61111119', '61111115', '61111117', '61111118']) {
        assert.equal(res.text.split(`href="/product/${cis}"`).length - 1, 1, `CIS ${cis}`);
      }
      // Le non commercialisé est replié à part.
      const replie = res.text.match(/<details class="molecules-reste">[\s\S]*?<\/details>/)?.[0] ?? '';
      assert.match(replie, /Paracétamol Teva/);
    });

    it('renvoie 404 sur une classe inexistante', async () => {
      await request(app).get('/classe/ZZZZ').expect(404);
      await request(app).get('/classe/N02BE99').expect(404);
    });
  });

  describe('Choix du dosage', () => {
    /** Le regroupement n'ouvre que la présentation représentante : la fiche doit offrir les autres. */
    it('propose les autres dosages et formes du produit', async () => {
      const res = await request(app).get('/product/61111114').expect(200);

      // Libellés par ce que la racine commune a retiré.
      assert.match(res.text, /1000 mg, comprimé/);
      assert.match(res.text, /500 mg, gélule/);
      assert.match(res.text, /href="\/product\/61111119"/);
    });

    it('n’affiche pas le sélecteur pour un produit à présentation unique', async () => {
      const res = await request(app).get('/product/61111113').expect(200);
      assert.doesNotMatch(res.text, /class="formes"/);
    });

    it('place Alternatives avant Documents, dans la page comme dans le rail', async () => {
      const res = await request(app).get('/product/61111111').expect(200);

      const blocs = [...res.text.matchAll(/class="bloc[^"]*" id="(\w+)"|id="(\w+)" class="bloc/g)]
        .map((correspondance) => correspondance[1] ?? correspondance[2]);
      const rail = [...res.text.matchAll(/<a class="rail-lien" href="#(\w+)">/g)].map((correspondance) => correspondance[1]);

      for (const ordre of [blocs, rail]) {
        const documents = ordre.indexOf('documents');
        const alternatives = ordre.indexOf('alternatives');
        if (documents !== -1 && alternatives !== -1) {
          assert.ok(alternatives < documents, `attendu alternatives avant documents : ${ordre.join(' → ')}`);
        }
      }
    });

    it('réduit le rail au plan de la fiche, sans les classes thérapeutiques', async () => {
      const res = await request(app).get('/product/61111111').expect(200);
      assert.match(res.text, /class="rail"/);
      assert.doesNotMatch(res.text, /Classes thérapeutiques/);
      assert.doesNotMatch(res.text, /class="rail-lien[^"]*" href="\/classe\//);
    });
  });

  describe('GET /api/suggest — ordre', () => {
    /** L'autocomplétion garde l'ordre de la recherche, sans reconcaténer les familles. */
    it('propose la marque avant les génériques homonymes de la molécule', async () => {
      const res = await request(app).get('/api/suggest?q=paracetamol').expect(200);
      const noms = res.body.suggestions.map((suggestion) => suggestion.name);

      assert.ok(noms.length > 0);
      // Même casse qu'à l'écran : la spécialité en nom propre.
      assert.equal(noms[0], 'Doliprane', `reçu : ${noms.join(', ')}`);
    });

    /** Un CIS = marque × dosage × forme : un produit peut en compter des dizaines d'égale pertinence. */
    it('rend un produit par ligne, pas un code CIS', async () => {
      const res = await request(app).get('/api/search?q=doliprane').expect(200);
      const noms = res.body.results.brandMatches;

      assert.equal(noms.length, 1, 'les deux dosages de DOLIPRANE ne font qu’une ligne');
      assert.equal(noms[0].libelle, 'DOLIPRANE');
      assert.equal(noms[0].presentations, 2, 'et la ligne dit ce qu’elle recouvre');
    });

    it('rétrograde ce qui n’est plus commercialisé', async () => {
      const res = await request(app).get('/api/search?q=paracetamol&filter=specialty').expect(200);
      const noms = res.body.results.brandMatches.map((resultat) => resultat.libelle);

      // Seul l'état de commercialisation départage ARROW et TEVA.
      assert.ok(
        noms.indexOf('PARACETAMOL ARROW') < noms.indexOf('PARACETAMOL TEVA'),
        `ARROW (commercialisé) doit précéder TEVA : ${noms.join(', ')}`,
      );
    });

    it('classe les trouvailles par substance sur la substance, pas sur le nom', async () => {
      // Composition identique : même rang, quelle que soit la dénomination.
      const resultats = await searchMedications(pool, parseQuery('paracetamol'));
      for (const resultat of resultats.activeIngredientMatches) assert.equal(resultat.rank, 0);
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
      const generique = res.body.related.find((apparente) => apparente.match_type === 'generic');
      assert.match(generique.denomination_medicament, /ASPIRINE PROTECT/);
      assert.equal(generique.type_generique, '1');
    });

    it('remonte les produits partageant le principe actif', async () => {
      const res = await request(app).get('/api/product/61111114').expect(200);
      const noms = res.body.related.map((apparente) => apparente.denomination_medicament);
      assert.ok(noms.some((nom) => nom.includes('DAFALGAN')));
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

  describe('excipients', () => {
    /** Rubrique 2 (déclaration à effet notoire) et 6.1 (liste complète) du RCP. */
    // Les excipients se cherchent (filtre du document, alternatives « sans ») : pas de case.
    it('ne les affiche pas dans la bande', async () => {
      const res = await request(app).get('/product/61111111').expect(200);
      assert.doesNotMatch(res.text, /data-cle="excipients"/);
      assert.doesNotMatch(res.text, /data-cle="atc"/);
    });

    it('propose « sans lactose » dans les alternatives, et masque ce qui en contient', async () => {
      const bloc = (texte) => texte.match(/<details class="bloc" id="alternatives"[\s\S]*?<\/details>/)?.[0] ?? '';

      const avant = bloc((await request(app).get('/product/61111114').expect(200)).text);
      assert.match(avant, /href="\?sans=lactose#alternatives"/);
      assert.match(avant, /href="\/product\/61111115">[^<]*<\/a><span class="excipients-item">lactose</);

      const apres = bloc((await request(app).get('/product/61111114?sans=lactose').expect(200)).text);
      assert.doesNotMatch(apres, /href="\/product\/61111115"/, 'DAFALGAN contient du lactose');
      assert.match(apres, /href="\/product\/61111117"/, 'PARACETAMOL ARROW n’en contient pas');
      assert.match(apres, /1 masquée/);
      // 6.1 non lue : ni avec ni sans, la spécialité reste, marquée.
      assert.match(apres, /href="\/product\/61111119">[^<]*<\/a><span class="excipients-item non-lu">non lu</);
    });
  });

  describe('interactions', () => {
    /** Champ de la rubrique 4.5 de la fiche : le CIS en `m`, la saisie en `avec`. */
    it('lit la rubrique 4.5 dans les deux sens, par la substance ou par la classe', async () => {
      const res = await request(app).get('/interactions?m=61111111&avec=previscan').expect(200);
      const [aspirine, previscan] = [...res.text.matchAll(/<div class="sens">[\s\S]*?<\/blockquote>/g)]
        .map((correspondance) => correspondance[0]);

      // Le titre porte le niveau du thésaurus de l'ANSM, composé, cité en entier.
      assert.match(res.text, /<h2 class="paire-titre">[^<]*<span class="niveau niveau-ci">Contre-indiquée · Déconseillée · À prendre en compte<\/span><span class="niveau-part">selon le thésaurus de l'ANSM/);
      assert.match(res.text, /<blockquote class="citation citation-ansm">.*Acide acétylsalicylique \+ Anticoagulants oraux/s);

      // ASPIRINE UPSA ne nomme pas la fluindione, mais les anticoagulants oraux.
      assert.match(aspirine, /niveau-deconseillee/);
      // Le passage dit « Anticoagulants oraux » : le groupe ANSM de ce nom compte la fluindione.
      assert.match(aspirine, /Par la classe : Anticoagulants oraux/);
      assert.match(aspirine, /href="\/product\/61111111#rcp-5"/);

      assert.match(previscan, /niveau-ci/);
      assert.match(previscan, /Par la substance/);
      assert.match(previscan, /href="\/product\/61111120#rcp-1"/);
    });

    it('envoie vers les interactions deux médicaments saisis ensemble', async () => {
      const res = await request(app).get('/search?q=doliprane%20previscan').expect(302);
      assert.match(res.headers.location, /^\/interactions\?m=doliprane&m=previscan$/);
    });

    /** « aspirine » seule est la substance ; « aspirine upsa » est la spécialité ASPIRINE UPSA. */
    it('reconnaît une marque qui commence par un nom courant', async () => {
      const paire = await request(app).get('/search?q=aspirine%20upsa%20previscan').expect(302);
      assert.equal(paire.headers.location, '/interactions?m=aspirine+upsa&m=previscan');

      const substance = await request(app).get('/search?q=aspirine%20previscan').expect(302);
      assert.equal(substance.headers.location, '/interactions?m=acide+acetylsalicylique&m=previscan');

      // Un nom seul : la recherche par nom, pas « upsa » cherché dans les documents.
      await request(app).get('/search?q=aspirine%20upsa').expect(200);

      // Depuis le champ de la fiche produit.
      const fiche = await request(app).get('/interactions?m=61111120&avec=aspirine%20upsa').expect(200);
      assert.doesNotMatch(fiche.text, /Non reconnu/);
      assert.match(fiche.text, /<span class="medicament-nom">Aspirine Upsa</);
    });

    it('revient à la fiche quand le champ est vide', async () => {
      const res = await request(app).get('/interactions?m=61111111&avec=').expect(302);
      assert.equal(res.headers.location, '/product/61111111');
    });
  });

  describe('sécurité', () => {
    it('affiche le triangle noir des médicaments sous surveillance renforcée', async () => {
      const surveille = await request(app).get('/product/61111120').expect(200);
      assert.match(surveille.text, /data-cle="surveillance">[\s\S]*?href="https:\/\/signalement\.social-sante\.gouv\.fr">Triangle noir</);

      const ordinaire = await request(app).get('/product/61111111').expect(200);
      assert.doesNotMatch(ordinaire.text, /Triangle noir/);
    });

    it('liste les informations de sécurité ANSM, sans lien hors des domaines autorisés', async () => {
      const res = await request(app).get('/product/61111120').expect(200);
      const bloc = res.text.match(/<details class="bloc" id="securite"[\s\S]*?<\/details>/)?.[0] ?? '';

      assert.match(bloc, /2 informations ANSM/);
      // La plus récente d'abord, entités décodées, lien conservé.
      assert.match(bloc, /href="https:\/\/ansm\.sante\.fr\/informations-de-securite\/fluindione-arret"[^>]*>Fluindione : arrêt de commercialisation programmé</);
      assert.equal(bloc.split('En cours').length - 1, 1, 'l’information archivée n’est pas « en cours »');
      // Domaine non autorisé : l'intitulé reste, sans lien.
      assert.match(bloc, /<span>Ancienne information archivée<\/span>/);
      assert.doesNotMatch(bloc, /evil\.example\.com/);
    });

    it('n’affiche pas le bloc sans information', async () => {
      const res = await request(app).get('/product/61111111').expect(200);
      assert.doesNotMatch(res.text, /id="securite"/);
    });
  });

  describe('recherche dans les documents', () => {
    /** Configuration french_nu et colonne `vecteur` de sql/recherche.sql. */
    it('trouve une expression dans les rubriques et renvoie à la rubrique', async () => {
      const res = await request(app).get('/documents?q=surdosage').expect(200);
      assert.match(res.text, /href="\/product\/61111111\?q=surdosage#rcp-4"/);
    });

    /**
     * L'expression exacte dans le seul surdosage (PREVISCAN, 4.9) ne passe pas
     * devant une mention partielle dans les effets indésirables (ASPIRINE UPSA, 4.8) :
     * le surdosage ne dit rien de l'usage normal.
     */
    /** « previscan QT » : la base garde le médicament, il reste « QT », deux lettres. */
    it('cherche un terme de deux lettres dans les documents d’un médicament', async () => {
      const cible = await request(app).get('/documents?q=QT&molecule=fluindione&question=previscan%20QT').expect(200);
      assert.doesNotMatch(cible.text, /Saisissez au moins/);
      assert.match(cible.text, /href="\/product\/61111120\?q=QT#rcp-2"/);

      // Sur toute la base, le minimum habituel tient.
      const partout = await request(app).get('/documents?q=QT').expect(200);
      assert.match(partout.text, /Saisissez au moins 3 caractères/);
    });

    it('classe une rubrique du comptoir devant le surdosage, même exact', async () => {
      const res = await request(app).get('/documents?q=allongement%20QT').expect(200);
      const molecules = [...res.text.matchAll(/class="trouvaille-molecule"[^>]*>([^<]+)</g)]
        .map((correspondance) => correspondance[1]);
      assert.ok(molecules.indexOf('acide acétylsalicylique') !== -1, `aspirine trouvée : ${molecules.join(', ')}`);
      assert.ok(molecules.indexOf('fluindione') !== -1, `fluindione trouvée : ${molecules.join(', ')}`);
      assert.ok(molecules.indexOf('acide acétylsalicylique') < molecules.indexOf('fluindione'),
        `attendu l'aspirine (4.8) avant la fluindione (4.9) : ${molecules.join(', ')}`);
    });
  });

  // Question sur un produit nommé : sa rubrique forme par forme, le silence dit.
  describe('lecture d’une rubrique', () => {
    const lire = (requete, rubrique) => request(app)
      .get(`/documents?q=${encodeURIComponent(requete)}&molecule=doliprane&rubrique=${rubrique}&question=x&ia=1`)
      .expect(200);
    // Par spécialité : l'ordre (dénomination la plus courte d'abord) n'est pas l'objet du test.
    const forme = (html, cis) => {
      const bloc = [...html.matchAll(/<li class="lecture-forme lecture-([a-z-]+)">.*?<\/li>/gs)]
        .find(([texte]) => texte.includes(`/product/${cis}?`));
      return bloc ? { bloc: bloc[0], statut: bloc[1] } : null;
    };

    it('cite un texte court entier et dit qu’il ne mentionne pas la requête ; RCP absent pour une forme sans document', async () => {
      const res = await lire('lactose', '6.1');
      const comprime = forme(res.text, '61111114');
      const gelule = forme(res.text, '61111119');
      assert.equal(comprime.statut, 'entiere');
      assert.match(comprime.bloc, /Doliprane 1000 mg, comprimé.*Amidon de maïs prégélatinisé.*ne mentionne pas « lactose »/s);
      assert.match(comprime.bloc, /href="\/product\/61111114\?q=lactose#rcp-1"/);
      assert.equal(gelule.statut, 'sans-rcp');
      assert.match(gelule.bloc, /RCP absent/);
    });

    it('surligne la requête quand elle y figure', async () => {
      const comprime = forme((await lire('povidone', '6.1')).text, '61111114');
      assert.equal(comprime.statut, 'trouve');
      assert.match(comprime.bloc, /<mark>povidone<\/mark>/);
    });

    it('dit « Rubrique vide » et « Rubrique absente », sans réorienter vers tout le document', async () => {
      const vide = forme((await lire('conduire', '4.7')).text, '61111114');
      assert.equal(vide.statut, 'vide');
      assert.match(vide.bloc, /Rubrique vide/);
      const absente = forme((await lire('sécable', '3')).text, '61111114');
      assert.equal(absente.statut, 'absente');
      assert.match(absente.bloc, /Rubrique absente/);
    });

    it('sans rubrique, la recherche habituelle', async () => {
      const res = await request(app).get('/documents?q=povidone&molecule=doliprane&question=x').expect(200);
      assert.doesNotMatch(res.text, /class="lecture"/);
    });
  });

  describe('transversal', () => {
    // Barre d'adresse : le navigateur découvre le moteur par le lien de l'en-tête.
    it('décrit la recherche pour la barre d’adresse (OpenSearch)', async () => {
      const accueil = await request(app).get('/').expect(200);
      assert.match(accueil.text, /<link rel="search" type="application\/opensearchdescription\+xml" title="Médipile" href="\/opensearch.xml">/);
      const res = await request(app).get('/opensearch.xml').set('X-Forwarded-Proto', 'https').expect(200);
      assert.match(res.headers['content-type'], /opensearchdescription\+xml/);
      assert.match(res.text, /<Url type="text\/html" method="get" template="https:\/\/127\.0\.0\.1:\d+\/search\?q=\{searchTerms\}"\/>/);
    });

    // Moteurs : fiches et classes indexées sous leur adresse canonique, résultats exclus.
    it('référencement : robots.txt, sitemap, titre et description des fiches, résultats hors index', async () => {
      const robotsTxt = await request(app).get('/robots.txt').expect(200);
      assert.match(robotsTxt.text, /^Disallow: \/search$/m);
      assert.match(robotsTxt.text, /^Sitemap: http:\/\/127\.0\.0\.1:\d+\/sitemap\.xml$/m);

      const plan = await request(app).get('/sitemap.xml').expect(200);
      assert.match(plan.headers['content-type'], /xml/);
      assert.match(plan.text, /<loc>http:\/\/127\.0\.0\.1:\d+\/product\/61111111<\/loc>/);

      const fiche = await request(app).get('/product/61111111?q=x').expect(200);
      assert.match(fiche.text, /<title>[^<]+ · RCP, notice, délivrance · Médipile<\/title>/);
      assert.match(fiche.text, /<meta name="description" content="[^"]+">/);
      assert.match(fiche.text, /<link rel="canonical" href="http:\/\/127\.0\.0\.1:\d+\/product\/61111111">/);

      const resultats = await request(app).get('/search?q=doliprane').expect(200);
      assert.match(resultats.text, /<meta name="robots" content="noindex">/);
      assert.doesNotMatch(resultats.text, /rel="canonical"/);
      const introuvable = await request(app).get('/product/99999999').expect(404);
      assert.match(introuvable.text, /noindex/);
    });

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
      const rayons = [...css.text.matchAll(/border-radius:\s*(\d+)px/g)].map((correspondance) => Number(correspondance[1]));
      assert.ok(rayons.every((rayon) => rayon <= 2), `rayons trouvés : ${rayons}`);
    });

    it('trie les présentations par quantité, pas par ordre alphabétique', async () => {
      const res = await request(app).get('/api/product/61111111').expect(200);
      const libelles = res.body.product.cip_products.map((presentation) => presentation.libelle_presentation);
      assert.deepEqual(libelles, [
        'Boîte de 20 comprimés effervescents',
        'Boîte de 30 comprimés effervescents',
      ]);
    });
  });
});

/**
 * Rendu par l'application entière : détecte une locale qu'une route oublie de passer,
 * ce que les tests unitaires de rendu (qui fournissent leurs locales) ne voient pas.
 */
describe('rendu des pages', { skip }, () => {
  let pool;
  let app;

  before(async () => {
    pool = new pg.Pool({ connectionString: url });
    await chargerBase(pool);
    oublierClasses();
    app = createApp(pool);
  });

  after(async () => {
    await pool?.end();
  });

  const PAGES = [
    ['/', 'accueil'],
    ['/search?q=aspirine', 'résultats par nom'],
    ['/search?q=aspirine&filter=active', 'résultats filtrés par principe actif'],
    ['/search?q=ab', 'requête trop courte'],
    ['/documents?q=aspirine', 'plein texte'],
    ['/documents?q=aspirine&rubrique=4.4', 'plein texte filtré'],
    ['/documents?q=aspirine&page=2', 'plein texte, seconde page'],
  ];

  for (const [chemin, quoi] of PAGES) {
    it(`${quoi} — ${chemin}`, async () => {
      const res = await request(app).get(chemin).expect(200);
      assert.match(res.text, /<\/html>/, 'la page est rendue jusqu’au bout');
    });
  }
});
