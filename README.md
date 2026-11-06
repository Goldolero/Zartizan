# Zartizan 🏠

**Les artisans péi, ensemble.** Une appli installable sur téléphone (Android et iPhone) pour un collectif d'artisans du bâtiment à La Réunion :

- 📋 **Demandes clients** : saisie rapide, attribution et suivi (nouvelle → attribuée → devis → planifiée → terminée), urgences en premier
- ↔ **Recommandation entre collègues** : on confie une demande ou on crée un nouveau besoin pour un collègue (ex. fuite repérée pendant un entretien de chauffe-eau)
- 📅 **Planning partagé** sur 3 semaines, avec une couleur par artisan
- 🔔 **Rappels d'entretien** automatiques (ex. chauffe-eau tous les 12 mois)
- 👥 **Équipe et statistiques** : interventions, clients échangés, montants facturés
- 📞 Appel, WhatsApp et itinéraire en un clic, mises à jour en temps réel entre les téléphones

Côté technique : une application web installable (PWA) en HTML/JS, sans étape de compilation. Les données sont dans [Supabase](https://supabase.com) (base Postgres gratuite) et l'hébergement sur GitHub Pages (gratuit).

---

## Mise en route (environ 20 minutes)

### 1. Créer la base de données (Supabase)
1. Crée un compte sur https://supabase.com, puis **New project** (choisis une région en Europe, Paris ou Frankfurt, pour le RGPD).
2. Va dans **SQL Editor → New query** et colle le contenu de `schema.sql`.
3. **Avant d'exécuter**, remplace à la dernière ligne `TON-EMAIL@exemple.com` par ton email (et ton nom si besoin), puis clique **Run**.
4. Va dans **Project Settings → API** et copie :
   - `Project URL`
   - la clé `anon public`
5. Colle-les dans `config.js`.

### 2. Mettre en ligne (GitHub Pages)
1. Crée un dépôt `zartizan` sur GitHub, puis pousse ce dossier :
   ```bash
   git remote add origin https://github.com/TON-COMPTE/zartizan.git
   git push -u origin main
   ```
2. Dans le dépôt : **Settings → Pages → Source : Deploy from a branch → main / (root)**.
3. L'appli sera en ligne à l'adresse `https://TON-COMPTE.github.io/zartizan/`.

### 3. Régler la connexion (Supabase → Authentication)
- **URL Configuration → Site URL** : mets l'adresse GitHub Pages ci-dessus (et ajoute-la aussi dans *Redirect URLs*).
- Recommandé pour démarrer : **Providers → Email → désactive « Confirm email »**. La sécurité reste assurée : seuls les emails ajoutés dans l'onglet *Équipe* voient les données.

### 4. Installer sur le téléphone
- **Android (Chrome)** : ouvre l'adresse, puis bouton **📲 Installer** dans l'appli ou menu ⋮ → *Installer l'application*.
- **iPhone (Safari)** : ouvre l'adresse, puis bouton Partager → **Sur l'écran d'accueil**.

### 5. Ajouter les artisans
1. Connecte-toi : la première fois, utilise **« Première connexion ? Créer mon mot de passe »** avec l'email mis dans le SQL.
2. Onglet **Équipe** → ajoute le plombier et l'électricien avec leur email.
3. Envoie-leur le lien : ils créent leur mot de passe avec le même bouton et ont accès directement.

---

## Structure

```
index.html            page de l'appli
app.js                logique (vues, fiche demande, recommandations, rappels)
app.css               styles
config.js             clés Supabase (URL + clé anon publique)
manifest.webmanifest  nom, icônes, couleurs (installation)
sw.js                 service worker (installable, démarrage hors ligne)
icon-*.png            icônes de l'appli
schema.sql            tables, sécurité (RLS) et temps réel
```

## Mettre à jour l'appli
Modifie les fichiers, **change `VERSION` dans `sw.js`** (ex. `zartizan-v2`), puis `git push`. Les téléphones récupèrent la nouvelle version à la prochaine ouverture.

## Sécurité et données
- La clé `anon` est faite pour être publique. Les données sont protégées par les règles RLS de `schema.sql` : il faut être connecté **et** que son email soit dans la table `artisans`.
- Retirer un artisan dans l'onglet *Équipe* lui coupe immédiatement l'accès.
- Ce sont des données clients (noms, téléphones, adresses) : avant d'ouvrir l'appli au public, prévoir une page de mentions légales et de confidentialité (RGPD).

## Prochaines étapes envisagées
- Formulaire public de demande (côté clients) qui arrive directement dans « Nouvelles »
- Notifications push quand une demande vous est attribuée
- Photos jointes aux demandes (Supabase Storage)
- Export des interventions pour la facturation
