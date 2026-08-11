# Dr Kevin — guide de design

Ce document dit ce qui est décidé et pourquoi. Les valeurs vivent dans
`public/css/tokens.css` ; ce qui suit explique de quel raisonnement elles
sortent, pour qu'on puisse les discuter au lieu de les recopier.

Deux règles priment sur toutes les autres.

**On lit ici, on ne parcourt pas.** Un RCP complet fait quarante mille signes.
Toute décision qui gagne en éclat ce qu'elle coûte en confort de lecture est
mauvaise, quelle que soit son allure sur une capture d'écran.

**Une donnée réglementaire s'affiche ou s'assume absente.** Jamais tronquée,
jamais devinée, jamais escamotée parce qu'elle ne rentrait pas.

---

## 1. Couleur

Une seule famille, deux emplois qui ne se croisent jamais.

| Rôle | Token | Valeur | Contraste |
|---|---|---|---|
| Encre | `--ink` | `#14201a` | 16,8 sur blanc |
| Encre secondaire | `--muted` | `#5f6b62` | 5,58 |
| Encre tertiaire | `--faint` | `#6b7770` | 4,67 |
| Accent — texte | `--accent` | `#1b5e33` | 7,79 |
| Accent — action | `--accent-vif` | `#7bd44f` | 9,09 avec l'encre **posée dessus** |
| Aplat sombre | `--bg-fonce` | `#123b22` | 12,5 avec du blanc |
| État sélectionné | `--accent-pale` | `#e4f0e6` | 14,3 avec l'encre |
| Teinte de section | `--bg-tint` | `#f2f7f2` | — |

Le vert vient d'antheosdata.com — même maison, même famille. Il est employé
autrement : là-bas il couvre des pages qu'on parcourt, ici il **borde** des
pages qu'on lit.

`--accent` porte du texte : liens, codes ATC, onglet actif, DCI. `--accent-vif`
n'en porte **jamais** — à 1,66 de contraste sur blanc il serait illisible. Il
est un fond, une fois par écran, pour l'action principale : le bouton de
recherche, et rien d'autre pour l'instant.

`--faint` a été relevé de `#9a9a9a`, qui plafonnait à 2,85 et ne passait aucun
seuil WCAG alors qu'il portait des libellés de colonnes et des codes ATC. Sur
une base médicale, une mention illisible est une mention absente.

**Jamais de rouge opposé au vert** pour coder une information. L'inversion
culturelle et le daltonisme rendent ce codage illisible pour une part
significative des lecteurs. Un statut se dit par un mot.

Ce qui vaut aussi pour le fond : le vert profond est réservé à l'en-tête
d'**accueil**, la seule page sans texte long. Sur la fiche produit, il devient
la teinte claire — même famille, même signal d'appartenance, sans l'épreuve.

## 2. Typographie

Inchangée, et ce n'est pas de la paresse.

- `--font-head` Georgia — titres de page et de rubrique.
- `--font-body` système sans empattement — interface, métadonnées, tableaux.
- `--font-lecture` Iowan Old Style / Palatino — **corps des rubriques**. Les
  liseuses composent en serif d'écran, Bookerly chez Kindle, parce qu'un texte
  de plusieurs milliers de signes se lit mieux avec des empattements qui
  ancrent la ligne de base.
- `--font-mono` — uniquement les identifiants : CIS, CIP, codes ATC. Un code
  qu'on recopie doit se vérifier caractère par caractère.

Mesure de ligne **68 caractères** (`--measure`), interligne **1,6**, corps de
base **17 px** sur la surface de lecture. Ce sont les valeurs pour lesquelles
la recherche sur la lecture longue converge ; ne pas les élargir pour gagner de
la place.

Échelle 1,333 depuis 16 px. Graisse 400 sur les titres : dans un document
officiel, la hiérarchie vient du corps et du blanc, pas de l'épaisseur.

## 3. Rayons

**Écart assumé avec le socle Antheos, qui les interdit.** Les deux sites de
référence en posent, et une page entièrement à angles vifs paraît aujourd'hui
datée plutôt que rigoureuse. La règle de partage est nette :

> Ce qui se manipule s'arrondit. Ce qui se lit reste droit.

- `--radius-control: 6px` — champs, boutons, puces de dosage, mentions de
  délivrance, marques. Tout ce qui se clique ou se saisit.
- `--radius-surface: 10px` — ce qui est vraiment un objet posé sur la page. Une
  seule occurrence aujourd'hui : la liste de suggestions, qui flotte au-dessus
  du reste et le dit par une ombre courte.
- **Aucun rayon sur la structure.** Sections, tableaux, rubriques, bandeaux :
  ils n'ont pas de contour, ce sont des filets qui les portent, et un filet ne
  s'arrondit pas.

Il n'y a pas de réglage global. Une règle `*` posant un rayon par défaut
revient à décider une fois pour toutes qu'aucun élément n'en mérite un
différent ; elle a été retirée.

## 4. Structure

**Une page, une question.** L'accueil répond à « par où j'entre ». La fiche
produit répond à « que dois-je savoir sur ce médicament ». La page de classe
répond à « que contient cette aire thérapeutique ». Si la réponse ne se lit pas
en dix secondes, la page est ratée — avant tout jugement esthétique.

**Une décision structurelle non-défaut par page**, au moins. Sur l'accueil et
sur la fiche, c'est le même parti : les bandeaux — barre de situation et
identité — débordent de la colonne, sans marge extérieure, tandis que le
contenu reste sur un axe unique de 46 rem (`--colonne`).

**Pas de sommaire latéral.** Il en a existé un ; il listait quatre blocs dont
trois tiennent sur une ligne repliée, c'est-à-dire qu'il annonçait ce que l'œil
voyait déjà. Il ne coûtait pas de la largeur — la colonne faisait sa mesure —
mais du centrage : le texte se lisait quatre-vingts pixels à droite de l'axe.
Le sommaire de la fiche est le document lui-même : rubriques repliées, il
affiche son plan numéroté dans la colonne de lecture, à sa vraie place.

**Interdits.** Pas de grille de trois cartes en tête de page — deux ou quatre
passent, trois est la signature d'une page générée. Pas de hero centré titre +
sous-titre + deux boutons. Pas d'icône dans un rond.

**Métadonnées uniques.** Date de mise à jour, source, périmètre : une seule
occurrence, sous le titre. Jamais répétées par bloc.

**Filtres au-dessus de ce qu'ils pilotent.** Un filtre sous une liste est une
erreur, pas une variante.

## 5. Composants

**Bandeau d'identité** (`.identite`, `.accueil`) — pleine largeur, sans marge
extérieure, contenu recentré à l'intérieur. Vert profond sur l'accueil, teinte
claire sur la fiche. Il porte l'identité et la navigation, jamais du contenu.

**Champ de recherche** — l'enveloppe porte le rayon et `overflow: hidden` ; le
bouton n'a pas à connaître l'arrondi. Sur fond teinté, l'intérieur reste blanc,
sinon il cesse de se lire comme une saisie.

**Puces et mentions** (`.forme-choix`, `.mention`, `.marque`) — filet fin,
rayon de contrôle, fond blanc. L'état courant est un aplat `--accent`. Ce sont
des étiquettes, pas des alertes : un stupéfiant n'est pas une erreur, c'est un
cadre de délivrance.

**Tableaux** — filets horizontaux seuls. Pas de bordures verticales, pas de
fond alterné, pas de rayon. L'en-tête en capitales petites, `--faint`.

**Onglets** — l'état sélectionné se dit par un aplat `--accent-pale`, pas par
un filet de soulignement. Un onglet est un `<button>` : il hérite du rayon des
contrôles, et le filet épousait cet arrondi en se recourbant à ses deux
extrémités — un trait qui se tord n'est plus un trait. L'aplat, lui, est ce que
la forme arrondie porte naturellement, et il range l'onglet dans la même famille
que les puces de dosage et les mentions de délivrance.

**Blocs repliables** (`.bloc`) — le résumé doit rester informatif fermé. Un
bloc qui ne dit rien quand il est replié cache au lieu de ranger : c'est la
raison d'être des mentions de délivrance dans l'en-tête du bloc.

**Barre de situation** — une ligne, collante, toujours présente. Elle porte le
retour, le champ de recherche et ce qu'on est en train de lire. Rien qui pointe
vers un bloc de la page : ce serait une seconde copie du plan que le document
affiche déjà. Toujours là plutôt qu'apparaissant au défilement — un seuil, un
état et une animation coûtent plus d'attention qu'ils n'économisent de place.
Sa hauteur est un token, `--barre-h` : les cibles d'ancre s'en écartent d'autant
en `scroll-margin-top`, sinon un lien vers 4.1 dépose son titre dessous.

**Fil ATC** — dans la ligne de situation, en tête. Le code de la feuille en
chasse fixe, les maillons en capitales de style, jamais dans la donnée.

## 6. Écarts avec le socle Antheos

Le skill `web-antheos` reste la référence pour les sites et tableaux de bord.
Dr Kevin s'en écarte sur deux points, et il vaut mieux les écrire que les
découvrir en relisant du CSS :

1. **Les rayons sont autorisés**, selon la règle du §3. Le socle les interdit.
2. **La surface de lecture est en serif**, à 68 caractères et 1,6 d'interligne.
   Le socle ne traite pas le cas du document long ; c'est ici l'essentiel du
   produit.

Tout le reste — angle droit sur la structure, accent unique, pas de codage
rouge/vert, filets horizontaux, une page une question, filtres au-dessus,
métadonnées uniques — s'applique sans réserve.

## 7. Contrôle avant livraison

- [ ] La question de la page se lit en dix secondes
- [ ] Aucune grille de trois cartes, aucun hero centré, aucune icône en rond
- [ ] Rayon uniquement sur ce qui se manipule ou flotte
- [ ] Tableaux à filets horizontaux seuls
- [ ] Un seul aplat `--accent-vif` par écran, jamais sous du texte
- [ ] Aucun couple rouge/vert porteur d'information
- [ ] Chaque contraste texte/fond ≥ 4,5
- [ ] Filtres au-dessus de ce qu'ils pilotent
- [ ] Date et périmètre affichés une seule fois
- [ ] Aucune ancre interne dans la barre de situation
- [ ] Rendu vérifié à 430 px de large
