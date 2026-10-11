import { Router } from 'express';
import { config } from '../config.js';
import { wrap } from '../middleware.js';
import { parseQuery, isValidCis } from '../validate.js';
import { lireEtat, titre, lien } from '../etat-recherche.js';
import { iaActive, estQuestion, interpreterQuestion } from '../ia.js';
import { reconnaitreMedicament } from '../reconnaissance.js';
import {
  lireFiche, listerFiches, lireCalcul, publiee, DOSSIER_CLASSES,
} from '../fiches.js';
import { regrouperSpecialites } from '../specialites.js';
import { groupeBiologique, substitutionBiosimilaires } from '../biosimilaires.js';
import { searchMedications } from '../search.js';
import {
  getProduct,
  getRelatedProducts,
  getVariantes,
  genericGroupLabel,
} from '../products.js';
import { getDocuments, withSections, DOCUMENT_TYPES } from '../documents.js';
import { getSections } from '../sections.js';
import { getDelivrance, getRemboursement } from '../delivrance.js';
import {
  chercherDansDocuments, extraitDeRubrique, rechercheAbsente,
  APERCU, COLONNES, PAR_PAGE,
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

  /**
   * Où envoyer une saisie : la base d'abord, l'IA ensuite.
   * - médicament + reste (« paracetamol allaitement ») → documents du médicament ;
   * - nom seul (« doliprane 1000 mg ») → recherche par nom, jamais l'IA ;
   * - aucun médicament et allure de question → l'IA interprète (`ia`) ;
   * - sinon la recherche habituelle (null).
   * @returns {Promise<{ url: string }|{ ia: true }|null>}
   */
  const orienter = async (etat, saisie) => {
    const reconnu = await reconnaitreMedicament(pool, saisie).catch((err) => {
      console.error('[recherche] reconnaissance indisponible :', err.message);
      return null;
    });
    if (reconnu?.reste) {
      return { url: lien({ ...etat, mode: 'documents' }, {
        requete: reconnu.reste, molecule: reconnu.molecule, question: saisie,
      }) };
    }
    if (reconnu) return null;
    return iaActive() && estQuestion(saisie) ? { ia: true } : null;
  };

  router.get(
    '/search',
    wrap(async (req, res) => {
      // Les gabarits reçoivent l'état au lieu de recomposer les URL.
      const etat = lireEtat(req.query, 'nom');
      const query = parseQuery(req.query.q);
      const filter = etat.filtre;

      if (!query.raw) return res.redirect('/');

      // Médicament reconnu → ses documents ; question → l'IA l'interprète sur /documents.
      if (!etat.brut && !query.tooShort) {
        const sens = await orienter(etat, query.raw);
        if (sens?.url) return res.redirect(sens.url);
        if (sens?.ia) return res.redirect(lien({ ...etat, mode: 'documents' }));
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
          // La panne s'affiche, distincte d'une absence de résultats.
          console.error('[recherche] plein texte indisponible :', err.message);
          panne = rechercheAbsente(err)
            ? 'La recherche dans les documents n’est pas encore installée sur cette base '
              + '— exécuter « npm run db:recherche ».'
            : 'La recherche dans les documents est momentanément indisponible.';
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

  /** Recherche plein texte, vue complète, avec son propre filtre par rubrique. */
  router.get(
    '/documents',
    wrap(async (req, res) => {
      const etat = lireEtat(req.query, 'documents');
      const query = parseQuery(req.query.q);
      const { rubrique, page } = etat;

      if (!query.raw) return res.redirect('/');

      // Saisie brute (ni déjà réorientée, ni « tel quel ») : la base reconnaît
      // un médicament, ou l'IA traduit la question en critères. Dans les deux
      // cas, redirection vers la recherche explicite (URL partageable, filtres
      // retirables) ; `question` présent : déjà fait, jamais deux fois.
      if (!etat.molecule && !etat.question && !etat.brut && !query.tooShort) {
        const sens = await orienter(etat, query.raw);
        if (sens?.url) return res.redirect(sens.url);
        if (sens?.ia) {
          const criteres = await interpreterQuestion(query.raw).catch((err) => {
            console.error('[ia] interprétation indisponible :', err.message);
            return null;
          });
          if (criteres) {
            return res.redirect(lien(etat, {
              requete: criteres.mots,
              rubrique: criteres.rubrique ?? rubrique,
              molecule: criteres.molecule,
              question: query.raw,
              ia: '1',
            }));
          }
        }
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
            console.error('[recherche] plein texte indisponible :', err.message);
            panne = rechercheAbsente(err)
              ? 'La recherche dans les documents n’est pas encore installée sur cette base '
                + '— exécuter « npm run db:recherche ».'
              : 'La recherche dans les documents est momentanément indisponible.';
            return vide;
          });

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
          ? `Saisissez au moins ${config.search.minLength} caractères.`
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
        substitutions, variantes, bruts, decoupe, delivrance, remboursement, classeAtc,
      ] = await Promise.all([
        getRelatedProducts(pool, cis, product.active_ingredients),
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
          // Classement vide plutôt qu'inventé.
          console.error('[délivrance] indisponible pour', cis, err.message);
          return { resume: [], groupes: [], liens: [] };
        }),
        // Absence normale : seules 672 spécialités sont concernées.
        getRemboursement(pool, cis).catch((err) => {
          console.error('[remboursement] indisponible pour', cis, err.message);
          return null;
        }),
        // Absence normale : 36,5 % des spécialités n'ont pas de classe ATC.
        getClasseAtc(pool, cis).catch((err) => {
          console.error('[atc] classe indisponible pour', cis, err.message);
          return [];
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
        hasDocuments && {
          id: 'documents',
          label: 'Documents',
          // Rubriques déjà sommaires dans le document : pas de doublon dans le rail.
          children: [],
        },
        substitutions.length > 0 && { id: 'substituer', label: 'Substituer' },
        { id: 'references', label: 'Références' },
      ].filter(Boolean);

      const resumeAtc = resumerClasse(classeAtc);

      res.render('product', {
        product,
        importation,
        reference,
        substitutions,
        variantes,
        remboursement,
        resumeAtc,
        // Branche ATC du produit, surlignée dans le rail.
        railActif: resumeAtc?.feuille?.code?.[0] ?? null,
        genericGroup: genericGroupLabel(substitutions),
        documents,
        hasDocuments,
        delivrance,
        // Meddispar ne recense que les spécialités à dispensation particulière.
        links: productLinks(product, {
          dispensationParticuliere: delivrance.groupes.length > 0,
        }),
        sections,
      });
    }),
  );

  return router;
}
