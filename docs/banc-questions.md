# Banc de questions du comptoir — à relire

Cinquante-cinq questions telles qu'on les tape au comptoir, avec la page attendue. Chaque réponse attendue est une phrase **relevée dans la base locale le 23 octobre 2026**, dans le RCP de la spécialité de référence ; rien n'est de mémoire. Le banc notera la page affichée : la bonne spécialité (ou ses formes), la bonne rubrique, et la phrase présente.

Les questions sont dans `tests/banc/questions.json` ; `npm run banc` les joue contre la base réelle (IA comprise si elle est configurée) et note chaque page. Le 23 octobre : 36/55 avant corrections, 55/55 après. Une réponse peut se trouver dans la rubrique entière, repliée sous son passage.

**Statuts possibles** : *phrase* (passage surligné), *entière* (texte court cité), *ne mentionne pas* (le RCP se tait : c'est la réponse attendue), *interactions* (page des interactions, niveau le plus fort).

## Grossesse, allaitement

| # | Question | Référence | Rub. | Attendu |
|---|---|---|---|---|
| 1 | tramadol allaitement ? | Topalgic 50 mg, gélule | 4.6 | « Environ 0,1% de la dose de tramadol administrée à la mère est excrété dans le lait maternel. » |
| 2 | Kardégic grossesse | Kardégic 75 mg, sachet | 4.6 | « Faibles doses, inférieures ou égales à 100 mg par jour : … semblent être sûres… » |
| 3 | ibuprofène enceinte 6 mois ? | Advil 200 mg | 4.3 | « grossesse, à partir du début du 6ème mois (24 semaines d'aménorrhée) » |
| 4 | Doliprane pendant la grossesse ? | Doliprane 1000 mg, comprimé | 4.6 | « Les études effectuées chez l'animal n'ont pas mis en évidence d'effet tératogène… » |
| 5 | isotrétinoïne et contraception | Curacné 20 mg | 4.4 | « … contre-indiquée chez les femmes en âge de procréer, sauf si toutes les conditions du Programme de prévention de la grossesse sont remplies » |
| 6 | méthotrexate allaitement | Méthotrexate Accord 10 mg | 4.6 | « … le traitement est contre-indiqué durant l'allaitement (voir rubrique 4.3). » |
| 7 | Coversyl et grossesse | Coversyl 5 mg | 4.3 | « 2ème et 3ème trimestres de la grossesse » |

## Interactions

| # | Question | Attendu |
|---|---|---|
| 8 | Kardégic + Previscan | interactions, *Contre-indiquée* |
| 9 | clarithromycine simvastatine | interactions, *Contre-indiquée* |
| 10 | tramadol sertraline | interactions, *À prendre en compte* |
| 11 | millepertuis ciclosporine | interactions, *Contre-indiquée* |
| 12 | Kardégic et ibuprofène, risque ? | interactions |
| 52 | atorvastatine millepertuis interactions | interactions comparatives (les deux RCP, l'un sur l'autre), pas la recherche par l'IA. RCP de l'atorvastatine : « L'administration concomitante d'atorvastatine avec un inducteur du cytochrome P450 3A (tels que l'éfavirenz, la rifampicine ou le millepertuis) peut entraîner des diminutions variables de la concentration plasmatique d'atorvastatine. » ; RCP du millepertuis : ne nomme pas l'atorvastatine (0 RCP sur 3) |
| 53 | atorvastatine pamplemousse | interactions ; thésaurus ANSM : « ATORVASTATINE + PAMPLEMOUSSE (JUS ET FRUIT) », *À prendre en compte* ; le pamplemousse sans RCP |
| 54 | simvastatine millepertuis | interactions ; thésaurus ANSM : « MILLEPERTUIS + SIMVASTATINE », *Association déconseillée* |
| 55 | metformine alcool | interactions ; thésaurus ANSM : « ALCOOL (BOISSON OU EXCIPIENT) + METFORMINE », *Association déconseillée*, « Eviter la prise de boissons alcoolisées… » |

## Posologie

| # | Question | Référence | Rub. | Attendu |
|---|---|---|---|---|
| 13 | poso macrogol | Forlax 10 g | 4.2 | « La posologie est de 1 à 2 sachets par jour (10 à 20 g)… le matin. » |
| 14 | dose max paracétamol adulte | Doliprane 1000 mg, comprimé | 4.2 | « … 3000 mg par jour… » (tableau) |
| 15 | amoxicilline enfant 20 kg posologie | Clamoxyl 250 mg/5 ml | 4.2 | « Enfants < 40 kg … 20 à 90 mg/kg/jour en plusieurs prises » |
| 16 | méthotrexate une fois par semaine ? | Imeth 10 mg | 4.2 | « … doit être utilisé une fois par semaine seulement » |
| 17 | Lévothyrox à jeun ? | Lévothyrox 100 µg | 4.2 | « … en une seule prise le matin à jeun une demi-heure avant le petit-déjeuner » |
| 18 | Doliprane 1000 combien par jour | Doliprane 1000 mg, comprimé | 4.2 | « 1000 mg… 4 heures minimum, 3000 mg par jour » |

## Rein, foie

| # | Question | Référence | Rub. | Attendu |
|---|---|---|---|---|
| 19 | metformine insuffisance rénale | Glucophage 1000 mg | 4.2 | « < 30 – La metformine est contre-indiquée. » |
| 20 | Xarelto insuffisance rénale | Xarelto 20 mg | 4.2 | « … clairance de la créatinine de 30 à 49 ml/min… » ; « non recommandée… < 15 ml/min » |
| 21 | paracétamol insuffisance hépatique | Doliprane 1000 mg, comprimé | 4.2 | « … ne doit pas dépasser 60 mg/kg/jour ni excéder 3000 mg par jour… » (populations spéciales) |
| 22 | allopurinol et rein | Zyloric 100 mg | 4.2 | « Il est recommandé avant la prescription de rechercher une insuffisance rénale… » |

## Sécabilité, écraser, ouvrir

| # | Question | Référence | Rub. | Attendu |
|---|---|---|---|---|
| 23 | Sécabilité du doliprane 1000 mg en comprimés ? | Doliprane 1000 mg et ses formes | 3 | comprimé : « Comprimé. » *ne mentionne pas* ; effervescent : « sécable » |
| 24 | Lévothyrox sécable ? | Lévothyrox 100 µg | 3 | « Comprimé sécable. » |
| 25 | couper le Coversyl 5 ? | Coversyl 5 mg | 3 | « Comprimé pelliculé sécable. » |
| 26 | Xeloda couper | Xeloda 500 mg | 4.2 | « Les comprimés de Xeloda ne doivent pas être écrasés ni coupés. » |
| 27 | peut-on écraser le Seroplex ? | Seroplex et ses formes | 4.2 | *ne mentionne pas* « écraser » |
| 28 | Inexium sonde gastrique | Inexium 20 mg | 4.2 | « … les comprimés peuvent être dispersés dans de l'eau non gazeuse et administrés par sonde gastrique. » |
| 29 | oxycodone LP écraser | Oxycodone EG LP 5 mg | 4.2 | « OXYCODONE EG LP doit être avalé entier, sans être mâché, divisé ou écrasé. » |
| 30 | Mopral ouvrir la gélule | Mopral 20 mg | 4.2 | « Les patients peuvent ouvrir les gélules et avaler le contenu… » |

## Conduite

| # | Question | Référence | Rub. | Attendu |
|---|---|---|---|---|
| 31 | Lévothyrox conduite | Lévothyrox 100 µg | 4.7 | « Sans objet. » (*entière*) |
| 32 | méthadone conduire | Méthadone AP-HP 20 mg | 4.7 | « La méthadone a une influence majeure sur la capacité à conduire… » |
| 33 | zolpidem et voiture le lendemain | Stilnox 10 mg | 4.7 | « Prévenir les conducteurs… du risque possible de somnolence… » |

## Conservation

| # | Question | Référence | Rub. | Attendu |
|---|---|---|---|---|
| 34 | Lantus après ouverture | Lantus 100 U/ml, flacon | 6.3 | « … jusqu'à 4 semaines au maximum, à une température ne dépassant pas 25 °C… » |
| 35 | Clamoxyl sirop reconstitué combien de temps | Clamoxyl 250 mg/5 ml | 6.3 | « Suspension reconstituée : 14 jours. » |
| 36 | Xalatan après ouverture | Xalatan collyre | 6.3 | « Après la première ouverture du flacon : 4 semaines. » |
| 37 | Lantus au frigo ? | Lantus 100 U/ml, flacon | 6.4 | « A conserver au réfrigérateur (entre 2 °C et 8 °C). » |

## Surdosage

| # | Question | Référence | Rub. | Attendu |
|---|---|---|---|---|
| 38 | surdosage paracétamol que faire | Doliprane 1000 mg, comprimé | 4.9 | « … l'antidote N-acétylcystéine par voie I.V. ou voie orale si possible avant la dixième heure. » |
| 39 | surdosage Previscan | Previscan 20 mg | 4.9 | « INR < 4 : pas de saut de prise, pas de vitamine K… » |

## Excipients

| # | Question | Référence | Rub. | Attendu |
|---|---|---|---|---|
| 40 | Xarelto lactose ? | Xarelto 20 mg | 6.1 | « Lactose monohydraté » |
| 41 | Doliprane sans lactose | Doliprane 1000 mg | — | Alternatives filtrées sans lactose |
| 42 | Spasfon gluten | Spasfon, comprimé enrobé | 2 | « … 23,77 mg d'amidon de blé… » |

## Effets indésirables, mises en garde

| # | Question | Référence | Rub. | Attendu |
|---|---|---|---|---|
| 43 | effets indésirables prégabaline | Lyrica 75 mg | 4.8 | « … les plus fréquemment rapportés ont été les étourdissements et la somnolence. » |
| 44 | amiodarone thyroïde | Cordarone 200 mg | 4.4 | « Manifestations thyroïdiennes… » |
| 45 | dompéridone QT | Dompéridone Teva 10 mg | 4.4 | « La dompéridone a été associée à un allongement de l'intervalle QT… » |

## Contre-indications

| # | Question | Référence | Rub. | Attendu |
|---|---|---|---|---|
| 46 | Kardégic ulcère contre-indiqué ? | Kardégic 75 mg | 4.3 | « Ulcère gastroduodénal en évolution… » |
| 47 | colchicine contre-indications | Colchimax | 4.3 | « insuffisance rénale sévère (clairance de la créatinine < 30 ml/min)… association avec un macrolide (sauf spiramycine) » |
| 48 | codéine enfant moins de 12 ans | Codoliprane 500 mg/30 mg | 4.3 | « Enfant de moins de 12 ans. » |

## Abréviations du comptoir

| # | Question | Référence | Rub. | Attendu |
|---|---|---|---|---|
| 49 | CI ibuprofène | Advil 200 mg | 4.3 | la rubrique 4.3 |
| 50 | EI amiodarone | Cordarone 200 mg | 4.8 | la rubrique 4.8 |
| 51 | zolpidem délai d'action | Stilnox 10 mg | 5.2 | « … concentration plasmatique maximale atteinte en 0,5 à 3 heures. » |

## À trancher à la relecture

- **Référence** : quand la question nomme une molécule (tramadol, ibuprofène), j'ai pris le princeps commercialisé. La page pourra montrer d'autres spécialités ; le banc vérifiera seulement que la phrase attendue y figure.
- **#14 et #18** : le RCP du Doliprane donne 3 g par jour au tableau, et jusqu'à 4 g dans certains cas. Laquelle est « la » réponse attendue ?
- **#52** : le thésaurus de l'ANSM n'a pas d'entrée pour ce couple (il en a une pour la simvastatine, #54) ; la page le dit, et cite les RCP de l'atorvastatine, qui nomment le millepertuis parmi les inducteurs, sans niveau.
- **#10** : l'association tramadol–sertraline est rendue *À prendre en compte* d'après les RCP. À confirmer avec ce que tu attends au comptoir.
