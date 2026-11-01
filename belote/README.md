# Belote en ligne

Jeu de belote à 4 joueurs (2 équipes de 2 partenaires face à face), jouable avec vos amis depuis un navigateur (ordinateur ou téléphone). Des robots peuvent compléter la table.

**Aucune dépendance** : il suffit d'avoir [Node.js](https://nodejs.org) 18 ou plus.

## Lancer le jeu

```bash
node server.js
```

Ouvrez ensuite http://localhost:3000. Le terminal affiche aussi l'adresse réseau (ex. `http://192.168.1.20:3000`) : vos amis connectés au même Wi-Fi peuvent l'utiliser directement.

1. L'un de vous clique sur **Créer une table** et reçoit un code à 4 lettres.
2. Les autres ouvrent le même site, saisissent le code (ou ouvrent le lien copié) et cliquent sur **Rejoindre**.
3. Chacun peut cliquer sur **S'asseoir ici** pour choisir sa place : les sièges face à face sont partenaires.
4. L'hôte complète avec des robots si besoin, choisit l'objectif (301 / 501 / 701 / 1000) et lance la partie.

Si quelqu'un recharge la page, il retrouve sa place automatiquement.

## Jouer avec des amis à distance (Internet)

- **Le plus rapide** : lancez `node server.js`, puis dans un autre terminal un tunnel, par exemple
  `npx cloudflared tunnel --url http://localhost:3000` (ou `ngrok http 3000`). Envoyez l'adresse obtenue à vos amis.
- **En permanence** : déployez le dossier sur un hébergeur Node.js (Render, Railway, Fly.io…). Commande de démarrage : `node server.js` (le port est lu dans la variable `PORT`).

Les tables sont conservées en mémoire : un redémarrage du serveur les efface.

## Règles implémentées

- 32 cartes, 4 joueurs, sens inverse des aiguilles d'une montre. Distribution : 5 cartes chacun + retourne.
- **Enchères** : 1er tour, chacun peut prendre la couleur de la retourne (le preneur reçoit la retourne, tout le monde a 8 cartes). 2e tour, on peut choisir une autre couleur. Si personne ne prend, nouvelle donne.
- **Valeurs** : à l'atout V 20 > 9 14 > A 11 > 10 > R 4 > D 3 > 8 > 7 ; hors atout A 11 > 10 > R 4 > D 3 > V 2 > 9 > 8 > 7.
- **Jeu des 8 plis** : fournir la couleur ; sinon couper (et surcouper si possible) ; à l'atout il faut monter. Si le partenaire est maître, on peut se défausser librement (règle officielle).
- **Belote-rebelote** : Roi + Dame d'atout, +20 points, annoncés automatiquement.
- **Dix de der** : +10 pour le dernier pli (152 points de cartes + 10 = 162 par donne).
- **Contrat** : le camp preneur doit faire **au moins 82 points sans compter la belote**. Sinon il est « dedans » : 0 point, la défense marque 162.
- **Capot** : 8 plis pour la même équipe = 252 points.
- La belote reste toujours acquise à l'équipe qui la détient, même si elle est dedans.
- Fin de partie : la première équipe qui atteint l'objectif à la fin d'une donne gagne.

## Fichiers

| Fichier | Rôle |
|---|---|
| `game.js` | Règles du jeu et robots (testable seul) |
| `server.js` | Serveur HTTP, tables, temps réel (Server-Sent Events) |
| `public/index.html` | Interface (accueil, salle d'attente, table de jeu) |
| `test.js` | Tests : `node test.js` (300 parties simulées) |

## Ajuster

- Robots plus ou moins audacieux : `THRESH1` / `THRESH2` dans `game.js`.
- Vitesse des robots et du ramassage des plis : délais dans `schedule()` de `server.js`.
