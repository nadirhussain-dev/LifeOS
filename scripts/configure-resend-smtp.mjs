#!/usr/bin/env node
/**
 * Points this Supabase project's Auth emails (and the send-invite edge
 * function) at Resend, and re-applies the Daykeep-branded OTP templates that
 * were blocked until now.
 *
 * Free-tier Supabase projects refuse custom email templates while they're
 * still on the shared default mailer — every attempt to save
 * "Confirm signup" / "Reset Password" / "Magic Link" fails with
 * "Email template modification is not available for free tier projects
 * using the default email provider." Configuring ANY custom SMTP provider
 * (Resend, in this repo's case) lifts that restriction, even on the free
 * plan — it's the "default email provider" part being replaced that matters,
 * not payment. mailer_otp_length was already fixed to 6 directly (the app's
 * OTP field only ever accepts 6 digits); this script covers everything that
 * was still blocked behind it.
 *
 * What this does, in order:
 *   1. Deploys RESEND_API_KEY and INVITE_FROM as secrets for the send-invite
 *      function (`supabase secrets set`) — that function has been silently
 *      running in its no-email fallback because neither was ever set.
 *   2. Points the project's Auth SMTP settings at Resend's relay
 *      (smtp.resend.com), authenticated with the same API key.
 *   3. Re-applies the branded subject lines + HTML from supabase/templates/
 *      to the Confirm signup / Reset Password / Magic Link templates, now
 *      that they're no longer gated.
 *
 * Requires, in `supabase/.env` (both gitignored) or exported in your shell:
 *   RESEND_API_KEY          From Resend → API Keys. "Sending access" scope is enough.
 *   INVITE_FROM             e.g. "Daykeep <invites@mail.yourdomain.com>" — must be an
 *                            address on a domain verified in Resend, or every send
 *                            bounces at Resend, not at Supabase. The sandbox sender
 *                            "Daykeep <onboarding@resend.dev>" needs no domain but
 *                            delivers ONLY to the Resend account's own address.
 * and in `.env`, or exported:
 *   SUPABASE_ACCESS_TOKEN   Account-level PAT — https://supabase.com/dashboard/account/tokens
 *   EXPO_PUBLIC_SUPABASE_URL   Used only to read the project ref out of its hostname.
 *
 * ⚠️  EXPO_PUBLIC_SUPABASE_URL decides WHICH PROJECT this writes to, and it is
 * whatever your local `.env` points at. Staging and production are separate
 * projects; run --dry-run first and read the project ref it prints.
 * Optional:
 *   AUTH_SMTP_FROM           Sender identity for Auth emails specifically, if you
 *                            want it different from INVITE_FROM (e.g. a
 *                            noreply@ address instead of invites@). Defaults to
 *                            INVITE_FROM.
 *
 * Usage:
 *   node scripts/configure-resend-smtp.mjs             # applies everything
 *   node scripts/configure-resend-smtp.mjs --dry-run    # prints the plan, no requests
 */
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATES = join(ROOT, 'supabase', 'templates');
const API = 'https://api.supabase.com/v1';

/** Only fills vars nothing has already set — a real exported env var always
 *  wins over a file, same precedence every dotenv-shaped tool uses.
 *
 *  Two files, because the values come from two different places and only one of
 *  them may ever sit next to an EXPO_PUBLIC_ name: `supabase/.env` holds the
 *  edge-function secrets (RESEND_API_KEY, INVITE_FROM — see
 *  supabase/.env.example for why they live apart from the app's env), and `.env`
 *  holds the operator credential this script needs to reach the Management API.
 *  Read in that order so the secrets file wins on any name they share. */
function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
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

function parseSender(raw, varName) {
  const match = raw.match(/^(.*)<(.+)>$/);
  if (!match) {
    throw new Error(`${varName} must look like "Daykeep <address@yourdomain.com>" — got: ${raw}`);
  }
  return { name: match[1].trim().replace(/^"|"$/g, ''), email: match[2].trim() };
}

function projectRefFrom(supabaseUrl) {
  const host = new URL(supabaseUrl).hostname; // "<ref>.supabase.co"
  const ref = host.split('.')[0];
  if (!ref) throw new Error(`Could not read a project ref out of ${supabaseUrl}`);
  return ref;
}

async function patchAuthConfig(ref, token, fields, dryRun) {
  if (dryRun) {
    console.log('  [dry-run] PATCH config/auth with:', Object.keys(fields).join(', '));
    return;
  }
  const res = await fetch(`${API}/projects/${ref}/config/auth`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`PATCH config/auth failed (${res.status}): ${body}`);
  }
}

function loadTemplate(file) {
  const html = readFileSync(join(TEMPLATES, file), 'utf8');
  // Strip the leading implementation-note comment — that's for repo readers,
  // not part of the email Supabase actually sends.
  return html.replace(/^<!--[\s\S]*?-->\s*/, '');
}

async function main() {
  loadEnvFile(join(ROOT, 'supabase', '.env'));
  loadEnvFile(join(ROOT, '.env'));
  const dryRun = process.argv.includes('--dry-run');

  const required = [
    'SUPABASE_ACCESS_TOKEN',
    'EXPO_PUBLIC_SUPABASE_URL',
    'RESEND_API_KEY',
    'INVITE_FROM',
  ];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.error(`Missing required environment variable(s): ${missing.join(', ')}`);
    console.error('See the header of this script for what each one is and where it comes from.');
    process.exit(1);
  }

  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = projectRefFrom(process.env.EXPO_PUBLIC_SUPABASE_URL);
  const resendKey = process.env.RESEND_API_KEY;
  const inviteFrom = parseSender(process.env.INVITE_FROM, 'INVITE_FROM');
  const authFrom = process.env.AUTH_SMTP_FROM
    ? parseSender(process.env.AUTH_SMTP_FROM, 'AUTH_SMTP_FROM')
    : inviteFrom;

  console.log(`Project: ${ref}${dryRun ? '  (dry run — no requests will be sent)' : ''}`);
  console.log(`Auth emails will send as: ${authFrom.name} <${authFrom.email}>`);
  console.log('');

  console.log('1/3 — deploying RESEND_API_KEY and INVITE_FROM as send-invite secrets');
  if (dryRun) {
    console.log(
      '  [dry-run] supabase secrets set RESEND_API_KEY=*** INVITE_FROM=*** --project-ref',
      ref,
    );
  } else {
    execFileSync(
      'supabase',
      [
        'secrets',
        'set',
        `RESEND_API_KEY=${resendKey}`,
        `INVITE_FROM=${process.env.INVITE_FROM}`,
        '--project-ref',
        ref,
      ],
      { stdio: 'inherit' },
    );
  }

  console.log('\n2/3 — pointing Auth SMTP at Resend');
  await patchAuthConfig(
    ref,
    token,
    {
      smtp_host: 'smtp.resend.com',
      smtp_port: '465',
      smtp_user: 'resend',
      smtp_pass: resendKey,
      smtp_admin_email: authFrom.email,
      smtp_sender_name: authFrom.name,
    },
    dryRun,
  );

  console.log('\n3/3 — re-applying the branded templates (previously blocked)');
  await patchAuthConfig(
    ref,
    token,
    {
      mailer_subjects_confirmation: 'Your Daykeep verification code',
      mailer_templates_confirmation_content: loadTemplate('confirm-signup.html'),
      mailer_subjects_recovery: 'Your Daykeep password reset code',
      mailer_templates_recovery_content: loadTemplate('reset-password.html'),
      mailer_subjects_magic_link: 'Your Daykeep sign-in code',
      mailer_templates_magic_link_content: loadTemplate('magic-link.html'),
      mailer_otp_length: 6,
    },
    dryRun,
  );

  console.log(
    dryRun
      ? '\nDry run complete — nothing was changed.'
      : '\nDone. Send yourself a real signup code to confirm delivery before trusting this in front of users.',
  );
}

main().catch((error) => {
  console.error('\n' + error.message);
  process.exit(1);
});
