# Your own Google access for Molinova — reference guide

Single source of truth for the setup assistant (`ui/setup.js`, step "Google") and the READMEs.
Verified against Google's documentation and a real run in October 2026. Console labels change; when they
do, update this file first, then the assistant texts (`ui/lang/*/setup.js`).

## Why each user creates their own Google app

Molinova is a local app with no server. Gmail access (`gmail.modify`) is a *restricted* scope: a single shared
Google app would need a paid yearly security audit and would make its publisher responsible for every user.
Instead, each user creates their own Google app (free, ~15 minutes, once). Nobody else — not the author of
Molinova — can use it or see the data. Same model as Home Assistant, n8n or OpenClaw.

What the user will see that looks scary, and why it is fine:
- "Your app needs verification" banner and failed "brand verification" checks in the console: verification
  is only for apps used by more than 100 people. A personal app keeps working unverified.
- "Google hasn't verified this app" when signing in: the user is signing in to *their own* app.

Never click: **Verification center / Prepare for verification / Submit for verification** (paid security
assessment), **Back to testing** (brings back the 7-day expiry).

## Two paths

- **Personal** (`@gmail.com`, or Workspace account without admin rights): steps 1 → 9.
- **Workspace admin** (project created inside the organisation): steps 1, 2, 3, 4 with audience **Internal**,
  then 8 and 9. No Branding, no publishing, no warning screen, no 7-day expiry.
  A Workspace account without admin rights follows the personal path; the admin may still block
  unverified apps ("This app is blocked" / `admin_policy_enforced`).

## Steps (labels: English / French console)

1. **Create a project** — `https://console.cloud.google.com/projectcreate`. Project name: "Molinova".
   Location: leave "No organization" (Workspace admin: your domain). **Create / Créer**. A billing prompt
   may appear: skip it, nothing here needs billing. Check the new project is selected in the picker at the top.
2. **Enable Gmail API** — `https://console.cloud.google.com/apis/library/gmail.googleapis.com` → **Enable / Activer**.
3. **Enable Google Calendar API** — `https://console.cloud.google.com/apis/library/calendar-json.googleapis.com` → **Enable / Activer**.
   Optional, only for Channels › Google Drive: **Enable Google Drive API** —
   `https://console.cloud.google.com/apis/library/drive.googleapis.com` → **Enable / Activer**. The Drive page
   links to it too; it can be done later, the same way.
4. **Google Auth Platform › Get started / Commencer** — `https://console.cloud.google.com/auth/overview`.
   Four parts on one page:
   - App information / Informations sur l'application: App name "Molinova", User support email = your address → Next.
   - Audience: **External / Externe** (Workspace admin: **Internal / Interne**) → Next.
   - Contact information / Coordonnées: your address → Next.
   - Finish / Terminer: tick "I agree to the Google API Services: User Data Policy" → **Continue**, then **Create / Créer**.
5. **Branding** — `https://console.cloud.google.com/auth/branding`. Required before publishing:
   - Application home page / Page d'accueil de l'application
   - Application privacy policy link / Lien vers les règles de confidentialité
   - Application terms of service link / Lien vers les conditions d'utilisation
   - Authorized domains / Domaines autorisés › **Add domain / Ajouter un domaine**: the domain of those links.
   Use Molinova's public pages (`https://kasiopajg.github.io/molinova/`, `…/privacy.html`, `…/terms.html`, domain
   `kasiopajg.github.io`) or pages of your own website. → **Save / Enregistrer**.
6. **Data access / Accès aux données** (recommended) — `https://console.cloud.google.com/auth/scopes` →
   **Add or remove scopes / Ajouter ou supprimer des champs d'application**, paste the scopes, **Update**, **Save**:
   `https://www.googleapis.com/auth/gmail.modify`, `https://www.googleapis.com/auth/gmail.compose`,
   `https://www.googleapis.com/auth/calendar.events`, `https://www.googleapis.com/auth/calendar.calendarlist.readonly`,
   `https://www.googleapis.com/auth/calendar.app.created`, and optionally `https://www.googleapis.com/auth/drive.readonly`
   (Channels › Google Drive: read-only, nothing is written, moved or deleted).
7. **Audience** — `https://console.cloud.google.com/auth/audience` → **Publish app / Publier l'application** →
   dialog "Push to production? / Transférer en production ?" → **Confirm / Confirmer**. Status must read
   **In production / En production**. Expected right after: yellow banner "Your app needs verification", and
   possibly a list of failed brand checks. Ignore both. Without publishing, access expires every 7 days.
8. **Clients** — `https://console.cloud.google.com/auth/clients` → **Create client / Créer un client** →
   Application type **Desktop app / Application de bureau** → Name "Molinova" → **Create / Créer**.
   In the "OAuth client created" dialog click **Download JSON / Télécharger le fichier JSON** *before closing it*:
   the secret is shown only once. Missed it? Open the client and add a new secret, or create a new client.
9. **Give the file to Molinova** — drop the downloaded `client_secret_….json` in the assistant. Molinova refuses a
   "Web application" client.

## Signing in (Gmail step)

1. Choose the Google account.
2. "Google hasn't verified this app / Google n'a pas validé cette application" → **Advanced / Paramètres avancés**
   → **Go to … (unsafe) / Accéder à … (non sécurisé)**. The name shown may be your project or domain, not "Molinova".
3. One checkbox per permission: **tick every box** (or "Select all / Tout sélectionner" when shown) → **Continue / Continuer**.
   An unticked Gmail box means Molinova gets no mail access: Molinova checks the permissions actually granted and asks
   to start again.

## Errors and fixes

| Error | Meaning | Fix |
|---|---|---|
| "Access blocked: … has not completed the Google verification process" / `access_denied` | App still in Testing and this account is not a test user (or the user clicked Cancel) | Step 7 (publish) |
| `redirect_uri_mismatch` | Client type "Web application" | Step 8 with "Desktop app" |
| `invalid_grant` | App left in Testing (7-day expiry), Google password changed, or access removed | Step 7, then reconnect the mailbox |
| `admin_policy_enforced`, "This app is blocked" | Workspace admin blocks unverified apps | Ask the admin, or use the Workspace-admin path |
| `org_internal` | Client set to Internal, account outside the organisation | Use an account of the organisation, or audience External |
