# Google and Apple sign-in, and email OTP — what still needs doing

The code is written and bundles clean. **None of it has run against a real
provider**, because every step below needs an account (or a dashboard setting)
only you can create. Until they are done, the two OAuth buttons appear
(whenever `EXPO_PUBLIC_SUPABASE_*` are set) and fail with "That sign-in method
is not switched on for this project yet."

There is nothing to undo if you stop reading here. Guest mode is unaffected.

---

## 0. The half that is automated

Everything in §3 (email OTP), plus the Google provider and the redirect
allow-list from §1b, is applied by one command per environment:

```bash
npm run configure:auth -- --env staging --dry-run   # read the plan first
npm run configure:auth -- --env staging
npm run configure:auth -- --env production --yes
```

It needs these, all gitignored:

| Variable                                                | Where it goes   | Where it comes from                                               |
| ------------------------------------------------------- | --------------- | ----------------------------------------------------------------- |
| `SUPABASE_ACCESS_TOKEN`                                 | `.env`          | [Account → Tokens](https://supabase.com/dashboard/account/tokens) |
| `RESEND_API_KEY`                                        | `supabase/.env` | Resend → API Keys                                                 |
| `SUPABASE_DB_URL_STAGING` / `_PRODUCTION`               | `.env.db`       | The same strings `npm run migrate` uses                           |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | `.env`          | Cloud Console → Credentials (**Web application**) — see §1        |

Google is the only optional pair: leave both unset and step 6 is skipped, and
the provider is left exactly as it is rather than switched off.

The project ref is read out of the connection string rather than out of
`EXPO_PUBLIC_SUPABASE_URL`, so which project gets configured is decided by
`--env` and nothing else — the same source of truth as the migration runner,
and impossible to change by accident while editing a local `.env`.

Afterwards, confirm rather than assume:

```bash
npm run configure:auth -- --env staging --check --test-email you@example.com
```

`--check` reads the live config back and reports every difference from this
repository; `--test-email` sends one real message through Resend, which is the
only step that proves an email actually arrives.

**What it does not do:** create the Google client or anything Apple. Creating
the OAuth client in Cloud Console (§1a) and registering both callbacks on it is
still yours — the script can only take credentials that already exist and hand
them to Supabase.

### The sandbox sender will fool you

`supabase/.env` currently sets `INVITE_FROM` to
`Daykeep <onboarding@resend.dev>`. That is Resend's shared testing address: it
needs no domain and it **delivers only to the address that owns the Resend
account**. Every other recipient is rejected _after_ the send is accepted, so
signup codes, password resets and invitations all work perfectly for you and
fail silently for everyone else.

Verify a domain at [resend.com/domains](https://resend.com/domains), point
`INVITE_FROM` at an address on it, and re-run. The script prints this warning
on every run that finds the sandbox sender still in place.

---

## How each one works, in one line

|            | Mechanism                                                                          | Needs a native build? | Works in Expo Go |
| ---------- | ---------------------------------------------------------------------------------- | --------------------- | ---------------- |
| **Google** | Supabase `signInWithOAuth` → in-app browser → PKCE code → `exchangeCodeForSession` | No                    | Yes              |
| **Apple**  | `expo-apple-authentication` → identity token → `signInWithIdToken`                 | Yes (config plugin)   | No               |

Google deliberately does **not** use `@react-native-google-signin/google-signin`.
That library gives a nicer sheet and costs three OAuth client ids, per-platform
SHA-1 fingerprints, and a native build to test any of it. This app has never been
run on a device, so that would be stacking unverified native configuration on top
of unverified native configuration. The browser flow needs one client and one
redirect URL. If you want the native sheet later it drops in behind
`signInWithGoogle()` in `features/auth/services/oauth.ts` without anything else
changing.

---

## 1. Google

### 1a. Google Cloud Console

1. Create (or open) a project → **APIs & Services → Credentials**.
2. Configure the **OAuth consent screen**. External, and fill in the app name,
   support email and developer email. It can stay in "Testing" while only you use
   it — add your own address under **Test users** or sign-in will be refused.
3. **Create credentials → OAuth client ID → Web application.**
   - Authorised redirect URI:
     `https://<your-project-ref>.supabase.co/auth/v1/callback`
   - That is Supabase's URL, not the app's. This trips everyone up once: Google
     redirects to Supabase, and Supabase redirects to the app.
4. Copy the **client ID** and **client secret**.

### 1b. Supabase dashboard

1. **Enabling the provider is automated.** Put the client ID and secret in
   `.env` as `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` and run
   §0's command; step 6 sets `external_google_enabled` on that project. Doing
   it by hand in **Authentication → Providers → Google** works too, but then
   the two projects drift the moment one is updated and the other isn't.

2. **Redirect URLs** are already handled: `npm run configure:auth -- --env <env>`
   (§0) merges the right ones in. For the record, they differ per environment,
   because a staging build installs as its own app with its own scheme
   (`scripts/build-env.js`):

   | Project        | Allow-listed                                                                                                                                   |
   | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
   | **staging**    | `daykeep-staging://auth/callback`, `daykeep-staging:///auth/callback`, `daykeep-staging://reset-password`, `daykeep-staging:///reset-password` |
   | **production** | `daykeep://auth/callback`, `daykeep:///auth/callback`, `daykeep://reset-password`, `daykeep:///reset-password`                                 |

   Both slash forms of each, because `Linking.createURL` emits the triple-slash
   form on some platforms and the double on others, and an unlisted redirect is
   refused before the user sees anything.

   Putting `daykeep://` on the _staging_ project is the mistake worth naming:
   it looks right, it matches the docs everyone quotes, and it allow-lists an
   address no staging build ever sends — so sign-in fails there and nowhere
   else. The script takes the scheme from the same module the build does, so
   the two cannot disagree.

3. If you want to test in **Expo Go**, also add the tunnel URL Expo prints on
   start (`exp://…`). It changes between sessions, which is the main reason to
   test this in a dev build instead. The script **merges** rather than replaces,
   so a tunnel URL you add by hand survives every later run.

4. **One Google client covers both projects.** Because this is the browser
   flow, Google never sees the app — only Supabase's callback — so the client
   is a **Web application** and there is no Android client, no package id and
   no SHA-1 anywhere in it. Register both callbacks on the one client:

   ```
   https://wucwbtjgeuersnrctuze.supabase.co/auth/v1/callback   # staging
   https://ksrpdaudraulmsyhrjrg.supabase.co/auth/v1/callback   # production
   ```

   Separate clients per project are tidier (independent revocation, and the
   consent screen can name the environment), but nothing forces it. Switching
   to `@react-native-google-signin` later is what would introduce per-package
   Android clients and SHA-1 fingerprints — that is a property of the native
   sheet, not of Google sign-in.

### 1c. Verify

Sign in on a device. The failure modes map onto messages in `oauth.ts`:

- _"That sign-in method is not switched on"_ → step 1b.1 not done.
- _"This app's sign-in address has not been allowlisted"_ → step 1b.2 not done,
  or the scheme does not match `expo.scheme` in `app.json` (`daykeep`).
- Browser opens, you approve, and it returns to a blank app → the redirect URL is
  allowlisted but is not the one the app asked for. Log `oauthRedirectUrl()` and
  add exactly that string.

---

## 2. Apple

Needs a **paid Apple Developer account** ($99/yr) — the same one blocking the iOS
widget in `TODO.md`. Nothing here is testable without it, and none of it can be
tested in a simulator without an iCloud account signed in.

### 2a. Apple Developer portal

1. **Certificates, Identifiers & Profiles → Identifiers** → your App ID
   (`com.daykeep.app`, or whatever it becomes — see the "real bundle identifier"
   item in `TODO.md`) → tick **Sign in with Apple**.
2. **Keys → new key** → tick **Sign in with Apple** → download the `.p8`. You
   get exactly one download; losing it means making a new key.
3. Note your **Team ID**, the **Key ID**, and create a **Services ID** for the
   web/Supabase side.

### 2b. Supabase dashboard

**Authentication → Providers → Apple** → enable, and give it the Services ID,
Team ID, Key ID and the contents of the `.p8`.

### 2c. Already done in this repo

- `app.json` → `ios.usesAppleSignIn: true` and the `expo-apple-authentication`
  plugin.
- The button only renders where `AppleAuthentication.isAvailableAsync()` says
  yes, so Android and unsupported iOS builds show only Google.

### 2d. The nonce, if it ever fails

`signInWithApple()` sends Apple the **SHA-256 hash** of a random nonce and sends
Supabase the **raw** one. GoTrue hashes what it is given and compares it with the
`nonce` claim inside the token. If sign-in fails with a nonce mismatch, that pair
is the only thing to look at — which value goes where, not the hashing itself.

---

## 3. Email OTP (sign-up & password reset)

Sign-up and "forgot password" both work by emailing a 6-digit code — entered
on `verify-signup.tsx` / `verify-reset.tsx` — rather than a password chosen up
front or a tap-through link. The client calls
(`supabase.auth.signInWithOtp`, `supabase.auth.resetPasswordForEmail`,
`supabase.auth.verifyOtp`, all in `features/auth/services/auth-store.ts`) are
already in place and need nothing further from Supabase's API side. What
decides whether the resulting email contains a **code** or a **link** is the
email template, not the API call:

**`npm run configure:auth -- --env <env>` (§0) does all of this.** What
follows is what it applies and why, so the dashboard is readable — not a list
of things to click.

### 3a. The templates

All five in `supabase/templates/` are applied, in **Source** form (the HTML
view, not the WYSIWYG one), with the subject line each file's header comment
names. Each is styled to match the app — the emerald accent and neutral palette
from `constants/design-tokens.ts`, dark-mode aware, no logo image to host since
the wordmark is styled text — and built around `{{ .Token }}` rather than
`{{ .ConfirmationURL }}`, which is what actually switches the email from a
tap-through link to a 6-digit code.

| Template                | Sent when                                                                                                                                                                                           |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `confirm-signup.html`   | `sendSignupOtp` creates a new account                                                                                                                                                               |
| `reset-password.html`   | `resetPassword` from the forgot-password screen                                                                                                                                                     |
| `magic-link.html`       | An address that **already has an account** is entered on the sign-up screen — `signInWithOtp` treats that as a passwordless login, not an error. Also the device-takeover code (`sendTakeoverOtp`). |
| `email-change.html`     | An address is changed from the dashboard or admin API                                                                                                                                               |
| `reauthentication.html` | GoTrue challenges a live session before a sensitive change                                                                                                                                          |

The last two correspond to no app screen. They are applied anyway: an unset
template is not an absent email, it is Supabase's stock one, which says
Supabase to somebody who has only ever seen Daykeep.

### 3b. The rate limits, which are not optional

`smtp_max_frequency` is the minimum gap between two emails to one address. It
defaults to **60 seconds**, and both verify screens re-enable "Resend code"
after **30** (`RESEND_COOLDOWN_S`). So the app invites the user to do something
the server refuses, and the refusal arrives as `over_email_send_rate_limit` —
which, to the person waiting, is indistinguishable from the code never being
sent. The script sets it to 20s so the app's cooldown is the binding
constraint.

`rate_limit_email_sent` defaults to 30/hour **project-wide**, sized for
Supabase's shared mailer. Once the relay is yours the limit that matters is
Resend's, so the script raises it to 200.

### 3c. If you skip all of it

`sendSignupOtp` / `resetPassword` still succeed and still send an email — it
just contains a magic link the OTP-entry screens have nowhere to use, so
verification fails with "That code is incorrect or has expired."

Nothing else needs configuring for this part — no new redirect URL, no new
provider toggle. Login (email + password) is unaffected either way.

The `{{ if .Data.display_name }}` greeting in each template reads the name
passed to `sendSignupOtp` at signup time (`features/auth/services/auth-store.ts`)
straight from the user's metadata — nothing to configure for that either, and
it degrades to a plain "Hi," if it's absent (Google/Apple accounts never hit
these templates at all, since neither goes through email).

---

## 3d. Invitation emails are not auth emails

Group invitations go out through Resend directly (`supabase/functions/send-invite`),
not through Auth's SMTP, so none of §3 applies to them. They have their own
trap.

The link in that email used to be `daykeep://join/<token>`, which is dead twice
over: **Gmail strips custom schemes out of `href`s entirely** — web and mobile,
rendering the button as unclickable text — and on a phone without the app
installed the scheme resolves to nothing at all, which describes most people
receiving an invitation.

So the email now links to `supabase/functions/join`, an https landing page on
the project's own functions domain that hands the token to the app over the
deep link and falls back to visible install instructions when nothing catches
it. It is deployed **without JWT verification**, because it is opened by
somebody who has no account yet:

```bash
supabase functions deploy join --no-verify-jwt
```

It reads and writes nothing; the token is echoed back into the page and
nowhere else. `APP_LINK_SCHEME` tells it which scheme to emit, and the
configure script sets that per environment for the same reason as the redirect
allow-list — a staging invitation must not open the production app, which would
reject a token its database has never seen.

---

## 4. App Store note

Guideline 4.8 requires Sign in with Apple to be offered wherever another
third-party login is, so **shipping Google to iOS without Apple is a rejection**.
They go live together or not at all. Android has no equivalent rule and can ship
Google alone.

---

## 5. What is deliberately not built

- **Account linking UI.** If somebody signs up with email and later uses Google
  with the same address, Supabase's own identity-linking settings decide what
  happens. There is no in-app "connect your Google account" screen.
- **Any other provider.** The service is shaped so a third is a new branch in
  `oauth.ts` plus a button, but nothing is stubbed out waiting for one.
