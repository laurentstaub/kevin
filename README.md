# Demander à Kevin

Moteur de recherche sur la **BDPM** (base de données publique des médicaments) :
spécialités, principes actifs, groupes génériques, présentations CIP et documents
officiels (RCP, notice) — avec une recherche instantanée et un classement par
pertinence que le site officiel ne propose pas.

Le suivi des ruptures d'approvisionnement est traité par un projet dédié
([app.antheosdata.com](https://app.antheosdata.com)) ; chaque fiche produit pointe vers lui.

---

## Démarrage

```bash
npm install
cp .env.example .env        # renseigner la connexion PostgreSQL
npm run db:setup            # extensions, fonction f_unaccent, index
npm run dev
```

L'application écoute sur `http://localhost:3000`.

**Prérequis :** Node ≥ 20.12 (chargement natif du `.env`), PostgreSQL ≥ 12 avec les
extensions `unaccent` et `pg_trgm`.

## Configuration

Tout passe par l'environnement — aucune valeur en dur dans le code.
Voir `.env.example` pour la liste complète.

| Variable | Rôle | Défaut |
|---|---|---|
| `DATABASE_URL` | Connexion complète (prioritaire) | — |
| `PGUSER` / `PGHOST` / `PGDATABASE` / `PGPORT` | Connexion détaillée | `localhost:5432` |
| `PORT` | Port HTTP | `3000` |
| `SEARCH_MIN_LENGTH` | Longueur minimale d'une recherche | `3` |
| `SEARCH_LIMIT` | Résultats maximum **par famille** (dénomination, principe actif) | `60` |
| `SUGGEST_LIMIT` | Suggestions d'autocomplétion | `8` |
| `RELATED_LIMIT` | Produits apparentés par fiche | `40` |
| `CORS_ORIGINS` | Origines tierces autorisées | aucune |
| `DOCUMENT_BASE_URL` | Base des `file_path` relatifs | BDPM |
| `DOCUMENT_HOSTS` | Domaines autorisés pour les liens de documents | ANSM, BDPM, EMA |
| `LINK_*` | Gabarits de liens sortants (`{cis}`, `{q}`) | voir `.env.example` |

## Données

L'application lit le schéma `dbpm`, alimenté par les fichiers publics de l'ANSM :

| Table | Contenu |
|---|---|
| `dbpm.cis_bdpm` | Spécialités (code CIS, dénomination, forme, titulaire) |
| `dbpm.cis_compo_bdpm` | Compositions (principes actifs) |
| `dbpm.cis_cip_bdpm` | Présentations (CIP7, CIP13) |
| `dbpm.cis_gener_bdpm` | Groupes génériques (`type_generique` : 0 = princeps, 1 = générique) |
| `dbpm.cis_documents` | RCP et notices (HTML ou PDF) — 4 types, voir plus bas |

`npm run db:setup` applique `sql/setup.sql` : extensions `unaccent` et `pg_trgm`,
wrapper `f_unaccent` IMMUTABLE (indispensable pour indexer une expression
désaccentuée) et index GIN trigrammes sur la dénomination et la substance.
Sans ces index, chaque recherche déclenche un balayage complet des tables.

Au démarrage, le serveur vérifie ces prérequis :

- **`f_unaccent` manquante** → il la crée lui-même (instantané, idempotent).
  Si les droits ne le permettent pas, il refuse de démarrer plutôt que de
  servir une recherche qui échouera à chaque requête.
- **Index trigrammes manquants** → simple avertissement : l'application
  fonctionne, elle est seulement lente.
- **Tables BDPM manquantes** → arrêt immédiat.

## Routes

**Pages**

| Route | Description |
|---|---|
| `GET /` | Recherche |
| `GET /search?q=&filter=` | Résultats. `filter` : `all`, `specialty`, `active` |
| `GET /product/:cis` | Fiche produit (CIS à 8 chiffres) |

**API JSON**

| Route | Description |
|---|---|
| `GET /api/health` | État du service et de la base |
| `GET /api/suggest?q=` | Autocomplétion — réponse courte, une requête SQL |
| `GET /api/search?q=&filter=` | Recherche complète |
| `GET /api/product/:cis` | Fiche, produits apparentés, liens sortants |
| `GET /api/product/:cis/documents` | Documents groupés par type |
| `GET /api/product/:cis/documents/:type` | Un document (`rcp`, `notice`, `main`) |

Le HTML des documents est **assaini avant de sortir de la couche données** et servi
en JSON, jamais en `text/html` sur l'origine de l'application.

## Architecture

```
server.js              Démarrage : vérification base, écoute, arrêt propre
src/
  config.js            Configuration, source unique de vérité
  db.js                Pool PostgreSQL et diagnostic
  app.js               Assemblage Express
  middleware.js        En-têtes de sécurité, CORS, 404, gestion d'erreurs
  validate.js          Normalisation des entrées (q, filter, code CIS)
  text.js              Désaccentuation, miroir de unaccent() côté application
  search.js            Recherche — une requête SQL, quel qu'en soit le volume
  products.js          Fiche produit et produits apparentés
  documents.js         Documents officiels et assainissement
  links.js             Liens sortants (BDPM, PubMed, ClinicalTrials, EMA, ruptures)
  outline.js           Plan des documents : découpe des titres et ancres
  rcp-plan.js          Plan type du RCP (modèle QRD) — casse, accents, socle
  split.js             Découpage d'un document en rubriques
  routes/
    pages.js           Rendu Pug
    api.js             API JSON
views/                 Gabarits Pug (layout, search_page, product, error)
public/
  css/tokens.css       Socle visuel : couleurs, échelle, filets, angles droits
  css/app.css          Recherche et éléments communs
  css/product.css      Fiche produit
  js/search.js         Autocomplétion
  js/rail.js           Sommaire actif
scripts/
  db-setup.js          Extensions, f_unaccent, index
  diagnostic.js        État des lieux de la base (lecture seule)
  build-sections.js    Matérialise les rubriques dans docs.rcp_sections
sql/
  setup.sql            Extensions, f_unaccent, index
  sections.sql         Schéma docs : rubriques et suivi du découpage
tests/
  unit/                Sans base
  integration/         Sur fixtures figées
  fixtures.sql         Jeu de données de test
```

Quatre dépendances de production, une de développement. Le `.env` est chargé
nativement par Node, les en-têtes de sécurité tiennent en un middleware,
et les tests utilisent le runner intégré — pas de couche de plus qu'il n'en faut.

### Découpage de la fiche produit

La page répond à une question : **ce médicament, c'est quoi, et par quoi je le
remplace ?** Le découpage suit cet ordre, pas celui de la base.

| Bloc | Contenu | Pourquoi là |
|---|---|---|
| Identité | Dénomination, DCI, forme, titulaire, CIS | En-tête, une seule fois. Le code CIS et le titulaire sont de l'identité, pas des « autres informations » |
| Substituer | Un tableau, colonne Rôle : Princeps / Générique / Même DCI | La question opérationnelle vient en premier. Un seul tableau au lieu de deux sections qui répondaient à la même chose |
| Présentations | CIP 13 et conditionnement, triés par quantité | Détail de conditionnement : après la substitution |
| Documents | RCP et notice, précédés de leur plan | Le plan rend le RCP consultable au comptoir plutôt que défilable |
| Références | PubMed, ClinicalTrials, EMA sur la DCI | Sortie vers la littérature, séparée des sources produit (rail) |

Le rail de gauche porte le sommaire et les liens produit (BDPM officiel,
disponibilité). Il libère la colonne de lecture et sert de navigation sur une
page que le RCP rend longue.

#### Sommaire et découpe des titres du RCP

Le rail de gauche est le **seul sommaire** de la page : les rubriques du RCP
viennent s'imbriquer sous « Documents ». Il reste à l'écran pendant la lecture
et surligne la rubrique en cours (`public/js/rail.js`, IntersectionObserver,
sans dépendance). Sur un document de quarante mille signes, savoir où l'on se
trouve vaut autant que pouvoir sauter ailleurs.

#### Découpe des titres

Un titre de rubrique arrive du scraping sous la forme d'une seule chaîne, en
capitales et souvent sans accents : `4. DONNEES CLINIQUES`. `src/outline.js` le
découpe en numéro et libellé, rendus dans deux colonnes alignées — le sommaire
et le corps du document partagent la même gouttière, l'œil retrouve la
numérotation au même endroit.

**Les documents de la BDPM n'utilisent pas `h1`-`h4`** : leurs titres sont des
paragraphes, souvent enveloppés dans une ancre. La détection ne se fie donc pas
à la balise mais au motif — un bloc court dont le texte entier est une rubrique
numérotée. Ce qui oblige à trancher ensuite : dans le corps d'un RCP,
« 3 ans. » (contenu de la 6.3) et « 30 comprimés sous plaquettes » (contenu de
la 6.5) ont exactement la même forme qu'un titre.

Ce qui les trahit, c'est la place. `coherentes()` retient la **plus longue
sous-suite strictement croissante** des numéros : les vrais titres en forment
une longue, le bruit isolé en est exclu. Un parcours de proche en proche ne
suffirait pas — le premier faux positif ancrerait la suite au mauvais endroit.

`src/rcp-plan.js` porte le plan type du RCP (modèle QRD) et sert à rétablir
casse et accents : `4. DONNEES CLINIQUES` s'affiche `4 · Données cliniques`.

**Le libellé de référence n'est retenu que s'il correspond mot pour mot au
libellé source**, une fois les accents, la casse et la ponctuation neutralisés.
Une rubrique dont la rédaction diffère du plan type garde la sienne — sur une
page médicale, on normalise la typographie, jamais le contenu. Les rubriques à
deux rédactions selon l'ancienneté de l'AMM (4.6 avec ou sans « Fertilité »)
sont toutes deux acceptées, et c'est celle qui correspond qui est retenue.

Le titre propre du document (`RESUME DES CARACTERISTIQUES DU PRODUIT`) est
retiré du corps : il est déjà affiché au-dessus.

#### Diagnostic de la base

```bash
npm run diagnostic
```

Lecture seule. Répond à trois questions qu'on ne peut pas trancher sans regarder
les données : quelles tables existent réellement, quelle part des documents n'a
qu'un PDF sans HTML, et sur quelle proportion l'application arrive à extraire un
plan. En cas d'échec de détection, il affiche le début du HTML des documents
concernés — le balisage y est visible.

#### Les quatre types de documents

Mesuré sur un instantané de `incidents_json` (39 946 lignes, ~14 400 CIS) :

| Type | Lignes | Contenu |
|---|---|---|
| `main` | 14 392 | Fiche info BDPM — identité, pictogrammes, présentations. Pas le RCP |
| `rcp` | 11 732 | Résumé des caractéristiques, en HTML |
| `notice` | 11 721 | Notice patient, en HTML |
| `rcp_notice` | 2 101 | **PDF seul**, `html_content` NULL, `file_path` relatif |

`rcp_notice` couvre les spécialités enregistrées en procédure centralisée : la
BDPM n'en publie pas de HTML, seulement un PDF regroupant les annexes de la
décision européenne. Cela concerne **2 086 CIS, soit environ 15 %** — et pour
eux, `main` ne compense pas : c'est la fiche info, pas le RCP.

#### Documents au format PDF

**L'application n'ingère rien** : elle lit `dbpm.cis_documents`, alimentée en
amont. Un document sans HTML s'affiche avec un lien vers la version officielle
et une mention explicite. Pas de sommaire, pas de texte : il n'y a rien à
découper.

Les `file_path` sont **relatifs au site source** (`/documents/<CIS>/rcp_notice.pdf`).
Servis tels quels ils pointeraient sur notre propre origine et donneraient un
404 : ils sont résolus contre `DOCUMENT_BASE_URL` avant de passer la liste
blanche `DOCUMENT_HOSTS`.

Rendre ces documents consultables au même titre que les autres suppose une
extraction texte à l'ingestion, hors du périmètre de ce dépôt.

### Choix structurants

**Une requête SQL par recherche.** Le classement (exact → préfixe → occurrence →
dénomination la plus courte) et les bornes sont appliqués en base. Le volume de
résultats ne change pas le nombre d'allers-retours.

**Les produits apparentés vivent sur la fiche produit, pas sur la page de résultats.**
Les calculer pour chaque ligne d'une liste coûte cher et n'apporte rien : on ne
compare des génériques qu'après avoir choisi une spécialité.

**Les documents ANSM sont du contenu externe.** Ils sont assainis par liste blanche
(`src/sanitize.js`) et les URL de téléchargement sont validées contre `DOCUMENT_HOSTS`
avant d'être exposées.

**La recherche par principe actif est une catégorie distincte.** Chercher
« paracétamol » remonte DOLIPRANE et DAFALGAN : ces produits ne portent pas le terme
dans leur nom, et c'est le comportement attendu. Les tests le vérifient par
catégorie, jamais globalement.

**Une ligne de résultat est un produit, pas un code CIS.** Un CIS est un triplet
marque × dosage × forme : DOLIPRANE en compte dix-sept, LEVOTHYROX treize. Les
lister un par un remplit l'écran d'un seul médicament, et aucun classement n'y
peut rien puisque ces dix-sept lignes sont d'égale pertinence. Le regroupement
se fait en base, avant la borne — regrouper après rendrait un nombre de produits
imprévisible. La clé est la racine de marque, précisée du titulaire (voir
`src/groupes.js`).

**Quand le terme désigne une molécule, les deux catégories fusionnent.**
Distinguer « trouvé par le nom » de « trouvé par la composition » n'a de sens
que pour une marque. Sur « oxazépam », cette séparation plaçait les trois
OXAZEPAM <laboratoire> en tête et reléguait SERESTA — le princeps, celui qu'on
cherche — dans une seconde section, en dessous. La recherche reconnaît donc un
terme qui correspond exactement à une substance et ne rend alors qu'une liste,
classée d'un bout à l'autre.

**Le princeps passe devant ses génériques**, et à défaut la marque devant le
générique de commodité. Trois critères, dans cet ordre :

| Critère | Ce qu'il tranche | Couverture |
|---|---|---|
| `type_generique = 0` | SERESTA avant OXAZEPAM ARROW | 51 % des CIS |
| trouvé par la substance, pas par le nom | DOLIPRANE avant PARACETAMOL EG | tous |
| étendue de la gamme | DOLIPRANE (17) avant DAFALGAN (6) | tous |

Le premier est le bon critère, mais il est muet là où la question se pose le
plus : **aucune** des 149 spécialités de paracétamol n'appartient à un groupe
générique, parce qu'un groupe encode une *substituabilité* — un princeps sous
brevet et ses génériques — et que DOLIPRANE, EFFERALGAN et DAFALGAN sont chacun
leur propre référence. D'où les deux relais. Le dernier est un corrélat de la
notoriété, pas la notoriété : seules des données de volume la connaissent.

**Chaque catégorie a son propre quota et son propre classement** — hors
recherche de molécule, où la liste est unique. Deux détails sans lesquels la
promesse ci-dessus est fausse en pratique :

- Un `LIMIT` commun laisse la dénomination affamer le principe actif. Soixante
  spécialités s'appellent « PARACETAMOL <labo> » : elles remplissaient à elles
  seules le budget, et DOLIPRANE n'apparaissait jamais. La borne est donc
  appliquée par catégorie (`row_number()` partitionné), pas sur le total.
- Le rang doit se calculer sur **ce par quoi la ligne a été trouvée**. Classer
  une trouvaille par substance sur sa dénomination revient à mettre en tête les
  produits que la recherche par nom rendait déjà — exactement ceux pour
  lesquels la recherche par substance n'apportait rien.

Les produits trouvés par substance qui portent aussi le terme dans leur nom sont
écartés de la catégorie « principe actif » : ils sont déjà rendus par la
dénomination. Cette exclusion est faite **avant** la borne, sinon elle ne
protège de rien.

## Découpage des documents en rubriques

```bash
npm run build-sections              # incrémental
npm run build-sections -- --all     # rejouer après amélioration du découpeur
npm run build-sections -- --dry-run --limit 500   # mesurer sans écrire
```

Lit `dbpm.cis_documents`, n'y écrit **jamais**, et matérialise une ligne par
rubrique dans `docs.rcp_sections`. Les rubriques sont dérivées : la source
reste la référence, et un rejeu les reconstruit intégralement.

### Pourquoi un schéma `docs`

`dbpm` est le miroir des fichiers `CIS_*.txt`, reconstruit par `DELETE` + insert
à chaque chargement. Tout ce qui est dérivé du scraping n'y a pas sa place —
sans quoi le miroir cesse d'être jetable, et on ne peut plus le recharger sans
détruire ce qu'on ne sait pas reconstruire.

### Deux colonnes de contenu

`html` pour l'affichage — gras, listes, tableaux de posologie. `texte` pour
l'index plein texte : les balises polluent la recherche, `<b>para</b>cétamol`
ne correspond pas à « paracétamol ». Le texte se déduit du HTML, ce n'est pas
une source en double.

C'est ce qui rend possible la question que le site officiel ne sait pas poser :

```sql
SELECT code_cis FROM docs.rcp_sections
WHERE numero = '4.3'
  AND to_tsvector('french', texte) @@ plainto_tsquery('french', 'insuffisance rénale');
```

### Incrémental et rejeu

`docs.document_parse` garde, par document, l'empreinte du HTML source et la
version du découpeur. Un document est sauté si les deux sont inchangés.
Incrémenter `PARSER_VERSION` dans `src/split.js` suffit à tout rejouer après
une amélioration de la détection — sans quoi les corrections ne s'appliqueraient
qu'aux documents modifiés depuis.

### Contrôle qualité

Un découpage rate en silence : un titre manqué et son contenu fusionne dans la
rubrique précédente. « 4.3 Contre-indications » avalée par la posologie ne se
voit pas à la lecture.

Le plan type QRD donne les rubriques **attendues**, ce qui rend le contrôle
gratuit. Chaque document est classé `ok`, `partiel` (des rubriques socle
manquent) ou `echec` (aucune rubrique), et les manquantes sont listées.

Le socle dépend de la famille : le RCP et la notice ont des plans différents,
et `main` — la fiche info — n'est pas un document à rubriques, il n'est pas
découpé du tout.

## Tests

Runner natif de Node — aucune dépendance de test à part `supertest`.

```bash
npm run test:unit    # 100 tests, sans base
npm test             # tout ; l'intégration s'ignore si TEST_DATABASE_URL est absent
```

```bash
createdb bdpm_test
TEST_DATABASE_URL=postgres://user@localhost:5432/bdpm_test npm test   # 129 tests
```

Les tests d'intégration reconstruisent le schéma depuis `tests/fixtures.sql` :
ils ne dépendent d'aucune donnée BDPM réelle et ne peuvent pas être cassés par
une mise à jour mensuelle de la base.

## Licence

ISC
