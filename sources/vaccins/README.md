# Sources vaccins

Calendrier des vaccinations et recommandations vaccinales du ministère chargé de
la santé, conservé tel que téléchargé : `data/calendrier-vaccinal.json` en est
une transcription manuelle (tableaux synoptiques), et chaque entrée renvoie à
sa page.

**Déposer ici le PDF sous son nom d'origine**, qui porte la version, par exemple
`2026_07_calendrier_vaccinal-2026_a4_93p_v11.pdf`. Le télécharger dans le
navigateur : sante.gouv.fr oppose un défi anti-robot aux scripts.

**Veille** : `npm run veille-vaccins` lit https://www.sante.fr/le-calendrier-des-vaccinations
et compare l'adresse publiée à `source.url` du JSON. Quand le PDF est déposé, le
script calcule son empreinte et extrait le texte (`.txt` à côté) pour comparer
deux versions.

Après relecture : reporter `url` et `sha256` dans `source` du JSON.
