#!/usr/bin/env node
/**
 * Configures one Supabase project's auth, end to end.
 *
 * Everything auth depends on that lives in the dashboard rather than in this
 * repository — the SMTP relay, the branded templates, the OTP shape, the rate
 * limits, the OAuth redirect allow-list and the Google provider — set from one
 * command so staging and production cannot quietly disagree about any of it.
 *
 * (It was `configure-auth.mjs` while it only did email. It grew the
 * redirect allow-list and then Google, at which point the name described about
 * half of it.)
 *
 * ---------------------------------------------------------------------------
 * Why this exists at all
 * ---------------------------------------------------------------------------
 * Free-tier Supabase projects refuse custom email templates while they are
 * still on the shared default mailer: saving "Confirm signup" / "Reset
 * Password" / "Magic Link" fails with "Email template modification is not
 * available for free tier projects using the default email provider."
 * Configuring ANY custom SMTP provider lifts that restriction, even on the
 * free plan — it is the "default email provider" part being replaced that
 * matters, not payment. So SMTP and templates have to be applied in that
 * order, which is what steps 2 and 4 below do.
 *
 * ---------------------------------------------------------------------------
 * What it does, in order
 * ---------------------------------------------------------------------------
 *   1. Deploys the edge-function secrets (`supabase secrets set`) — send-invite
 *      has been running in its no-email fallback on any project where these
 *      were never pushed.
 *   2. Points Auth's SMTP at Resend's relay (smtp.resend.com), authenticated
 *      with the same API key.
 *   3. Sets the OTP shape and the two rate limits. This is not cosmetic: the
 *      verify screens allow a resend after 30s, and Supabase's default
 *      `smtp_max_frequency` is 60s, so the second code a user asks for is
 *      refused with a 429 that reads as "email is broken".
 *   4. Applies the branded subject lines and HTML from supabase/templates/.
 *   5. Merges this environment's deep-link callbacks into the redirect
 *      allow-list, so Google sign-in and the password-reset link are permitted
 *      to come back to the app. Merges rather than replaces — an Expo Go
 *      tunnel URL somebody added by hand survives a re-run.
 *   6. Enables the Google provider, when GOOGLE_OAUTH_CLIENT_ID and
 *      GOOGLE_OAUTH_CLIENT_SECRET are set. Skipped, not failed, when they are
 *      not: email auth is worth configuring on its own.
 *
 * ---------------------------------------------------------------------------
 * Which project it writes to
 * ---------------------------------------------------------------------------
 * `--env staging` / `--env production`, and the project ref is read out of the
 * connection string the migration runner already uses
 * (`SUPABASE_DB_URL_STAGING` / `SUPABASE_DB_URL_PRODUCTION`, from `.env.db` —
 * see scripts/db-env.mjs). One source of truth for "which project is staging",
 * shared with `npm run migrate`, rather than a second list that can drift.
 *
 * This used to read `EXPO_PUBLIC_SUPABASE_URL`, which meant it could only ever
 * configure whichever project your local `.env` happened to point at — so
 * production's auth email was unreachable without editing a file first, and
 * doing it in the wrong order silently reconfigured staging instead.
 *
 * ---------------------------------------------------------------------------
 * Credentials
 * ---------------------------------------------------------------------------
 * In `supabase/.env` (gitignored):
 *   RESEND_API_KEY   Resend → API Keys. "Sending access" is enough to send;
 *                    `--check` additionally lists your verified domains, which
 *                    needs full access and is skipped, not failed, without it.
 *   INVITE_FROM      e.g. "Daykeep <invites@mail.yourdomain.com>". Must be an
 *                    address on a domain verified in Resend, or every send
 *                    bounces at Resend rather than at Supabase.
 *
 *                    ⚠ The sandbox sender "Daykeep <onboarding@resend.dev>"
 *                    needs no domain and DELIVERS ONLY to the email address
 *                    that owns the Resend account. Every other recipient is
 *                    rejected. It is fine for testing the wiring and cannot
 *                    ship — this script says so on every run that uses it.
 *
 * In `.env` or `.env.db` (gitignored):
 *   SUPABASE_ACCESS_TOKEN      Account-level PAT —
 *                              https://supabase.com/dashboard/account/tokens
 *   SUPABASE_DB_URL_STAGING    Used only to read the project ref out of.
 *   SUPABASE_DB_URL_PRODUCTION
 *
 * Optional:
 *   AUTH_SMTP_FROM   Sender for Auth emails specifically, if it should differ
 *                    from INVITE_FROM (a noreply@ rather than an invites@).
 *                    Defaults to INVITE_FROM.
 *   GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET
 *                    A **Web application** client from Google Cloud Console.
 *                    One client can serve both projects, provided both
 *                    projects' `https://<ref>.supabase.co/auth/v1/callback`
 *                    URLs are registered on it. Absent, step 6 is skipped and
 *                    the provider is left exactly as it is.
 *
 * ---------------------------------------------------------------------------
 * Usage
 * ---------------------------------------------------------------------------
 *   npm run configure:auth -- --env staging --dry-run   # print the plan
 *   npm run configure:auth -- --env staging
 *   npm run configure:auth -- --env production --yes
 *   npm run configure:auth -- --env staging --check --test-email me@x.com
 *
 * `--check` reads back what the project currently has and reports drift
 * without changing anything; with `--test-email` it also sends one real
 * message through Resend, which is the only way to find out whether the key
 * and the sender actually work.
 *
 * What gets applied — the template list, the rate limits, the redirect URLs,
 * the provider fields and the parsers — lives in scripts/auth-config.mjs so it
 * can be tested without running any of this. Same split as migrate.mjs /
 * migration-plan.mjs.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

import { loadDbEnv } from './db-env.mjs';
import {
  ENVIRONMENTS,
  MAILER_SETTINGS,
  MAILER_TEMPLATES,
  googleCallbackUrl,
  googleProviderFields,
  mergeAllowList,
  parseSender,
  projectRefFromDbUrl,
  redirectUrlsFor,
} from './auth-config.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATES = join(ROOT, 'supabase', 'templates');
const API = 'https://api.supabase.com/v1';

/** Only fills what nothing has already set — a real exported variable always
 *  wins over a file, the same precedence every dotenv-shaped tool uses.
 *
 *  `supabase/.env` is read before `.env` because the two hold different things
 *  and only one of them may ever sit beside an `EXPO_PUBLIC_` name: the edge
 *  secrets live in the former (see supabase/.env.example for why), the
 *  operator credential in the latter. */
function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed
      .slice(0, eq)
      .trim()
      .replace(/^export\s+/, '')
      .trim();
    if (!key || process.env[key] !== undefined) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

/**
 * Runs the Supabase CLI, however it happens to be installed here.
 *
 * `supabase` if it is on PATH, `npx supabase` otherwise. The CLI is not a
 * dependency of this project and the documented install is a global one, but
 * plenty of machines only ever reach it through npx — including any CI runner
 * that has not installed it. Falling back costs one failed spawn and turns an
 * ENOENT reading "the CLI is not installed" into it simply working.
 *
 * `shell: true` on Windows because both resolve to `.cmd` shims there, which
 * `execFileSync` will not execute without one.
 */
let cliPrefix = null;

function supabaseCli(args) {
  const shell = process.platform === 'win32';

  // Probed once with a harmless command, rather than by catching the failure
  // of a real one. Under `shell: true` a missing binary comes back as a plain
  // exit 1 from cmd.exe — indistinguishable from the CLI having run and
  // refused — so there is nothing reliable to catch on the platform where the
  // fallback is most often needed.
  if (!cliPrefix) {
    try {
      execFileSync('supabase', ['--version'], { stdio: 'ignore', shell });
      cliPrefix = ['supabase'];
    } catch {
      cliPrefix = ['npx', '--yes', 'supabase'];
    }
  }

  const [command, ...prefixArgs] = cliPrefix;
  execFileSync(command, [...prefixArgs, ...args], { stdio: 'inherit', cwd: ROOT, shell });
}

/** Strips the leading implementation-note comment. That block is addressed to
 *  whoever opens the file in this repository; it is not part of the email. */
function loadTemplate(file) {
  const html = readFileSync(join(TEMPLATES, file), 'utf8');
  return html.replace(/^<!--[\s\S]*?-->\s*/, '');
}

async function getAuthConfig(ref, token) {
  const res = await fetch(`${API}/projects/${ref}/config/auth`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(
      `GET config/auth failed (${res.status}): ${await res.text()}\n\n` +
        (res.status === 401
          ? 'SUPABASE_ACCESS_TOKEN was rejected. It must be an account-level personal\n' +
            'access token from https://supabase.com/dashboard/account/tokens — not the\n' +
            'anon key, not the service-role key.'
          : res.status === 404
            ? `No project "${ref}" is visible to that token. Check which account it belongs to.`
            : ''),
    );
  }
  return res.json();
}

async function patchAuthConfig(ref, token, fields, dryRun, label) {
  if (dryRun) {
    console.log(`  [dry-run] PATCH config/auth — ${label}: ${Object.keys(fields).join(', ')}`);
    return;
  }
  const res = await fetch(`${API}/projects/${ref}/config/auth`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  if (!res.ok) {
    throw new Error(
      `PATCH config/auth failed (${res.status}) while setting ${label}:\n${await res.text()}`,
    );
  }
  console.log(`  ✓ ${label}`);
}

/**
 * What Resend thinks of the sender, said out loud before anything is
 * configured around it.
 *
 * The sandbox sender is the case worth catching. It is the one every project
 * starts on, it works perfectly for the person setting it up — they are the
 * account owner, so they are the one address it delivers to — and it fails for
 * literally every real user. Nothing in Supabase surfaces that; the send
 * succeeds as far as SMTP is concerned and Resend rejects the recipient
 * afterwards.
 */
async function reportSenderStatus(sender, resendKey) {
  const domain = sender.email.split('@')[1] ?? '';

  if (domain === 'resend.dev') {
    console.log('');
    console.log('  ⚠  SANDBOX SENDER — this project cannot email anybody but you.');
    console.log('');
    console.log(`     ${sender.email} is Resend's shared testing address. Resend accepts`);
    console.log('     the send and then rejects every recipient that is not the Resend');
    console.log('     account owner, so signup codes, password resets and invitations all');
    console.log('     silently fail for real users while working for you.');
    console.log('');
    console.log('     To fix: verify a domain at https://resend.com/domains, then set');
    console.log('     INVITE_FROM in supabase/.env to an address on it and re-run this.');
    console.log('');
    return;
  }

  // Needs a full-access key; a sending-only key 401s here. That is a perfectly
  // reasonable key to hold, so it is reported and stepped over rather than
  // treated as a failure.
  try {
    const res = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${resendKey}` },
    });
    if (res.status === 401 || res.status === 403) {
      console.log(`  · sender ${sender.email} — cannot verify (sending-only API key)`);
      return;
    }
    if (!res.ok) return;
    const body = await res.json();
    const match = (body?.data ?? []).find((entry) => entry.name === domain);
    if (!match) {
      console.log(`  ⚠  ${domain} is not registered in this Resend account — every send`);
      console.log('     from it will be rejected. Add it at https://resend.com/domains.');
    } else if (match.status !== 'verified') {
      console.log(`  ⚠  ${domain} is registered but its status is "${match.status}", not`);
      console.log('     "verified". Sends are rejected until the DNS records resolve.');
    } else {
      console.log(`  ✓ sender domain ${domain} is verified in Resend`);
    }
  } catch {
    // Reachability of Resend's API is not what this script is for.
  }
}

/** Proves the whole chain — key, sender, recipient — with one real message.
 *  Every other check here reads configuration; this is the only one that finds
 *  out whether an email actually arrives. */
async function sendTestEmail(sender, resendKey, to) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `${sender.name} <${sender.email}>`,
      to: [to],
      subject: 'Daykeep — email configuration test',
      text:
        'This is a test message from scripts/configure-auth.mjs.\n\n' +
        'It was sent directly through the Resend API with the key in supabase/.env,\n' +
        'so receiving it proves the key and the sender address both work. It does\n' +
        'NOT prove Supabase Auth can send — for that, ask the app for a signup code.',
    }),
  });
  if (!res.ok) {
    console.log(`  ✗ test send rejected (${res.status}): ${await res.text()}`);
    return false;
  }
  console.log(`  ✓ test email accepted by Resend for ${to} — check that it arrives`);
  return true;
}

/** Production says its name, the same way `npm run migrate` makes it. */
async function confirmProduction(ref) {
  if (!process.stdin.isTTY) {
    throw new Error(
      '--env production needs a terminal to confirm at, or --yes to skip the prompt.',
    );
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log(`\nThis will reconfigure auth email and redirect URLs on PRODUCTION (${ref}).`);
    const answer = await rl.question('Type "production" to continue: ');
    return answer.trim() === 'production';
  } finally {
    rl.close();
  }
}

/** Read at call time rather than captured, because loadEnvFile() runs inside
 *  main() and may be what puts it there. */
const token = () => process.env.SUPABASE_ACCESS_TOKEN;

function parseArgs(argv) {
  const args = { dryRun: false, yes: false, check: false, env: null, testEmail: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--env') args.env = argv[++i];
    else if (arg === '--test-email') args.testEmail = argv[++i];
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--yes') args.yes = true;
    else if (arg === '--check') args.check = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

/** Reports what the project already has against what this script would set,
 *  and changes nothing. The question it answers is the one you have after a
 *  deploy behaves oddly: is this project configured the way the repository
 *  thinks it is? */
async function check(ref, token, environment, sender, resendKey, testEmail) {
  const config = await getAuthConfig(ref, token);
  const problems = [];

  const smtpConfigured = (config.smtp_host ?? '') === 'smtp.resend.com';
  console.log(
    smtpConfigured
      ? '  ✓ SMTP points at smtp.resend.com'
      : `  ✗ SMTP host is "${config.smtp_host || '(unset — still Supabase’s shared mailer)'}"`,
  );
  if (!smtpConfigured) problems.push('smtp');

  for (const [field, expected] of Object.entries(MAILER_SETTINGS)) {
    const actual = config[field];
    if (String(actual) === String(expected)) continue;
    console.log(`  ✗ ${field} is ${actual}, expected ${expected}`);
    problems.push(field);
  }

  for (const template of MAILER_TEMPLATES) {
    const content = config[template.contentField] ?? '';
    if (!content) {
      console.log(`  ✗ ${template.file} not applied — this project sends Supabase's stock email`);
      problems.push(template.file);
    } else if (!content.includes('Daykeep')) {
      console.log(`  ✗ ${template.contentField} is set but does not say Daykeep`);
      problems.push(template.file);
    } else if (content.trim() !== loadTemplate(template.file).trim()) {
      console.log(`  ⚠ ${template.file} differs from the copy in this repository`);
      problems.push(template.file);
    }
  }

  const merged = mergeAllowList(config.uri_allow_list, redirectUrlsFor(environment));
  if (merged) {
    console.log(`  ✗ redirect allow-list is missing: ${merged.added.join(', ')}`);
    problems.push('uri_allow_list');
  } else {
    console.log('  ✓ redirect allow-list covers this environment’s scheme');
  }

  const google = googleProviderFields();
  if (!config.external_google_enabled) {
    console.log('  ✗ Google sign-in is disabled — the button fails with "not switched on"');
    problems.push('external_google_enabled');
  } else if (google && config.external_google_client_id !== google.external_google_client_id) {
    // The secret is never returned by the API, so the client id is the only
    // half that can be compared. It is also the half that identifies which
    // Google project is in play, which is the question worth answering.
    console.log('  ✗ Google is enabled with a different client id than .env holds');
    problems.push('external_google_client_id');
  } else {
    console.log(`  ✓ Google enabled — Console must list ${googleCallbackUrl(ref)}`);
  }

  await reportSenderStatus(sender, resendKey);
  if (testEmail) await sendTestEmail(sender, resendKey, testEmail);

  console.log(
    problems.length === 0
      ? '\nThis project matches the repository.'
      : `\n${problems.length} difference(s). Re-run without --check to apply.`,
  );
  return problems.length === 0;
}

async function main() {
  loadEnvFile(join(ROOT, 'supabase', '.env'));
  loadEnvFile(join(ROOT, '.env'));
  loadDbEnv(process.env, ROOT);

  const args = parseArgs(process.argv.slice(2));

  if (!args.env || !ENVIRONMENTS[args.env]) {
    throw new Error(
      '--env is required, and must be "staging" or "production".\n\n' +
        '  npm run configure:auth -- --env staging --dry-run\n' +
        '  npm run configure:auth -- --env production --yes\n\n' +
        'There is deliberately no default: the two projects send email to\n' +
        'different people, and the one you did not mean is the one that has\n' +
        'real users on it.',
    );
  }

  const missing = ['SUPABASE_ACCESS_TOKEN', 'RESEND_API_KEY', 'INVITE_FROM'].filter(
    (name) => !process.env[name],
  );
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(', ')}\n\n` +
        'See the header of this script for what each one is and where it comes from.' +
        (missing.includes('SUPABASE_ACCESS_TOKEN')
          ? '\n\nSUPABASE_ACCESS_TOKEN is a personal access token from\n' +
            'https://supabase.com/dashboard/account/tokens. Put it in `.env`\n' +
            '(gitignored) — it is an operator credential and must never gain an\n' +
            'EXPO_PUBLIC_ prefix, which would inline it into the app bundle.'
          : ''),
    );
  }

  const { variable, read } = ENVIRONMENTS[args.env];
  const dbUrl = read();
  if (!dbUrl) {
    throw new Error(
      `${variable} is not set, so there is no way to tell which project "${args.env}" is.\n\n` +
        'It is the same connection string `npm run migrate` uses; put it in\n' +
        '`.env.db` (gitignored). See scripts/db-env.mjs.',
    );
  }
  const ref = projectRefFromDbUrl(dbUrl);
  if (!ref) {
    throw new Error(
      `Could not read a project ref out of ${variable}.\n\n` +
        'Expected a Supabase connection string — either the session pooler form\n' +
        '(postgres://postgres.<ref>:...@aws-0-<region>.pooler.supabase.com:5432/postgres)\n' +
        'or the direct one (postgres://postgres:...@db.<ref>.supabase.co:5432/postgres).',
    );
  }

  const resendKey = process.env.RESEND_API_KEY;
  const inviteFrom = parseSender(process.env.INVITE_FROM, 'INVITE_FROM');
  const authFrom = process.env.AUTH_SMTP_FROM
    ? parseSender(process.env.AUTH_SMTP_FROM, 'AUTH_SMTP_FROM')
    : inviteFrom;
  const redirectUrls = redirectUrlsFor(args.env);

  console.log(`Environment: ${args.env}`);
  console.log(`Project:     ${ref}`);
  console.log(`Auth emails: ${authFrom.name} <${authFrom.email}>`);
  console.log(`Deep links:  ${redirectUrls[0]} (+3 variants)`);
  if (args.dryRun) console.log('\n(dry run — no requests will be sent)');
  console.log('');

  if (args.check) {
    const ok = await check(ref, token(), args.env, authFrom, resendKey, args.testEmail);
    process.exitCode = ok ? 0 : 1;
    return;
  }

  if (args.env === 'production' && !args.yes && !args.dryRun) {
    if (!(await confirmProduction(ref))) {
      console.log('Aborted — nothing was changed.');
      return;
    }
  }

  await reportSenderStatus(authFrom, resendKey);

  const scheme = redirectUrls[0].split('://')[0];

  console.log('1/6 — pushing the edge-function secrets');
  if (args.dryRun) {
    console.log(`  [dry-run] supabase secrets set --env-file supabase/.env --project-ref ${ref}`);
    console.log(`  [dry-run] supabase secrets set APP_LINK_SCHEME=${scheme} --project-ref ${ref}`);
  } else {
    // The whole file, not a hand-picked list: supabase/.env is already the
    // canonical record of what the functions read (supabase/edge-secrets.test.ts
    // enforces that it stays complete), and naming secrets here as well would
    // be a second list to forget to update. Matches `npm run secrets:push`.
    supabaseCli(['secrets', 'set', '--env-file', join('supabase', '.env'), '--project-ref', ref]);

    // Then the one secret that cannot come from that file, because it is the
    // one whose correct value differs per project. `supabase/.env` is a single
    // file pushed to both projects, so a scheme written into it is right for
    // one of them and wrong for the other — and wrong here means a staging
    // invitation opens the production app, which rejects a token its database
    // has never seen. Applied second so it wins over anything in the file.
    supabaseCli(['secrets', 'set', `APP_LINK_SCHEME=${scheme}`, '--project-ref', ref]);
    console.log(`  ✓ APP_LINK_SCHEME=${scheme}`);
  }

  console.log('\n2/6 — pointing Auth SMTP at Resend');
  await patchAuthConfig(
    ref,
    token(),
    {
      smtp_host: 'smtp.resend.com',
      smtp_port: '465',
      smtp_user: 'resend',
      smtp_pass: resendKey,
      smtp_admin_email: authFrom.email,
      smtp_sender_name: authFrom.name,
    },
    args.dryRun,
    'SMTP relay',
  );

  console.log('\n3/6 — OTP shape and rate limits');
  await patchAuthConfig(ref, token(), MAILER_SETTINGS, args.dryRun, 'mailer settings');

  console.log('\n4/6 — branded templates');
  const templateFields = {};
  for (const template of MAILER_TEMPLATES) {
    templateFields[template.subjectField] = template.subject;
    templateFields[template.contentField] = loadTemplate(template.file);
  }
  await patchAuthConfig(
    ref,
    token(),
    templateFields,
    args.dryRun,
    `${MAILER_TEMPLATES.length} templates`,
  );

  console.log('\n5/6 — redirect allow-list');
  if (args.dryRun) {
    console.log(`  [dry-run] would ensure: ${redirectUrls.join(', ')}`);
  } else {
    const config = await getAuthConfig(ref, token());
    const merged = mergeAllowList(config.uri_allow_list, redirectUrls);
    if (!merged) {
      console.log('  ✓ already covers this environment (nothing removed)');
    } else {
      await patchAuthConfig(
        ref,
        token(),
        { uri_allow_list: merged.list },
        false,
        `added ${merged.added.join(', ')}`,
      );
    }
  }

  console.log('\n6/6 — Google sign-in');
  const google = googleProviderFields();
  if (!google) {
    console.log('  · skipped — GOOGLE_OAUTH_CLIENT_ID / _SECRET not set, provider left as-is');
  } else if (args.dryRun) {
    console.log(`  [dry-run] would enable Google with client ${google.external_google_client_id}`);
  } else {
    await patchAuthConfig(ref, token(), google, false, 'Google provider enabled');
    // The one thing this cannot set, and the one that fails most confusingly:
    // the callback lives in Google's console, not Supabase's. Missing, Google
    // rejects the request with redirect_uri_mismatch before the user sees a
    // consent screen at all.
    console.log(`  → Google Console must list: ${googleCallbackUrl(ref)}`);
  }

  if (args.testEmail) {
    console.log('\nTest send');
    await sendTestEmail(authFrom, resendKey, args.testEmail);
  }

  console.log(
    args.dryRun
      ? '\nDry run complete — nothing was changed.'
      : '\nDone. Ask the app for a real signup code before trusting this in front of\n' +
          `users, then confirm with:  npm run configure:auth -- --env ${args.env} --check`,
  );
}

main().catch((error) => {
  console.error('\n' + error.message);
  process.exit(1);
});
