-- 0042 — Cross-device onboarding status.
--
-- `onboardingComplete` (features/profile/store/profile-store.ts) has been a
-- LOCAL, per-device flag by design: a fresh install always re-runs onboarding
-- regardless of the account's history, because onboarding's answers (name,
-- gender, focus areas) are themselves device-local and re-asking costs
-- little. That reasoning breaks down for exactly one case: an existing user
-- signing in on a device that has never seen them before lands back in the
-- welcome flow instead of their dashboard, which reads as "sign-in doesn't
-- work" even though the account and its data are both fine.
--
-- `onboarding_completed_at` is the fix: a plain timestamp on the account's
-- own profile row, set once onboarding finishes on ANY device, read by every
-- other device that signs into the same account afterward. It answers one
-- question only — "has this account ever finished onboarding" — and changes
-- nothing about onboarding itself staying otherwise local.

alter table public.profiles
  add column if not exists onboarding_completed_at bigint;
