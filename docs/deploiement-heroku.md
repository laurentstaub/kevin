# Déploiement sur Heroku, base commune avec Dispomed

État de départ (16 octobre 2026) : Dispomed tourne sur Heroku, région `eu`,
avec le Postgres `postgresql-fitted-75952` en plan **essential-0** (1 Go,
96 Mo utilisés, 25 tables, 20 connexions). Il lit déjà le schéma `dbpm`. En
local, les deux applications partagent la base `incidents_json`.

Dr Kevin est une application Node sans étape de build : `npm start` lance
`server.js`, qui lit `PORT` et `DATABASE_URL`, et s'arrête proprement sur
`SIGTERM`. Tout le poids est dans la base :

| Schéma | Taille locale | Rôle |
|---|---|---|
| `dbpm` | 645 Mo, dont 503 Mo de `cis_documents` (lu par la fiche : à garder) | BDPM |
| `ref` | 1,4 Mo | ATC |
| `docs` | 3,7 Go (`rcp_sections` : 504 000 rubriques) | RCP et notices découpés, vecteurs de recherche |

Soit **3,9 Go** : il faut le plan **essential-1** (10 Go). La colonne
`vecteur` est générée (`GENERATED ALWAYS`) : `pg_dump` ne l'exporte pas, elle
se recalcule à la restauration, ce qui exige que la configuration `french_nu`
existe avant.

## Principe

Une seule base Postgres, attachée aux deux applications Heroku. Un seul
chargement des données publiques sert Dispomed et Dr Kevin. Chaque
application garde son dyno, ses variables et son déploiement.

Coût : essential-1 à 9 $/mois au lieu de 5, plus un dyno Basic à 7 $/mois
pour Dr Kevin, soit **environ 11 $/mois de plus**. Un dyno Eco (5 $/mois,
partagé avec Dispomed) s'endort après trente minutes sans visite : au
comptoir, le réveil de quelques secondes se sentirait.

## 0. Vérifier avant d'écraser

Les tables `dbpm` de Dispomed sur Heroku doivent venir du même chargement
que les tiennes (`0db_incidents_json`), sinon la restauration de `dbpm`
casserait Dispomed.

```bash
heroku pg:psql -a dispomed -c "\dt dbpm.*"
```

```bash
heroku pg:psql -a dispomed -c "select count(*) from dbpm.cis_bdpm" && psql -d incidents_json -Atc "select count(*) from dbpm.cis_bdpm"
```

Même liste de tables, mêmes colonnes (`\d dbpm.cis_bdpm` des deux côtés) :
on continue. Sinon, s'arrêter là et comparer les chargeurs.

## 1. Agrandir la base

Le changement de plan entre deux plans Essential se fait sur place, données
conservées, en quelques minutes :

```bash
heroku addons:upgrade postgresql-fitted-75952 heroku-postgresql:essential-1 -a dispomed
```

```bash
heroku pg:info -a dispomed
```

## 2. Créer l'application et lui attacher la base

```bash
heroku create dr-kevin --region eu
```

Si le nom est pris, Heroku en propose un autre ; les commandes suivantes
prennent le nom retenu. L'attachement pose `DATABASE_URL` sur la nouvelle
application, la même URL que Dispomed :

```bash
heroku addons:attach postgresql-fitted-75952 -a dr-kevin
```

## 3. Prérequis SQL

Les scripts du dépôt tournent depuis le poste, contre la base Heroku. `PG_SSL`
force le TLS (par défaut, il n'est actif qu'avec `NODE_ENV=production`) :

```bash
export DATABASE_URL="$(heroku config:get DATABASE_URL -a dr-kevin)" PG_SSL=true
```

Dans l'ordre : extensions, fonction `f_unaccent` et index trigrammes
(`setup.sql`) ; schéma `docs` vide (`sections.sql`) ; configuration
`french_nu`, colonne `vecteur` et son index (`recherche.sql`) :

```bash
npm run db:setup && npm run db:sections && npm run db:recherche
```

Heroku autorise `CREATE EXTENSION` pour `unaccent` et `pg_trgm`, et la
création d'une configuration de recherche dans `public`.

## 4. Charger les données

Depuis le poste, deux archives :

```bash
pg_dump -Fc -n dbpm -n ref incidents_json -f /tmp/dbpm.dump && pg_dump -Fc -n docs incidents_json -f /tmp/docs.dump
```

`dbpm` et `ref` existent déjà côté Heroku (Dispomed) : la restauration
remplace les tables. Pendant ce temps, Dispomed lit des tables vides ou
absentes — choisir une heure creuse et le mettre en maintenance :

```bash
heroku maintenance:on -a dispomed
```

```bash
pg_restore --no-owner --no-privileges --clean --if-exists -d "$DATABASE_URL" /tmp/dbpm.dump
```

```bash
heroku maintenance:off -a dispomed
```

`docs` est nouveau. La table `rcp_sections` est recréée depuis l'archive
(avec sa colonne générée, d'où `french_nu` avant), les vecteurs se
recalculent au chargement et l'index GIN se construit ensuite : compter une
à deux heures sur une base Essential, le temps du transfert compris
(environ 1 Go de texte).

```bash
pg_restore --no-owner --no-privileges --clean --if-exists -d "$DATABASE_URL" /tmp/docs.dump
```

Puis vérifier les comptes et la recherche :

```bash
npm run diagnostic
```

## 5. Variables de l'application

Vingt connexions pour la base : cinq pour Dr Kevin, et vérifier le pool de
Dispomed pour que les deux et un script de maintenance tiennent dedans.

```bash
heroku config:set NODE_ENV=production PG_POOL_MAX=5 PG_STATEMENT_TIMEOUT_MS=5000 -a dr-kevin
```

L'interprétation des questions par IA est facultative ; sans clé, elle est
inactive et tout le reste fonctionne :

```bash
heroku config:set MISTRAL_API_KEY=… IA_MODELE=mistral-small-latest -a dr-kevin
```

## 6. Déployer

Pas de `Procfile` : Heroku lance `npm start`. Le dépôt garde `origin` pour
GitHub et prend un second dépôt distant pour Heroku :

```bash
heroku git:remote -a dr-kevin -r heroku
```

```bash
git push heroku main
```

```bash
heroku ps:type basic -a dr-kevin
```

Contrôle : `heroku logs --tail -a dr-kevin` doit montrer le démarrage et la
vérification des prérequis (f_unaccent, index, tables), puis
`https://<app>.herokuapp.com/api/health` répond `ok`. Faire ensuite quelques
recherches réelles : un nom, une molécule, une expression dans les documents,
deux médicaments pour les interactions.

## Mises à jour de la BDPM

La collecte, la découpe et le calcul des vecteurs restent sur le poste
(`npm run collect-documents`, `npm run build-sections`,
`npm run build-pdf-sections`) : trop longs et trop gourmands pour un dyno.
Puis l'étape 4, archive par archive. `docs` ne gêne pas Dispomed ; `dbpm` le
touche, donc maintenance. Un rythme mensuel suit la BDPM d'assez près.

## Ce qui peut gêner

- **Connexions** : 20 au total. Un script lancé depuis le poste pendant que
  les deux applications tournent peut manquer de place ; `PG_POOL_MAX=5` de
  chaque côté laisse dix connexions libres.
- **Temps de requête** : la base Essential partage son processeur. Le
  `statement_timeout` de 5 s protège l'application ; si la recherche plein
  texte le dépasse en production, c'est la base à monter d'un cran, pas le
  délai à allonger.
- **Deux applications, une base** : une migration de schéma de l'une se fait
  en pensant à l'autre. Dr Kevin ne touche qu'à `docs` et ne modifie rien
  dans `dbpm` ni `ref`.
- **Données** : la BDPM est publique, aucune donnée personnelle ; la région
  `eu` suffit.
