# Fiches thématiques

Une fiche est un fichier Markdown de ce dossier, publié à `/fiches/<nom-du-fichier>`.

## Ce qu'une fiche contient

- **Un en-tête** : `titre`, `auteur`, `relu` (date AAAA-MM-JJ), et `liste` si elle en porte une. **Sans date de relecture, la fiche n'est pas publiée** — elle se prévisualise en développement seulement.
- **Un texte court, signé.** Titres `##`, paragraphes, listes `-`, `**gras**`, `*italique*`, `[lien](https://…)`. Rien d'autre : pas de HTML, pas de tableau.
- **Des blocs calculés**, qui ne se rédigent pas :
  - `::: substances <liste>` — la liste de `data/listes/<liste>.json`, une ligne par substance ;
  - `::: citations rubriques=4.4,4.5 termes=QT` — pour chaque substance, les phrases de son RCP qui portent ces termes (élargis par le thésaurus), dans ces rubriques.

## Le cycle

1. On écrit ou modifie la fiche, ou la liste.
2. `npm run build-fiches` calcule les citations depuis les RCP et écrit `data/fiches/<nom>.json`, plus un rapport de candidats `data/fiches/<nom>.candidats.md`, jamais publié.
3. **On relit le diff** de `data/fiches/` : ce qui change d'un millésime à l'autre s'y lit avant d'être en ligne.
4. On date `relu:` et on commite.

## Règle éditoriale

Tout ce qui porte sur une molécule est cité du RCP, jamais réécrit. Le texte libre dit pourquoi la fiche existe et comment la lire ; il ne résume aucun RCP.
