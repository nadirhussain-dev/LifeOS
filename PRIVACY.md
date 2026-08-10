# LifeOS — Privacy Policy

_Last updated: 2026-08-10_

LifeOS ("the app", "we") is a personal life-organization app. Your privacy is
central to how it's built: **LifeOS is local-first — your data lives on your
device by default**, and only leaves it if you choose to create an account and
enable cloud sync.

## What data LifeOS handles

**On your device (always local):**

- Content you create: tasks, notes, habits and habit logs, journal entries
  (including optional mood, energy, and — only if you enable it — a location tag
  with coordinates), calendar events, water logs, sleep and study sessions,
  budget transactions/debts/savings, goals, and gallery photos/videos you add.
- App preferences: theme, language, notification settings, and app-lock setting.

**In the cloud (only if you sign in and enable sync):**

- The above records for the modules you choose to sync (you control this
  per-module in Settings → Sync & Account).
- For photos, videos and music, **the details travel but the files do not.**
  Album and playlist names, captions, file names, favourites, ordering and dates
  are uploaded so a second device can show your library; the images, videos and
  audio themselves stay on the device that imported them and appear elsewhere as
  "Not on this device". Treat a caption or a file name as text you have uploaded,
  because it is.
- Reminders are **not** synced. They are scheduled by your phone, and each phone
  keeps its own.
- Your account profile: email address and display name.

**Usage statistics — off unless you turn them on:**

We ask once, in the app, and collect nothing unless you say yes. If you decline
or simply never answer, no usage data is collected at all. You can change your
mind either way in **Settings → Sync & Account → Usage statistics**.

If you do say yes, so we can tell how many people use LifeOS and which parts of
it are worth building on, the app reports a small daily count:

- **If you have an account:** for each day, which modules you opened and how
  many records you synced. A whole day's report looks like
  `habits: 5 opens, 3 writes`. That is the entire record. It contains no titles,
  no text, no amounts, no dates from your entries, no file names, and nothing
  that could be turned back into what you wrote.
- **If you're in guest mode:** a single "this installation was active today",
  plus your platform and app version, against a random identifier stored on
  your device. It is not linked to an account, an email, an advertising ID, or
  your device's identifiers, and it cannot be.

We do **not** use advertising identifiers, we do **not** track you across other
apps or websites, and we do **not** sell your data.

## Where cloud data is stored

Cloud sync uses [Supabase](https://supabase.com) (Postgres). Every row is
protected by Row Level Security so that only your authenticated account can read
or write your data. Data is transmitted over HTTPS.

## Permissions

LifeOS requests device permissions only for features you use:

- **Notifications** — to deliver reminders you set.
- **Camera / Photos** — to add media to the gallery, notes, and journal.
- **Microphone** — to record voice notes.
- **Location** — approximate only, and only when you explicitly tag a journal
  entry's location. The app requests coarse location and blocks the precise
  permission outright, because all it does with it is look up a town and region
  name. Whether that tag then leaves your device depends on your journal sync
  setting.
- **Face ID / biometrics** — only to unlock the app if you enable App Lock.

## Your rights and controls

- **Export** — Settings → Data → Export data produces a full JSON copy of your
  on-device data.
- **Delete on device** — Settings → Data → Clear all data erases everything
  locally.
- **Delete your account** — Settings → Sync & Account → Delete account
  permanently deletes your account and all your synced cloud data, and clears
  this device. This cannot be undone.

  One thing deliberately survives it, and you should know what: if you were in a
  shared expense group, **your membership row stays, with your name and your
  share of the ledger, but no longer attached to any account**. Removing it would
  silently change what everybody else in that group is owed. Nothing else of
  yours remains — your private space, its records and the escrowed copy of its
  key all go with the account.

- **Control what syncs** — per-module toggles in Settings → Sync & Account; or
  simply never create an account (guest mode keeps everything local).
- **Turn usage statistics on or off** — Settings → Sync & Account → Usage
  statistics. They are off until you switch them on.

## The private space

LifeOS has an optional, separately locked area — a vault for photos and files,
and modules for things people generally don't keep in a shared app (cycle
tracking, recovery, a relationship diary). It works differently from the rest of
the app on purpose:

- **It is encrypted, and locked behind a separate PIN.** Everything in the
  private space — including which modules you use and the dates on your entries
  — is stored as encrypted data. Nobody with your phone but not your PIN can
  read it. See "What LifeOS staff can access" below for whether we can.
- **There is no PIN recovery.** If you forget it, you lose access to your
  private space and we cannot restore it for you. You are told this before you
  choose a PIN.
- **Sync is off by default.** The private space stays on your device unless you
  turn its sync on in Settings → Sync & Account. It is never included in
  "Export data" or in imports.
- **It is invisible to the rest of the app.** Private content never appears in
  search results, notifications, the home-screen widget, or your gallery.
  Screenshots and screen recording are blocked while it is open.
- **Usage statistics say nothing about it.** As with every other module, only
  "opened" and "saved" counts are reported — and only if you switched them on
  at all — never what is inside.
- **"Delete all data" erases it**, along with its keys.

Gender is asked once during setup, only to suggest which of these modules to
offer you. It stays on your device, is never uploaded, never restricts what you
can use, and can be skipped.

### Moving other modules into the private space

You can also move ordinary modules (Journal, Gallery, Budget, and so on) behind
your PIN. **This is different from the modules above, and the difference
matters:**

- **What it does:** hides the module from the Hub, requires your PIN to open it,
  and removes it from global search, from "Export data", and from notifications.
- **What it does not do:** re-encrypt data that already exists in the app's
  normal storage. Those records stay where they were. Moving a module here hides
  and locks it; it does not give it the same encryption as the Vault or Cycle.

Note that a module you have moved here is left out of your export **whether or
not the vault is unlocked** — so an export taken after doing this is not a
complete backup. The file lists which modules were left out.

## Modules we can switch off

We can remotely disable a module for everyone — for example if we find a bug
that damages data, or a feature depends on a service that is down. If we do:

- The module disappears from the Hub and shows the reason instead.
- **None of your data is deleted, moved or changed.** It is still on your
  device, and the module returns exactly as it was when we switch it back on.
- If your device can't reach us, nothing is switched off. Modules are only ever
  disabled by an explicit instruction, never by a failed connection.

## What LifeOS staff can access

Please read this section carefully — it is the most important thing on this
page.

**Account information.** Your email, username, display name, when you joined,
when you were last active, which modules you use and how often, how many groups
and devices you have, and your account standing.

**Content you have synced.** If you sign in and enable cloud sync, staff can
access the records for the modules you sync, in order to investigate abuse,
respond to legal requests, and operate the service.

**Controls on that access:**

- Staff access requires being on an internal roster **and** connecting from a
  registered device or network. A stolen password alone is not enough.
- Every access to a specific account's data is recorded in an audit log —
  who, when, from where, and why.

**Your private space, including the Vault, Cycle, Recovery and Us modules.**
LifeOS is built with the *capability* to support staff access here — a copy of
its encryption key sealed so that only LifeOS staff could open it, for abuse
investigation and legal compliance. **We are not switching this on.** No key is
generated or uploaded, on this account or any other, so nobody but you can
decrypt your private space — including us.

If that ever changes, this section will say so in plain terms — which key,
which modules, and why — before it takes effect, not after, and never silently
in an app update. Were it ever switched on, opening a private space would still
require a written reason of its own, separate from and in addition to the
roster/device/audit controls above, and a check for whether a private space
merely *exists* would be logged separately from opening it. Those controls
exist in the code today; there is simply nothing for them to gate here yet.

**What we cannot access:**

- Your private space, on any account — see above.
- Anything you have not synced. If a module's sync is off, those records stay
  on your device.
- Your PIN. We cannot recover it or tell you what it is.

If this is not acceptable to you, use LifeOS in guest mode, or keep sensitive
material out of the app. That is a legitimate choice and the app works fully
offline.

**Reporting.** If someone shares content with you and you report it, the item
you reported is attached to that report so we can review it.

## Profile picture

Your profile picture and display name are visible to people you share expense
groups with. They are the only things in LifeOS that other users can see. Photo
location data (EXIF) is stripped before upload.

## Account restrictions

LifeOS has one feature where you interact with other people: shared expense
groups and the invitations that create them. To keep that from being used for
spam, we apply automatic limits (for example, on how many invitations one
account can send in an hour) and can restrict or block an account manually.

- Automatic restrictions are always temporary and expire on their own.
- A restriction stops you creating groups and sending invitations. **It never
  touches the data on your device**, and it does not stop you reading groups
  you are already in.
- If your account is restricted or blocked, the app tells you so, tells you the
  reason, and gives you a way to appeal.
- These decisions are made from account-level counts — how often an action was
  taken — never from the content of anything you have written.

## Crash reporting

If a crash-reporting service (Sentry) is configured for a build, technical error
reports (no journal/financial/personal content) may be sent to help fix bugs.
Builds without it configured send nothing.

## Children

LifeOS is not directed to children under 13, and we do not knowingly collect
data from them.

## Changes

We may update this policy; material changes will be reflected by the "Last
updated" date above.

## Your rights under GDPR and similar laws

Depending on where you live you have the right to access your data, correct it,
delete it, take it elsewhere, and object to or restrict some processing.

In LifeOS most of these are buttons rather than requests: **Export data** gives
you a machine-readable copy, **Delete account** erases the cloud side, and
**Clear all data** erases the device. For anything those do not cover — including
a data-access request from an account that has been blocked, which cannot read
its own data to export it — email the address below and we will do it by hand.

Our lawful basis is your consent for usage statistics, and performance of this
agreement for everything else needed to run the app. You can withdraw consent for
usage statistics at any time without losing any functionality.

## Terms of Service

These terms govern use of the app, including the rules for shared expense groups
and what happens when content is reported:
https://nadirhussain786.github.io/LifeOS/terms/

## Contact

Questions about privacy or your data, and data-access requests:
**nh262464@gmail.com**
