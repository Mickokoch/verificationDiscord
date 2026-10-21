# Bot de vérification étudiante

Un membre du serveur Discord prouve qu'il possède une adresse de l'université (un ou plusieurs domaines, par ex. `@truc.fr`) en recevant un code par mail. S'il saisit le bon code, il obtient le rôle « Étudiant vérifié ». Une adresse ne peut vérifier qu'un seul compte à la fois.

## Commandes

| Commande | Qui | Effet |
|---|---|---|
| `/verify` | Tout le monde | Ouvre un formulaire pour l'adresse et envoie un code à 6 chiffres. Le bouton « Entrer le code » ouvre ensuite un second formulaire, et le rôle est attribué si le code est bon. |
| `/unlink` | Membres vérifiés | Après confirmation, supprime la vérification et retire le rôle. |
| `/forget membre:@x` | Admins (permission « Gérer les rôles ») | Supprime la vérification d'un membre, lui retire le rôle et libère son adresse. Sert à débloquer les cas particuliers. |

Comportements automatiques :
- **Même adresse sur un nouveau compte** : le nouveau compte obtient le rôle et l'ancien le perd. Ça couvre les comptes perdus ou changés, et empêche de prêter son adresse.
- **Départ du serveur** : la vérification est supprimée. Si le bot était éteint au moment du départ, la ligne reste, mais le transfert automatique règle le cas si la personne revient.

Toutes les réponses du bot ne sont visibles que par l'utilisateur concerné. Les adresses ne passent jamais par les messages privés ni par un salon.

## Données et vie privée

- La base SQLite contient **une seule table** : `HMAC(id Discord) → HMAC(adresse)`, sans date, sans pseudo, sans aucune donnée en clair.
- La clé HMAC (`HMAC_SECRET`) est dans le `.env`, jamais dans la base. **Une base volée sans la clé est inutilisable.** En revanche, quelqu'un qui détient à la fois la base et la clé peut retrouver quelle adresse correspond à quel compte, en testant les adresses de la promo.
- Avant le calcul de l'empreinte, les adresses sont passées en minuscules. `prenom.nom+1@truc.fr` est donc considérée comme une adresse différente : c'est un risque accepté.
- Plusieurs domaines peuvent être acceptés (`ALLOWED_DOMAINS=truc.fr,etu.truc.fr`), en correspondance exacte : un sous-domaine qui n'est pas dans la liste est refusé. Si une même personne a une adresse sur chaque domaine (`jean@truc.fr` et `jean@etu.truc.fr`), ce sont deux adresses différentes pour le bot : c'est un risque accepté, comme pour les alias.
- Le code et l'empreinte de l'adresse en attente restent **en mémoire uniquement**, et sont effacés à l'expiration du code (10 minutes).
- Ni les logs ni le salon de logs ne contiennent d'adresse. Les erreurs d'envoi sont journalisées avec leur seul code d'erreur.
- Les messages du bot dans le salon de logs sont **supprimés au bout de 30 jours** (`LOG_RETENTION_DAYS`). Ceux des modérateurs ne sont pas touchés.
- **Le compte Gmail est purgé** juste après chaque envoi, puis toutes les heures. Sont supprimés les mails **envoyés depuis ce compte** (y compris les réponses écrites depuis Gmail), les **mails d'erreur** (mailer-daemon, postmaster) et la **corbeille**. Les **mails reçus sont conservés**, car l'adresse du bot sert aussi de contact RGPD : pense à consulter sa boîte de réception.

### Texte d'information à épingler dans le salon de vérification

> **Vérification étudiante — tes données**
> Pour obtenir le rôle, tape `/verify` et indique ton adresse universitaire : un code t'est envoyé par mail.
> **Ce qui est conservé :** une empreinte cryptographique (HMAC) de ton adresse, associée à une empreinte de ton identifiant Discord. Ton adresse elle-même n'est pas stockée, et le mail envoyé est supprimé de notre boîte aussitôt après l'envoi. Le salon de logs des modérateurs indique qui s'est vérifié (sans adresse) ; ces messages sont supprimés au bout de 30 jours.
> **Pourquoi :** s'assurer qu'une adresse ne vérifie qu'un seul compte.
> **Qui peut y accéder :** seul l'administrateur du bot, qui détient la clé, pourrait techniquement retrouver à quel compte correspond une adresse.
> **Suppression :** tape `/unlink` à tout moment. Tes données sont aussi supprimées automatiquement si tu quittes le serveur.
> **Contact :** l'adresse qui t'a envoyé le code.

## Installation

### 1. Application Discord

1. Sur <https://discord.com/developers/applications>, crée une application, puis un bot. Copie son token dans `DISCORD_TOKEN`.
2. Dans l'onglet **Bot**, active **Server Members Intent**. Le bot en a besoin pour détecter les départs et retrouver l'ancien compte lors d'un transfert.
3. Dans **OAuth2 → URL Generator**, coche les scopes `bot` et `applications.commands`, et les permissions **Gérer les rôles**, **Voir les salons**, **Envoyer des messages** et **Lire l'historique des messages** (nombre de permissions : `268504064`). Le bot a besoin de lire l'historique pour supprimer ses anciens messages du salon de logs. Ouvre l'URL générée pour inviter le bot sur le serveur.
4. Dans les paramètres du serveur, section **Rôles**, place le rôle du bot **au-dessus** du rôle « Étudiant vérifié ». Le bot affiche un avertissement au démarrage si ce n'est pas le cas.
5. Active le mode développeur dans Discord (Paramètres → Avancés), puis copie par clic droit les identifiants du serveur, du rôle et du salon de logs.

### 2. Compte Gmail

1. Crée un **compte Gmail réservé au bot** : tout ce qu'il envoie sera supprimé. Ce compte sert aussi d'adresse de contact, donc consulte régulièrement sa boîte de réception.
2. Active la **validation en deux étapes**, puis crée un **mot de passe d'application** sur <https://myaccount.google.com/apppasswords>. Mets-le dans `GMAIL_APP_PASSWORD`.
3. Dans Gmail, ouvre Paramètres → Transfert et POP/IMAP :
   - **Accès IMAP** : activé
   - **Lorsqu'un message est marqué comme supprimé et retiré du dernier dossier IMAP visible** : *Supprimer définitivement le message immédiatement*
4. **Teste la délivrabilité tôt** : vérifie que le code arrive bien sur une adresse de **chaque** domaine accepté et qu'il ne part pas en spam.

### 3. Déploiement

Toute la configuration Docker (volume, redémarrage, logs, variables) est dans [docker-compose.yml](docker-compose.yml). La base est stockée dans le volume nommé `verification-data`, qui est conservé entre les redéploiements.

**Sur Coolify**
1. New Resource → Private Repository, puis choisis le dépôt.
2. **Build Pack : Docker Compose**. Docker Compose Location : `/docker-compose.yml`.
3. Dans **Environment Variables**, Coolify affiche les variables lues dans le compose. Les variables marquées comme requises doivent être remplies (voir [.env.example](.env.example)).
4. Ne mets **aucun domaine** : le bot n'a pas de serveur web.
5. Clique sur **Deploy**. Les logs doivent afficher « Connecté en tant que … ».

**En local ou sur un serveur sans Coolify**
```bash
cp .env.example .env
openssl rand -hex 32          # à copier dans HMAC_SECRET (et dans ton gestionnaire de mots de passe)
nano .env                     # remplir le reste
docker compose up -d --build
docker compose logs -f        # doit afficher « Connecté en tant que … »
```

Les commandes slash sont enregistrées automatiquement au démarrage.

## Sauvegardes

- **La clé `HMAC_SECRET`** : sauvegardée une seule fois dans un gestionnaire de mots de passe. **Jamais au même endroit que la base.**
- **La base** : une copie quotidienne vers une autre machine. Sur l'hôte, une tâche cron fait une copie cohérente dans le volume, puis l'envoie ailleurs. `docker ps` donne le nom du conteneur, et `docker volume ls | grep verification-data` celui du volume (Coolify y ajoute un préfixe).

```cron
0 4 * * * docker exec <conteneur> node -e "new (require('better-sqlite3'))('/data/verification.sqlite').backup('/data/backup.sqlite')" && rsync -a /var/lib/docker/volumes/<volume>/_data/backup.sqlite autre-machine:sauvegardes/verification.sqlite
```

Si la clé est perdue, il faut tout réinitialiser : supprimer `/data/verification.sqlite` dans le volume et générer une nouvelle clé. Les rôles déjà attribués restent en place, mais toutes les adresses redeviennent libres.

## Développement

```bash
npm ci --ignore-scripts
npm test          # compile puis lance les tests (node:test)
npm run build && node --env-file=.env dist/index.js
```

Organisation du code :

| Fichier | Rôle |
|---|---|
| `src/index.ts` | Assemble les modules, lance les tâches périodiques (purge, nettoyage) |
| `src/bot.ts` | Partie Discord : commandes, formulaires, boutons, départs |
| `src/verification.ts` | Logique de vérification : quotas, codes, transfert. Indépendante de Discord et testée. |
| `src/store.ts` | Base SQLite (`links`) |
| `src/crypto.ts` | HMAC, normalisation des adresses, codes |
| `src/mailer.ts` | Envoi par SMTP Gmail et purge IMAP |
| `src/config.ts` | Lecture et validation du `.env` |

## Maintenance

- Les versions des dépendances sont **figées** (`package-lock.json`), donc rien ne change sans action de ta part. Pour mettre à jour : `npm outdated`, puis une version à la fois, `npm test`, et un test réel sur le serveur.
- discord.js v14 est la version stable actuelle. C'est Discord qui retire ses anciennes API, donc il faudra probablement migrer vers une nouvelle version majeure tous les 2 ou 3 ans.
- L'image Docker utilise Node 24 (LTS). Il faudra changer `node:24-slim` dans le `Dockerfile` quand cette version arrivera en fin de support (avril 2028).

## Licence

[0BSD](LICENSE) : libre de toute utilisation (copie, modification, usage commercial…), sans obligation de citer l'auteur. Fourni tel quel, sans garantie.
