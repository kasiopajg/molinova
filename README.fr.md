# Molinova

[English](README.md) · Français

Molinova est un assistant personnel et familial pour macOS. Il trie tes boîtes Gmail avec l'IA : il
range chaque email dans tes catégories et repère ce qui attend une réponse, un paiement ou une date.
À partir de là, il tient un agenda familial et une liste de tâches. Il peut aussi lire des groupes
WhatsApp en local, par WhatsApp Desktop sur le même Mac (Molinova n'ajoute aucun appareil lié), et
échanger avec ta famille par un bot Telegram privé. Molinova tourne sur ton Mac : tes données et tes
accès Google y restent. Il n'y a ni serveur Molinova sur Internet ni compte Molinova (Molinova fait seulement
tourner un petit serveur sur ton Mac pour sa fenêtre). Les appels à l'IA passent par **ta propre**
clé Vercel AI Gateway (le service qui relaie les demandes vers les modèles d'IA), sans conservation
des données (zero data retention) : rien n'est gardé ni utilisé pour entraîner un modèle.

Molinova est open source (MIT), en version 0.1.0. Il fonctionne sur les Mac à puce Apple, en français,
en anglais ou en espagnol.

## Ce qu'il fait

### Les écrans

- **Accueil** : ce que Molinova fait tout seul, canal par canal (veille Gmail, lecture WhatsApp, bot
  Telegram, relances), avec l'heure du dernier et du prochain passage ; ce qui t'attend pour que
  tout tourne (rattrapage de l'historique, boîte à reconnecter, bot arrêté…) ; ce que chaque canal
  fait remonter (à traiter, à caler, tâches) ; et le fil de ce qui s'est passé.
- **Actions** : une seule file pour tout ce qui t'attend, en groupes Traiter, Répondre, Relancer,
  Payer, Agenda, Tâche et À lire. Un email sort de la file dès que tu y as répondu, ou que
  tu l'as lu, archivé ou ignoré. Tu y trouves aussi des actions en lot, des règles « Plus jamais ces
  expéditeurs » et un nettoyage du bruit en un clic (archivé, jamais supprimé). L'importance suit le
  temps : un email de plus de 3 jours n'est plus *Urgent*, au-delà de 14 jours il est au plus
  *Normal*. Un email dont la portée était limitée dans le temps (offre, invitation, alerte,
  livraison…) devient *Obsolète* une fois ce délai passé : il sort de la file, et le filtre
  *Obsolète* les archive tous en un clic.
- **Boîte**, avec trois dossiers dans le menu de gauche : *Reçus* (là où la Boîte s'ouvre),
  *Envoyés* et *Brouillons* (lus chez Gmail à l'ouverture, ils se terminent dans Gmail). Des filtres (date : 24 h, 7 jours, 30 jours ou une période
  choisie au calendrier, comme dans Actions ; non lus, à répondre, à relancer, à payer, agenda,
  bruit…), la recherche, la lecture, la réponse et le transfert (avec pièces jointes depuis le Mac,
  25 Mo au total). L'IA prépare des réponses
  (« Rédiger avec l'IA ») que tu envoies ou gardes dans tes brouillons Gmail, et elle extrait un
  événement d'un email. Raccourcis clavier : J / K pour naviguer, R répondre, F transférer,
  E archiver, A agenda, 1–9 corriger la catégorie.
- **Agenda** : la semaine, un couloir par membre du foyer. Les propositions « À caler » viennent des
  emails et de WhatsApp, avec la personne concernée déjà indiquée. Tu y réponds aussi aux
  invitations Google Agenda. Par défaut, les événements vont dans un agenda Google « Famille » (un
  agenda existant dont le nom commence par « Famil… », sinon un agenda que Molinova crée) ; tu peux
  aussi ajouter un événement à ton agenda principal. Les tâches se trouvent dans l'app, sous les
  couloirs. Les propositions ne viennent que des emails des 30 derniers jours, ou ont une
  date encore à venir. *Nettoyer le bruit* fait relire chaque proposition par Jev et ignore les sollicitations
  (promotions, newsletters, appels aux dons), coût montré avant.
- **Documents** : les documents Google Drive des dossiers que tu as inclus, chacun avec sa fiche
  (type, contexte, personnes concernées, validité, échéance, émetteur), des filtres, une recherche
  en langage courant, et un aperçu ou un téléchargement sans quitter Molinova. Tu corriges une fiche en
  un clic ; Molinova ne réécrit jamais une fiche que tu as corrigée.
- **Canaux** : une page par canal, avec son voyant dans le menu.
  - *Telegram* : Molinova dans la poche. Résumé du matin, semaine le dimanche, rappels, et un chat pour
    chercher, caler un événement ou noter une tâche. Tu relies ton téléphone en scannant un QR code.
  - *Gmail* : tes boîtes, leur veille, leur historique, et le moteur de classement : *Aperçu*
    (classe sans toucher à Gmail), *Classer l'historique* (pose les libellés dans Gmail),
    *Surveiller les nouveaux* et *Reclasser* (Jev relit les emails déjà classés d'une période, ou
    d'une catégorie, avec ses questions actuelles ; tes corrections gardent leur catégorie, et le
    coût est montré avant). Dans Actions et la Boîte, *Relancer Jev* fait de même pour les emails
    que tu choisis. Tu y trouves aussi la carte des sujets des emails.
  - *À classer* (sous Gmail) : les emails dont le libellé est incertain. Ce n'est pas du travail à
    faire, donc ils ne sont pas dans Actions. Tu choisis la catégorie, ou tu acceptes les
    propositions en bloc ; tes réponses deviennent des exemples et, si tu veux, des règles par
    domaine.
  - *WhatsApp* : les conversations que Molinova écoute.
  - *Google Drive* : les comptes autorisés à lire leur Drive, le choix des dossiers, et le coût IA
    avant tout lancement.
- **Réglages** :
  - *Connexions* : passerelle, modèles, crédits, comptes Google, WhatsApp, Telegram, options de
    l'app Mac.
  - *Tokens et coûts* : chaque appel à un modèle, par sujet, modèle, source et jour.
  - *Contexte* : famille, écoles, clubs, personnes clés.
  - *Règles* : règles fixes par expéditeur, domaine ou objet (sans IA), seuils de confiance, une
    date de nettoyage (les emails reçus avant sortent d'Actions et des rappels ; rien ne change dans
    Gmail), langue et format des dates.
  - *Taxonomie* : tes catégories, sur deux niveaux, par glisser-déposer.
  - *Questions Jev* : ce qu'on demande au classement pour chaque email.

### Comment un email est classé

Une cascade choisit la catégorie de chaque email et s'arrête au premier niveau sûr de lui :

1. **Règles** : les tiennes, et celles apprises de tes corrections.
2. **Mémoire expéditeur** : le même expéditeur a reçu la même catégorie au moins trois fois.
3. **Jev** (`typesafe-ai/jev`) : une liste fixe de questions à réponses fermées, traitées en un seul
   appel à l'IA, chacune avec un score de confiance. Elles portent sur la catégorie, la réponse
   attendue, la priorité, le spam, l'action requise, l'événement, la tâche, le paiement, la portée
   limitée dans le temps, l'enfant concerné et, pour un email que tu as envoyé, l'attente d'une
   réponse. Jev reçoit la date de l'email et la date du jour.
4. **Toi** : sous le seuil de confiance, l'email attend dans *À classer*.

Une règle ou la mémoire expéditeur ne fixe que la catégorie : Jev reste interrogé sur chaque
email pour les signaux (réponse, paiement, date, tâche, priorité). Seuls y échappent les emails
couverts par une règle « Sans Jev », comme les règles « rien à faire » que crée *Plus jamais ces
expéditeurs* : ceux-là ne passent jamais par l'IA.

Molinova pose des libellés sous le préfixe `AI/` dans Gmail (`AI/Maison/Jardinage` pour une
sous-catégorie) et n'archive rien de lui-même. Renommer ou déplacer une catégorie dans *Taxonomie*
renomme le libellé Gmail, et Molinova propose de reclasser les emails concernés.

Modèles par défaut, réglés dans `config/settings.json` du dossier de données : `typesafe-ai/jev`
pour le classement, `openai/gpt-5.4-mini` pour les brouillons et l'extraction d'événements et de
tâches, `google/gemini-3.1-flash-lite` pour le chat Telegram.

### WhatsApp (facultatif)

- Molinova lit la base que **WhatsApp Desktop** garde sur ce Mac. Il copie ce fichier dans son dossier
  de données et lit la copie en lecture seule. Ce n'est pas un appareil lié : il ne parle jamais aux
  serveurs de WhatsApp, n'envoie rien, et ton numéro n'est pas exposé.
- À la première lecture, macOS demande si Molinova peut accéder aux données d'autres apps : clique sur
  **Autoriser**. Si tu as refusé par erreur, va dans **Réglages Système › Confidentialité et
  sécurité**.
- Seules les conversations que tu coches partent vers l'IA (Molinova parcourt les autres sur ton Mac
  seulement, pour montrer lesquelles parlent de dates). Leur texte part par tranches de quelques
  heures. Photos, messages vocaux et fichiers restent sur le disque ; les légendes et les noms des
  documents ne partent que si tu actives *Légendes des photos et noms des documents*.
  L'identifiant WhatsApp de chaque conversation part aussi : pour une conversation à deux, c'est le
  numéro du contact, qui tient aussi lieu de nom quand le contact n'en a pas d'enregistré.
- Les dates et les choses à faire repérées dans les groupes arrivent dans *Agenda › À caler ·
  WhatsApp* et dans *Actions*.
- Si une mise à jour de WhatsApp change le format de la base, Molinova refuse de la lire et t'explique
  la solution de secours : exporter la discussion depuis ton téléphone.

### Google Drive (facultatif)

- Dans **Canaux › Google Drive**, chaque compte Google peut autoriser Molinova à *lire* son Drive
  (`drive.readonly`). Tu actives une fois Google Drive API dans ton propre projet Google, puis tu
  autorises la lecture ; tes autres droits sont redemandés en même temps, rien n'est perdu.
- **L'index** : toutes les 15 minutes, Molinova lit les noms, les dossiers et les dates de ce qui a
  changé depuis la lecture précédente. L'index vit dans la base locale.
- **Les fiches**, sur la page *Documents*, seulement pour les dossiers que tu inclus, et seulement
  après que tu as vu le coût IA estimé : Molinova télécharge chaque document dans le dossier temporaire
  du système, lit son texte sur ton Mac (export de Google pour Docs, Sheets et Slides ; couche texte
  ou OCR de macOS pour les PDF et les images, par l'assistant `molinova-text` fourni avec l'app ;
  `textutil` pour Word, RTF et OpenDocument), garde les 6 000 premiers caractères et efface le
  fichier. Ce texte, avec le nom, le dossier et les dates, part vers Jev, qui remplit la fiche.
  Ensuite, seules les nouveautés sont classées d'elles-mêmes, 50 au plus par passage ; un plus gros
  lot t'attend, avec son coût. Un document que Jev juge sensible (identité, santé, banque…) garde sa
  fiche, mais son texte n'est pas conservé.
- **La recherche** (page Documents et Telegram) combine l'index local et la recherche plein texte de
  Google, puis Jev relit les 10 meilleurs résultats (nom, fiche et jusqu'à 1 200 caractères de
  texte, aucun pour un document sensible) et garde ceux qui répondent. Un proche sur Telegram ne
  reçoit jamais un document sensible, sauf si tu l'as permis.
- Tu choisis, dossier par dossier : *Lire et ranger* (lu, classé, pourra plus tard être déplacé
  ou renommé par lots que tu valides), *Lire sans déplacer* (lu et classé, jamais déplacé ni
  renommé) ou *Ignorer* (rien n'est lu, aucun coût). Chaque dossier suit le choix de son parent.
  Photos, enregistrements Meet et notebooks sont ignorés d'office, de même que les images
  (surtout des photos).
- Molinova ne supprime jamais, ne met jamais à la corbeille, ne change jamais qui peut voir un document
  et ne modifie jamais son contenu. Un test du code casse si un tel appel apparaît un jour.

### Telegram (facultatif)

- Un bot privé, que tu crées chez [@BotFather](https://t.me/BotFather). Molinova l'interroge depuis ton
  Mac : aucune URL publique, aucun serveur. Le bot ne fonctionne que lorsque Molinova est ouvert.
- **Il t'écrit de lui-même**, sans aucun appel à l'IA : un résumé le matin, la semaine à venir le
  dimanche soir, et des rappels. Les rappels couvrent une échéance demain, une tâche en retard, une
  facture, un email sans réponse ou quelque chose à caler sous 48 h. Chacun part une seule fois, et
  attend la fin des heures de silence.
- **Tu lui parles.** Les commandes `/jour`, `/semaine`, `/actions`, `/apayer`, `/repondre`,
  `/taches`, `/rappels` et `/aide` répondent directement depuis la base, sans IA, et ne coûtent
  rien ; `/oublie` repart d'une conversation neuve. Les noms anglais et espagnols sont acceptés
  aussi. Le texte libre passe par le modèle de chat, qui peut chercher, lire l'agenda et ajouter des
  tâches. Créer un événement ou envoyer un message à un proche attend toujours que tu confirmes d'un
  bouton. Plusieurs choses dans un même message (« crée-moi ces 8 rendez-vous ») sont préparées
  ensemble et se confirment d'un seul bouton.
- **Tu lui envoies une photo, un PDF ou un fichier texte** (une affiche, un planning, un `.ics`) :
  il le lit, dit ce qui compte (dates, lieux, montants) et propose quoi en faire. Plusieurs photos
  envoyées ensemble sont lues ensemble. Le fichier part au modèle de chat une seule fois.
- **Des proches** (par exemple Sam, ton ou ta partenaire, ou une grand-mère) s'invitent par un QR
  code. Ils parlent au bot comme toi (agenda, tâches, événements), jamais à ta boîte mail. Tu
  rattaches chacun à un membre du foyer et tu choisis ce qu'il suit : ses événements, ceux d'un
  enfant, toute la famille, ou un agenda Google précis. Molinova peut alors lui envoyer, chaque envoi
  activable à part : son résumé du matin, des rappels avant ses événements, les nouveautés qui le
  concernent au fil de l'eau (avec un bouton pour les ajouter ; d'un email, il ne voit que
  l'expéditeur et l'objet) et sa semaine le dimanche. Tu es prévenu de ce qu'il ajoute ou écarte.
- Seuls ton compte relié et les proches invités peuvent utiliser le bot ; tout autre expéditeur
  reçoit une seule fois « Ce bot est privé. », puis plus rien. Le bot n'envoie jamais un email
  entier : seulement l'expéditeur, l'objet et une ligne.

### Dans la barre des menus

Molinova continue de tourner dans la barre des menus quand tu fermes la fenêtre. `Cmd+Q` quitte
vraiment. Le menu montre :

- les boîtes surveillées, les actions en attente, et l'état de WhatsApp et de Telegram ;
- les comptes à reconnecter, et si une mise à jour est disponible ;
- *Rester éveillé sur secteur*, *Redémarrer le serveur* et *Quitter Molinova*.

La pastille sur l'icône du Dock affiche le nombre d'actions en attente.

## Ce qu'il te faut

- **Un Mac avec puce Apple** (M1 ou plus récent). L'app est compilée pour `arm64` seulement.
- **Un compte Vercel avec l'offre Pro.** Molinova n'utilise que des modèles sans conservation des
  données, une option réservée à l'offre Pro : sans elle, la passerelle refuse les appels. L'offre
  Pro est un abonnement mensuel payant (voir [vercel.com/pricing](https://vercel.com/pricing)) ; la
  consommation d'IA se paie en plus, avec des crédits AI Gateway à acheter dans le tableau de bord
  Vercel (*AI Gateway*, puis le bouton du solde en haut à droite ; la recharge automatique existe).
  Tu paies directement à Vercel ce que l'IA lit et écrit, compté en tokens (de petits morceaux de
  texte), au prix public des fournisseurs d'IA. La page *Tokens et coûts* montre où ils partent.
- **Un compte Google** (Gmail, et Google Agenda si tu veux l'agenda) et **ta propre application
  Google**, créée dans ton propre projet Google Cloud. C'est gratuit, et l'assistant t'y guide en une
  quinzaine de minutes (voir [Ta propre application Google](#ta-propre-application-google)).
- Facultatif : **WhatsApp Desktop**, depuis le Mac App Store, relié une fois à ton téléphone.
- Facultatif : **Telegram**, pour créer et utiliser le bot.

Le Mac doit être allumé, avec Molinova ouvert, pour que la surveillance de Gmail, la lecture de WhatsApp
et le bot fonctionnent.

## Installation

Aucune version n'est encore publiée. En attendant, [compile l'app
toi-même](#en-attendant-compile-lapp-toi-même) : quelques commandes dans le Terminal suffisent. Une
fois les versions publiées, l'installation se passera ainsi :

1. Télécharge `Molinova-<version>-arm64.dmg` depuis la page
   [GitHub Releases](https://github.com/kasiopajg/molinova/releases).
2. Ouvre-le et glisse **Molinova** dans **Applications**.
3. Premier lancement : Molinova n'est pas enregistré auprès d'Apple (il faudrait un compte développeur
   payant), donc macOS le bloque la première fois. Clic droit sur l'app › **Ouvrir**, puis confirme.
   Sur les versions récentes de macOS, ce choix n'est plus proposé : essaie d'ouvrir Molinova une fois,
   puis va dans **Réglages Système › Confidentialité et sécurité** et clique sur **Ouvrir quand
   même**.
4. Molinova chiffre tes secrets avec sa propre clé du Trousseau, « Molinova Safe Storage ». Toutes les
   versions sont signées avec le même certificat « Molinova » : en principe, macOS ne demande jamais
   rien, mises à jour comprises. S'il le fait un jour (par exemple si tu compiles Molinova toi-même),
   tape le mot de passe de ton Mac et clique sur **Toujours autoriser**. L'assistant de démarrage
   liste chaque permission que macOS ou Google va te demander, pourquoi Molinova en a besoin, et ce
   qu'il n'en fera jamais.

### En attendant, compile l'app toi-même

Il te faut l'app Terminal (dans *Applications › Utilitaires*).

1. Installe [Node.js](https://nodejs.org) (la version LTS, 20.19 ou plus récente) et
   [pnpm](https://pnpm.io/installation).
2. Récupère le code :

   ```sh
   git clone https://github.com/kasiopajg/molinova.git
   cd molinova
   ```

   Si macOS propose d'installer les outils de développement en ligne de commande, accepte, puis
   relance la commande.
3. Construis l'app :

   ```sh
   pnpm install
   node node_modules/electron/install.js
   pnpm app:dist
   ```

4. Ouvre `release/Molinova-0.1.0-arm64.dmg` (le numéro suit la version), depuis le Finder ou avec
   `open release/Molinova-0.1.0-arm64.dmg`, puis reprends à l'étape 2 ci-dessus.

Pour travailler sur Molinova lui-même, voir [Compiler depuis les sources](#compiler-depuis-les-sources).

### L'assistant de démarrage

Au premier lancement, Molinova ouvre un assistant en six étapes. Tu peux revenir à toute étape déjà
faite.

1. **Bienvenue**
   - Ce que fait Molinova, ce qui reste sur le Mac et ce qui part vers l'IA.
   - Choisis la langue : français, anglais ou espagnol.
2. **Clé IA**
   - Sur [vercel.com/ai-gateway](https://vercel.com/ai-gateway), inscris-toi ou connecte-toi.
   - Passe le compte à l'offre Pro (obligatoire, voir [Ce qu'il te faut](#ce-quil-te-faut)) et
     ajoute des crédits AI Gateway.
   - Dans le [tableau de bord](https://vercel.com/dashboard) : *AI Gateway › API Keys › Create
     Key*.
   - Colle la clé et clique sur *Tester et enregistrer*. Molinova la vérifie auprès de la passerelle,
     puis la range dans le trousseau macOS. Cette vérification ne contrôle ni l'offre ni les crédits.
3. **Google** : ta propre application Google, donc personne d'autre n'y a accès. Une quinzaine de
   minutes, une seule fois, gratuit. L'assistant te guide écran par écran, avec les libellés exacts
   des boutons ; les mêmes étapes sont dans [Ta propre application Google](#ta-propre-application-google)
   plus bas. À la fin, dépose le fichier JSON téléchargé dans l'assistant, ou colle plutôt
   l'identifiant et le secret du client. Un client de type « Application Web » est refusé.
4. **Gmail**
   - Deux options, cochées par défaut :
     - *Brouillons* : Molinova prépare des réponses dans tes brouillons Gmail.
     - *Agenda* : Molinova lit tes agendas et crée les événements dans un agenda à lui.
   - Clique sur *Connecter un compte Gmail*. Google s'ouvre dans ton navigateur :
     1. choisis le compte ;
     2. sur « Google n'a pas validé cette application », clique sur *Paramètres avancés*, puis
        *Accéder à … (non sécurisé)* : c'est ta propre application (le nom affiché peut être celui de
        ton projet ou de ton domaine plutôt que « Molinova ») ;
     3. **coche toutes les cases**, puis *Continuer*.
   - Molinova vérifie les autorisations réellement accordées par Google. Sans la case Gmail, rien n'est
     connecté et il te demande de recommencer ; sans Brouillons ou Agenda, la boîte est connectée et
     Molinova te dit ce qui manque (reconnecte-la plus tard pour l'ajouter).
   - Tu peux ajouter d'autres boîtes ici, ou plus tard dans *Canaux › Gmail*.
5. **Toi**
   - Ton nom, tes adresses email (laisse vide pour utiliser les boîtes connectées) et ton fuseau
     horaire (celui du Mac est proposé).
   - Le reste du foyer (par exemple Léo, Inès et Noé, leurs écoles et leurs clubs) peut attendre
     *Réglages › Contexte*.
6. **Toujours prêt**
   - *Ouvrir Molinova à la connexion* et *Garder le Mac éveillé sur secteur*. Sur batterie, rien ne
     change.
   - Le rythme de la surveillance de Gmail : désactivée, ou toutes les 5, 15 ou 30 minutes.
   - Clique sur *Terminer*.

Molinova est alors prêt. Avec la surveillance activée, les nouveaux emails sont classés à leur arrivée.
Pour classer ceux que tu as déjà, lance le rattrapage depuis l'**Accueil** ou *Canaux › Gmail*. Commence par
une période courte (un mois, par exemple) : chaque email classé est un appel payant à l'IA, et les
libellés sont écrits dans Gmail. Essaie d'abord *Aperçu* : il classe de la même façon (donc coûte
autant) sans toucher à Gmail, et *Classer l'historique* reprend ensuite ces résultats au lieu de
payer une seconde fois. Tu peux brancher Telegram et WhatsApp plus tard, depuis *Canaux*.

### Ta propre application Google

Molinova n'a pas de serveur, il ne peut donc pas partager une application Google entre ses utilisateurs :
l'accès à Gmail (`gmail.modify`) est une autorisation Google *restreinte*, et une application
partagée exigerait un audit de sécurité payant chaque année et rendrait son éditeur responsable de
chaque utilisateur. À la place, **chaque utilisateur crée sa propre application Google** : gratuit,
une quinzaine de minutes, une seule fois. Personne d'autre, pas même l'auteur de Molinova, ne peut
l'utiliser ni voir tes données. Home Assistant et n8n fonctionnent de la même façon. La référence
complète, tenue à jour avec la console Google, est [docs/google-setup.md](docs/google-setup.md) (en
anglais).

**Quel parcours ?**

- **Perso** (une adresse `@gmail.com`, ou une adresse Google Workspace sans droits
  d'administrateur) : étapes 1 à 9.
- **Administrateur Workspace** (le projet est créé dans ton organisation) : étapes 1, 2, 3 et 4 avec
  l'audience **Interne**, puis 8 et 9. Ni Branding, ni publication, ni écran d'avertissement, ni
  expiration à 7 jours. Avec un compte Workspace sans droits d'administrateur, suis le parcours
  perso : l'administrateur peut quand même bloquer les applications non validées (« Cette
  application est bloquée »).

**Les étapes** (libellés de la console en français, l'anglais entre parenthèses) :

1. **Créer un projet** : [console.cloud.google.com/projectcreate](https://console.cloud.google.com/projectcreate).
   Nom du projet « Molinova », emplacement laissé sur « No organization » / aucune organisation (administrateur Workspace : ton
   domaine), *Créer* (*Create*). Si une demande de facturation apparaît, ignore-la : rien ici n'a
   besoin de facturation. Vérifie que le nouveau projet est sélectionné en haut de la page.
2. **Activer l'API Gmail** : [API Gmail](https://console.cloud.google.com/apis/library/gmail.googleapis.com) › *Activer* (*Enable*).
3. **Activer l'API Google Calendar** : [API Google Calendar](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com) › *Activer* (*Enable*).
4. **Google Auth Platform › Commencer** (*Get started*) : [console.cloud.google.com/auth/overview](https://console.cloud.google.com/auth/overview).
   Quatre parties sur une page : *Informations sur l'application* (nom « Molinova », ton adresse comme
   email d'assistance) › *Audience* : **Externe** (administrateur Workspace : **Interne**) ›
   *Coordonnées* : ton adresse › *Terminer* : coche l'acceptation de la règle « Google API Services:
   User Data Policy », *Continuer*, puis *Créer*.
5. **Branding** : [console.cloud.google.com/auth/branding](https://console.cloud.google.com/auth/branding).
   Google exige trois liens et leur domaine avant la publication. Mets les pages publiques de Molinova,
   ou des pages de ton propre site, puis *Enregistrer* (*Save*) :

   | Champ | Valeur |
   |---|---|
   | Page d'accueil de l'application | `https://kasiopajg.github.io/molinova/` |
   | Lien vers les règles de confidentialité | `https://kasiopajg.github.io/molinova/privacy.html` |
   | Lien vers les conditions d'utilisation | `https://kasiopajg.github.io/molinova/terms.html` |
   | Domaines autorisés › *Ajouter un domaine* | `kasiopajg.github.io` |

   Les pages de Molinova sont publiées depuis `site/` dans ce dépôt. Si elles ne s'ouvrent pas,
   l'assistant te le dit et propose ton propre site à la place.
6. **Accès aux données** (recommandé) : [console.cloud.google.com/auth/scopes](https://console.cloud.google.com/auth/scopes) ›
   *Ajouter ou supprimer des champs d'application*, colle les droits ci-dessous, *Update*, puis
   *Enregistrer* :
   `https://www.googleapis.com/auth/gmail.modify`, `https://www.googleapis.com/auth/gmail.compose`,
   `https://www.googleapis.com/auth/calendar.events`,
   `https://www.googleapis.com/auth/calendar.calendarlist.readonly`,
   `https://www.googleapis.com/auth/calendar.app.created`.
7. **Audience** : [console.cloud.google.com/auth/audience](https://console.cloud.google.com/auth/audience) ›
   *Publier l'application* (*Publish app*) › « Transférer en production ? » › *Confirmer*. L'état
   doit indiquer **En production**. Sans publication, l'accès expire tous les 7 jours. Juste après,
   un bandeau jaune dit que l'application doit être validée (« Your app needs verification »), et une
   liste de contrôles de marque en échec peut apparaître : ignore les deux. La validation ne
   concerne que les applications utilisées par plus de 100 personnes ; la tienne fonctionne sans.
8. **Clients** : [console.cloud.google.com/auth/clients](https://console.cloud.google.com/auth/clients) ›
   *Créer un client* › type d'application **Application de bureau** (*Desktop app*) › nom « Molinova » ›
   *Créer*. Dans la fenêtre qui confirme la création du client, clique sur **Télécharger le fichier
   JSON** *avant de la fermer* : le code secret n'est affiché qu'une fois. Raté ? Ouvre le client et ajoute
   un nouveau code secret, ou crée un nouveau client.
9. **Donne le fichier à Molinova** : dépose le `client_secret_….json` téléchargé dans l'assistant.

**Ne clique jamais** sur *Centre de validation* ni sur ce qui prépare ou envoie une validation
(*Verification center*, *Prepare for verification*, *Submit for verification* : un audit de sécurité
payant), ni sur *Revenir au mode test* (*Back to testing* : l'expiration à 7 jours
revient).

**Si quelque chose bloque** (Molinova affiche les mêmes explications) :

| Erreur | Ce que ça veut dire | Solution |
|---|---|---|
| « Accès bloqué : … n'a pas terminé la procédure de validation de Google » / `access_denied` | L'application est encore en mode Test (ou tu as cliqué sur Annuler) | Étape 7 : publier |
| `redirect_uri_mismatch` | Le client est de type « Application Web » | Étape 8 avec « Application de bureau » |
| `invalid_grant` | Application restée en mode Test (expiration à 7 jours), mot de passe Google changé, ou accès retiré | Étape 7, puis reconnecte la boîte dans *Canaux › Gmail* |
| `admin_policy_enforced`, « Cette application est bloquée » | L'administrateur Workspace bloque les applications non validées | Demande à l'administrateur, ou suis le parcours administrateur Workspace |
| `org_internal` | Audience Interne, compte hors de l'organisation | Utilise un compte de l'organisation, ou l'audience Externe (étapes 4 et 7) |
| `invalid_client` | Le client a été supprimé, ou son code secret a changé | Étape 8 (nouveau client de bureau), puis étape 9 |

### Où sont tes données

Tout ce que Molinova écrit se trouve dans `~/Library/Application Support/Molinova` :

| Chemin | Contenu |
|---|---|
| `config/` | `settings.json`, `taxonomy.json`, `doc-taxonomy.json`, `rules.json`, `context.json`, `app.json` |
| `data/molinova.sqlite` | la base : emails lus, décisions, tâches, consommation ; `data/whatsapp/` contient la copie WhatsApp |
| `tokens/<email>.json` | tes accès Google, un fichier par compte (lisible par ton seul utilisateur macOS, pas encore chiffré) |
| `secrets.bin` | la clé IA, le client Google et le jeton Telegram, chiffrés avec le trousseau macOS |
| `logs/` | `main.log` (l'app) et `server.log` (le serveur local) |

Ce dossier est masqué dans le Finder : choisis **Aller › Aller au dossier…** (Maj-Cmd-G) et colle
`~/Library/Application Support/Molinova`.

### Mettre à jour, désinstaller

- **Mettre à jour** : Molinova vérifie sur GitHub une fois par jour s'il existe une version plus
  récente. Si oui, la barre des menus affiche *Mise à jour disponible*. Il n'y a pas de mise à jour
  automatique. Quitte Molinova et remplace l'app par celle du nouveau `.dmg` ; ton dossier de données
  est conservé. macOS peut bloquer la nouvelle version comme la première fois. Il peut aussi
  demander si Molinova peut utiliser son élément de trousseau : choisis *Toujours autoriser*.
- **Désinstaller** :
  - Quitte Molinova depuis la barre des menus, puis supprime `/Applications/Molinova.app` et le dossier de
    données : dans le Finder, choisis **Aller › Aller au dossier…** (Maj-Cmd-G), colle
    `~/Library/Application Support/Molinova`, puis mets ce dossier à la corbeille.
  - Si tu veux, supprime aussi « Molinova Safe Storage » dans Trousseau d'accès, retire ton
    application Google des accès tiers de ton compte Google
    ([myaccount.google.com/permissions](https://myaccount.google.com/permissions)), et supprime le
    bot chez @BotFather.

## Confidentialité et sécurité

Le détail est dans [SECURITY.md](SECURITY.md) (en anglais). En bref :

- **Ce qui reste sur ton Mac** : la base, les réglages, le contexte, les règles et les journaux. Il
  n'y a ni serveur Molinova sur Internet, ni compte, ni télémétrie Molinova. Les polices et scripts de
  l'interface sont livrés avec l'app : ils ne sont pas chargés depuis Internet.
- **Avec qui Molinova parle** :
  - Google (API Gmail, Agenda et, si tu le relies, Drive) ;
  - Vercel AI Gateway ;
  - Telegram, si tu as créé le bot ;
  - GitHub, une fois par jour, pour chercher une nouvelle version.
- **Ce qui part vers l'IA**, uniquement par ta propre clé Vercel AI Gateway, avec la non-conservation
  des données demandée à chaque appel :
  - pour chaque email (sauf ceux couverts par une règle « Sans Jev ») : l'expéditeur, l'objet, la
    date, quelques indicateurs et le début du corps (1 500 caractères, sans historique cité ni
    signature), avec tes définitions de catégories et le contexte qu'elles demandent. S'y ajoutent,
    en exemples, l'expéditeur et l'objet d'emails que tu as corrigés (jusqu'à 8 par catégorie),
    ainsi que ton nom, tes consignes permanentes et le contexte du foyer (le nom et le lien d'une
    personne clé, les prénoms, écoles et activités des enfants) ;
  - pour un email où Jev repère une date ou une tâche, son texte (jusqu'à 5 000 caractères, nettoyé
    de la même façon), pour que le modèle de rédaction en extraie l'événement ou la tâche ; cela se
    fait tout seul, sans clic ;
  - le texte des conversations WhatsApp que tu as cochées, avec l'identifiant de chaque
    conversation (pour une conversation à deux, le numéro du contact), et les légendes et noms de
    documents si tu as activé cette option ;
  - tes messages en texte libre au bot Telegram (et ceux des proches réglés sur *parle au bot*),
    les photos, PDF et fichiers texte que vous lui envoyez, avec ce que le chat lit pour répondre :
    extraits d'emails et de WhatsApp, événements de l'agenda, tâches et contexte du foyer ;
  - quand tu demandes un brouillon ou un événement à partir d'un email, l'email concerné (et, pour
    un brouillon, jusqu'à 15 extraits de tes emails envoyés, pour le ton) ;
  - pour chaque document Google Drive que tu fais classer (voir
    [Google Drive](#google-drive-facultatif)) : son nom, son dossier, ses dates et les 6 000
    premiers caractères de son texte, pièces d'identité comprises ; pour une recherche de document,
    la demande et les 10 meilleurs résultats (fiche et jusqu'à 1 200 caractères de texte, aucun pour
    un document sensible).
- **Les secrets** :
  - Dans l'app, la clé IA, le client Google et le jeton Telegram sont dans `secrets.bin`, chiffré
    avec `safeStorage` d'Electron, dont la clé est rangée dans l'élément de trousseau macOS « Molinova
    Safe Storage ».
  - Tes accès Google (`tokens/`) sont des fichiers lisibles par ton seul utilisateur macOS ; leur
    chiffrement est prévu.
  - En développement, les secrets sont dans `.env.local` (en clair, mode 0600 quand Molinova l'écrit).
- **Le serveur local** écoute sur `127.0.0.1` seulement, et ne répond qu'à l'interface :
  - toute requête `/api/` exige la clé de session, une valeur aléatoire que l'app crée à chaque
    lancement et remet à sa fenêtre dans un cookie `HttpOnly`, `SameSite=Strict` ; un autre compte
    macOS ou une autre app du Mac ne peut pas se servir du serveur ;
  - il vérifie `Host` à chaque requête (contre le DNS rebinding), refuse les requêtes `/api/` qu'un
    navigateur signale comme venues d'un autre site, et pour toute écriture exige un `Content-Type`
    JSON et, si le navigateur en envoie une, la bonne `Origin`.
- **Les droits Google** :
  - `gmail.modify`, toujours : lire, étiqueter, archiver, marquer comme lu, et envoyer les
    réponses, transferts et relances sur lesquels tu cliques *Envoyer* (le droit Google permet
    l'envoi ; Molinova n'envoie que sur ton clic) ;
  - `gmail.compose`, seulement avec l'option Brouillons ;
  - `calendar.events`, `calendar.calendarlist.readonly` et `calendar.app.created`, seulement avec
    l'option Agenda ;
  - `drive.readonly`, seulement pour les comptes branchés dans Canaux › Google Drive : lecture seule ;
  - ils vont à **ta propre** application Google (voir
    [Ta propre application Google](#ta-propre-application-google)) : personne d'autre ne détient un
    client capable d'atteindre ta boîte. Molinova enregistre les droits réellement accordés par Google,
    et tu peux les retirer à tout moment sur
    [myaccount.google.com/permissions](https://myaccount.google.com/permissions).
- **Ce que Molinova fait tout seul** : poser ses libellés `AI/…`. Si tu as créé le bot Telegram, il
  t'envoie aussi de lui-même les résumés et les rappels, et le résumé du dimanche aux proches pour
  qui tu l'as activé ; le chat peut ajouter une tâche directement. Tout le reste attend ton clic :
  envoyer un email, archiver, marquer comme lu, créer ou supprimer un événement, écrire à un proche.
  Il ne **supprime jamais un email**, et il ne paie ni ne déplace jamais d'argent.

Tu as trouvé une faille ? Signale-la en privé comme l'explique [SECURITY.md](SECURITY.md), pas dans
un ticket public (issue GitHub).

## Compiler depuis les sources

Ce qu'il te faut :

- macOS ;
- Node.js 20.19 ou plus récent (la CI utilise Node 22) ;
- [pnpm](https://pnpm.io) (la CI utilise pnpm 10) ;
- les Xcode Command Line Tools : `swiftc` compile l'assistant `molinova-text` (texte des PDF et OCR)
  pour l'app, et ils compilent aussi `better-sqlite3` s'il n'a pas de binaire précompilé pour ta
  configuration.

### Lancer en développement

Depuis une copie du dépôt :

```sh
pnpm install
pnpm ui      # serveur local sur http://127.0.0.1:4310, ouvre ton navigateur avec sa clé de session
pnpm dev     # pareil, redémarre à chaque modification, n'ouvre pas le navigateur : utilise le lien affiché
pnpm ea      # interface en ligne de commande : liste ses commandes
```

- Le serveur ne répond qu'à un navigateur passé par le lien qu'il affiche (`/?molinova_key=…`), qui pose
  le cookie de session. En développement, la clé est gardée dans `data/session.key` : le lien reste
  le même d'un lancement à l'autre.
- Le même assistant tourne dans le navigateur. En développement, il écrit les secrets dans
  `.env.local`, dans le dossier de données. Tu peux aussi copier `.env.example` en `.env.local`,
  lancer `chmod 600 .env.local` pour que toi seul puisses le lire, et le remplir toi-même.
- **Le dossier de données est le dépôt lui-même** (les fichiers générés dans `config/`, ainsi que
  `data/`, `tokens/`, `credentials/`, `logs/` et `.env.local`, sont tous dans `.gitignore`), sauf si
  `MOLINOVA_HOME` est défini. Pour essayer sans toucher à tes vraies données :

  ```sh
  MOLINOVA_HOME=/tmp/molinova-test MOLINOVA_PORT=4391 pnpm dev   # puis ouvre le lien affiché
  ```

### Construire l'app macOS

```sh
node node_modules/electron/install.js   # une fois : pnpm ne lance pas le téléchargement d'Electron
pnpm app:dev                            # build + native:electron + native:text + electron .
pnpm app:dist                           # build + native:electron + native:text + electron-builder
```

- `pnpm app:dist` produit `release/Molinova-<version>-arm64.dmg` et `release/mac-arm64/Molinova.app`. L'app
  a une signature ad hoc et n'est pas notarisée.
- `pnpm app:dev` utilise ton vrai `~/Library/Application Support/Molinova`, sauf si `MOLINOVA_HOME` est
  défini. Pour tester sur un dossier jetable :

  ```sh
  MOLINOVA_HOME=/tmp/molinova-app MOLINOVA_PORT=4392 MOLINOVA_NO_LOGIN_ITEM=1 MOLINOVA_NO_UPDATE_CHECK=1 pnpm app:dev
  ```

  L'Electron de développement et Molinova.app partagent l'élément de trousseau « Molinova Safe Storage » :
  macOS demande une fois lequel des deux peut le lire.
- Les autres scripts :
  - `pnpm build` compile `src/` → `dist/` et `desktop/` → `dist-desktop/`.
  - `pnpm native:electron` construit le binaire `better-sqlite3` pour Electron dans `build/native/`.
  - `pnpm native:text` compile `native/molinova-text` (Swift : texte des PDF, OCR de macOS, aperçus des
    pages) dans `build/native/`.
  - `pnpm icons` régénère les icônes à partir de `build/*.svg`.
- Versions : pousser un tag `v<version>` qui reprend la version de `package.json` lance
  `.github/workflows/release.yml`. Le workflow construit le `.dmg`, vérifie la signature et les
  fusibles d'Electron, et crée une GitHub Release en brouillon.

### Vérifications

Les trois doivent passer avant une pull request :

```sh
pnpm typecheck   # TypeScript
pnpm test        # Vitest ; les tests n'appellent jamais de vrai service
pnpm i18n        # dictionnaires de traduction complets (fr, en, es)
```

### Variables d'environnement

| Variable | Rôle |
|---|---|
| `AI_GATEWAY_API_KEY` | clé Vercel AI Gateway |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | client OAuth Google de type « Application de bureau ». L'ancienne alternative est `credentials/google-oauth.json` dans le dossier de données. |
| `TELEGRAM_BOT_TOKEN` | facultatif, le jeton du bot donné par @BotFather |
| `MOLINOVA_HOME` | le dossier de données. Par défaut : le dépôt en développement, `~/Library/Application Support/Molinova` pour l'app et `pnpm app:dev`. |
| `MOLINOVA_PORT` | le port du serveur local. Par défaut : `4310`. L'app prend 4310 s'il est libre, sinon un autre port libre. |
| `MOLINOVA_NO_LOGIN_ITEM=1` | l'app ne s'inscrit jamais à l'ouverture de session (tests) |
| `MOLINOVA_NO_UPDATE_CHECK=1` | l'app saute la vérification quotidienne des versions sur GitHub (tests) |

- **Les secrets** (`AI_GATEWAY_API_KEY`, `GOOGLE_CLIENT_*`, `TELEGRAM_BOT_TOKEN`) : en
  développement, ils sont lus dans `.env.local`, dans le dossier de données (voir `.env.example`) ;
  dans l'app, ils sont dans le trousseau. En développement, une variable déjà définie dans
  l'environnement l'emporte sur `.env.local` ; l'app les ignore et n'utilise que le trousseau.
- **Les variables `MOLINOVA_*`** se mettent dans ton shell. En particulier, `MOLINOVA_HOME` ne peut pas
  être choisi depuis `.env.local`, puisque ce fichier est lu dans le dossier de données.

### Organisation du dépôt

| Chemin | Contenu |
|---|---|
| `src/` | serveur local et CLI (TypeScript, ESM) : connecteurs Gmail, Agenda, Drive et WhatsApp, classement, documents, bot Telegram, textes du serveur (`src/i18n/`) |
| `ui/` | l'interface, en JavaScript sans étape de build ; dictionnaires dans `ui/lang/<fr\|en\|es>/` |
| `desktop/` | le processus principal d'Electron et le preload |
| `native/molinova-text/` | l'assistant Swift qui lit les PDF et les images (couche texte, OCR) et rend les aperçus |
| `site/` | les pages publiques (accueil, confidentialité, conditions) publiées sur GitHub Pages |
| `docs/` | le guide de configuration Google et l'architecture de l'app macOS |
| `config/context.example*.json` | modèles de contexte du foyer |
| `scripts/` | vérification i18n, module natif, icônes |

Lis [CONTRIBUTING.md](CONTRIBUTING.md) avant d'ouvrir une pull request. L'architecture de l'app macOS
(modes de lancement, chemins, secrets, routes de l'assistant, empaquetage) est décrite dans
[docs/desktop-app.md](docs/desktop-app.md). Ces deux documents sont en anglais.

## Licence

[MIT](LICENSE) © 2026 Kasiopa SAS. Les logiciels tiers et leurs licences sont listés dans
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
