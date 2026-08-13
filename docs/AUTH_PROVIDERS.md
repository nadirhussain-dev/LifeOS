# Google and Apple sign-in, and email OTP — what still needs doing

The code is written and bundles clean. **None of it has run against a real
provider**, because every step below needs an account (or a dashboard setting)
only you can create. Until they are done, the two OAuth buttons appear
(whenever `EXPO_PUBLIC_SUPABASE_*` are set) and fail with "That sign-in method
is not switched on for this project yet," and the email sign-up / password
reset codes go out as magic links instead of 6-digit codes (§3 below).

There is nothing to undo if you stop reading here. Guest mode is unaffected.

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

1. **Authentication → Providers → Google** → enable, paste the client ID and
   secret, save.
2. **Authentication → URL Configuration → Redirect URLs** → add:

   ```
   lifeos://auth/callback
   lifeos:///auth/callback
   ```

   Both, because `Linking.createURL` emits the triple-slash form on some
   platforms and the double on others, and an unlisted redirect is refused
   before the user sees anything.

3. If you want to test in **Expo Go**, also add the tunnel URL Expo prints on
   start (`exp://…`). It changes between sessions, which is the main reason to
   test this in a dev build instead.

### 1c. Verify

Sign in on a device. The failure modes map onto messages in `oauth.ts`:

- _"That sign-in method is not switched on"_ → step 1b.1 not done.
- _"This app's sign-in address has not been allowlisted"_ → step 1b.2 not done,
  or the scheme does not match `expo.scheme` in `app.json` (`lifeos`).
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
   (`com.lifeos.app`, or whatever it becomes — see the "real bundle identifier"
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

1. **Supabase dashboard → Authentication → Email Templates.**
2. For each of **Confirm signup**, **Reset Password**, and **Magic Link**,
   open the template, switch to **Source** (the HTML view, not the plain
   WYSIWYG one), and paste in the matching file from `supabase/templates/`:
   `confirm-signup.html`, `reset-password.html`, `magic-link.html`. Each is a
   complete, ready-to-paste document — styled to match the app (the emerald
   accent and neutral palette from `constants/design-tokens.ts`, dark-mode
   aware, no logo image to host since the wordmark is styled text) — built
   around `{{ .Token }}` rather than `{{ .ConfirmationURL }}`, which is what
   actually switches the email from a link to a 6-digit code. Set each
   template's **Subject** to the line noted in a comment at the top of its
   file (e.g. "Your LifeOS verification code").
3. **Magic Link is the one easy to skip.** It doesn't correspond to a button
   anywhere in the app — it's what Supabase sends instead of "Confirm signup"
   if someone enters an email that already has an account into the sign-up
   screen (`sendSignupOtp`'s `signInWithOtp` treats that as a passwordless
   login, not an error). Leave it unstyled and that's the one email in the
   whole flow that still looks like a default Supabase template.
4. Until all three are done, `sendSignupOtp` / `resetPassword` still succeed
   and still send an email — it just contains a magic link the OTP-entry
   screens have nowhere to use, so verification will fail with "That code is
   incorrect or has expired."

Nothing else needs configuring for this part — no new redirect URL, no new
provider toggle. Login (email + password) is unaffected either way.

The `{{ if .Data.display_name }}` greeting in each template reads the name
passed to `sendSignupOtp` at signup time (`features/auth/services/auth-store.ts`)
straight from the user's metadata — nothing to configure for that either, and
it degrades to a plain "Hi," if it's absent (Google/Apple accounts never hit
these templates at all, since neither goes through email).

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
