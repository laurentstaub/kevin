# Déploiement sur Heroku, base commune avec Dispomed

État vérifié le 21 octobre 2026, en lecture seule :

- Dispomed : application `dispomed`, région `eu`, dyno Basic, Node 20.x.
- Base : Postgres `postgresql-fitted-75952`, plan **essential-0** (1 Go, 96,6 Mo utilisés, PostgreSQL 16.14, 20 connexions).
- Ce que Kevin trouve déjà en place, apporté par `deploy_prod.sh` de Dispomed avec le schéma `public` : les extensions `unaccent` et `pg_trgm`, la fonction `f_unaccent`, la configuration `french_nu`, l'index trigramme de `cis_bdpm`.
- `dbpm` : 10 tables, avec les mêmes comptes que la base locale (même chargeur). `ref` : identique.

**Ce qui manque à Kevin** : trois tables `dbpm` et le schéma `docs`. Le script de déploiement de Dispomed les exclut déjà de son archive (`--exclude-schema=docs`, `--exclude-table` pour `cis_documents`, `cis_compo_bdpm` et `cis_cip_bdpm`) : les deux déploiements ne se marchent pas dessus.

| Ajout | Taille locale | Rôle |
|---|---|---|
| `dbpm.cis_documents` | 503 Mo | HTML des RCP et notices, lu par la fiche |
| `dbpm.cis_compo_bdpm` | 28 Mo | substances |
| `dbpm.cis_cip_bdpm` | 19 Mo | présentations, CIP |
| `docs.rcp_sections` | 3,7 Go (2,75 Go de TOAST, index GIN 248 Mo) | rubriques découpées, vecteurs de recherche |

## Principe

On n'écrase rien : on ajoute à la base de Dispomed ses trois tables manquantes et le schéma `docs`. Dispomed tourne pendant le chargement, sans maintenance.

Taille finale : **2,7 Go**, mesurée lors de la répétition du 21 octobre sur une base neuve. Elle est plus compacte que la base locale, qui a gonflé au fil des rechargements. Il faut donc le plan **essential-1** (10 Go).

Coût : essential-1 à 9 $/mois au lieu de 5, plus un dyno Basic à 7 $/mois pour Kevin, soit **environ 11 $/mois de plus**. Un dyno Eco s'endort après trente minutes sans visite ; au comptoir, le réveil de quelques secondes se sentirait.

## Avant de commencer

- **Connexions** : la base en accepte 20. Le pool de Dispomed est réglé à 20 (`database/connect_db.js`, `max: 20`), et celui de Kevin à 5. Sous charge, Dispomed peut prendre toutes les connexions et Kevin échoue. Il faut ramener Dispomed à 10 avant d'ouvrir Kevin.
- **Clients PostgreSQL 16** : le `pg_dump` 18 de Homebrew écrit un `SET transaction_timeout` que le serveur 16 refuse. Utiliser ceux de Postgres.app :

  ```bash
  export P=/Applications/Postgres.app/Contents/Versions/16/bin
  ```

## 0. Vérifier avant d'ajouter

Les tables communes doivent venir du même chargement que les tiennes :

```bash
heroku pg:psql -a dispomed -c "select count(*) from dbpm.cis_bdpm"
```

```bash
psql -d incidents_json -Atc "select count(*) from dbpm.cis_bdpm"
```

Le 21 octobre, les deux comptes étaient de 15 883. S'ils diffèrent, lancer d'abord `deploy_prod.sh` de Dispomed. Puis vérifier que les tables de Kevin n'existent pas encore côté Heroku (la commande ne doit rien renvoyer) :

```bash
heroku pg:psql -a dispomed -c "select to_regclass('dbpm.cis_documents'), to_regclass('docs.rcp_sections')"
```

## 1. Agrandir la base

**Fait le 23 octobre 2026** : essential-0 → essential-1, données conservées. Le changement **coupe la base** pendant sa migration : de 21h38 à 21h42, toute connexion était refusée (« role … is not permitted to log in ») et Dispomed renvoyait des erreurs 500. À refaire (essential-2, standard-0) : en heure creuse, Dispomed en maintenance.

```bash
heroku maintenance:on -a dispomed
```

```bash
heroku addons:upgrade postgresql-fitted-75952 heroku-postgresql:essential-1 -a dispomed
```

Attendre `Plan: essential-1` et `plan change: succeeded` (relancer la commande) :

```bash
heroku pg:info -a dispomed
```

```bash
heroku maintenance:off -a dispomed
```

## 2. Créer l'application et lui attacher la base

```bash
heroku create medipile --region eu
```

```bash
heroku addons:attach postgresql-fitted-75952 -a medipile
```

Une seule fois : chaque commande ajoute un alias de plus (`HEROKU_POSTGRESQL_…`) à la même base.

Sans ses tables, Médipile s'arrête au démarrage : le garder à zéro jusqu'à la fin de l'étape 4.

```bash
heroku ps:scale web=0 -a medipile
```

## 3. Prérequis

Les scripts tournent depuis le poste, contre la base Heroku. `PG_SSL` force le TLS :

```bash
export DATABASE_URL="$(heroku config:get DATABASE_URL -a medipile)" PG_SSL=true
```

```bash
npm run db:setup && npm run db:recherche
```

Les deux scripts sont idempotents. Ils ne posent que ce qui manque (extensions, `f_unaccent`, `french_nu`) et reportent, avec un avis, les index des tables encore absentes.

## 4. Charger les tables de Kevin

Deux archives depuis le poste, avec les clients 16 :

```bash
$P/pg_dump -Fc -t dbpm.cis_compo_bdpm -t dbpm.cis_cip_bdpm -t dbpm.cis_documents incidents_json -f /tmp/kevin_dbpm.dump
```

```bash
$P/pg_dump -Fc -n docs incidents_json -f /tmp/kevin_docs.dump
```

Restauration, sans `--clean` pour `dbpm` : les tables sont nouvelles et rien d'autre n'est touché.

Il faut aussi la faire **sans les clés étrangères vers `cis_bdpm`**. Cette table appartient au déploiement de Dispomed, qui la supprime et la recrée chaque mois (`pg_restore --clean`). Une clé venue d'une table de Kevin bloquerait cette suppression, et la mise à jour de Dispomed échouerait. On retire donc ces contraintes de la liste des objets à restaurer :

```bash
$P/pg_restore -l /tmp/kevin_dbpm.dump | grep -v 'FK CONSTRAINT' > /tmp/kevin_dbpm.list
```

```bash
$P/pg_restore --no-owner --no-privileges -L /tmp/kevin_dbpm.list -d "$DATABASE_URL" /tmp/kevin_dbpm.dump
```

L'archive crée le schéma `docs` ; `--clean --if-exists` ne fait rien la première fois et permet de rejouer la commande après un transfert interrompu :

```bash
$P/pg_restore --no-owner --no-privileges --clean --if-exists -d "$DATABASE_URL" /tmp/kevin_docs.dump
```

La colonne `vecteur` est générée : elle n'est pas dans l'archive et se recalcule au chargement, grâce à `french_nu` posée à l'étape 3. L'index GIN se construit ensuite.

Les archives font 290 Mo (`dbpm`) et 365 Mo (`docs`). En local, la restauration prend 18 s et 2 min. Vers Heroku, le transfert et une base partagée allongent cette durée : compter de trente minutes à une heure.

Puis les index reportés et les statistiques :

```bash
npm run db:setup && npm run db:recherche
```

```bash
psql "$DATABASE_URL" -c "VACUUM ANALYZE docs.rcp_sections" -c "ANALYZE dbpm.cis_documents"
```

```bash
npm run diagnostic
```

## 5. Variables de l'application

```bash
heroku config:set NODE_ENV=production PG_POOL_MAX=5 PG_STATEMENT_TIMEOUT_MS=5000 -a medipile
```

L'adresse publique fixe les liens canoniques, le sitemap, la recherche depuis la barre d'adresse et la redirection HTTPS ; `medipile-36a03b1184cf.herokuapp.com` y est redirigé. Sans elle, l'adresse est déduite de chaque requête, en-tête `Host` compris :

```bash
heroku config:set PUBLIC_URL=https://<domaine> -a medipile
```

L'interprétation des questions par IA est facultative ; sans clé, elle est inactive et tout le reste fonctionne :

```bash
heroku config:set MISTRAL_API_KEY=… IA_MODELE=mistral-small-latest -a medipile
```

Côté Dispomed, le lien vers les fiches de Kevin :

```bash
heroku config:set KEVIN_URL=https://<domaine> -a dispomed
```

## 6. Déployer

Pas de `Procfile` : Heroku lance `npm start`, avec Node 26 (`engines` du `package.json`).

```bash
heroku git:remote -a medipile -r heroku
```

```bash
git push heroku main
```

Le dyno est Basic par défaut (toujours allumé). Une fois les tables chargées :

```bash
heroku ps:scale web=1 -a medipile
```

Contrôles :

- `heroku logs --tail -a medipile` montre le démarrage en `production`.
- `https://medipile-36a03b1184cf.herokuapp.com/api/health` répond `ok`.
- Une adresse en `http://` est redirigée en `https://`.
- Quelques recherches réelles : un nom, une molécule, une expression dans les documents, deux médicaments pour les interactions.
- Une recherche dans les documents sur un mot courant (« grossesse ») : voir « Ce qui peut gêner ».

## Mises à jour mensuelles

1. Le chargement local habituel (BDPM, puis `npm run collect-documents`, `npm run build-sections`, `npm run build-pdf-sections`).
2. `deploy_prod.sh` de Dispomed : les tables communes de `dbpm`, `ref` et `public`, sans toucher à celles de Kevin.
3. Les tables de Kevin, en remplaçant les anciennes : les deux `pg_dump` de l'étape 4, puis `pg_restore --clean --if-exists`, avec la liste sans clés étrangères pour `dbpm`. Kevin lit des tables à jour une fois la commande finie. Pendant `docs`, la recherche dans les documents est indisponible quelques dizaines de minutes ; le reste fonctionne.

## Répétition du 21 octobre 2026

La procédure a été jouée en entier sur une base locale jetable :
- **Départ** : l'état de Dispomed en production (les 10 tables `dbpm` et `ref`), un rôle sans droits superutilisateur et PostgreSQL 16.
- **Étapes 3 et 4** de ce guide.
- **Puis un déploiement de Dispomed simulé**, avec les options exactes de `deploy_prod.sh` et `--clean`.
  - Les tables de Dispomed sont recréées.
  - Les tables de Kevin restent intactes.
  - Les seules erreurs sont des suppressions refusées parce que Kevin s'en sert : extensions, `f_unaccent`, `french_nu`, la séquence de `cis_compo_bdpm`. Elles sont sans effet.
- **Kevin en production** sur cette base : 53 routes en moins de 1,5 s, 60 fiches tirées au hasard, aucune erreur.

## Ce qui peut gêner

- **Mise en ligne du 23 octobre 2026** : chargement en 5 minutes (les trois tables `dbpm` en 1 min 15, `docs` en 3 min), base à 2,7 Go. Une seule erreur, sans effet : la séquence `cis_compo_bdpm_id_seq` existait déjà, laissée par un ancien déploiement de Dispomed. Banc contre la production : 60/60, médiane 428 ms. Les recherches les plus lourdes dans les documents (« grossesse », « insuffisance hépatique sévère » en 4.3) prennent 2,2 à 2,5 s, sous la limite de 5 s : l'essential-1 suffit pour l'instant.
- **Recherche dans les documents sur un mot courant.**
  - En local, « grossesse » lit 490 000 pages du cache, dont 80 000 du disque (630 Mo) ; « insuffisance hépatique sévère » en rubrique 4.3 a pris 4,7 s à froid, puis 1,2 s.
  - Une base Essential partage sa mémoire : la table de 3,7 Go n'y tiendra pas en cache, et ces recherches risquent de dépasser le `statement_timeout` de 5 s.
  - À mesurer dès le chargement. Si elles dépassent, deux voies :
    - monter la base (standard-0, 4 Go de mémoire, environ 50 $/mois) ;
    - ou séparer les vecteurs dans une table étroite (`code_cis`, `document_type`, `position`, `numero`, `vecteur`), pour que le classement ne lise plus le HTML ni le texte.
  - Allonger le délai ne ferait que déplacer l'attente.
- **Deux applications, une base** : une migration de schéma de l'une se fait en pensant à l'autre. En production, Kevin ne fait que lire ; ses scripts, lancés depuis le poste, n'écrivent que dans `docs` et dans ses trois tables `dbpm`.
- **Données** : la BDPM est publique, aucune donnée personnelle ; la région `eu` suffit.
