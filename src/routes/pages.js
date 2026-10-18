import { Router } from 'express';
import { config } from '../config.js';
import { wrap } from '../middleware.js';
import { parseQuery, isValidCis } from '../validate.js';
import { lireEtat, titre, lien } from '../etat-recherche.js';
import { iaActive, estQuestion, interpreterQuestion } from '../ia.js';
import {
  reconnaitreMedicament, reconnaitreMedicaments, normaliser, substituerHorsMarques,
} from '../reconnaissance.js';
import { chercherInteractions, estAssociation, MEDICAMENTS_MAX } from '../interactions.js';
import { lireCode, trouverParCode } from '../codes.js';
import { substituer } from '../synonymes.js';
import {
  getSecabilite, getAdministration, administrationDe, filtrerDeglutition,
} from '../galenique.js';
import { getInfosSecurite } from '../securite.js';
import { getComptoir } from '../comptoir.js';
import {
  getExcipients, excipientsDe, cisDesAlternatives, filtrerAlternatives, lireSans, lienAlternatives,
} from '../excipients.js';
import {
  lireFiche, listerFiches, lireCalcul, publiee, DOSSIER_CLASSES,
} from '../fiches.js';
import { regrouperSpecialites } from '../specialites.js';
import { groupeBiologique, substitutionBiosimilaires } from '../biosimilaires.js';
import { searchMedications } from '../search.js';
import { getProduct, getVariantes } from '../products.js';
import { getAlternatives } from '../alternatives.js';
import { compterOptions } from '../substitution.js';
import { getDocuments, withSections, DOCUMENT_TYPES } from '../documents.js';
import { getSections } from '../sections.js';
import {
  getDelivrance, getRemboursement, delivranceIndisponible, remboursementIndisponible,
} from '../delivrance.js';
import { signaletique } from '../signaletique.js';
import { getEvaluation, resumerEvaluation } from '../has.js';
import {
  chercherDansDocuments, extraitDeRubrique, rechercheAbsente, motsTrouves,
  APERCU, COLONNES, PAR_PAGE, MINIMUM_CIBLE,
} from '../recherche-texte.js';
import { estImportation, referenceNationale } from '../imports.js';
import { productLinks } from '../links.js';
import {
  getClasseAtc,
  resumerClasse,
  getClassesPrincipales,
  getClasse,
  getSpecialitesDeClasse,
  getMoleculesDeClasse,
  getMoleculesPrincipales,
  getPortraitClasse,
  lirePortrait,
  FEUILLE,
} from '../atc.js';

/** Panne de la recherche dans les documents, distincte d'une absence de résultats. */
function messagePanne(err) {
  console.error('[recherche] plein texte indisponible :', err.message);
  return rechercheAbsente(err)
    ? 'La recherche dans les documents n’est pas encore installée sur cette base '
      + '— exécuter « npm run db:recherche ».'
    : 'La recherche dans les documents est momentanément indisponible.';
}

/** Adresse de la page Interactions : un paramètre `m` par médicament, dans l'ordre de la saisie. */
export function lienInteractions(elements) {
  return `/interactions?${new URLSearchParams(elements.map((nom) => ['m', nom]))}`;
}

export function pageRoutes(pool) {
  const router = Router();

  /** Fiche ou chapeau non relu : visible en développement seulement. */
  const visible = (fiche) => config.env !== 'production' || publiee(fiche);

  /**
   * Rail présent sur toutes les pages (résultat mis en cache par getClassesPrincipales).
   * En cas de défaut, le rail se réduit au lien d'accueil.
   */
  router.use(
    wrap(async (req, res, next) => {
      res.locals.rail = await getClassesPrincipales(pool).catch((err) => {
        console.error('[rail] classes indisponibles :', err.message);
        return [];
      });
      next();
    }),
  );

  router.get(
    '/',
    wrap(async (req, res) => {
      // Un défaut de classification ne doit pas bloquer la page de recherche.
      const repli = (quoi) => (err) => {
        console.error(`[atc] ${quoi} indisponibles :`, err.message);
        return [];
      };
      const [classes, molecules] = await Promise.all([
        getClassesPrincipales(pool).catch(repli('classes principales')),
        getMoleculesPrincipales(pool).catch(repli('molécules principales')),
      ]);

      res.render('search_page', {
        etat: lireEtat({}, 'nom'),
        title: titre(lireEtat({}, 'nom')),
        query: '', filter: 'all', results: null, classes, molecules, sansRail: true,
        colonnes: COLONNES,
      });
    }),
  );

  /**
   * Parcours par classe thérapeutique. Le code ATC est validé contre la base :
   * une chaîne bien formée peut ne désigner aucune classe.
   */
  router.get(
    '/classe/:code',
    wrap(async (req, res, next) => {
      const code = String(req.params.code ?? '').toUpperCase();
      if (!/^[A-Z][0-9A-Z]{0,6}$/.test(code)) return next();

      const classe = await getClasse(pool, code);
      if (!classe) return next();

      // Spécialités listées à la feuille seulement : plus haut, la liste serait tronquée.
      const feuille = classe.level === FEUILLE || classe.enfants.length === 0;

      // Enfants déjà au niveau molécule (ex. J05AF) : pas de seconde liste.
      const enfantsMolecules = classe.enfants[0]?.level === FEUILLE;

      const [specialitesListe, molecules, portrait] = await Promise.all([
        feuille ? getSpecialitesDeClasse(pool, code, classe.label) : [],
        feuille || enfantsMolecules ? [] : getMoleculesDeClasse(pool, code),
        // Facultatif : son absence ne doit pas bloquer la page.
        getPortraitClasse(pool, code).catch((err) => {
          console.error('[atc] portrait indisponible pour', code, err.message);
          return null;
        }),
      ]);

      // Chapeau signé facultatif : fiches/classes/<code>.md.
      const chapeau = lireFiche(code.toLowerCase(), DOSSIER_CLASSES);

      // Groupe biologique substituable, lu sur les spécialités de la molécule.
      const groupe = specialitesListe.map((sp) => groupeBiologique(sp.denomination)).find(Boolean);
      const substitution = groupe?.substituable ? { ...substitutionBiosimilaires(), substance: groupe.substance } : null;

      res.render('classe', {
        substitution,
        classe, feuille, molecules, railActif: code[0],
        commercialisees: regrouperSpecialites(specialitesListe.filter((sp) => sp.commercialise)),
        retirees: regrouperSpecialites(specialitesListe.filter((sp) => !sp.commercialise)),
        portrait: lirePortrait(portrait),
        chapeau: chapeau && visible(chapeau) ? chapeau : null,
      });
    }),
  );

  /** L'IA traduit une question en critères ; null si elle est absente ou échoue. */
  const interpreter = async (texte) => {
    if (!iaActive() || !estQuestion(texte)) return null;
    return interpreterQuestion(texte).catch((err) => {
      console.error('[ia] interprétation indisponible :', err.message);
      return null;
    });
  };

  /**
   * Où envoyer une saisie : la base d'abord, l'IA ensuite.
   * - médicament + reste court (« paracetamol allaitement ») → documents du médicament ;
   * - médicament + reste en forme de question (« une femme qui allaite peut-elle
   *   prendre de l'aspirine ») → l'IA traduit le reste, la base garde la molécule ;
   * - nom seul (« doliprane 1000 mg ») → recherche par nom, jamais l'IA ;
   * - aucun médicament et allure de question → l'IA interprète tout ;
   * - sinon la recherche habituelle (null).
   * Toujours une redirection vers la recherche explicite : URL partageable, filtres retirables.
   * @returns {Promise<{ url: string }|null>}
   */
  const orienter = async (etat, saisie) => {
    // Plusieurs médicaments nommés séparément : leurs interactions. Les
    // substances d'une association commercialisée désignent ce produit.
    const plusieurs = await reconnaitreMedicaments(pool, saisie).catch((err) => {
      console.error('[interactions] reconnaissance indisponible :', err.message);
      return null;
    });
    if (plusieurs && !(await estAssociation(pool, plusieurs).catch(() => true))) {
      return { url: lienInteractions(plusieurs) };
    }

    const documents = (changements) => ({ url: lien({ ...etat, mode: 'documents' }, { question: saisie, ...changements }) });
    const reconnu = await reconnaitreMedicament(pool, saisie).catch((err) => {
      console.error('[recherche] reconnaissance indisponible :', err.message);
      return null;
    });
    if (reconnu?.reste) {
      const criteres = await interpreter(reconnu.reste);
      return criteres
        ? documents({ requete: criteres.mots, rubrique: criteres.rubrique, molecule: reconnu.molecule, ia: '1' })
        : documents({ requete: reconnu.reste, molecule: reconnu.molecule });
    }
    if (reconnu) return null;
    const criteres = await interpreter(saisie);
    if (criteres) {
      return documents({ requete: criteres.mots, rubrique: criteres.rubrique, molecule: criteres.molecule, ia: '1' });
    }
    // Question sans réponse de l'IA : les documents tout de même, texte tel quel.
    // `question` posé : sans lui, /documents réorienterait vers lui-même, sans fin.
    return iaActive() && estQuestion(saisie) ? documents({}) : null;
  };

  // Recherche depuis la barre d'adresse du navigateur (OpenSearch) : « kevin »
  // puis Tab, ou moteur ajouté. L'adresse doit être absolue ; derrière le
  // proxy de Heroku, le protocole vient de X-Forwarded-Proto.
  router.get('/opensearch.xml', (req, res) => {
    const origine = `${req.get('x-forwarded-proto') ?? req.protocol}://${req.get('host')}`;
    res.type('application/opensearchdescription+xml').set('Cache-Control', 'public, max-age=86400').send(
      '<?xml version="1.0" encoding="UTF-8"?>\n'
      + '<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">'
      + '<ShortName>Kevin</ShortName>'
      + '<Description>Médicaments de la BDPM : nom, principe actif, expression dans les RCP</Description>'
      + '<InputEncoding>UTF-8</InputEncoding>'
      + `<Url type="text/html" method="get" template="${encodeURI(origine)}/search?q={searchTerms}"/>`
      + '</OpenSearchDescription>',
    );
  });

  router.get(
    '/search',
    wrap(async (req, res) => {
      // Les gabarits reçoivent l'état au lieu de recomposer les URL.
      const etat = lireEtat(req.query, 'nom');
      const query = parseQuery(req.query.q);
      const filter = etat.filtre;

      if (!query.raw) return res.redirect('/');

      // Code de boîte (CIP, Datamatrix) : la fiche directement. Inconnu de la
      // BDPM, la recherche habituelle le dira introuvable.
      const code = lireCode(String(req.query.q).slice(0, 200));
      if (code) {
        const cis = await trouverParCode(pool, code).catch((err) => {
          console.error('[code] recherche par code indisponible :', err.message);
          return null;
        });
        if (cis) return res.redirect(`/product/${cis}`);
      }

      // Médicament reconnu ou question interprétée → les documents, par redirection.
      if (!etat.brut && !query.tooShort) {
        const sens = await orienter(etat, query.raw);
        if (sens) return res.redirect(sens.url);
      }

      if (query.tooShort) {
        return res.render('search_page', {
          etat,
          sansRail: true,
          title: titre(etat),
          query: query.raw,
          filter,
          results: null,
          colonnes: COLONNES,
          notice: `Saisissez au moins ${config.search.minLength} caractères.`,
        });
      }

      // En parallèle ; un défaut sur les documents ne bloque pas la recherche par nom.
      let panne = null;
      const [results, documents] = await Promise.all([
        searchMedications(pool, query, filter),
        chercherDansDocuments(pool, query.raw, { limite: APERCU }).catch((err) => {
          panne = messagePanne(err);
          return null;
        }),
      ]);

      res.render('search_page', {
        etat,
        title: titre(etat),
        query: query.raw, filter, results, documents, panne, colonnes: COLONNES,
        sansRail: true,
      });
    }),
  );

  /**
   * Interactions entre médicaments, deux à cinq : `?m=kardegic&m=previscan`.
   * Chaque nom est normalisé comme à la reconnaissance ; un nom inconnu est dit.
   */
  router.get(
    '/interactions',
    wrap(async (req, res) => {
      // `m` : un médicament par paramètre ; `avec` : la saisie du champ de la
      // rubrique 4.5 de la fiche, plusieurs noms séparés par des virgules ou des « + ».
      // Sans séparateur (« kardegic previscan »), la reconnaissance de la
      // recherche coupe la saisie ; les noms courants passent en substance.
      // « aspirine upsa » reste la spécialité ; « aspirine » seule devient la substance.
      const saisies = (await Promise.all([req.query.avec].flat()
        .flatMap((saisie) => String(saisie ?? '').slice(0, 200).split(/[,;+/]/))
        .map((saisie) => substituerHorsMarques(pool, saisie).catch(() => substituer(saisie)))))
        .filter((saisie) => saisie.trim());
      const decoupees = await Promise.all(saisies.map(async (saisie) => (
        await reconnaitreMedicaments(pool, saisie).catch(() => null)) ?? [saisie]));
      const bruts = [[req.query.m].flat(), decoupees.flat()].flat()
        .filter((nom) => typeof nom === 'string');
      const elements = [...new Set(bruts
        .map((nom) => nom.slice(0, 60).split(/\s+/).map(normaliser).filter(Boolean).join(' '))
        .filter(Boolean))].slice(0, MEDICAMENTS_MAX);
      if (elements.length < 2) {
        // Depuis la 4.5 de la fiche, champ vide ou illisible : retour à la fiche.
        const cis = elements.find((element) => /^\d{8}$/.test(element));
        return res.redirect(cis ? `/product/${cis}` : '/');
      }

      const resultat = await chercherInteractions(pool, elements);
      const noms = resultat.medicaments.map((med) => med.libelle);
      return res.render('interactions', {
        title: `${noms.join(' × ') || 'Interactions'} · Interactions · Demander à Kevin`,
        // Les noms affichés, pas les codes : la barre se resoumet telle quelle.
        saisie: noms.join(' + ') || elements.join(' '),
        resultat,
        sansRail: true,
      });
    }),
  );

  /** Recherche plein texte, vue complète, avec son propre filtre par rubrique. */
  router.get(
    '/documents',
    wrap(async (req, res) => {
      const etat = lireEtat(req.query, 'documents');
      // Dans les documents d'un seul médicament, un terme de deux lettres
      // (« olanzapine QT » → « QT ») est précis et la recherche reste petite.
      // Sur toute la base, le minimum habituel évite de tout ramener.
      const minimum = etat.molecule ? MINIMUM_CIBLE : config.search.minLength;
      const query = parseQuery(req.query.q, { minLength: minimum });
      const { rubrique, page } = etat;

      if (!query.raw) return res.redirect('/');

      // Saisie brute (ni déjà réorientée, ni « tel quel ») : la base reconnaît
      // un médicament, ou l'IA traduit la question en critères. Dans les deux
      // cas, redirection vers la recherche explicite (URL partageable, filtres
      // retirables) ; `question` présent : déjà fait, jamais deux fois.
      if (!etat.molecule && !etat.question && !etat.brut && !query.tooShort) {
        const sens = await orienter(etat, query.raw);
        if (sens) return res.redirect(sens.url);
      }

      let panne = null;
      const vide = { resultats: [], total: 0, borne: false, decalage: 0, suite: false };
      const chercher = (phrases) => chercherDansDocuments(pool, query.raw, {
        rubrique, molecule: etat.molecule, phrases, limite: PAR_PAGE, decalage: (page - 1) * PAR_PAGE,
      });
      // Recherche ciblée (médicament, question, rubrique) : la molécule et ses phrases.
      // Transversale (« QT ») : une ligne par molécule, les rubriques en colonnes.
      const ciblee = Boolean(etat.molecule || etat.question || rubrique);
      const documents = query.tooShort
        ? vide
        : await chercher(ciblee)
          .catch((err) => {
            panne = messagePanne(err);
            return vide;
          });

      // Rubrique choisie par l'IA et vide : elle s'est trompée de rubrique, pas de
      // question. Même recherche sur tout le document, URL honnête.
      if (etat.ia && rubrique && !panne && documents.total === 0 && documents.resultats.length === 0) {
        return res.redirect(lien(etat, { rubrique: null }));
      }

      res.render('documents', {
        etat,
        sansRail: true,
        title: titre(etat),
        query: query.raw,
        rubrique,
        ciblee,
        documents,
        page,
        colonnes: COLONNES,
        parPage: PAR_PAGE,
        panne,
        notice: query.tooShort
          ? `Saisissez au moins ${minimum} caractères.`
          : null,
      });
    }),
  );

  /** Fiches thématiques. Non relue : brouillon en développement, absente en production. */

  router.get(
    '/fiches',
    wrap(async (req, res) => {
      const fiches = listerFiches().filter(visible);
      res.render('fiches', { title: 'Fiches · Demander à Kevin', fiches });
    }),
  );

  router.get(
    '/fiches/:slug',
    wrap(async (req, res, next) => {
      const fiche = lireFiche(req.params.slug);
      if (!fiche || !visible(fiche)) return next();
      return res.render('fiche', {
        title: `${fiche.meta.titre ?? fiche.slug} · Demander à Kevin`,
        fiche,
        calcul: lireCalcul(fiche.slug),
        brouillon: !publiee(fiche),
      });
    }),
  );

  /**
   * Extrait d'une rubrique pour l'aperçu au survol, calculé à la demande :
   * `ts_headline` sur toute la page ferait passer la recherche de 20 à 170 ms.
   */
  router.get(
    '/extrait',
    wrap(async (req, res) => {
      const trouvaille = await extraitDeRubrique(pool, {
        cis: req.query.cis,
        type: req.query.type,
        position: req.query.position,
        requete: req.query.q,
      }).catch((err) => {
        console.error('[extrait] indisponible :', err.message);
        return null;
      });

      if (!trouvaille) return res.status(404).json({ erreur: 'introuvable' });
      // Stable tant que le découpage ne change pas.
      res.set('Cache-Control', 'private, max-age=300');
      return res.json(trouvaille);
    }),
  );

  router.get(
    '/product/:id',
    wrap(async (req, res, next) => {
      const cis = req.params.id;
      if (!isValidCis(cis)) return next();

      const product = await getProduct(pool, cis);
      if (!product) return next();

      const [
        alternatives, variantes, bruts, decoupe, delivrance, remboursement, classeAtc, evaluation, trouves,
        secabilite, securite, excipients, administration, comptoir,
      ] = await Promise.all([
        getAlternatives(pool, cis).catch((err) => {
          console.error('[substitution] alternatives indisponibles pour', cis, err.message);
          return { categories: [], groupe: null };
        }),
        getVariantes(pool, cis).catch((err) => {
          console.error('[variantes] indisponibles pour', cis, err.message);
          return [];
        }),
        getDocuments(pool, cis).catch((err) => {
          console.error('[documents] indisponibles pour', cis, err.message);
          return [];
        }),
        getSections(pool, cis).catch((err) => {
          // Repli : texte d'un seul bloc.
          console.error('[rubriques] indisponibles pour', cis, err.message);
          return new Map();
        }),
        getDelivrance(pool, cis).catch((err) => {
          // Panne signalée comme telle : une liste vide se lirait « Sans ordonnance ».
          console.error('[délivrance] indisponible pour', cis, err.message);
          return delivranceIndisponible();
        }),
        // Absence normale (`null`) : seules 672 spécialités sont concernées. Une panne
        // se signale : `null` laisserait croire la prise en charge sans restriction.
        getRemboursement(pool, cis).catch((err) => {
          console.error('[remboursement] indisponible pour', cis, err.message);
          return remboursementIndisponible();
        }),
        // Absence normale : 36,5 % des spécialités n'ont pas de classe ATC.
        getClasseAtc(pool, cis).catch((err) => {
          console.error('[atc] classe indisponible pour', cis, err.message);
          return [];
        }),
        // Absence normale (`[]`) : beaucoup de spécialités n'ont pas d'avis de la
        // Commission. Panne : `null`, sinon la bande dirait « Pas d'avis HAS ».
        getEvaluation(pool, cis).catch((err) => {
          console.error('[has] évaluation indisponible pour', cis, err.message);
          return null;
        }),
        // Venu de « Dans les documents » : les mots que la recherche a réellement trouvés.
        typeof req.query.q === 'string' && req.query.q.trim()
          ? motsTrouves(pool, cis, req.query.q.slice(0, 200)).catch((err) => {
            console.error('[surlignage] mots indisponibles pour', cis, err.message);
            return [];
          })
          : [],
        // Absence normale : la rubrique 3 ne dit rien de la sécabilité, ou pas de RCP découpé.
        getSecabilite(pool, cis).catch((err) => {
          console.error('[galénique] sécabilité indisponible pour', cis, err.message);
          return null;
        }),
        // Panne : `null`, sinon l'absence de bloc se lirait « aucune information ».
        getInfosSecurite(pool, cis).catch((err) => {
          console.error('[sécurité] informations indisponibles pour', cis, err.message);
          return null;
        }),
        // Panne : `null`, la bande se tait plutôt que de suggérer « sans ».
        getExcipients(pool, cis).catch((err) => {
          console.error('[excipients] indisponibles pour', cis, err.message);
          return null;
        }),
        // Panne ou RCP muet : rien, la bande ne conclut pas.
        getAdministration(pool, cis).catch((err) => {
          console.error('[administration] indisponible pour', cis, err.message);
          return [];
        }),
        // Panne ou RCP muet : rien, la bande ne conclut pas.
        getComptoir(pool, cis, product.forme_pharmaceutique).catch((err) => {
          console.error('[comptoir] indisponible pour', cis, err.message);
          return null;
        }),
      ]);

      const documents = withSections(bruts, decoupe);

      // Importation parallèle sans RCP ni notice : emprunter ceux de la spécialité française.
      const importation = estImportation(product.type_procedure_amm);
      let reference = null;

      if (importation && documents.every((doc) => doc.rubriques.length === 0)) {
        reference = await referenceNationale(pool, cis, product.denomination_medicament).catch(
          (err) => {
            console.error('[importation] référence introuvable pour', cis, err.message);
            return null;
          },
        );
      }

      if (reference) {
        const [refBruts, refDecoupe] = await Promise.all([
          getDocuments(pool, reference.id).catch(() => []),
          getSections(pool, reference.id).catch(() => new Map()),
        ]);

        documents.push(
          ...withSections(refBruts, refDecoupe)
            .filter((doc) => doc.rubriques.length > 0)
            .map((doc) => ({ ...doc, emprunte: reference })),
        );
      }

      // Le document le plus substantiel en premier.
      documents.sort((a, b) => DOCUMENT_TYPES.indexOf(a.type) - DOCUMENT_TYPES.indexOf(b.type));
      const hasDocuments = documents.length > 0;

      // Plan de la page, dans l'ordre d'affichage : le rail doit suivre la lecture.
      const sections = [
        { id: 'delivrance', label: 'Délivrance' },
        evaluation?.length > 0 && { id: 'evaluation', label: 'Évaluation HAS' },
        securite?.total > 0 && { id: 'securite', label: 'Sécurité' },
        // Question de comptoir : avant les documents, qui sont la référence.
        alternatives.categories.length > 0 && { id: 'alternatives', label: 'Alternatives' },
        hasDocuments && {
          id: 'documents',
          label: 'Documents',
          // Rubriques déjà sommaires dans le document : pas de doublon dans le rail.
          children: [],
        },
        { id: 'references', label: 'Références' },
      ].filter(Boolean);

      const resumeAtc = resumerClasse(classeAtc);
      const genericGroup = alternatives.groupe;
      const optionsAlternatives = compterOptions(alternatives.categories);

      // Excipients des alternatives, calculés en base, et filtre « sans … » de
      // l'URL. Une panne laisse les alternatives sans filtre plutôt que vides.
      const profils = await excipientsDe(pool, cisDesAlternatives(alternatives.categories)).catch((err) => {
        console.error('[excipients] alternatives indisponibles pour', cis, err.message);
        return null;
      });
      const parExcipient = profils
        ? filtrerAlternatives(alternatives.categories, profils, lireSans(req.query.sans ?? ''),
          new Set((excipients?.presents ?? []).map((present) => present.id)), product.voies_administration)
        : null;

      // Déglutition difficile : forme (BDPM) ou ce que le RCP permet. Panne : pas de filtre.
      const categoriesFiltrees = parExcipient ? parExcipient.categories : alternatives.categories;
      const mentions = await administrationDe(pool, cisDesAlternatives(categoriesFiltrees)).catch((err) => {
        console.error('[administration] alternatives indisponibles pour', cis, err.message);
        return null;
      });
      const deglutition = mentions ? filtrerDeglutition(categoriesFiltrees, mentions, req.query.deglutition === '1') : null;

      res.render('product', {
        product,
        // Cases fixes sous le titre, condensées en seconde ligne de la barre au défilement.
        signaletique: signaletique(product, delivrance, genericGroup, importation,
          resumerEvaluation(evaluation), optionsAlternatives, secabilite, administration, comptoir),
        securite,
        optionsAlternatives,
        // Sous-classe ATC (5 caractères) des alternatives de classe : nommée et liée.
        sousClasseAtc: (classeAtc ?? []).find((niveau) => niveau.code?.length === 5) ?? null,
        evaluation,
        motsTrouves: trouves,
        importation,
        reference,
        alternatives: { ...alternatives, categories: deglutition ? deglutition.categories : categoriesFiltrees },
        parExcipient,
        deglutition,
        lienAlternatives,
        variantes,
        remboursement,
        resumeAtc,
        // Rail réduit au plan : le fil ATC en tête de fiche mène aux classes,
        // et la recherche ailleurs.
        rail: null,
        genericGroup,
        documents,
        hasDocuments,
        delivrance,
        // Meddispar ne recense que les spécialités à dispensation particulière.
        links: productLinks(product, {
          // Conditions inconnues : le lien reste proposé, faute de savoir.
          dispensationParticuliere: delivrance.indisponible || delivrance.groupes.length > 0,
        }),
        sections,
      });
    }),
  );

  return router;
}
