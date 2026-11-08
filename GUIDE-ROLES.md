# Modifier les rôles au choix

Ce guide explique comment ajouter, retirer ou réorganiser les rôles que les membres choisissent avec le bouton **« Choisir mes rôles »** (niveau, domaines d'études, etc.). Aucune connaissance en programmation n'est nécessaire : tout se fait depuis Discord et depuis le site de GitHub.

## Comment ça marche

La liste des rôles proposés est écrite dans un seul fichier : [`roles.json`](roles.json). Ce fichier ne contient pas les noms des rôles, seulement leurs **identifiants** (un long nombre propre à chaque rôle).

- Le **nom** et la **couleur** d'un rôle se règlent sur Discord, comme d'habitude. Le menu du bot les reprend automatiquement.
- Les **salons** auxquels un rôle donne accès se règlent aussi sur Discord.
- Le fichier `roles.json` sert uniquement à dire **quels rôles apparaissent dans le menu, et dans quel groupe**.

Le bot ne crée et ne supprime jamais de rôle : il donne ou retire des rôles qui existent déjà.

### Ce qui ne demande aucune modification du fichier

| Vous voulez… | Où le faire |
|---|---|
| Renommer un rôle, changer sa couleur | Discord : Paramètres du serveur → Rôles |
| Changer les salons accessibles avec un rôle | Discord : permissions du salon ou de la catégorie |
| Supprimer définitivement un rôle pour tout le monde | Discord : supprimez le rôle (pensez ensuite à le retirer du fichier) |

Pour tout le reste (ajouter un rôle au menu, en retirer un, créer un groupe…), il faut modifier `roles.json`.

---

## Étape 1 : préparer le rôle sur Discord

1. **Créez le rôle** (ou utilisez un rôle existant) dans Paramètres du serveur → Rôles.
2. **Placez-le sous le rôle du bot** dans la liste des rôles (faites-le glisser). Sinon le bot n'aura pas le droit de le donner.
3. **Réglez les salons** : dans les permissions du salon ou de la catégorie, `@everyone` ne doit pas avoir « Voir le salon », et le nouveau rôle doit l'avoir.
4. **Ne l'ajoutez pas à l'onboarding** de Discord. Le bot retire automatiquement ces rôles aux personnes non vérifiées.

## Étape 2 : copier l'identifiant du rôle

1. Activez le **mode développeur** de Discord (une seule fois) : Paramètres utilisateur → Avancés → Mode développeur.
2. Paramètres du serveur → Rôles → **clic droit sur le rôle** → **Copier l'identifiant du rôle**.

Vous obtenez un nombre comme `1561686532400742523`. Gardez-le de côté.

## Étape 3 : modifier le fichier sur GitHub

1. Ouvrez le dépôt sur GitHub, puis cliquez sur le fichier **`roles.json`**.
2. Cliquez sur l'icône **crayon** (« Edit this file ») en haut à droite du fichier.
3. Faites votre modification (voir les exemples plus bas).
4. Cliquez sur **Commit changes…** en haut à droite, écrivez une courte description (« Ajout du rôle Biologie »), puis confirmez avec **Commit changes**.

Il vous faut un accès en écriture au dépôt. Si vous n'avez pas le bouton crayon, demandez à la personne qui gère le dépôt.

## Étape 4 : appliquer la modification

Le bot doit être redéployé pour lire le nouveau fichier.

- Si le **déploiement automatique** est activé sur Coolify, il démarre tout seul quelques secondes après l'enregistrement.
- Sinon, ouvrez l'application dans Coolify et cliquez sur **Redeploy**.

Le message « Choisir mes rôles » se met à jour tout seul, il n'y a rien à republier.

## Étape 5 : vérifier

Sur Discord, tapez **`/roles-config`** (commande réservée aux admins). Le bot affiche les groupes, les rôles et un éventuel problème, par exemple un rôle placé au-dessus du bot. Vous devez voir « ✅ Aucun problème détecté ».

---

## Lire le fichier

Voici à quoi ressemble un groupe :

```json
  {
    "label": "Ton niveau",
    "max": 1,
    "roles": ["1561686292591284234", "1561686407645372417"]
  },
```

| Ligne | Signification |
|---|---|
| `"label"` | Le titre du groupe, affiché aux membres. Vous pouvez le changer librement. |
| `"max"` | Le nombre de rôles qu'on peut choisir dans ce groupe. `1` = un seul choix (par exemple un seul niveau). Si la ligne est absente, on peut tout cocher. |
| `"roles"` | La liste des identifiants, entre crochets `[ ]`. L'ordre de la liste est l'ordre d'affichage dans le menu. |

Un rôle peut aussi avoir un petit texte d'explication sous son nom dans le menu :

```json
    "roles": [{ "id": "1568175428600864889", "description": "Salons jeux et jeux vidéo" }]
```

## Exemples de modifications

### Ajouter un rôle dans un groupe

Ajoutez l'identifiant à la fin de la liste, **précédé d'une virgule** :

Avant :
```json
    "roles": ["1561687017480261692", "1561691414268485723"]
```
Après :
```json
    "roles": ["1561687017480261692", "1561691414268485723", "1570000000000000000"]
```

### Retirer un rôle du menu

Supprimez l'identifiant **et la virgule qui le sépare du précédent** :

Avant :
```json
    "roles": ["1561687017480261692", "1561691414268485723", "1570000000000000000"]
```
Après :
```json
    "roles": ["1561687017480261692", "1561691414268485723"]
```

Les membres qui avaient ce rôle **le gardent** : le bot ne s'en occupe simplement plus. Pour le retirer à tout le monde, supprimez le rôle sur Discord.

### Ajouter un groupe

Copiez un groupe entier, de `{` à `}`, et collez-le après le dernier. **Ajoutez une virgule** après le `}` du groupe précédent :

```json
  {
    "label": "Salons supplémentaires",
    "roles": [{ "id": "1568175428600864889", "description": "Salons jeux et jeux vidéo" }]
  },
  {
    "label": "Associations",
    "roles": ["1570000000000000001", "1570000000000000002"]
  }
]
```

### Changer l'ordre des groupes

Déplacez un groupe entier (de `{` à `}`). Vérifiez ensuite les virgules : il en faut une **entre** chaque groupe, et **aucune** après le dernier.

## Limites

- **5 groupes** au maximum.
- **25 rôles** au maximum par groupe.
- Un même rôle ne peut apparaître que dans un seul groupe.
- Le rôle « membre vérifié » ne doit pas figurer dans le fichier.

## Les erreurs fréquentes

Le format du fichier est strict. Les erreurs les plus courantes :

| Erreur | Exemple incorrect | Correct |
|---|---|---|
| Virgule oubliée entre deux éléments | `["111" "222"]` | `["111", "222"]` |
| Virgule en trop après le dernier élément | `["111", "222",]` | `["111", "222"]` |
| Guillemets oubliés autour de l'identifiant | `[1561686292591284234]` | `["1561686292591284234"]` |
| Guillemets « typographiques » (copiés depuis Word, etc.) | `[“111”]` | `["111"]` |
| Crochet ou accolade non refermé | `"roles": ["111", "222"` | `"roles": ["111", "222"]` |

En cas de doute, collez le contenu du fichier sur un site comme [jsonlint.com](https://jsonlint.com) : il indique la ligne qui pose problème.

## Si le bot ne redémarre plus

Une erreur dans `roles.json` **empêche le bot de démarrer**, pour éviter de proposer un menu cassé. Les membres ne peuvent alors plus se vérifier, donc il faut corriger rapidement.

1. Dans Coolify, ouvrez l'application, puis l'onglet **Logs**. Une ligne commençant par `roles.json :` explique le problème, par exemple :
   ```
   roles.json : groupe n°2 : « 15616865 » n'est pas un identifiant de rôle
   ```
2. Corrigez le fichier sur GitHub (étape 3), puis redéployez.
3. Si vous ne trouvez pas : sur GitHub, ouvrez `roles.json`, cliquez sur **History**, ouvrez la dernière version qui fonctionnait, et recopiez son contenu.

Les messages d'avertissement qui commencent par `⚠️ roles.json` (rôle supprimé, rôle placé au-dessus du bot) n'empêchent pas le bot de fonctionner. Corrigez-les quand même sur Discord, puis vérifiez avec `/roles-config`.
