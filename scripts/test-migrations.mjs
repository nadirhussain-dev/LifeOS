#!/usr/bin/env node
/**
 * Executes supabase/migrations against a real (WASM) Postgres and asserts the
 * behaviour that only running it can prove: that the migrations apply at all,
 * that row-level security actually refuses what it should, and that the
 * constraint triggers fire when they should.
 *
 * `check-migrations.mjs` reads the SQL; this one runs it.
 *
 * Every policy assertion goes through asUser(), which SETs ROLE to
 * `authenticated`. Postgres exempts superusers from RLS, so an assertion made on
 * the default connection would pass without proving anything.
 *
 * Run with `npm run test:sql`.
 */
import {
  asAnon,
  asUser,
  bootDatabase,
  createUser,
  expectEqual,
  expectRejection,
  summary,
  test,
} from './sql-harness.mjs';

const ALICE = '11111111-1111-1111-1111-111111111111';
const BOB = '22222222-2222-2222-2222-222222222222';
const STRANGER = '33333333-3333-3333-3333-333333333333';
// 0010: moderation needs an operator, somebody to moderate, and somebody whose
// behaviour trips a rule on its own.
const ADMIN = '55555555-5555-5555-5555-555555555555';
const MALLORY = '66666666-6666-6666-6666-666666666666';
const VANDAL = '77777777-7777-7777-7777-777777777777';
// 0018: a subject with no report history, so the report gate is tested from a
// clean slate — ALICE already collects reports in the 0010 rate-limit tests.
const SUBJECT = '88888888-8888-8888-8888-888888888888';

const { db, files } = await bootDatabase();
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const count = async (sql, params = []) => Number((await one(sql, params)).n);

/**
 * Today as the server sees it — the window checks in `record_usage` are relative
 * to `current_date`, so the test has to speak the same calendar.
 *
 * It is asked for rather than computed. This was
 * `new Date().toISOString().slice(0, 10)`, which is the date in UTC, while
 * `current_date` resolves in the session's timezone — so on any machine not set
 * to UTC the two disagree for part of every day, `record_anon_activity` filed
 * its row under one date and the dashboard was queried for the other, and
 * "0010 an admin sees both halves of the active population" failed with zero
 * installs. CI runs in UTC and has never seen it.
 *
 * Asking the database removes the assumption instead of correcting it: whatever
 * `current_date` means here, that is what the tests use.
 */
const TODAY = (await one(`select current_date::text as d`)).d;

console.log(`applied ${files.length} migrations\n`);

await createUser(db, ALICE, 'alice@example.com');
await createUser(db, BOB, 'bob@example.com');
await createUser(db, STRANGER, 'stranger@example.com');
await createUser(db, ADMIN, 'admin@example.com');
await createUser(db, MALLORY, 'mallory@example.com');
await createUser(db, VANDAL, 'vandal@example.com');
await createUser(db, SUBJECT, 'subject@example.com');

// ---------------------------------------------------------------------------
console.log('schema');
// ---------------------------------------------------------------------------

await test('0001 auto-creates a profile for each new auth user', async () => {
  expectEqual(await count('select count(*)::int n from public.profiles'), 7, 'profile count');
});

await test('every public table has row level security enabled', async () => {
  const n = await count(`
    select count(*)::int n from pg_tables t
     where t.schemaname = 'public'
       and not exists (
         select 1 from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
          where ns.nspname = 'public' and c.relname = t.tablename and c.relrowsecurity
       )`);
  expectEqual(n, 0, 'tables without RLS');
});

// ---------------------------------------------------------------------------
console.log('\nusernames (0002)');
// ---------------------------------------------------------------------------

await test('a free username reads as available', async () => {
  await asUser(db, ALICE, async () => {
    expectEqual((await one(`select public.is_username_available('alice') as v`)).v, true);
  });
});

await test('claiming succeeds and then reads as taken by somebody else', async () => {
  await asUser(db, ALICE, async () => {
    expectEqual((await one(`select public.claim_username('alice') as v`)).v, 'ok');
  });
  // The bug this guards: `profiles_own` RLS hides Alice's row from Bob, so a
  // plain `select ... where username='alice'` returns nothing and the name looks
  // free. The SECURITY DEFINER probe is what makes this false.
  await asUser(db, BOB, async () => {
    expectEqual((await one(`select public.is_username_available('alice') as v`)).v, false);
  });
});

await test('uniqueness is case-insensitive', async () => {
  await asUser(db, BOB, async () => {
    expectEqual((await one(`select public.is_username_available('ALICE') as v`)).v, false);
  });
});

await test('your own name is not a clash with yourself', async () => {
  await asUser(db, ALICE, async () => {
    expectEqual((await one(`select public.is_username_available('alice') as v`)).v, true);
  });
});

await test('a lost race returns taken rather than a 500', async () => {
  await asUser(db, BOB, async () => {
    expectEqual((await one(`select public.claim_username('alice') as v`)).v, 'taken');
  });
});

await test('malformed names are rejected by shape', async () => {
  await asUser(db, BOB, async () => {
    for (const bad of ['ab', '1bob', 'has space', 'no-dashes', 'x'.repeat(21)]) {
      const r = await one(`select public.is_username_available($1) as v`, [bad]);
      expectEqual(r.v, false, `availability of ${JSON.stringify(bad)}`);
    }
  });
});

// ---------------------------------------------------------------------------
console.log('\nusernames from the sign-up screen (0006)');
// ---------------------------------------------------------------------------

// Sign-up is the only caller of the probe, and it runs BEFORE the account exists
// — so the identity that matters is `anon` with a NULL auth.uid(). Every test
// above runs through asUser() and so cannot see this path at all. 0002 granted
// the function to `authenticated` only: anon got "permission denied", the client
// read any error as a negative verdict, and every name on the sign-up form came
// back "already taken" — which also made the form impossible to submit, since it
// gates on a positive verdict.

await test('an anonymous visitor may probe a name at all', async () => {
  await asAnon(db, async () => {
    expectEqual((await one(`select public.is_username_available('freename') as v`)).v, true);
  });
});

await test('an anonymous visitor sees a taken name as taken', async () => {
  // The null-safe self-exclusion is what this proves. With `id <> auth.uid()`,
  // a NULL uid makes the comparison NULL for every row, the NOT EXISTS matches
  // nothing, and 'alice' would come back free — the exact opposite failure.
  await asAnon(db, async () => {
    expectEqual((await one(`select public.is_username_available('alice') as v`)).v, false);
    expectEqual((await one(`select public.is_username_available('ALICE') as v`)).v, false);
  });
});

await test('an anonymous visitor still cannot read the profiles table', async () => {
  // The grant widens exactly one boolean function, not the table behind it.
  await asAnon(db, async () => {
    expectEqual(
      await count(`select count(*)::int n from public.profiles`),
      0,
      'profile rows visible to anon',
    );
  });
});

await test('claiming a name still requires a session', async () => {
  await asAnon(db, async () => {
    await expectRejection(
      () => db.query(`select public.claim_username('freename')`),
      'permission denied',
    );
  });
});

// ---------------------------------------------------------------------------
console.log('\ngroups & RLS (0003)');
// ---------------------------------------------------------------------------

let groupId;

await test('creating a group makes the creator an owner member, atomically', async () => {
  await asUser(db, ALICE, async () => {
    const r = await one(
      `select public.create_expense_group('g1','Goa trip','trip','$','m-alice',null,'act-1',$1) as id`,
      [Date.now()],
    );
    expectEqual(r.id, 'g1', 'returned group id');
  });
  groupId = 'g1';

  const role = (await one(`select role from public.expense_group_members where id = 'm-alice'`))
    .role;
  expectEqual(role, 'owner', "creator's role");
});

await test('0007 a user with no profile row can still create a group', async () => {
  // The bug 0007 fixes. 0004 added the owner with INSERT..SELECT FROM profiles,
  // which inserts nothing when there is no profile row — so the creator was not
  // a member, the activity insert was then refused by RLS, and the whole
  // transaction rolled back with an opaque 42501 that the app reported to the
  // user as a connection failure.
  const GHOST = '44444444-4444-4444-4444-444444444444';
  await db.exec(`alter table auth.users disable trigger on_auth_user_created;`);
  await db.query(`insert into auth.users (id, email) values ($1::uuid, 'ghost@example.com')`, [
    GHOST,
  ]);
  await db.exec(`alter table auth.users enable trigger on_auth_user_created;`);
  expectEqual(
    await count(`select count(*)::int n from public.profiles where id = $1::uuid`, [GHOST]),
    0,
    'profile rows before',
  );

  await asUser(db, GHOST, async () => {
    const r = await one(
      `select public.create_expense_group('g-ghost','Flat 3B','home','$','m-ghost',null,'act-ghost',$1) as id`,
      [Date.now()],
    );
    expectEqual(r.id, 'g-ghost', 'returned group id');
  });

  expectEqual(
    await count(`select count(*)::int n from public.profiles where id = $1::uuid`, [GHOST]),
    1,
    'profile self-healed',
  );
  expectEqual(
    await count(
      `select count(*)::int n from public.expense_group_members
        where group_id = 'g-ghost' and role = 'owner'`,
    ),
    1,
    'owner member row',
  );
  // And the creator can actually see what they made.
  await asUser(db, GHOST, async () => {
    expectEqual(
      await count(`select count(*)::int n from public.expense_groups where id = 'g-ghost'`),
      1,
      'group visible to its creator',
    );
  });
});

await test('0007 ensure_profile is idempotent and never clobbers an existing name', async () => {
  await asUser(db, ALICE, async () => {
    await db.query(`select public.ensure_profile()`);
    await db.query(`select public.ensure_profile()`);
  });
  expectEqual(
    await count(`select count(*)::int n from public.profiles where id = $1::uuid`, [ALICE]),
    1,
    'profile rows for Alice',
  );
  expectEqual(
    (await one(`select display_name from public.profiles where id = $1::uuid`, [ALICE]))
      .display_name,
    'alice',
    "Alice's display name",
  );
});

await test('0007 ensure_profile refuses an anonymous caller', async () => {
  await asAnon(db, async () => {
    await expectRejection(() => db.query(`select public.ensure_profile()`), 'permission denied');
  });
});

await test('a member can read their group', async () => {
  await asUser(db, ALICE, async () => {
    expectEqual(
      await count(`select count(*)::int n from public.expense_groups`),
      1,
      'groups visible',
    );
  });
});

await test('a non-member cannot see the group at all', async () => {
  await asUser(db, STRANGER, async () => {
    expectEqual(
      await count(`select count(*)::int n from public.expense_groups`),
      0,
      'groups visible',
    );
  });
});

await test('a stranger cannot insert themselves into somebody elses group', async () => {
  // The hole in the first draft of 0003: `with check (user_id = auth.uid())`
  // would have let anyone join any group and read every expense in it.
  await asUser(db, STRANGER, async () => {
    await expectRejection(
      () =>
        db.query(
          `insert into public.expense_group_members
             (id, group_id, user_id, email, role, created_at, updated_at)
           values ('m-hack', $1, $2, 'stranger@example.com', 'member', 0, 0)`,
          [groupId, STRANGER],
        ),
      'policy',
    );
  });
});

await test('a member can add somebody by email before they have an account', async () => {
  await asUser(db, ALICE, async () => {
    await db.query(
      `insert into public.expense_group_members
         (id, group_id, user_id, email, display_name, role, created_at, updated_at)
       values ('m-bob', $1, null, 'bob@example.com', 'Bob', 'member', 0, 0)`,
      [groupId],
    );
  });

  const row = await one(`select user_id, email from public.expense_group_members where id='m-bob'`);
  expectEqual(row.user_id, null, 'placeholder user_id');
});

await test('a non-member cannot add members', async () => {
  await asUser(db, STRANGER, async () => {
    await expectRejection(
      () =>
        db.query(
          `insert into public.expense_group_members
             (id, group_id, user_id, email, role, created_at, updated_at)
           values ('m-x', $1, null, 'x@example.com', 'member', 0, 0)`,
          [groupId],
        ),
      'policy',
    );
  });
});

// ---------------------------------------------------------------------------
console.log('\nexpenses, shares & the sum invariant (0003 + 0004)');
// ---------------------------------------------------------------------------

await test('an expense and its split commit together', async () => {
  await asUser(db, ALICE, async () => {
    await db.query(
      `select public.create_group_expense('e1',$1,'m-alice','Dinner',1000,'$',$2,null,
         $3::jsonb,'act-2',$2)`,
      [
        groupId,
        Date.now(),
        JSON.stringify([
          { member_id: 'm-alice', share_cents: 334 },
          { member_id: 'm-bob', share_cents: 333 },
        ]),
      ],
    );
  }).catch(() => {});
  // 334 + 333 = 667, not 1000 — the deferred trigger must have rejected it.
  expectEqual(
    await count(`select count(*)::int n from public.expense_group_expenses`),
    0,
    'expenses after an unbalanced split',
  );
});

await test('a split that does not add up is refused', async () => {
  await asUser(db, ALICE, async () => {
    await expectRejection(
      () =>
        db.query(
          `select public.create_group_expense('e-bad',$1,'m-alice','Bad',1000,'$',$2,null,
             $3::jsonb,'act-bad',$2)`,
          [groupId, Date.now(), JSON.stringify([{ member_id: 'm-alice', share_cents: 999 }])],
        ),
      'shares total',
    );
  });
});

await test('a split that adds up is accepted', async () => {
  await asUser(db, ALICE, async () => {
    await db.query(
      `select public.create_group_expense('e1',$1,'m-alice','Dinner',1000,'$',$2,null,
         $3::jsonb,'act-2',$2)`,
      [
        groupId,
        Date.now(),
        JSON.stringify([
          { member_id: 'm-alice', share_cents: 500 },
          { member_id: 'm-bob', share_cents: 500 },
        ]),
      ],
    );
  });
  expectEqual(
    await count(`select count(*)::int n from public.expense_group_shares where expense_id='e1'`),
    2,
    'share rows',
  );
});

await test('editing only the amount is refused, leaving no stale split', async () => {
  // The second trigger exists for exactly this: guarding the shares side alone
  // would let an amount edit orphan a split that no longer sums.
  await asUser(db, ALICE, async () => {
    await expectRejection(
      () => db.query(`update public.expense_group_expenses set amount_cents = 5000 where id='e1'`),
      'shares total',
    );
  });
  expectEqual(
    Number(
      (await one(`select amount_cents from public.expense_group_expenses where id='e1'`))
        .amount_cents,
    ),
    1000,
    'amount after the refused edit',
  );
});

await test('editing amount and split together succeeds', async () => {
  await asUser(db, ALICE, async () => {
    await db.query(
      `select public.update_group_expense('e1','Dinner',2000,'m-alice',$1,null,$2::jsonb,'act-3',$1)`,
      [
        Date.now(),
        JSON.stringify([
          { member_id: 'm-alice', share_cents: 1000 },
          { member_id: 'm-bob', share_cents: 1000 },
        ]),
      ],
    );
  });
  expectEqual(
    Number(
      (await one(`select amount_cents from public.expense_group_expenses where id='e1'`))
        .amount_cents,
    ),
    2000,
    'amount after a valid edit',
  );
});

await test('a non-member cannot read the groups expenses', async () => {
  await asUser(db, STRANGER, async () => {
    expectEqual(
      await count(`select count(*)::int n from public.expense_group_expenses`),
      0,
      'expenses visible',
    );
  });
});

await test('a non-member cannot read its shares either', async () => {
  await asUser(db, STRANGER, async () => {
    expectEqual(
      await count(`select count(*)::int n from public.expense_group_shares`),
      0,
      'shares visible',
    );
  });
});

await test('activity is append-only — even for its own author', async () => {
  // With no UPDATE policy the rows are invisible to UPDATE, so this affects zero
  // rows rather than raising. The history is protected either way; asserting the
  // value is what proves it.
  await asUser(db, ALICE, async () => {
    await db.query(
      `update public.expense_group_activity set action='expense_deleted' where id='act-2'`,
    );
  });
  expectEqual(
    (await one(`select action from public.expense_group_activity where id='act-2'`)).action,
    'expense_added',
    'action after an attempted rewrite',
  );
});

// ---------------------------------------------------------------------------
console.log('\ninvitations & push (0005)');
// ---------------------------------------------------------------------------

await test('an invitation can be created by a member', async () => {
  await asUser(db, ALICE, async () => {
    await db.query(
      `select public.create_group_invitation('inv-1',$1,'m-bob','bob@example.com','tok-good',$2,$3)`,
      [groupId, Date.now() + 86400000, Date.now()],
    );
  });
  expectEqual(
    await count(`select count(*)::int n from public.expense_group_invitations`),
    1,
    'invitations',
  );
});

await test('peeking reveals the group name and nothing else', async () => {
  await asUser(db, BOB, async () => {
    const r = await one(`select * from public.peek_group_invitation('tok-good',$1)`, [Date.now()]);
    expectEqual(r.status, 'ok');
    expectEqual(r.group_name, 'Goa trip');
  });
});

await test('an unknown token is invalid', async () => {
  await asUser(db, BOB, async () => {
    const r = await one(`select * from public.peek_group_invitation('nope',$1)`, [Date.now()]);
    expectEqual(r.status, 'invalid');
  });
});

await test('accepting claims the placeholder member, so prior splits carry over', async () => {
  await asUser(db, BOB, async () => {
    expectEqual(
      (await one(`select public.accept_group_invitation('tok-good',$1) as v`, [Date.now()])).v,
      'ok',
    );
  });
  const row = await one(`select user_id from public.expense_group_members where id='m-bob'`);
  expectEqual(row.user_id, BOB, "Bob's claimed member row");
  // The share written before Bob had an account is still his.
  expectEqual(
    await count(`select count(*)::int n from public.expense_group_shares where member_id='m-bob'`),
    1,
    'shares carried over',
  );
});

await test('Bob can now read the group he joined', async () => {
  await asUser(db, BOB, async () => {
    expectEqual(
      await count(`select count(*)::int n from public.expense_groups`),
      1,
      'groups visible',
    );
  });
});

await test('an invitation cannot be redeemed twice', async () => {
  await asUser(db, STRANGER, async () => {
    expectEqual(
      (await one(`select public.accept_group_invitation('tok-good',$1) as v`, [Date.now()])).v,
      'already_accepted',
    );
  });
});

await test('an expired invitation is refused', async () => {
  await asUser(db, ALICE, async () => {
    await db.query(
      `select public.create_group_invitation('inv-2',$1,'m-bob','x@example.com','tok-old',$2,$3)`,
      [groupId, Date.now() - 1000, Date.now()],
    );
  });
  await asUser(db, STRANGER, async () => {
    expectEqual(
      (await one(`select public.accept_group_invitation('tok-old',$1) as v`, [Date.now()])).v,
      'expired',
    );
  });
});

await test('a device token is private to its owner', async () => {
  const now = Date.now();
  await asUser(db, ALICE, async () => {
    await db.query(`select public.register_push_token('ExponentPushToken[alice]','ios',$1)`, [now]);
  });
  await asUser(db, BOB, async () => {
    expectEqual(
      await count(`select count(*)::int n from public.push_tokens`),
      0,
      'tokens Bob can see',
    );
  });
  await asUser(db, ALICE, async () => {
    expectEqual(
      await count(`select count(*)::int n from public.push_tokens`),
      1,
      'tokens Alice can see',
    );
  });
});

await test('re-registering the same device updates rather than duplicates', async () => {
  const now = Date.now();
  await asUser(db, BOB, async () => {
    await db.query(`select public.register_push_token('ExponentPushToken[alice]','android',$1)`, [
      now,
    ]);
  });
  expectEqual(await count(`select count(*)::int n from public.push_tokens`), 1, 'total token rows');
  expectEqual((await one(`select user_id from public.push_tokens`)).user_id, BOB, 'new owner');
});

// ---------------------------------------------------------------------------
console.log('\ngroup lifecycle (0008)');
// ---------------------------------------------------------------------------

await test('0008 removing a member tombstones them rather than deleting the row', async () => {
  // The row has to survive: expenses, shares and settlements all reference it,
  // and the balances only add up while every party still resolves.
  await asUser(db, ALICE, async () => {
    await db.query(
      `insert into public.expense_group_members (id, group_id, user_id, email, display_name, role, created_at, updated_at)
       values ('m-temp', $1, null, 'temp@example.com', 'Temp', 'member', $2, $2)`,
      [groupId, Date.now()],
    );
    await db.query(`select public.remove_group_member('m-temp','act-rm',$1)`, [Date.now()]);
  });

  expectEqual(
    await count(`select count(*)::int n from public.expense_group_members where id = 'm-temp'`),
    1,
    'member row still present',
  );
  expectEqual(
    await count(
      `select count(*)::int n from public.expense_group_members
        where id = 'm-temp' and deleted_at is not null`,
    ),
    1,
    'member tombstoned',
  );
});

await test('0008 a removed member is still readable, so balances stay complete', async () => {
  await asUser(db, ALICE, async () => {
    expectEqual(
      await count(`select count(*)::int n from public.expense_group_members where id = 'm-temp'`),
      1,
      'removed member visible to the group',
    );
  });
});

await test('0008 removing somebody is recorded in the activity feed', async () => {
  expectEqual(
    await count(
      `select count(*)::int n from public.expense_group_activity
        where id = 'act-rm' and action = 'member_removed'`,
    ),
    1,
    'member_removed entries',
  );
});

await test('0008 a member cannot remove another member', async () => {
  await asUser(db, ALICE, async () => {
    await db.query(
      `insert into public.expense_group_members (id, group_id, user_id, email, display_name, role, created_at, updated_at)
       values ('m-victim', $1, null, 'victim@example.com', 'Victim', 'member', $2, $2)`,
      [groupId, Date.now()],
    );
  });
  await asUser(db, BOB, async () => {
    await expectRejection(
      () => db.query(`select public.remove_group_member('m-victim','act-bad',$1)`, [Date.now()]),
      'only the group owner',
    );
  });
});

await test('0008 anybody may remove themselves, and it reads as leaving', async () => {
  const bobMember = await one(
    `select id from public.expense_group_members
      where group_id = $1 and user_id = $2::uuid and deleted_at is null`,
    [groupId, BOB],
  );
  await asUser(db, BOB, async () => {
    await db.query(`select public.remove_group_member($1,'act-left',$2)`, [
      bobMember.id,
      Date.now(),
    ]);
  });
  expectEqual(
    await count(
      `select count(*)::int n from public.expense_group_activity
        where id = 'act-left' and action = 'member_left'`,
    ),
    1,
    'member_left entries',
  );
});

await test('0008 the owner cannot be removed, which would orphan the group', async () => {
  await asUser(db, ALICE, async () => {
    await expectRejection(
      () => db.query(`select public.remove_group_member('m-alice','act-owner',$1)`, [Date.now()]),
      'owner cannot be removed',
    );
  });
});

await test('0008 a non-owner cannot delete the group', async () => {
  await asUser(db, ALICE, async () => {
    await db.query(
      `insert into public.expense_group_members (id, group_id, user_id, email, display_name, role, created_at, updated_at)
       values ('m-carol', $1, $2::uuid, 'stranger@example.com', 'Carol', 'member', $3, $3)`,
      [groupId, STRANGER, Date.now()],
    );
  });
  await asUser(db, STRANGER, async () => {
    await expectRejection(
      () =>
        db.query(`select public.delete_expense_group($1,'act-del-bad',$2)`, [groupId, Date.now()]),
      'only the group owner',
    );
  });
});

await test('0008 a member cannot soft-delete the group by writing the column directly', async () => {
  // expense_groups_update lets any member write any column, so the narrowing
  // has to be a trigger — a policy cannot see which column changed.
  await asUser(db, STRANGER, async () => {
    await expectRejection(
      () =>
        db.query(`update public.expense_groups set deleted_at = $1 where id = $2`, [
          Date.now(),
          groupId,
        ]),
      'only the group owner',
    );
  });
});

await test('0008 the owner can delete the group, and it is a tombstone', async () => {
  await asUser(db, ALICE, async () => {
    await db.query(`select public.delete_expense_group($1,'act-del',$2)`, [groupId, Date.now()]);
  });
  expectEqual(
    await count(`select count(*)::int n from public.expense_groups where id = $1`, [groupId]),
    1,
    'group row survives',
  );
  expectEqual(
    await count(
      `select count(*)::int n from public.expense_groups where id = $1 and deleted_at is not null`,
      [groupId],
    ),
    1,
    'group tombstoned',
  );
  // The whole point of soft-deleting: the ledger is still there for everyone.
  expectEqual(
    (await count(`select count(*)::int n from public.expense_group_expenses where group_id = $1`, [
      groupId,
    ])) > 0,
    true,
    'expenses preserved',
  );
});

await test('0008 deleting the group is recorded before it disappears from reads', async () => {
  expectEqual(
    await count(
      `select count(*)::int n from public.expense_group_activity
        where id = 'act-del' and action = 'group_deleted'`,
    ),
    1,
    'group_deleted entries',
  );
});

// ---------------------------------------------------------------------------
console.log('\nhistory sync (0009)');
// ---------------------------------------------------------------------------

const HISTORY_TABLES = [
  'habit_logs',
  'habit_skips',
  'water_intake_logs',
  'goal_milestones',
  'goal_progress_logs',
  'study_sessions',
  'journal_reflections',
];

await test('0009 every history table exists with the columns the engine needs', async () => {
  for (const table of HISTORY_TABLES) {
    const n = await count(
      `select count(*)::int n from information_schema.columns
        where table_schema = 'public' and table_name = $1
          and column_name in ('id','user_id','updated_at','deleted_at')`,
      [table],
    );
    expectEqual(n, 4, `${table} sync columns`);
  }
});

await test('0009 history is private to its owner', async () => {
  const now = Date.now();
  await asUser(db, ALICE, async () => {
    await db.query(
      `insert into public.habit_logs (id, user_id, habit_id, log_date, value, logged_at, created_at, updated_at)
       values ('hl-alice', $1::uuid, 'h1', '2026-07-30', 1, $2, $2, $2)`,
      [ALICE, now],
    );
  });
  await asUser(db, BOB, async () => {
    expectEqual(
      await count(`select count(*)::int n from public.habit_logs`),
      0,
      'habit logs Bob can see',
    );
  });
  await asUser(db, ALICE, async () => {
    expectEqual(
      await count(`select count(*)::int n from public.habit_logs`),
      1,
      'habit logs Alice can see',
    );
  });
});

await test('0009 one user cannot write history under another uid', async () => {
  const now = Date.now();
  await asUser(db, BOB, async () => {
    await expectRejection(
      () =>
        db.query(
          `insert into public.habit_logs (id, user_id, habit_id, log_date, value, logged_at, created_at, updated_at)
           values ('hl-forged', $1::uuid, 'h1', '2026-07-30', 1, $2, $2, $2)`,
          [ALICE, now],
        ),
      'row-level security',
    );
  });
});

await test('0009 a soft-deleted row still syncs, so the delete propagates', async () => {
  // The whole reason deleted_at exists here: a hard delete leaves nothing to
  // pull, so the row is resurrected on the next sync from another device.
  const now = Date.now();
  await asUser(db, ALICE, async () => {
    await db.query(
      `update public.habit_logs set deleted_at = $1, updated_at = $1 where id = 'hl-alice'`,
      [now + 1000],
    );
    expectEqual(
      await count(`select count(*)::int n from public.habit_logs where deleted_at is not null`),
      1,
      'tombstoned rows still readable',
    );
  });
});

// ---------------------------------------------------------------------------
console.log('\nusage rollups (0010)');
// ---------------------------------------------------------------------------

await test('0010 usage accumulates rather than overwrites', async () => {
  // The whole reason record_usage exists instead of a PostgREST upsert: the
  // client sends a delta per flush, and two flushes in a day must add up.
  await asUser(db, ALICE, async () => {
    await db.query(`select public.record_usage($1::jsonb, $2::bigint)`, [
      JSON.stringify([{ day: TODAY, module: 'habits', opens: 2, writes: 1 }]),
      Date.now(),
    ]);
    await db.query(`select public.record_usage($1::jsonb, $2::bigint)`, [
      JSON.stringify([{ day: TODAY, module: 'habits', opens: 3, writes: 2 }]),
      Date.now(),
    ]);
  });
  const row = await one(
    `select opens, writes from public.usage_daily
      where user_id = $1::uuid and module = 'habits' and day = $2::date`,
    [ALICE, TODAY],
  );
  expectEqual(row.opens, 5, 'opens');
  expectEqual(row.writes, 3, 'writes');
});

await test('0010 a client cannot move a counter by six orders of magnitude', async () => {
  await asUser(db, ALICE, async () => {
    await db.query(`select public.record_usage($1::jsonb, $2::bigint)`, [
      JSON.stringify([{ day: TODAY, module: 'vault', opens: 999999, writes: 0 }]),
      Date.now(),
    ]);
  });
  expectEqual(
    (
      await one(
        `select opens from public.usage_daily
          where user_id = $1::uuid and module = 'vault' and day = $2::date`,
        [ALICE, TODAY],
      )
    ).opens,
    10000,
    'clamped opens',
  );
});

await test('0010 a device with a wrong clock cannot write history', async () => {
  const longAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  await asUser(db, ALICE, async () => {
    await db.query(`select public.record_usage($1::jsonb, $2::bigint)`, [
      JSON.stringify([{ day: longAgo, module: 'sleep', opens: 1, writes: 1 }]),
      Date.now(),
    ]);
  });
  expectEqual(
    await count(`select count(*)::int n from public.usage_daily where day = $1::date`, [longAgo]),
    0,
    'rows written outside the window',
  );
});

await test('0010 usage is private to its owner', async () => {
  await asUser(db, BOB, async () => {
    expectEqual(
      await count(`select count(*)::int n from public.usage_daily`),
      0,
      'usage rows Bob can see',
    );
  });
  await asUser(db, ALICE, async () => {
    expectEqual(
      (await count(`select count(*)::int n from public.usage_daily`)) > 0,
      true,
      'Alice can see her own',
    );
  });
});

await test('0010 recording usage requires a session', async () => {
  await asAnon(db, async () => {
    await expectRejection(
      () =>
        db.query(`select public.record_usage($1::jsonb, $2::bigint)`, [
          JSON.stringify([{ day: TODAY, module: 'habits', opens: 1, writes: 0 }]),
          Date.now(),
        ]),
      'permission denied',
    );
  });
});

await test('0010 a signed-out install can be counted, once per day', async () => {
  // Guest mode is a supported way to use Daykeep, so actives measured only from
  // usage_daily would silently under-report by everyone without an account.
  const install = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  await asAnon(db, async () => {
    await db.query(`select public.record_anon_activity($1,'ios','1.3.0')`, [install]);
    await db.query(`select public.record_anon_activity($1,'ios','1.3.0')`, [install]);
  });
  expectEqual(
    await count(`select count(*)::int n from public.anon_activity_daily where install_id = $1`, [
      install,
    ]),
    1,
    'rows for one install in one day',
  );
});

await test('0010 a malformed install id is refused', async () => {
  await asAnon(db, async () => {
    await expectRejection(
      () => db.query(`select public.record_anon_activity('not-a-uuid','ios','1.3.0')`),
      'invalid install id',
    );
  });
});

await test('0010 nobody can read the anonymous table through the API', async () => {
  // RLS with zero policies denies everything; the RPC is the only door.
  await asAnon(db, async () => {
    expectEqual(
      await count(`select count(*)::int n from public.anon_activity_daily`),
      0,
      'rows visible to anon',
    );
  });
  await asUser(db, ALICE, async () => {
    expectEqual(
      await count(`select count(*)::int n from public.anon_activity_daily`),
      0,
      'rows visible to a signed-in user',
    );
  });
});

// ---------------------------------------------------------------------------
console.log('\nmoderation (0010)');
// ---------------------------------------------------------------------------

await db.query(`insert into public.admins (user_id, note) values ($1::uuid, 'owner')`, [ADMIN]);

await test('0010 the admin roster is invisible, including to admins', async () => {
  await asUser(db, ADMIN, async () => {
    expectEqual(await count(`select count(*)::int n from public.admins`), 0, 'roster rows visible');
    // ...but the predicate built on it still answers.
    expectEqual((await one(`select public.is_admin() as v`)).v, true, 'is_admin');
  });
});

await test('0010 a non-admin cannot read the operator dashboards', async () => {
  await asUser(db, STRANGER, async () => {
    await expectRejection(
      () => db.query(`select * from public.admin_active_users($1::date, $2::date)`, [TODAY, TODAY]),
      'not an administrator',
    );
    await expectRejection(
      () => db.query(`select * from public.admin_module_reach($1::date, $2::date)`, [TODAY, TODAY]),
      'not an administrator',
    );
  });
});

await test('0010 an admin sees both halves of the active population', async () => {
  await asUser(db, ADMIN, async () => {
    const row = await one(`select * from public.admin_active_users($1::date, $2::date)`, [
      TODAY,
      TODAY,
    ]);
    expectEqual(Number(row.accounts), 1, 'signed-in accounts today');
    expectEqual(Number(row.installs), 1, 'signed-out installs today');
  });
});

await test('0010 module reach counts people, not rows', async () => {
  await asUser(db, ADMIN, async () => {
    const rows = (
      await db.query(`select * from public.admin_module_reach($1::date, $2::date)`, [TODAY, TODAY])
    ).rows;
    const habits = rows.find((r) => r.module === 'habits');
    expectEqual(Number(habits.accounts), 1, 'accounts touching habits');
    expectEqual(Number(habits.opens), 5, 'habit opens');
  });
});

await test('0010 a non-admin cannot set anybody standing, including their own', async () => {
  await asUser(db, STRANGER, async () => {
    await expectRejection(
      () =>
        db.query(
          `select public.admin_set_account_status($1::uuid,'active'::public.moderation_status,'self-pardon',null::timestamptz)`,
          [STRANGER],
        ),
      'not an administrator',
    );
  });
});

await test('0010 a client cannot write standing directly either', async () => {
  await asUser(db, MALLORY, async () => {
    await expectRejection(
      () =>
        db.query(
          `insert into public.account_status (user_id, status) values ($1::uuid,'active'::public.moderation_status)`,
          [MALLORY],
        ),
      'row-level security',
    );
  });
});

let mallorysGroup;

await test('0010 an account in good standing can create a group and invite', async () => {
  await asUser(db, MALLORY, async () => {
    await db.query(
      `select public.create_expense_group('g-mal','Flatmates','home','$','m-mal',null,'act-mal',$1)`,
      [Date.now()],
    );
    await db.query(
      `insert into public.expense_group_invitations
         (id, group_id, member_id, email, token, invited_by, expires_at, created_at)
       values ('inv-mal-1','g-mal',null,'friend@example.com','tok-mal-1',$1::uuid,$2,$2)`,
      [MALLORY, Date.now() + 86400000],
    );
  });
  mallorysGroup = 'g-mal';
  expectEqual(
    await count(`select count(*)::int n from public.expense_groups where id = 'g-mal'`),
    1,
    'group created',
  );
});

await test('0010 restricting an account is recorded and audited', async () => {
  await asUser(db, ADMIN, async () => {
    await db.query(
      `select public.admin_set_account_status($1::uuid,'restricted'::public.moderation_status,'invite spam',null::timestamptz)`,
      [MALLORY],
    );
  });
  const row = await one(
    `select status, auto, actor from public.account_status where user_id = $1::uuid`,
    [MALLORY],
  );
  expectEqual(row.status, 'restricted', 'status');
  expectEqual(row.auto, false, 'marked as a human decision');
  expectEqual(row.actor, ADMIN, 'actor');
  expectEqual(
    await count(
      `select count(*)::int n from public.admin_audit_log
        where action = 'set_account_status' and target_user = $1::uuid`,
      [MALLORY],
    ),
    1,
    'audit entries',
  );
});

await test('0010 a restricted account cannot invite anybody new', async () => {
  await asUser(db, MALLORY, async () => {
    await expectRejection(
      () =>
        db.query(
          `insert into public.expense_group_invitations
             (id, group_id, member_id, email, token, invited_by, expires_at, created_at)
           values ('inv-mal-2',$1,null,'victim@example.com','tok-mal-2',$2::uuid,$3,$3)`,
          [mallorysGroup, MALLORY, Date.now() + 86400000],
        ),
      'row-level security',
    );
  });
});

await test('0010 a restricted account cannot start a new group', async () => {
  await asUser(db, MALLORY, async () => {
    await expectRejection(
      () =>
        db.query(
          `select public.create_expense_group('g-mal-2','Another','home','$','m-mal-2',null,'act-mal-2',$1)`,
          [Date.now()],
        ),
      'row-level security',
    );
  });
});

await test('0010 restriction takes away reach, not their own data', async () => {
  // The distinction the whole ladder is built on: somebody who spams invitations
  // has not forfeited the ledger they share with three flatmates.
  await asUser(db, MALLORY, async () => {
    expectEqual(
      await count(`select count(*)::int n from public.expense_groups where id = $1`, [
        mallorysGroup,
      ]),
      1,
      'their group is still readable',
    );
    expectEqual(
      await count(
        `select count(*)::int n from public.expense_group_invitations where id = 'inv-mal-1'`,
      ),
      1,
      'existing invitations still readable',
    );
  });
});

await test('0010 an expired restriction stops applying on its own', async () => {
  await asUser(db, ADMIN, async () => {
    await db.query(
      `select public.admin_set_account_status($1::uuid,'restricted'::public.moderation_status,'cooling off',$2::timestamptz)`,
      [MALLORY, new Date(Date.now() - 3600000).toISOString()],
    );
  });
  await asUser(db, MALLORY, async () => {
    expectEqual((await one(`select public.can_share($1::uuid) as v`, [MALLORY])).v, true);
    await db.query(
      `insert into public.expense_group_invitations
         (id, group_id, member_id, email, token, invited_by, expires_at, created_at)
       values ('inv-mal-3',$1,null,'friend2@example.com','tok-mal-3',$2::uuid,$3,$3)`,
      [mallorysGroup, MALLORY, Date.now() + 86400000],
    );
  });
});

await test('0010 blocked and restricted are different questions', async () => {
  await asUser(db, ADMIN, async () => {
    await db.query(
      `select public.admin_set_account_status($1::uuid,'blocked'::public.moderation_status,'abuse',null::timestamptz)`,
      [MALLORY],
    );
  });
  await asUser(db, ALICE, async () => {
    expectEqual(
      (await one(`select public.is_active($1::uuid) as v`, [MALLORY])).v,
      false,
      'blocked is not active',
    );
    expectEqual(
      (await one(`select public.can_share($1::uuid) as v`, [MALLORY])).v,
      false,
      'blocked cannot share',
    );
    expectEqual(
      (await one(`select public.is_active($1::uuid) as v`, [ALICE])).v,
      true,
      'a normal account is active',
    );
  });
});

await test('0010 an account can read why it was blocked', async () => {
  // A verdict a user cannot see is a support ticket you will answer by hand.
  await asUser(db, MALLORY, async () => {
    const row = await one(`select status, reason from public.account_status`);
    expectEqual(row.status, 'blocked', 'own status');
    expectEqual(row.reason, 'abuse', 'own reason');
  });
});

await test('0010 one account cannot read another account standing', async () => {
  await asUser(db, BOB, async () => {
    expectEqual(
      await count(`select count(*)::int n from public.account_status`),
      0,
      'standing rows Bob can see',
    );
  });
});

// ---------------------------------------------------------------------------
console.log('\nautomatic rate rules (0010)');
// ---------------------------------------------------------------------------

await test('0010 crossing the invitation limit restricts the account automatically', async () => {
  await asUser(db, VANDAL, async () => {
    await db.query(
      `select public.create_expense_group('g-van','Spam Co','home','$','m-van',null,'act-van',$1)`,
      [Date.now()],
    );
    // The limit is 20/hour. The 21st is deliberately allowed through: the rule
    // records rather than raises, because an exception would roll back the
    // restriction it just wrote along with the offending insert.
    for (let i = 0; i < 21; i++) {
      await db.query(
        `insert into public.expense_group_invitations
           (id, group_id, member_id, email, token, invited_by, expires_at, created_at)
         values ($1,'g-van',null,'target@example.com',$2,$3::uuid,$4,$4)`,
        [`inv-van-${i}`, `tok-van-${i}`, VANDAL, Date.now() + 86400000],
      );
    }
  });

  const row = await one(
    `select status, auto, expires_at from public.account_status where user_id = $1::uuid`,
    [VANDAL],
  );
  expectEqual(row.status, 'restricted', 'status');
  expectEqual(row.auto, true, 'marked automatic');
  expectEqual(row.expires_at !== null, true, 'automatic actions always expire');
});

await test('0010 and the next invitation is refused', async () => {
  await asUser(db, VANDAL, async () => {
    await expectRejection(
      () =>
        db.query(
          `insert into public.expense_group_invitations
             (id, group_id, member_id, email, token, invited_by, expires_at, created_at)
           values ('inv-van-x','g-van',null,'target@example.com','tok-van-x',$1::uuid,$2,$2)`,
          [VANDAL, Date.now() + 86400000],
        ),
      'row-level security',
    );
  });
});

await test('0010 a rule never overrules a person', async () => {
  // Somebody looked at this account and decided it was fine. A counter crossing
  // a threshold twenty minutes later must not quietly undo that — otherwise
  // every manual pardon has a shelf life measured in minutes.
  await asUser(db, ADMIN, async () => {
    await db.query(
      `select public.admin_set_account_status($1::uuid,'active'::public.moderation_status,'reviewed: legitimate',null::timestamptz)`,
      [VANDAL],
    );
  });
  await asUser(db, VANDAL, async () => {
    for (let i = 0; i < 25; i++) {
      await db.query(
        `insert into public.expense_group_invitations
           (id, group_id, member_id, email, token, invited_by, expires_at, created_at)
         values ($1,'g-van',null,'target@example.com',$2,$3::uuid,$4,$4)`,
        [`inv-van-b-${i}`, `tok-van-b-${i}`, VANDAL, Date.now() + 86400000],
      );
    }
  });
  const row = await one(
    `select status, auto, reason from public.account_status where user_id = $1::uuid`,
    [VANDAL],
  );
  expectEqual(row.status, 'active', 'status after a rule fired against a human verdict');
  expectEqual(row.auto, false, 'still a human decision');
  expectEqual(row.reason, 'reviewed: legitimate', 'reason preserved');
});

// ---------------------------------------------------------------------------
console.log('\nremote module switches (0011)');
// ---------------------------------------------------------------------------

await test('0011 an unknown module reads as enabled, with no row needed', async () => {
  // Rule 1: the table holds overrides only, so a new module ships working
  // rather than waiting on a migration to enable it.
  expectEqual(
    await count(`select count(*)::int n from public.module_flags where module = 'habits'`),
    0,
    'rows for an untouched module',
  );
});

await test('0011 a non-admin cannot switch a module off for everybody', async () => {
  await asUser(db, STRANGER, async () => {
    await expectRejection(
      () => db.query(`select public.admin_set_module_enabled('split', false, 'nope')`),
      'not an administrator',
    );
  });
});

await test('0011 a non-admin cannot write the table directly either', async () => {
  await asUser(db, STRANGER, async () => {
    await expectRejection(
      () => db.query(`insert into public.module_flags (module, enabled) values ('split', false)`),
      'row-level security',
    );
  });
});

await test('0011 an admin can disable a module, with a reason', async () => {
  await asUser(db, ADMIN, async () => {
    await db.query(
      `select public.admin_set_module_enabled('split', false, 'Paused while we fix balances')`,
    );
  });
  const row = await one(
    `select enabled, message, actor from public.module_flags where module = 'split'`,
  );
  expectEqual(row.enabled, false, 'enabled');
  expectEqual(row.message, 'Paused while we fix balances', 'message');
  expectEqual(row.actor, ADMIN, 'actor');
});

await test('0011 every user can read the flags, including signed-out guests', async () => {
  // Guests are the population most likely to be sitting on a broken build, so
  // gating flags behind a session would leave exactly them unprotected.
  await asUser(db, BOB, async () => {
    expectEqual(
      await count(`select count(*)::int n from public.module_flags where module = 'split'`),
      1,
      'flags Bob can see',
    );
  });
  await asAnon(db, async () => {
    expectEqual(
      await count(`select count(*)::int n from public.module_flags where module = 'split'`),
      1,
      'flags a guest can see',
    );
  });
});

await test('0011 flipping a module is audit-logged', async () => {
  expectEqual(
    await count(
      `select count(*)::int n from public.admin_audit_log
        where action = 'set_module_enabled' and detail ->> 'module' = 'split'`,
    ),
    1,
    'audit entries',
  );
});

await test('0011 disabling a module touches none of its data', async () => {
  // Rule 2. The expenses written back in the 0003/0004 tests are still there —
  // a kill switch that deleted anything would be unusable, because nobody
  // would dare flip it.
  expectEqual(
    (await count(`select count(*)::int n from public.expense_group_expenses`)) > 0,
    true,
    'expenses after the module was switched off',
  );
});

await test('0011 clearing an override returns the module to the default', async () => {
  await asUser(db, ADMIN, async () => {
    await db.query(`select public.admin_clear_module_flag('split')`);
  });
  expectEqual(
    await count(`select count(*)::int n from public.module_flags where module = 'split'`),
    0,
    'rows after clearing',
  );
});

await test('0011 a module id is normalised, so casing cannot fork a flag', async () => {
  // Two rows for 'Split' and 'split' would mean the switch silently stops
  // matching what the client asks for.
  await asUser(db, ADMIN, async () => {
    await db.query(`select public.admin_set_module_enabled('  GALLERY  ', false, null)`);
  });
  expectEqual(
    await count(`select count(*)::int n from public.module_flags where module = 'gallery'`),
    1,
    'normalised row',
  );
});

await test('0011 an empty module id is refused', async () => {
  await asUser(db, ADMIN, async () => {
    await expectRejection(
      () => db.query(`select public.admin_set_module_enabled('   ', false, null)`),
      'module is required',
    );
  });
});

// ---------------------------------------------------------------------------
console.log('\nadmin user directory (0012)');
// ---------------------------------------------------------------------------

await test('0012 a non-admin cannot list the users', async () => {
  await asUser(db, STRANGER, async () => {
    await expectRejection(
      () => db.query(`select * from public.admin_list_users(null, 50, 0)`),
      'not an administrator',
    );
  });
});

await test('0012 a non-admin cannot open somebody else profile', async () => {
  await asUser(db, STRANGER, async () => {
    await expectRejection(
      () => db.query(`select * from public.admin_user_detail($1::uuid)`, [ALICE]),
      'not an administrator',
    );
  });
});

await test('0012 an admin sees every account', async () => {
  await asUser(db, ADMIN, async () => {
    const rows = (await db.query(`select * from public.admin_list_users(null, 200, 0)`)).rows;
    expectEqual(rows.length >= 6, true, 'accounts listed');
  });
});

await test('0012 the directory can be searched by email and by username', async () => {
  await asUser(db, ADMIN, async () => {
    const byEmail = (await db.query(`select * from public.admin_list_users('alice@', 50, 0)`)).rows;
    expectEqual(byEmail.length, 1, 'matches for an email fragment');
    expectEqual(byEmail[0].user_id, ALICE, 'matched account');

    const byName = (await db.query(`select * from public.admin_list_users('alice', 50, 0)`)).rows;
    expectEqual(byName.length, 1, 'matches for a username');
  });
});

await test('0012 the drill-down carries the signals an abuse call is made from', async () => {
  await asUser(db, ADMIN, async () => {
    const row = (await db.query(`select * from public.admin_user_detail($1::uuid)`, [VANDAL]))
      .rows[0];
    expectEqual(row.user_id, VANDAL, 'account');
    // Vandal sent 46 invitations across the two rate-limit tests.
    expectEqual(Number(row.invitations_sent) > 20, true, 'invitations sent');
    expectEqual(row.recent_actions.invitation_created > 20, true, 'recent action counters');
    expectEqual(row.status, 'active', 'standing after the manual pardon');
  });
});

await test('0012 opening a profile is itself audit-logged', async () => {
  // The check that makes broad read access safe to hold: an operator with a
  // reason to look is unaffected, one browsing out of curiosity leaves a trail.
  expectEqual(
    await count(
      `select count(*)::int n from public.admin_audit_log
        where action = 'view_user_detail' and target_user = $1::uuid`,
      [VANDAL],
    ),
    1,
    'audit entries for the profile view',
  );
});

await test('0012 the directory exposes no user content, only account data', async () => {
  // The property that matters most here, asserted against the shape of the
  // result rather than by trusting the implementation to stay honest.
  //
  // `display_name` and `username` are deliberately not in the forbidden list:
  // they are account identity, which is the whole point of a directory. What
  // must never appear is anything that could carry something the user *wrote*.
  await asUser(db, ADMIN, async () => {
    const row = (await db.query(`select * from public.admin_user_detail($1::uuid)`, [ALICE]))
      .rows[0];
    const keys = Object.keys(row);

    for (const forbidden of ['title', 'body', 'content', 'payload', 'caption', 'file']) {
      expectEqual(
        keys.some((k) => k.includes(forbidden)),
        false,
        `no "${forbidden}" column in the drill-down`,
      );
    }
    // `status_reason` is a moderator's own note, not the user's writing — it is
    // the one free-text field here and it is written by the operator.
    expectEqual(
      keys.filter((k) => k.includes('reason')).join(','),
      'status_reason',
      'the only free-text column',
    );
  });
});

await test('0012 per-module usage counts activity, never content', async () => {
  await asUser(db, ADMIN, async () => {
    const rows = (
      await db.query(`select * from public.admin_user_module_usage($1::uuid, $2::date, $3::date)`, [
        ALICE,
        TODAY,
        TODAY,
      ])
    ).rows;
    const habits = rows.find((r) => r.module === 'habits');
    expectEqual(Number(habits.opens), 5, 'habit opens');
    expectEqual(Object.keys(habits).sort().join(','), 'days_active,module,opens,writes', 'columns');
  });
});

// ---------------------------------------------------------------------------
console.log('\nreports (0013)');
// ---------------------------------------------------------------------------

await test('0013 a member can report content, attaching what they can see', async () => {
  // The evidence gets here by the only route that exists under end-to-end
  // encryption: somebody who could already read it chose to attach it.
  await asUser(db, BOB, async () => {
    await db.query(
      `select public.submit_content_report('rep-1', $1::uuid, 'expense_group', 'g1',
         'harassment', 'abusive expense description', $2::jsonb)`,
      [ALICE, JSON.stringify({ text: 'the reported message' })],
    );
  });
  expectEqual(
    await count(`select count(*)::int n from public.content_reports where id = 'rep-1'`),
    1,
    'reports filed',
  );
});

await test('0013 you cannot report yourself', async () => {
  await asUser(db, BOB, async () => {
    await expectRejection(
      () =>
        db.query(
          `select public.submit_content_report('rep-self', $1::uuid, 'expense_group', 'g1',
             'spam', null, '{}'::jsonb)`,
          [BOB],
        ),
      'cannot report yourself',
    );
  });
});

await test('0013 a reporter can see their own report but not others', async () => {
  await asUser(db, BOB, async () => {
    expectEqual(
      await count(`select count(*)::int n from public.content_reports`),
      1,
      'own reports',
    );
  });
  // The accused must never learn who reported them — that is how a reporter
  // gets retaliated against.
  await asUser(db, ALICE, async () => {
    expectEqual(
      await count(`select count(*)::int n from public.content_reports`),
      0,
      'reports visible to the reported account',
    );
  });
});

await test('0013 a report cannot be marked resolved by the person who filed it', async () => {
  await asUser(db, BOB, async () => {
    await db.query(`update public.content_reports set status = 'dismissed' where id = 'rep-1'`);
  });
  expectEqual(
    (await one(`select status from public.content_reports where id = 'rep-1'`)).status,
    'open',
    'status after a reporter tried to close it',
  );
});

await test('0013 brigading is rate-limited', async () => {
  // A brigade filing hundreds of reports is a denial of service on the
  // operator's attention, and on the accused.
  await asUser(db, STRANGER, async () => {
    for (let i = 0; i < 20; i++) {
      await db.query(
        `select public.submit_content_report($1, $2::uuid, 'expense_group', 'g1', 'spam', null, '{}'::jsonb)`,
        [`rep-flood-${i}`, ALICE],
      );
    }
    await expectRejection(
      () =>
        db.query(
          `select public.submit_content_report('rep-flood-x', $1::uuid, 'expense_group', 'g1',
             'spam', null, '{}'::jsonb)`,
          [ALICE],
        ),
      'too many reports',
    );
  });
});

await test('0013 a non-admin cannot read the report queue', async () => {
  await asUser(db, STRANGER, async () => {
    await expectRejection(
      () => db.query(`select * from public.admin_list_reports(null, 100)`),
      'not an administrator',
    );
  });
});

await test('0013 the queue shows the evidence and how often the account is reported', async () => {
  await asUser(db, ADMIN, async () => {
    const rows = (await db.query(`select * from public.admin_list_reports('open', 100)`)).rows;
    const first = rows.find((r) => r.id === 'rep-1');
    expectEqual(first.evidence.text, 'the reported message', 'attached evidence');
    // One report is a disagreement; a pile from different people is a pattern.
    expectEqual(Number(first.reports_against), 21, 'total reports against the account');
  });
});

await test('0013 resolving a report is audit-logged', async () => {
  await asUser(db, ADMIN, async () => {
    await db.query(`select public.admin_resolve_report('rep-1', 'dismissed', 'not abusive')`);
  });
  expectEqual(
    (await one(`select status from public.content_reports where id = 'rep-1'`)).status,
    'dismissed',
    'status',
  );
  expectEqual(
    await count(
      `select count(*)::int n from public.admin_audit_log where action = 'resolve_report'`,
    ),
    1,
    'audit entries',
  );
});

await test('0013 profiles carry an avatar path', async () => {
  expectEqual(
    await count(
      `select count(*)::int n from information_schema.columns
        where table_schema = 'public' and table_name = 'profiles'
          and column_name in ('avatar_path', 'avatar_updated_at')`,
    ),
    2,
    'avatar columns',
  );
});

// ---------------------------------------------------------------------------
console.log('\nadmin origin allowlist (0014)');
// ---------------------------------------------------------------------------

/** Impersonates PostgREST's request headers, which is where the client IP and
 * the registered device id arrive from. */
const withHeaders = async (headers, fn) => {
  await db.query(`select set_config('request.headers', $1, false)`, [JSON.stringify(headers)]);
  try {
    return await fn();
  } finally {
    await db.query(`select set_config('request.headers', '', false)`);
  }
};

await test('0014 an empty allowlist leaves admin access unrestricted', async () => {
  // The bootstrap case. Without it the first migration locks the owner out of
  // the console they need in order to register their own IP.
  await asUser(db, ADMIN, async () => {
    expectEqual((await one(`select public.is_admin() as v`)).v, true);
  });
});

await test('0014 registering an origin immediately restricts everyone else', async () => {
  await db.query(
    `insert into public.admin_allowed_origins (id, ip_range, label)
     values ('office', '203.0.113.0/24'::cidr, 'Office network')`,
  );
  await asUser(db, ADMIN, async () => {
    await withHeaders({ 'x-forwarded-for': '198.51.100.7' }, async () => {
      expectEqual((await one(`select public.is_admin() as v`)).v, false, 'from an unknown IP');
    });
  });
});

await test('0014 a request from the registered range is allowed', async () => {
  await asUser(db, ADMIN, async () => {
    await withHeaders({ 'x-forwarded-for': '203.0.113.44' }, async () => {
      expectEqual((await one(`select public.is_admin() as v`)).v, true);
    });
  });
});

await test('0014 only the first x-forwarded-for entry counts', async () => {
  // The classic bug: reading the last entry (or the whole string) lets a caller
  // prepend anything they like and walk straight through the allowlist.
  await asUser(db, ADMIN, async () => {
    await withHeaders({ 'x-forwarded-for': '198.51.100.7, 203.0.113.44' }, async () => {
      expectEqual(
        (await one(`select public.is_admin() as v`)).v,
        false,
        'spoofed proxy chain ending in an allowed IP',
      );
    });
  });
});

await test('0014 a registered device id works from any network', async () => {
  // IP alone is unusable from a phone — carrier NAT reassigns constantly.
  await db.query(
    `insert into public.admin_allowed_origins (id, device_id, label)
     values ('laptop', 'device-secret-abc', 'Owner laptop')`,
  );
  await asUser(db, ADMIN, async () => {
    await withHeaders(
      { 'x-forwarded-for': '198.51.100.7', 'x-admin-device': 'device-secret-abc' },
      async () => {
        expectEqual((await one(`select public.is_admin() as v`)).v, true);
      },
    );
  });
});

await test('0014 a non-admin on an allowed origin is still not an admin', async () => {
  // The allowlist is a second factor, never a first one.
  await asUser(db, STRANGER, async () => {
    await withHeaders({ 'x-forwarded-for': '203.0.113.44' }, async () => {
      expectEqual((await one(`select public.is_admin() as v`)).v, false);
    });
  });
});

await test('0014 the origin gate covers every admin function, not just is_admin', async () => {
  // The whole point of gating inside is_admin(): one change, applied at every
  // call site that already existed.
  await asUser(db, ADMIN, async () => {
    await withHeaders({ 'x-forwarded-for': '198.51.100.7' }, async () => {
      await expectRejection(
        () => db.query(`select * from public.admin_list_users(null, 10, 0)`),
        'not an administrator',
      );
      await expectRejection(
        () => db.query(`select public.admin_set_module_enabled('split', false, null)`),
        'not an administrator',
      );
    });
  });
});

await test('0014 an admin can find out why they are being refused', async () => {
  await asUser(db, ADMIN, async () => {
    await withHeaders({ 'x-forwarded-for': '198.51.100.7' }, async () => {
      const row = await one(`select * from public.admin_origin_debug()`);
      expectEqual(row.on_roster, true, 'on the roster');
      expectEqual(row.origin_allowed, false, 'origin allowed');
      expectEqual(row.seen_ip, '198.51.100.7', 'the IP the server actually saw');
    });
  });
});

// Clear the allowlist so the escrow tests below run unrestricted.
await db.query(`delete from public.admin_allowed_origins`);

// ---------------------------------------------------------------------------
console.log('\nvault escrow & private sync (0015)');
// ---------------------------------------------------------------------------

await test('0015 a user can write their own escrow blob', async () => {
  await asUser(db, ALICE, async () => {
    await db.query(
      `insert into public.vault_escrow (user_id, ephemeral_public_key, wrapped_key)
       values ($1::uuid, 'eph-alice', 'wrapped-alice')`,
      [ALICE],
    );
  });
  expectEqual(await count(`select count(*)::int n from public.vault_escrow`), 1, 'escrow rows');
});

await test('0015 one user cannot forge an escrow under another uid', async () => {
  await asUser(db, BOB, async () => {
    await expectRejection(
      () =>
        db.query(
          `insert into public.vault_escrow (user_id, ephemeral_public_key, wrapped_key)
           values ($1::uuid, 'eph-forged', 'wrapped-forged')`,
          [ALICE],
        ),
      'row-level security',
    );
  });
});

await test('0015 no client can read an escrow blob, not even its owner', async () => {
  // There is no SELECT policy at all: the blob only ever leaves through the
  // audited admin function, so reading a vault key always leaves a record.
  await asUser(db, ALICE, async () => {
    expectEqual(
      await count(`select count(*)::int n from public.vault_escrow`),
      0,
      'escrow rows visible to its owner',
    );
  });
  await asUser(db, BOB, async () => {
    expectEqual(
      await count(`select count(*)::int n from public.vault_escrow`),
      0,
      'escrow rows visible to a stranger',
    );
  });
});

await test('0015 private entries are private to their owner', async () => {
  const now = Date.now();
  await asUser(db, ALICE, async () => {
    await db.query(
      `insert into public.private_entries (id, user_id, payload, created_at, updated_at)
       values ('pe-1', $1::uuid, 'ciphertext-alice', $2, $2)`,
      [ALICE, now],
    );
  });
  await asUser(db, BOB, async () => {
    expectEqual(
      await count(`select count(*)::int n from public.private_entries`),
      0,
      'private entries Bob can see',
    );
  });
});

await test('0015 a non-admin cannot unseal anybody vault', async () => {
  await asUser(db, BOB, async () => {
    await expectRejection(
      () =>
        db.query(`select * from public.admin_fetch_vault_escrow($1::uuid, 'investigating abuse')`, [
          ALICE,
        ]),
      'not an administrator',
    );
  });
});

await test('0015 unsealing requires a stated reason', async () => {
  // An operator who cannot articulate why they are opening somebody's private
  // space does not get to open it.
  await asUser(db, ADMIN, async () => {
    await expectRejection(
      () => db.query(`select * from public.admin_fetch_vault_escrow($1::uuid, 'x')`, [ALICE]),
      'a reason is required',
    );
  });
});

await test('0015 an admin can unseal, and it is recorded before anything is returned', async () => {
  await asUser(db, ADMIN, async () => {
    const row = await one(
      `select * from public.admin_fetch_vault_escrow($1::uuid, 'report #42: harassment')`,
      [ALICE],
    );
    expectEqual(row.wrapped_key, 'wrapped-alice', 'returned blob');
  });
  const audit = await one(
    `select detail from public.admin_audit_log
      where action = 'unseal_vault_escrow' and target_user = $1::uuid`,
    [ALICE],
  );
  expectEqual(audit.detail.reason, 'report #42: harassment', 'the logged reason');
});

await test('0015 reading private rows is logged separately from unsealing', async () => {
  // Pulling ciphertext without the key is a legitimate diagnostic and should
  // not read as an unseal in the audit trail.
  await asUser(db, ADMIN, async () => {
    const rows = (
      await db.query(
        `select * from public.admin_fetch_private_entries($1::uuid, 'report #42', 100)`,
        [ALICE],
      )
    ).rows;
    expectEqual(rows.length, 1, 'rows returned');
    expectEqual(rows[0].payload, 'ciphertext-alice', 'still ciphertext on the wire');
  });
  expectEqual(
    await count(
      `select count(*)::int n from public.admin_audit_log where action = 'read_private_entries'`,
    ),
    1,
    'separate audit action',
  );
});

await test('0015 escrow status reveals existence without unsealing', async () => {
  await asUser(db, ADMIN, async () => {
    const row = await one(`select * from public.admin_escrow_status($1::uuid)`, [ALICE]);
    expectEqual(row.has_escrow, true, 'has escrow');
    expectEqual(Number(row.entry_count), 1, 'entry count');
  });
  // Checking status is not an unseal, so it must not have added one.
  expectEqual(
    await count(
      `select count(*)::int n from public.admin_audit_log where action = 'unseal_vault_escrow'`,
    ),
    1,
    'unseal entries after a status check',
  );
});

// ---------------------------------------------------------------------------
console.log('\nfull sync coverage (0016)');
// ---------------------------------------------------------------------------

/** Every table the sync engine touches, and the column it is keyed by. Kept in
 *  step with features/sync/config/sync-tables.ts by the contract test there;
 *  what is checked here is the half that only a real database can answer. */
const SYNCED = [
  ...[
    'task_categories',
    'tasks',
    'note_categories',
    'notes',
    'note_tags',
    'note_tag_links',
    'note_attachments',
    'entry_links',
    'habit_categories',
    'habits',
    'habit_routines',
    'habit_routine_items',
    'habit_logs',
    'habit_skips',
    'journal_entries',
    'journal_prompts',
    'journal_reflections',
    'journal_attachments',
    'calendar_events',
    'goals',
    'goal_milestones',
    'goal_progress_logs',
    'sleep_sessions',
    'study_subjects',
    'study_sessions',
    'water_intake_logs',
    'budget_transactions',
    'savings_goals',
    'budget_debts',
    'gallery_albums',
    'gallery_photos',
    'songs',
    'playlists',
    'playlist_songs',
    'private_entries',
  ].map((table) => ({ table, key: 'id' })),
  ...['sleep_settings', 'study_settings', 'budget_settings'].map((table) => ({
    table,
    key: 'user_id',
  })),
];

await test('0016 every synced table exists with the columns the engine reads', async () => {
  for (const { table, key } of SYNCED) {
    const columns = (
      await db.query(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = $1`,
        [table],
      )
    ).rows.map((row) => row.column_name);
    if (columns.length === 0) throw new Error(`${table}: no such table`);
    for (const required of [key, 'user_id', 'updated_at']) {
      if (!columns.includes(required)) throw new Error(`${table}: missing ${required}`);
    }
  }
});

await test('0016 no synced table exposes a device-local column', async () => {
  // Uploading another device's notification handles or file paths is worse than
  // not syncing the row at all — see SYNC_DEVICE_LOCAL_COLUMNS. The server not
  // having the column is what makes that impossible rather than merely
  // discouraged.
  const leaked = (
    await db.query(
      `select table_name, column_name from information_schema.columns
        where table_schema = 'public'
          and table_name = any($1)
          and column_name in ('uri', 'thumbnail_uri', 'reminder_notification_id')`,
      [SYNCED.map((s) => s.table)],
    )
  ).rows;
  expectEqual(
    leaked.map((row) => `${row.table_name}.${row.column_name}`).join(', '),
    '',
    'device-local columns on the server',
  );
});

await test('0016 every synced table is indexed on (user_id, updated_at)', async () => {
  // The engine reads nothing else. Without the index this is a sequential scan
  // of every user's rows on every pull.
  const missing = [];
  for (const { table } of SYNCED) {
    const found = await count(
      `select count(*)::int n from pg_indexes
        where schemaname = 'public' and tablename = $1
          and indexdef like '%(user_id, updated_at)%'`,
      [table],
    );
    if (found === 0) missing.push(table);
  }
  expectEqual(missing.join(', '), '', 'tables without a sync index');
});

await test('0016 every synced table refuses another user', async () => {
  // RLS, asserted per table rather than per migration: a table added later with
  // `enable row level security` but no policy reads as locked down to a static
  // check and is wide open to nobody, which is a different bug with the same
  // shape. This inserts as Alice and reads as Bob.
  await asUser(db, ALICE, async () => {
    await db.query(
      `insert into public.note_tags (id, user_id, name, created_at, updated_at)
        values ('tag-a', $1, 'private tag', 1, 1)`,
      [ALICE],
    );
    await db.query(
      `insert into public.sleep_settings (user_id, goal_minutes, updated_at)
        values ($1, 400, 1)`,
      [ALICE],
    );
  });

  await asUser(db, BOB, async () => {
    expectEqual(
      await count(`select count(*)::int n from public.note_tags`),
      0,
      "Bob's view of Alice's tags",
    );
    expectEqual(
      await count(`select count(*)::int n from public.sleep_settings`),
      0,
      "Bob's view of Alice's sleep settings",
    );
  });

  await asUser(db, ALICE, async () => {
    expectEqual(await count(`select count(*)::int n from public.note_tags`), 1, 'Alice sees hers');
  });
});

await test('0016 one user cannot write a row under another uid', async () => {
  await asUser(db, BOB, async () => {
    await expectRejection(
      () =>
        db.query(
          `insert into public.entry_links
            (id, user_id, source_type, source_id, target_type, target_id, relation,
             created_at, updated_at)
           values ('forged', $1, 'note', 'n1', 'note', 'n2', 'mentions', 1, 1)`,
          [ALICE],
        ),
      'row-level security',
    );
  });
});

await test('0016 an anonymous caller sees none of it', async () => {
  await asAnon(db, async () => {
    for (const table of ['note_tags', 'gallery_photos', 'songs', 'budget_settings']) {
      expectEqual(
        await count(`select count(*)::int n from public.${table}`),
        0,
        `anon rows in ${table}`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
console.log('\nRLS at scale (0017)');
// ---------------------------------------------------------------------------

await test('0017 owner policies still refuse another user after the rewrite', async () => {
  // The rewrite is meant to be semantics-preserving. This is the assertion that
  // says so: if the loop had produced `user_id = user_id`, every table in the
  // schema would be world-readable and every other test here would still pass.
  await asUser(db, ALICE, async () => {
    await db.query(
      `insert into public.tasks (id, user_id, title, created_at, updated_at)
        values ('t-rls', $1, 'Alice private task', 1, 1)`,
      [ALICE],
    );
  });
  await asUser(db, BOB, async () => {
    expectEqual(
      await count(`select count(*)::int n from public.tasks where id = 't-rls'`),
      0,
      "Bob's view of Alice's task",
    );
  });
  await asUser(db, ALICE, async () => {
    expectEqual(
      await count(`select count(*)::int n from public.tasks where id = 't-rls'`),
      1,
      'Alice sees her own',
    );
  });
});

await test('0017 a blocked account cannot write, server-side', async () => {
  // The sync engine refuses to run for a blocked account, but that check is in
  // the client and is therefore advice. This is the enforcement.
  await asUser(db, VANDAL, async () => {
    await db.query(
      `insert into public.notes (id, user_id, title, created_at, updated_at)
        values ('n-before', $1, 'written while in good standing', 1, 1)`,
      [VANDAL],
    );
  });

  await db.query(
    `insert into public.account_status (user_id, status, reason, actor)
      values ($1, 'blocked', 'abuse', $2)
     on conflict (user_id) do update set status = 'blocked', reason = 'abuse', expires_at = null`,
    [VANDAL, ADMIN],
  );

  await asUser(db, VANDAL, async () => {
    await expectRejection(
      () =>
        db.query(
          `insert into public.notes (id, user_id, title, created_at, updated_at)
            values ('n-after', $1, 'written while blocked', 2, 2)`,
          [VANDAL],
        ),
      'row-level security',
    );
  });
});

await test('0019 a blocked account cannot read its own data either', async () => {
  // 0017 allowed this; 0019 deliberately does not. A block that leaves the
  // cloud copy readable through any HTTP client is not a block, and the
  // export-my-data obligation is now served by the operator surface (an admin
  // can produce the rows) rather than by leaving the account's own access open.
  await asUser(db, VANDAL, async () => {
    expectEqual(
      await count(`select count(*)::int n from public.notes where id = 'n-before'`),
      0,
      'blocked user reading their own note',
    );
  });
});

await test('0019 a blocked account can still read why', async () => {
  // account_status, profiles and device_commands stay reachable on purpose:
  // "you are blocked" with no reason and no expiry is how an appeal turns into
  // a support ticket answered by hand.
  await asUser(db, VANDAL, async () => {
    const row = await one(
      `select status::text, reason from public.account_status where user_id = $1`,
      [VANDAL],
    );
    expectEqual(row.status, 'blocked', 'own standing is readable');
    expectEqual(row.reason, 'abuse', 'and says why');
  });
});

await test('0017 lifting the block restores writing', async () => {
  await db.query(`update public.account_status set status = 'active' where user_id = $1`, [VANDAL]);
  await asUser(db, VANDAL, async () => {
    await db.query(
      `insert into public.notes (id, user_id, title, created_at, updated_at)
        values ('n-restored', $1, 'unblocked', 3, 3)`,
      [VANDAL],
    );
  });
  expectEqual(
    await count(`select count(*)::int n from public.notes where id = 'n-restored'`),
    1,
    'write after the block was lifted',
  );
});

await test('0017 an expired block stops applying on its own', async () => {
  // `is_active()` honours expires_at, so a timed restriction lapses without
  // anybody having to remember to clear it.
  await db.query(
    `update public.account_status
        set status = 'blocked', expires_at = now() - interval '1 hour'
      where user_id = $1`,
    [VANDAL],
  );
  await asUser(db, VANDAL, async () => {
    await db.query(
      `insert into public.notes (id, user_id, title, created_at, updated_at)
        values ('n-expired', $1, 'block already lapsed', 4, 4)`,
      [VANDAL],
    );
  });
  expectEqual(
    await count(`select count(*)::int n from public.notes where id = 'n-expired'`),
    1,
    'write after the block expired',
  );
});

// ---------------------------------------------------------------------------
console.log('\nstaff roles & report gating (0018)');
// ---------------------------------------------------------------------------

// MALLORY becomes the lower-tier operator; ADMIN keeps the full tier.
await db.query(`insert into public.admins (user_id, role) values ($1, 'staff')`, [MALLORY]);
await db.query(`update public.admins set role = 'admin' where user_id = $1`, [ADMIN]);

await test('0018 an existing admin keeps the full tier by default', async () => {
  // The column defaults to 'admin' precisely so a deploy does not silently
  // demote the owner out of their own console.
  await asUser(db, ADMIN, async () => {
    expectEqual((await one(`select public.is_admin() as v`)).v, true, 'admin is admin');
    expectEqual((await one(`select public.is_staff() as v`)).v, true, 'admin is also staff');
  });
});

await test('0018 staff are not admins', async () => {
  await asUser(db, MALLORY, async () => {
    expectEqual((await one(`select public.is_staff() as v`)).v, true, 'staff is staff');
    expectEqual((await one(`select public.is_admin() as v`)).v, false, 'staff is not admin');
  });
});

await test('0018 staff cannot open an account nobody reported', async () => {
  // The whole point of the tier. Without a report there are no grounds, and the
  // error says which of the two problems it is.
  await asUser(db, MALLORY, async () => {
    await expectRejection(
      () =>
        db.query(`select * from public.operator_user_profile($1::uuid, 'routine check')`, [
          SUBJECT,
        ]),
      'no live report',
    );
  });
});

await test('0018 an admin can open any account without a report', async () => {
  await asUser(db, ADMIN, async () => {
    const row = await one(
      `select * from public.operator_user_profile($1::uuid, 'ownership review')`,
      [SUBJECT],
    );
    expectEqual(row.email, 'subject@example.com', 'profile returned');
    expectEqual(row.grounds, 'admin', 'grounds recorded as admin');
  });
});

await test('0018 a report opens the account to staff', async () => {
  await asUser(db, BOB, async () => {
    await db.query(
      `select public.submit_content_report(
         'rep-gate-1', $1::uuid, 'expense_group', 'g-1', 'harassment', 'abusive messages', '{}'::jsonb)`,
      [SUBJECT],
    );
  });

  await asUser(db, MALLORY, async () => {
    const row = await one(
      `select * from public.operator_user_profile($1::uuid, 'reviewing report rep-gate-1')`,
      [SUBJECT],
    );
    expectEqual(row.grounds, 'rep-gate-1', 'grounds recorded as the report id');
    expectEqual(Number(row.open_reports), 1, 'open report count');
  });
});

await test('0018 access is audited with the grounds that justified it', async () => {
  // "opened X because of report Y" is what a later review needs. "opened X" is
  // not enough to tell a moderator doing their job from one who is not.
  const row = await one(
    `select detail from public.admin_audit_log
      where actor = $1 and action = 'read_user_profile' order by created_at desc limit 1`,
    [MALLORY],
  );
  expectEqual(row.detail.grounds, 'rep-gate-1', 'audited grounds');
  expectEqual(row.detail.reason, 'reviewing report rep-gate-1', 'audited reason');
});

await test('0018 staff must state a reason', async () => {
  await asUser(db, MALLORY, async () => {
    await expectRejection(
      () => db.query(`select * from public.operator_user_profile($1::uuid, 'x')`, [SUBJECT]),
      'a reason is required',
    );
  });
});

await test('0018 dismissing the report closes the door again', async () => {
  await db.query(
    `update public.content_reports set status = 'dismissed', resolved_at = now() where id = 'rep-gate-1'`,
  );
  await asUser(db, MALLORY, async () => {
    await expectRejection(
      () =>
        db.query(`select * from public.operator_user_profile($1::uuid, 'having another look')`, [
          SUBJECT,
        ]),
      'no live report',
    );
  });
});

await test('0018 an actioned report keeps access open for the appeal window', async () => {
  // Work does not stop at the verdict: appeals arrive, and a moderator has to
  // be able to check their own decision.
  await db.query(
    `update public.content_reports set status = 'actioned', resolved_at = now() where id = 'rep-gate-1'`,
  );
  await asUser(db, MALLORY, async () => {
    const row = await one(
      `select * from public.operator_user_profile($1::uuid, 'appeal review for rep-gate-1')`,
      [SUBJECT],
    );
    expectEqual(row.grounds, 'rep-gate-1', 'still open on an actioned report');
  });

  // But not forever.
  await db.query(
    `update public.content_reports
        set resolved_at = now() - interval '31 days' where id = 'rep-gate-1'`,
  );
  await asUser(db, MALLORY, async () => {
    await expectRejection(
      () =>
        db.query(`select * from public.operator_user_profile($1::uuid, 'much later')`, [SUBJECT]),
      'no live report',
    );
  });
});

await test('0018 the report queue never names the reporter', async () => {
  // Telling the reported party's moderator who complained is one leak away from
  // telling the reported party, and that is how reporting stops happening.
  await db.query(`update public.content_reports set status = 'open' where id = 'rep-gate-1'`);
  await asUser(db, MALLORY, async () => {
    const columns = (
      await db.query(
        `select * from public.operator_user_reports($1::uuid, 'reviewing the queue')`,
        [ALICE],
      )
    ).fields.map((f) => f.name);
    expectEqual(columns.includes('reporter_id'), false, 'reporter_id exposed');
  });
});

await test('0018 an ordinary user is neither', async () => {
  await asUser(db, STRANGER, async () => {
    expectEqual((await one(`select public.is_staff() as v`)).v, false, 'not staff');
    await expectRejection(
      () => db.query(`select * from public.operator_report_queue(10)`),
      'not an operator',
    );
  });
});

// ---------------------------------------------------------------------------
console.log('\nblock enforcement & device wipe (0019)');
// ---------------------------------------------------------------------------

await test('0019 blocking cuts the account off and queues a wipe', async () => {
  await asUser(db, ADMIN, async () => {
    await db.query(
      `select public.admin_block_user($1::uuid, 'sustained harassment', null, true, 15)`,
      [ALICE],
    );
  });

  const status = await one(
    `select status::text, evacuation_until from public.account_status where user_id = $1`,
    [ALICE],
  );
  expectEqual(status.status, 'blocked', 'status');
  expectEqual(status.evacuation_until !== null, true, 'evacuation window opened');

  await asUser(db, ALICE, async () => {
    const commands = (await db.query(`select * from public.pending_device_commands()`)).rows;
    expectEqual(commands.length, 1, 'pending commands');
    expectEqual(commands[0].command, 'wipe_local', 'command');
  });
});

await test('0019 the evacuation window lets the device push a last time', async () => {
  // The window is what stops the wipe destroying anything that was never
  // synced. Blocked, but still able to reach its own rows for a few minutes.
  await asUser(db, ALICE, async () => {
    await db.query(
      `insert into public.notes (id, user_id, title, created_at, updated_at)
        values ('n-evac', $1, 'written during evacuation', 9, 9)`,
      [ALICE],
    );
  });
  expectEqual(
    await count(`select count(*)::int n from public.notes where id = 'n-evac'`),
    1,
    'evacuated row',
  );
});

await test('0019 once the window closes the account is fully cut off', async () => {
  await db.query(
    `update public.account_status set evacuation_until = now() - interval '1 minute'
      where user_id = $1`,
    [ALICE],
  );

  await asUser(db, ALICE, async () => {
    expectEqual(
      await count(`select count(*)::int n from public.notes`),
      0,
      'reads after the window',
    );
    await expectRejection(
      () =>
        db.query(
          `insert into public.notes (id, user_id, title, created_at, updated_at)
            values ('n-late', $1, 'too late', 10, 10)`,
          [ALICE],
        ),
      'row-level security',
    );
  });
});

await test('0019 the wipe command is still readable once cut off', async () => {
  // The one thing a blocked device must be able to fetch is the instruction to
  // wipe itself. Gating device_commands would make the whole mechanism
  // unreachable exactly when it is needed.
  await asUser(db, ALICE, async () => {
    expectEqual(
      (await db.query(`select * from public.pending_device_commands()`)).rows.length,
      1,
      'command still visible',
    );
  });
});

await test('0019 a device acknowledges the wipe, and says what it could not save', async () => {
  await asUser(db, ALICE, async () => {
    const id = (await db.query(`select id from public.pending_device_commands()`)).rows[0].id;
    await db.query(`select public.ack_device_command($1::uuid, $2::jsonb)`, [
      id,
      JSON.stringify({ wiped: true, unsyncedModules: ['gallery'] }),
    ]);
    expectEqual(
      (await db.query(`select * from public.pending_device_commands()`)).rows.length,
      0,
      'still pending after ack',
    );
  });

  const row = await one(
    `select ack_detail from public.device_commands where user_id = $1 order by issued_at desc limit 1`,
    [ALICE],
  );
  expectEqual(row.ack_detail.unsyncedModules[0], 'gallery', 'what was lost is recorded');
});

await test('0019 one user cannot acknowledge another user’s wipe', async () => {
  await asUser(db, ADMIN, async () => {
    await db.query(`select public.admin_wipe_user_device($1::uuid, 'content removal request')`, [
      BOB,
    ]);
  });
  const id = (
    await db.query(
      `select id from public.device_commands where user_id = $1 and acked_at is null`,
      [BOB],
    )
  ).rows[0].id;

  await asUser(db, STRANGER, async () => {
    await db.query(`select public.ack_device_command($1::uuid, '{}'::jsonb)`, [id]);
  });
  expectEqual(
    await count(
      `select count(*)::int n from public.device_commands where id = $1 and acked_at is null`,
      [id],
    ),
    1,
    "Bob's command after a stranger tried to ack it",
  );
});

await test('0019 unblocking restores access and cancels an outstanding wipe', async () => {
  // A phone that was off for the whole episode must not wake up and wipe an
  // account that is fine again.
  await asUser(db, ADMIN, async () => {
    await db.query(
      `select public.admin_block_user($1::uuid, 'second look needed', null, true, 0)`,
      [BOB],
    );
    await db.query(`select public.admin_unblock_user($1::uuid, 'appeal upheld')`, [BOB]);
  });

  await asUser(db, BOB, async () => {
    expectEqual(
      (await db.query(`select * from public.pending_device_commands()`)).rows.length,
      0,
      'pending wipes after unblock',
    );
    await db.query(
      `insert into public.notes (id, user_id, title, created_at, updated_at)
        values ('n-unblocked', $1, 'back in good standing', 11, 11)`,
      [BOB],
    );
  });
  expectEqual(
    await count(`select count(*)::int n from public.notes where id = 'n-unblocked'`),
    1,
    'write after unblock',
  );
});

await test('0019 zero evacuation minutes cuts the account off immediately', async () => {
  await asUser(db, ADMIN, async () => {
    await db.query(
      `select public.admin_block_user($1::uuid, 'active abuse in progress', null, true, 0)`,
      [VANDAL],
    );
  });
  const status = await one(
    `select evacuation_until from public.account_status where user_id = $1`,
    [VANDAL],
  );
  expectEqual(status.evacuation_until, null, 'no window');
  await asUser(db, VANDAL, async () => {
    expectEqual(await count(`select count(*)::int n from public.notes`), 0, 'reads');
  });
});

await test('0019 an admin reads any row, including soft-deleted ones', async () => {
  await asUser(db, ADMIN, async () => {
    const all = (
      await db.query(
        `select * from public.admin_user_rows($1::uuid, 'notes', 'evidence for report rep-gate-1', true, 100)`,
        [ALICE],
      )
    ).rows;
    // Alice wrote 'n-before'… no: that was VANDAL. Alice has n-rls-era rows.
    expectEqual(all.length >= 1, true, 'rows returned');
  });
});

await test('0019 admin_user_rows refuses a table that is not on the list', async () => {
  // The whitelist is what stops `p_table` being a way to select from auth.users.
  await asUser(db, ADMIN, async () => {
    await expectRejection(
      () =>
        db.query(
          `select * from public.admin_user_rows($1::uuid, 'admins', 'poking about', true, 10)`,
          [ALICE],
        ),
      'not readable through this function',
    );
  });
});

await test('0019 staff cannot read rows at all', async () => {
  // The unrestricted capability stays with the owner tier. This is the split
  // 0018's report gate exists to preserve.
  await asUser(db, MALLORY, async () => {
    await expectRejection(
      () =>
        db.query(
          `select * from public.admin_user_rows($1::uuid, 'notes', 'reviewing report rep-gate-1', true, 10)`,
          [ALICE],
        ),
      'not an administrator',
    );
  });
});

await test('0019 purging soft-deletes, so an appeal can still be answered', async () => {
  const before = await count(
    `select count(*)::int n from public.notes where user_id = $1 and deleted_at is null`,
    [ALICE],
  );
  expectEqual(before > 0, true, 'notes before the purge');

  await asUser(db, ADMIN, async () => {
    await db.query(`select public.admin_purge_user_data($1::uuid, 'confirmed abuse, rep-gate-1')`, [
      ALICE,
    ]);
  });

  expectEqual(
    await count(
      `select count(*)::int n from public.notes where user_id = $1 and deleted_at is null`,
      [ALICE],
    ),
    0,
    'live notes after the purge',
  );
  // The rows survive — a hard delete would destroy the evidence the report was
  // about along with the ability to reverse a mistake.
  expectEqual(
    (await count(`select count(*)::int n from public.notes where user_id = $1`, [ALICE])) > 0,
    true,
    'rows retained for appeal',
  );
});

await test('0019 every operator action left an audit row', async () => {
  for (const action of [
    'block_user',
    'unblock_user',
    'wipe_user_device',
    'read_user_rows',
    'purge_user_data',
  ]) {
    expectEqual(
      (await count(`select count(*)::int n from public.admin_audit_log where action = $1`, [
        action,
      ])) > 0,
      true,
      `audit rows for ${action}`,
    );
  }
});

await test('0019 a non-admin cannot block anybody', async () => {
  for (const actor of [MALLORY, STRANGER]) {
    await asUser(db, actor, async () => {
      await expectRejection(
        () =>
          db.query(`select public.admin_block_user($1::uuid, 'because I say so', null, true, 0)`, [
            BOB,
          ]),
        'not an administrator',
      );
    });
  }
});

// ---------------------------------------------------------------------------
console.log('\naccount deletion (0020)');
// ---------------------------------------------------------------------------
//
// The bug: deletion was a 15-name list in the edge function while sync covered
// 38 tables, and `user_id` carried no foreign key, so deleting the auth user
// left the other 23 tables' rows behind owned by a uid that resolves to nobody.
// Every assertion below is about a table that was in that gap.

await test('0020 no per-user table is left outside the cascade', async () => {
  // The preflight the edge function refuses to delete without. Catalog-derived,
  // so it fails the day a migration adds a table without the constraint —
  // which is exactly how the 23-table gap opened in the first place.
  const rows = (await db.query(`select * from public.account_deletion_uncovered_tables()`)).rows;
  expectEqual(
    rows.map((r) => r.account_deletion_uncovered_tables).join(', '),
    '',
    'tables with no auth.users foreign key',
  );
});

await test('0020 deleting the auth user takes the data with it', async () => {
  const DOOMED = '99999999-9999-9999-9999-999999999999';
  await createUser(db, DOOMED, 'doomed@example.com');

  // One row in each of six tables the old delete list never named — including
  // the two that matter most: cycle/intimacy records, and the sealed copy of
  // the private space's master key.
  await db.query(
    `insert into public.water_intake_logs (id, user_id, log_date, amount_ml, logged_at, created_at, updated_at)
     values ('w1', $1, '2026-08-06', 250, 1, 1, 1)`,
    [DOOMED],
  );
  await db.query(
    `insert into public.gallery_albums (id, user_id, name, created_at, updated_at)
     values ('a1', $1, 'Album', 1, 1)`,
    [DOOMED],
  );
  await db.query(
    `insert into public.songs (id, user_id, title, added_at, created_at, updated_at)
     values ('s1', $1, 'Song', 1, 1, 1)`,
    [DOOMED],
  );
  await db.query(
    `insert into public.habit_logs (id, user_id, habit_id, log_date, logged_at, created_at, updated_at)
     values ('hl1', $1, 'h1', '2026-08-06', 1, 1, 1)`,
    [DOOMED],
  );
  await db.query(
    `insert into public.private_entries (id, user_id, payload, created_at, updated_at)
     values ('p1', $1, 'ciphertext', 1, 1)`,
    [DOOMED],
  );
  await db.query(
    `insert into public.vault_escrow (user_id, ephemeral_public_key, wrapped_key)
     values ($1, 'epk', 'wrapped')`,
    [DOOMED],
  );

  await db.query(`delete from auth.users where id = $1`, [DOOMED]);

  for (const table of [
    'water_intake_logs',
    'gallery_albums',
    'songs',
    'habit_logs',
    'private_entries',
    'vault_escrow',
  ]) {
    expectEqual(
      await count(`select count(*)::int n from public.${table} where user_id = $1`, [DOOMED]),
      0,
      `${table} rows left behind`,
    );
  }

  // The postflight, over every per-user table rather than the six above.
  const remaining = (
    await db.query(`select * from public.account_data_remaining($1::uuid)`, [DOOMED])
  ).rows;
  expectEqual(
    remaining.map((r) => `${r.relation}=${r.rows_left}`).join(', '),
    '',
    'rows surviving the account',
  );
});

await test('0020 a shared ledger survives a member deleting their account', async () => {
  // The deliberate exception. `expense_group_members.user_id` is `set null`, so
  // the membership row outlives the account and the group's balances still add
  // up — cascading here would silently rewrite what everybody else is owed.
  const LEAVER = 'aaaaaaaa-0000-0000-0000-000000000001';
  await createUser(db, LEAVER, 'leaver@example.com');

  await asUser(db, LEAVER, async () => {
    await db.query(
      `select public.create_expense_group('g-leaver','Trip','trip','$','m-leaver',null,'act-leaver',$1)`,
      [Date.now()],
    );
  });

  await db.query(`delete from auth.users where id = $1`, [LEAVER]);

  expectEqual(
    await count(
      `select count(*)::int n from public.expense_group_members where group_id = 'g-leaver'`,
    ),
    1,
    'membership rows kept for the ledger',
  );
  expectEqual(
    await count(
      `select count(*)::int n from public.expense_group_members
        where group_id = 'g-leaver' and user_id is null`,
    ),
    1,
    'membership rows detached from the deleted account',
  );
});

await test('0020 the deletion helpers are not a row-count oracle', async () => {
  // Both are SECURITY DEFINER and read across every user's rows. Left callable
  // by `authenticated`, they would let any signed-in user count anybody else's
  // private_entries by uid.
  await asUser(db, MALLORY, async () => {
    await expectRejection(
      () => db.query(`select * from public.account_data_remaining($1::uuid)`, [ALICE]),
      'permission denied',
    );
    await expectRejection(
      () => db.query(`select * from public.account_deletion_uncovered_tables()`),
      'permission denied',
    );
  });
});

// ---------------------------------------------------------------------------
console.log('\nuser blocking (0021)');
// ---------------------------------------------------------------------------
//
// The requirement: a user must be able to stop another user reaching them,
// without an operator in the loop. The contact vector in this app is a shared
// expense group, and it has three doors — adding an email as a member, sending
// the invitation, and redeeming a token minted before the block. All three.

const BLOCKER = 'bbbbbbbb-0000-0000-0000-000000000001';
const PEST = 'bbbbbbbb-0000-0000-0000-000000000002';
await createUser(db, BLOCKER, 'blocker@example.com');
await createUser(db, PEST, 'pest@example.com');

await test('0021 a token minted before the block cannot be redeemed after it', async () => {
  // Ordering matters: the invitation is created while contact is still allowed,
  // so this is the case the two triggers cannot catch. Without the check inside
  // accept_group_invitation, blocking somebody who had already invited you
  // leaves their way in open until the token expires.
  await asUser(db, PEST, async () => {
    await db.query(
      `select public.create_expense_group('g21-a','Trip','trip','$','m21-pest',null,'act21-a',$1)`,
      [Date.now()],
    );
    await db.query(
      `insert into public.expense_group_members (id, group_id, user_id, email, display_name, role, created_at, updated_at)
       values ('m21-target','g21-a',null,'blocker@example.com','Blocker','member',$1,$1)`,
      [Date.now()],
    );
    await db.query(
      `select public.create_group_invitation('inv21-1','g21-a','m21-target','blocker@example.com','tok21-1',$1,$2)`,
      [Date.now() + 86400000, Date.now()],
    );
  });

  await asUser(db, BLOCKER, async () => {
    await db.query(`select public.block_user($1::uuid)`, [PEST]);
    expectEqual(
      (await one(`select public.accept_group_invitation('tok21-1', $1) as v`, [Date.now()])).v,
      'blocked',
      'redeeming a blocked inviter’s token',
    );
  });

  // Refused without consuming the token, so unblocking and accepting later
  // still works — declining should not destroy the invitation.
  expectEqual(
    await count(
      `select count(*)::int n from public.expense_group_invitations
        where id = 'inv21-1' and accepted_at is null`,
    ),
    1,
    'invitation left unconsumed',
  );
});

await test('0021 a blocked user cannot add you to a group', async () => {
  // A fresh group: the email is unique per group (0003), so re-adding to g21-a
  // would fail on that index and prove nothing about the block.
  await asUser(db, PEST, async () => {
    await db.query(
      `select public.create_expense_group('g21-b','Another','trip','$','m21-pest-b',null,'act21-b',$1)`,
      [Date.now()],
    );
    await expectRejection(
      () =>
        db.query(
          `insert into public.expense_group_members (id, group_id, user_id, email, display_name, role, created_at, updated_at)
           values ('m21-again','g21-b',null,'blocker@example.com','Blocker','member',$1,$1)`,
          [Date.now()],
        ),
      'cannot be added',
    );
  });
});

await test('0021 a blocked user cannot invite you', async () => {
  await asUser(db, PEST, async () => {
    await expectRejection(
      () =>
        db.query(
          `insert into public.expense_group_invitations (id, group_id, member_id, email, token, invited_by, expires_at, created_at)
           values ('inv21-2','g21-a','m21-target','blocker@example.com','tok21-2',$1,$2,$3)`,
          [PEST, Date.now() + 86400000, Date.now()],
        ),
      'cannot be invited',
    );
  });
});

await test('0021 the block runs both ways', async () => {
  // Asymmetric blocking leaves an obvious hole: block somebody, then add them
  // to a group yourself, and you are back in a shared space with content they
  // can write. Blocking is about contact, and contact has two ends.
  await asUser(db, BLOCKER, async () => {
    await db.query(
      `select public.create_expense_group('g21-c','Mine','trip','$','m21-blk',null,'act21-c',$1)`,
      [Date.now()],
    );
    await expectRejection(
      () =>
        db.query(
          `insert into public.expense_group_members (id, group_id, user_id, email, display_name, role, created_at, updated_at)
           values ('m21-pest2','g21-c',null,'pest@example.com','Pest','member',$1,$1)`,
          [Date.now()],
        ),
      'cannot be added',
    );
  });
});

await test('0021 unblocking reopens contact', async () => {
  await asUser(db, BLOCKER, async () => {
    await db.query(`select public.unblock_user($1::uuid)`, [PEST]);
    expectEqual(
      (await one(`select public.accept_group_invitation('tok21-1', $1) as v`, [Date.now()])).v,
      'ok',
      'the original invitation after unblocking',
    );
  });
});

await test('0021 you cannot see who blocked you', async () => {
  // The policy grants `blocker_id = auth.uid()` only. Somebody who can
  // enumerate their blockers knows exactly who to reach from a second account,
  // and not being findable is usually the entire point of the block.
  await asUser(db, BLOCKER, async () => {
    await db.query(`select public.block_user($1::uuid)`, [PEST]);
  });
  await asUser(db, PEST, async () => {
    expectEqual(
      await count(`select count(*)::int n from public.user_blocks`),
      0,
      'rows visible to the blocked party',
    );
    // And not through the helper either — it is revoked from `authenticated`.
    await expectRejection(
      () => db.query(`select public.contact_blocked($1::uuid, $2::uuid)`, [PEST, BLOCKER]),
      'permission denied',
    );
  });
});

await test('0021 you can list and unblock the accounts you blocked', async () => {
  await asUser(db, BLOCKER, async () => {
    const rows = (await db.query(`select * from public.list_blocked_accounts()`)).rows;
    expectEqual(rows.length, 1, 'blocked accounts listed');
    expectEqual(rows[0].user_id, PEST, 'the account blocked');
    // Needs a name to show, and profiles_own hides it — hence SECURITY DEFINER.
    expectEqual(rows[0].display_name, 'pest', 'a label for the unblock screen');
  });
});

await test('0021 blocking yourself is refused', async () => {
  await asUser(db, BLOCKER, async () => {
    await expectRejection(
      () => db.query(`select public.block_user($1::uuid)`, [BLOCKER]),
      'cannot block yourself',
    );
  });
});

await test('0021 blocking twice is not an error', async () => {
  // The UI should not have to model "already blocked" as a failure state.
  await asUser(db, BLOCKER, async () => {
    await db.query(`select public.block_user($1::uuid)`, [PEST]);
    await db.query(`select public.block_user($1::uuid)`, [PEST]);
    expectEqual(
      await count(`select count(*)::int n from public.user_blocks where blocker_id = $1`, [
        BLOCKER,
      ]),
      1,
      'rows after blocking twice',
    );
  });
});

await test('0021 blocks die with either account', async () => {
  // user_blocks has no `user_id` column, so 0020's catalog checks do not see
  // it. The two cascades are the whole guarantee, in both directions.
  const A = 'cccccccc-0000-0000-0000-000000000001';
  const B = 'cccccccc-0000-0000-0000-000000000002';
  await createUser(db, A, 'a@example.com');
  await createUser(db, B, 'b@example.com');

  await asUser(db, A, async () => {
    await db.query(`select public.block_user($1::uuid)`, [B]);
  });
  await db.query(`delete from auth.users where id = $1`, [B]);
  expectEqual(
    await count(`select count(*)::int n from public.user_blocks where blocker_id = $1`, [A]),
    0,
    'blocks left after the blocked account is deleted',
  );

  await asUser(db, A, async () => {
    await db.query(`select public.block_user($1::uuid)`, [PEST]);
  });
  await db.query(`delete from auth.users where id = $1`, [A]);
  expectEqual(
    await count(`select count(*)::int n from public.user_blocks where blocked_id = $1`, [PEST]),
    1,
    'only the blocker’s own rows removed',
  );
});

// ---------------------------------------------------------------------------
console.log('\n0022 self-service data access');
// ---------------------------------------------------------------------------

/**
 * The whole safety argument for `export_own_data` is that it takes no user id —
 * it is SECURITY DEFINER so it can see past a block, and the only thing keeping
 * it from being a universal reader is that there is nothing to point it at.
 * These hold that.
 */
await test('0022 gives you your own rows', async () => {
  const OWNER = 'dddddddd-0000-0000-0000-000000000001';
  await createUser(db, OWNER, 'owner@example.com');

  await asUser(db, OWNER, async () => {
    await db.query(
      `insert into public.tasks (id, user_id, title, updated_at, created_at)
       values ('t-own-1', $1, 'mine', 1, 1)`,
      [OWNER],
    );
  });

  await asUser(db, OWNER, async () => {
    const { rows } = await db.query(`select * from public.export_own_data('tasks', 100)`);
    expectEqual(rows.length, 1, 'own rows returned');
    expectEqual(rows[0].row_data.title, 'mine', 'own row content');
  });
});

await test('0022 still works while the account is blocked', async () => {
  // The entire reason this exists: 0019 denies a blocked account every read,
  // and GDPR Art. 15 does not pause because we blocked somebody.
  const BLOCKED = 'dddddddd-0000-0000-0000-000000000002';
  await createUser(db, BLOCKED, 'blocked@example.com');

  await asUser(db, BLOCKED, async () => {
    await db.query(
      `insert into public.tasks (id, user_id, title, updated_at, created_at)
       values ('t-blk-1', $1, 'still mine', 1, 1)`,
      [BLOCKED],
    );
  });

  await db.query(
    `insert into public.account_status (user_id, status, reason, auto, updated_at)
     values ($1, 'blocked', 'test', false, now())
     on conflict (user_id) do update set status = 'blocked'`,
    [BLOCKED],
  );

  await asUser(db, BLOCKED, async () => {
    // Confirm the block really is in force, so the next assertion means
    // something rather than passing because nothing was blocking anyway.
    const direct = await db.query(`select count(*)::int n from public.tasks`);
    expectEqual(Number(direct.rows[0].n), 0, 'ordinary reads are denied while blocked');

    const { rows } = await db.query(`select * from public.export_own_data('tasks', 100)`);
    expectEqual(rows.length, 1, 'export still returns own rows while blocked');
  });
});

await test('0022 cannot be pointed at anybody else', async () => {
  // There is no user-id argument, so the only way to ask for another account is
  // to call an overload that does not exist. If one is ever added, this fails.
  const { rows } = await db.query(
    `select count(*)::int n from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'export_own_data'
        and 'uuid'::regtype = any (p.proargtypes::oid[]::regtype[])`,
  );
  expectEqual(Number(rows[0].n), 0, 'export_own_data overloads taking a uuid');
});

await test('0022 refuses a table outside the exportable set', async () => {
  await asUser(db, ALICE, async () => {
    await expectRejection(
      () => db.query(`select * from public.export_own_data('admin_audit_log', 10)`),
      'not exportable',
    );
    // The vault is deliberately out: the server only holds ciphertext sealed to
    // a key it never derived, so returning it satisfies the letter of a request
    // with bytes nobody can open.
    await expectRejection(
      () => db.query(`select * from public.export_own_data('private_entries', 10)`),
      'not exportable',
    );
  });
});

await test('0022 records every request', async () => {
  const LOGGED = 'dddddddd-0000-0000-0000-000000000003';
  await createUser(db, LOGGED, 'logged@example.com');

  await asUser(db, LOGGED, async () => {
    await db.query(`select * from public.export_own_data('tasks', 10)`);
    const seen = await count(
      `select count(*)::int n from public.data_access_log where user_id = $1`,
      [LOGGED],
    );
    expectEqual(seen, 1, 'requests logged');
  });
});

await test('0022 nobody can edit the access log, including its subject', async () => {
  // "We provided the data" is the claim that has to be evidenced, and a log the
  // subject can rewrite is not evidence.
  await asUser(db, ALICE, async () => {
    await expectRejection(
      () =>
        db.query(`insert into public.data_access_log (user_id, table_name) values ($1, 'tasks')`, [
          ALICE,
        ]),
      'violates row-level security policy',
    );
  });
});

// ---------------------------------------------------------------------------
console.log('\n0023 group RLS, rewritten');
// ---------------------------------------------------------------------------

/**
 * 0023 swapped every group policy from a correlated per-row membership call to
 * a hoisted `x in (select my_*_ids())`. The whole point is that the predicate is
 * unchanged, so the pre-existing 0003–0021 group tests passing is the primary
 * evidence. These add the case that shape could plausibly get wrong: a set-based
 * test that accidentally spans groups rather than scoping to one.
 */
await test('0023 one group cannot see another group', async () => {
  const A_OWNER = 'eeeeeeee-0000-0000-0000-000000000001';
  const B_OWNER = 'eeeeeeee-0000-0000-0000-000000000002';
  await createUser(db, A_OWNER, 'ga@example.com');
  await createUser(db, B_OWNER, 'gb@example.com');

  const mkGroup = async (uid, gid) => {
    await asUser(db, uid, async () => {
      await db.query(`select public.create_expense_group($1, $2, 'trip', '$', $3, null, $4, 1)`, [
        gid,
        `name-${gid}`,
        `m-${gid}`,
        `act-${gid}`,
      ]);
      await db.query(
        `insert into public.expense_group_expenses
           (id, group_id, paid_by_member_id, description, amount_cents, currency, spent_at,
            created_by, created_at, updated_at)
         values ($1, $2, $3, 'dinner', 1000, '$', 1, $4, 1, 1)`,
        [`x-${gid}`, gid, `m-${gid}`, uid],
      );
      await db.query(
        `insert into public.expense_group_shares
           (id, expense_id, member_id, share_cents, created_at, updated_at)
         values ($1, $2, $3, 1000, 1, 1)`,
        [`s-${gid}`, `x-${gid}`, `m-${gid}`],
      );
    });
  };

  await mkGroup(A_OWNER, 'grp-a');
  await mkGroup(B_OWNER, 'grp-b');

  await asUser(db, A_OWNER, async () => {
    // The membership set is per-caller. If `my_expense_group_ids()` ever
    // stopped filtering on auth.uid(), every one of these becomes 2 and the
    // whole ledger leaks between unrelated households.
    expectEqual(await count(`select count(*)::int n from public.expense_groups`), 1, 'groups');
    expectEqual(
      await count(`select count(*)::int n from public.expense_group_expenses`),
      1,
      'expenses',
    );
    expectEqual(
      await count(`select count(*)::int n from public.expense_group_shares`),
      1,
      'shares (reached through my_expense_ids, the widest of the new sets)',
    );
    expectEqual(
      await count(`select count(*)::int n from public.expense_group_members`),
      1,
      'members',
    );
  });
});

await test('0023 leaving a group closes the door immediately', async () => {
  // The membership set is computed per statement, so a soft-deleted membership
  // row has to drop out of it on the very next query — not on the next session.
  const OWNER = 'eeeeeeee-0000-0000-0000-000000000003';
  const GUEST = 'eeeeeeee-0000-0000-0000-000000000004';
  await createUser(db, OWNER, 'go@example.com');
  await createUser(db, GUEST, 'gg@example.com');

  await asUser(db, OWNER, async () => {
    await db.query(
      `select public.create_expense_group('grp-c', 'c', 'home', '$', 'm-c-owner', null, 'act-c', 1)`,
    );
    await db.query(
      `insert into public.expense_group_members
         (id, group_id, user_id, display_name, role, joined_at, created_at, updated_at)
       values ('m-c-guest', 'grp-c', $1, 'guest', 'member', 1, 1, 1)`,
      [GUEST],
    );
  });

  await asUser(db, GUEST, async () => {
    expectEqual(await count(`select count(*)::int n from public.expense_groups`), 1, 'in');
    await db.query(`update public.expense_group_members set deleted_at = 1 where user_id = $1`, [
      GUEST,
    ]);
    expectEqual(await count(`select count(*)::int n from public.expense_groups`), 0, 'out');
  });
});

await test('0024 with no override, the global switch decides', async () => {
  await db.query(
    `insert into public.module_flags (module, enabled, message, updated_at)
     values ('budget', false, 'maintenance', now())
     on conflict (module) do update set enabled = false, message = 'maintenance'`,
  );
  await asUser(db, ALICE, async () => {
    const { rows } = await db.query(`select * from public.my_module_flags()`);
    const budget = rows.find((r) => r.module === 'budget');
    expectEqual(budget?.enabled, false, 'global off reaches a user with no override');
    expectEqual(budget?.message, 'maintenance', 'the operator message travels');
  });
});

await test('0024 a user override wins, including re-enabling', async () => {
  // The staged-rollout case: on for this account while off for everyone else.
  // Without a tri-state override, per-user flags could only ever take away.
  await asUser(db, ADMIN, async () => {
    await db.query(
      `select public.admin_set_user_module($1::uuid, 'budget', true, 'early access')`,
      [BOB],
    );
  });
  await asUser(db, BOB, async () => {
    const { rows } = await db.query(`select * from public.my_module_flags()`);
    expectEqual(
      rows.find((r) => r.module === 'budget'),
      undefined,
      'an override re-enables a globally disabled module',
    );
  });
  await asUser(db, ALICE, async () => {
    const { rows } = await db.query(`select * from public.my_module_flags()`);
    expectEqual(
      rows.find((r) => r.module === 'budget')?.enabled,
      false,
      "somebody else's override does not reach this account",
    );
  });
});

await test('0024 an override can switch one account off on its own', async () => {
  // The support-fix case. `notes` has no global row at all, so this also proves
  // the join reaches an override with no global counterpart.
  await asUser(db, ADMIN, async () => {
    await db.query(`select public.admin_set_user_module($1::uuid, 'notes', false, 'crash loop')`, [
      BOB,
    ]);
  });
  await asUser(db, BOB, async () => {
    const { rows } = await db.query(`select * from public.my_module_flags()`);
    expectEqual(rows.find((r) => r.module === 'notes')?.enabled, false, 'off for this account');
  });
  await asUser(db, ALICE, async () => {
    const { rows } = await db.query(`select * from public.my_module_flags()`);
    expectEqual(
      rows.find((r) => r.module === 'notes'),
      undefined,
      'and on for everybody else',
    );
  });
});

await test('0024 the internal note is never shown to its subject', async () => {
  // `message` is the operator's user-facing explanation and only ever lives on
  // the global row. The per-user note is internal — "crash loop", "abusive" —
  // and must not be rendered to the account it is about.
  await asUser(db, BOB, async () => {
    const { rows } = await db.query(`select * from public.my_module_flags()`);
    expectEqual(rows.find((r) => r.module === 'notes')?.message, null, 'per-user note withheld');
  });
});

await test('0024 a user cannot switch their own modules back on', async () => {
  // An override its subject can edit is an override that means nothing.
  //
  // Note the shape of the first assertion. There is no DELETE policy on the
  // table, and RLS answers a missing DELETE policy by making the rows invisible
  // to the statement rather than by raising — so the DELETE *succeeds* and
  // removes nothing. Asserting a rejection would have failed for the right
  // reason and taught the wrong lesson; the property that matters is that the
  // row is still there afterwards.
  await asUser(db, BOB, async () => {
    await db.query(`delete from public.module_flags_user where user_id = $1`, [BOB]);
    await expectRejection(
      () => db.query(`select public.admin_set_user_module($1::uuid, 'notes', true, 'nope')`, [BOB]),
      'not an administrator',
    );
  });

  expectEqual(
    await count(
      `select count(*)::int n from public.module_flags_user
        where user_id = $1 and module = 'notes'`,
      [BOB],
    ),
    1,
    'the override survives its subject trying to delete it',
  );

  await asUser(db, BOB, async () => {
    const { rows } = await db.query(`select * from public.my_module_flags()`);
    expectEqual(
      rows.find((r) => r.module === 'notes')?.enabled,
      false,
      'and the module is still switched off for them',
    );
  });
});

await test('0024 clearing an override falls back to the global switch', async () => {
  await asUser(db, ADMIN, async () => {
    await db.query(`select public.admin_clear_user_module($1::uuid, 'budget')`, [BOB]);
  });
  await asUser(db, BOB, async () => {
    const { rows } = await db.query(`select * from public.my_module_flags()`);
    expectEqual(rows.find((r) => r.module === 'budget')?.enabled, false, 'back to global');
  });
});

await test('0025 escrow can actually be written — the bug this migration fixes', async () => {
  // Before 0025 this was impossible, and nothing said so. `vault_escrow` has no
  // SELECT policy by design, and Postgres refuses `INSERT … ON CONFLICT DO
  // UPDATE` against a table the caller cannot select from — whether or not a
  // conflicting row exists. PostgREST's `.upsert()` emits exactly that, so every
  // upload since 0015 failed silently and the table stayed empty. The
  // capability PRIVACY.md describes did not exist.
  const FRESH = 'ffffffff-0000-0000-0000-000000000001';
  await createUser(db, FRESH, 'escrow-fresh@example.com');

  await asUser(db, FRESH, async () => {
    await db.query(`select public.set_own_vault_escrow(1, 'eph-1', 'wrapped-1')`);
    // Twice, because a scheme that works once is what the old code looked like.
    await db.query(`select public.set_own_vault_escrow(1, 'eph-2', 'wrapped-2')`);
  });

  const row = await one(
    `select ephemeral_public_key, wrapped_key from public.vault_escrow where user_id = $1`,
    [FRESH],
  );
  expectEqual(row?.wrapped_key, 'wrapped-2', 'the second upload replaced the first');
});

await test('0025 the direct upsert is still refused, which is why the RPC exists', async () => {
  await asUser(db, ALICE, async () => {
    await expectRejection(
      () =>
        db.query(
          `insert into public.vault_escrow (user_id, ephemeral_public_key, wrapped_key)
           values ($1::uuid, 'e2', 'w2')
           on conflict (user_id) do update set wrapped_key = 'w2'`,
          [ALICE],
        ),
      'row-level security',
    );
  });
});

await test('0025 a filtered update or delete silently matches nothing', async () => {
  // The other half of the same gap, and the reason a policy-only fix was not
  // available: a WHERE clause cannot see the row it filters on, so both of
  // these report success and change nothing — the worst possible answer for a
  // "remove my key from your servers" button.
  const V = 'ffffffff-0000-0000-0000-000000000002';
  await createUser(db, V, 'escrow-victim@example.com');
  await asUser(db, V, async () => {
    await db.query(`select public.set_own_vault_escrow(1, 'eph', 'ORIGINAL')`);
    await db.query(`update public.vault_escrow set wrapped_key = 'CHANGED' where user_id = $1`, [
      V,
    ]);
    await db.query(`delete from public.vault_escrow where user_id = $1`, [V]);
  });

  const row = await one(`select wrapped_key from public.vault_escrow where user_id = $1`, [V]);
  expectEqual(row?.wrapped_key, 'ORIGINAL', 'the filtered update changed nothing');
});

await test('0025 destroying a vault removes its escrow', async () => {
  // The most explicit "I want this gone" the app offers used to clear the local
  // keystore and leave the sealed key on the server — the space became
  // unreadable to its owner while staying readable to an operator.
  const D = 'ffffffff-0000-0000-0000-000000000003';
  await createUser(db, D, 'escrow-destroy@example.com');

  await asUser(db, D, async () => {
    await db.query(`select public.set_own_vault_escrow(1, 'eph', 'wrapped')`);
    await db.query(`select public.delete_own_vault_escrow()`);
  });

  expectEqual(
    await count(`select count(*)::int n from public.vault_escrow where user_id = $1`, [D]),
    0,
    'own escrow row deleted',
  );
});

await test('0025 neither RPC can be pointed at anybody else', async () => {
  // Same shape as `export_own_data` in 0022: no user id to get wrong. Both read
  // auth.uid() and nothing else, which is the whole safety argument for a
  // SECURITY DEFINER function that writes a key-escrow table.
  const OTHER = 'ffffffff-0000-0000-0000-000000000004';
  await createUser(db, OTHER, 'escrow-other@example.com');
  await asUser(db, OTHER, async () => {
    await db.query(`select public.set_own_vault_escrow(1, 'eph-other', 'wrapped-other')`);
  });

  await asUser(db, ALICE, async () => {
    await db.query(`select public.delete_own_vault_escrow()`);
  });

  expectEqual(
    await count(`select count(*)::int n from public.vault_escrow where user_id = $1`, [OTHER]),
    1,
    'another account’s escrow survives',
  );

  const { rows } = await db.query(
    `select count(*)::int n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
      where ns.nspname = 'public'
        and p.proname in ('set_own_vault_escrow', 'delete_own_vault_escrow')
        and 'uuid'::regtype = any (p.proargtypes::oid[]::regtype[])`,
  );
  expectEqual(Number(rows[0].n), 0, 'overloads taking a uuid');
});

await test('0025 an anonymous caller is refused', async () => {
  await expectRejection(
    () => db.query(`select public.set_own_vault_escrow(1, 'e', 'w')`),
    'sign in first',
  );
});

await test('0025 the escrow blob is still unreadable by its own owner', async () => {
  // Deliberately no SELECT policy: the client writes the blob and forgets it,
  // and `uploadEscrow` upserts rather than reading first. Only
  // `admin_fetch_vault_escrow` returns it, behind the admin gate and an audit
  // row. A select policy added "for symmetry" would quietly widen that.
  await asUser(db, BOB, async () => {
    expectEqual(
      await count(`select count(*)::int n from public.vault_escrow`),
      0,
      'no select policy, so the blob reads as absent',
    );
  });
});

// ---------------------------------------------------------------------------
console.log('\n0026 media storage');
// ---------------------------------------------------------------------------

/**
 * The bytes are the most sensitive thing this app will ever store — somebody's
 * photographs — and the entire isolation model is one predicate: the first path
 * segment is your own uid. These hold it, and hold the quota, which is the only
 * thing standing between this feature and an unbounded bill.
 */
const put = (uid, path, size) =>
  db.query(
    `insert into storage.objects (bucket_id, name, metadata)
     values ('media', $1, jsonb_build_object('size', $2::bigint))`,
    [`${uid}/${path}`, size],
  );

await test('0026 you can store and read your own media', async () => {
  const M1 = 'aaaabbbb-0000-0000-0000-000000000001';
  await createUser(db, M1, 'media1@example.com');
  // 0035 gates media backup behind a paid plan; this section is about
  // isolation and quota mechanics, not that gate, so every user who
  // actually uploads here is bumped off the free plan the same way
  // ALBUM_OWNER is, above.
  await asUser(db, M1, async () => {
    await db.query(`select public.set_my_plan('plus_monthly', $1)`, [Date.now() + 30 * 86400000]);
  });
  await asUser(db, M1, async () => {
    await put(M1, 'gallery_photos/p1.jpg', 1024);
    expectEqual(
      await count(`select count(*)::int n from storage.objects where bucket_id = 'media'`),
      1,
      'own objects visible',
    );
  });
});

await test('0026 one account cannot read another account’s media', async () => {
  // The whole point of the feature and the whole risk of it, in one assertion.
  const M2 = 'aaaabbbb-0000-0000-0000-000000000002';
  await createUser(db, M2, 'media2@example.com');
  await asUser(db, M2, async () => {
    expectEqual(
      await count(`select count(*)::int n from storage.objects where bucket_id = 'media'`),
      0,
      'somebody else’s objects are invisible',
    );
  });
});

await test('0026 you cannot write into another account’s folder', async () => {
  const M3 = 'aaaabbbb-0000-0000-0000-000000000003';
  const VICTIM = 'aaaabbbb-0000-0000-0000-000000000001';
  await createUser(db, M3, 'media3@example.com');
  // Paid, so this actually exercises the RLS rejection being tested rather
  // than being short-circuited by 0035's plan check, which runs first.
  await asUser(db, M3, async () => {
    await db.query(`select public.set_my_plan('plus_monthly', $1)`, [Date.now() + 30 * 86400000]);
  });
  await asUser(db, M3, async () => {
    await expectRejection(() => put(VICTIM, 'gallery_photos/forged.jpg', 10), 'row-level security');
  });
});

await test('0026 you cannot delete another account’s media', async () => {
  const M4 = 'aaaabbbb-0000-0000-0000-000000000004';
  const VICTIM = 'aaaabbbb-0000-0000-0000-000000000001';
  await createUser(db, M4, 'media4@example.com');
  await asUser(db, M4, async () => {
    await db.query(`delete from storage.objects where name like $1`, [`${VICTIM}/%`]);
  });
  expectEqual(
    await count(`select count(*)::int n from storage.objects where name like $1`, [`${VICTIM}/%`]),
    1,
    'the victim’s object survives',
  );
});

await test('0026 the quota is enforced on the server', async () => {
  // A limit the client alone enforces is a suggestion to anyone who has not
  // modified the client. This is the one that costs money.
  const M5 = 'aaaabbbb-0000-0000-0000-000000000005';
  await createUser(db, M5, 'media5@example.com');
  let quota;
  await asUser(db, M5, async () => {
    await db.query(`select public.set_my_plan('plus_monthly', $1)`, [Date.now() + 30 * 86400000]);
    // Queried as M5, not the harness's own connection: since 0037,
    // media_quota_bytes() reads the CALLER's plan, so evaluating it outside
    // asUser() would silently see no signed-in account and fall back to the
    // free-plan number instead of M5's real (much larger) plus quota.
    quota = Number((await one(`select public.media_quota_bytes() as q`)).q);
  });

  await asUser(db, M5, async () => {
    await put(M5, 'gallery_photos/big.jpg', quota - 100);
    await expectRejection(
      () => put(M5, 'gallery_photos/over.jpg', 200),
      'media storage quota exceeded',
    );
  });
});

await test('0026 usage is reported to the account it belongs to', async () => {
  // A quota nobody can see is a quota that only ever appears as an unexplained
  // failure, so the app has to be able to show it.
  const M6 = 'aaaabbbb-0000-0000-0000-000000000006';
  await createUser(db, M6, 'media6@example.com');
  await asUser(db, M6, async () => {
    await db.query(`select public.set_my_plan('plus_monthly', $1)`, [Date.now() + 30 * 86400000]);
  });
  await asUser(db, M6, async () => {
    await put(M6, 'songs/a.mp3', 500);
    await put(M6, 'songs/b.mp3', 250);
    expectEqual(Number((await one(`select public.media_bytes_used() as b`)).b), 750, 'bytes used');
  });
});

await test('0026 usage counts only your own bytes', async () => {
  const M7 = 'aaaabbbb-0000-0000-0000-000000000007';
  await createUser(db, M7, 'media7@example.com');
  await asUser(db, M7, async () => {
    expectEqual(
      Number((await one(`select public.media_bytes_used() as b`)).b),
      0,
      'a new account starts at zero however much anyone else stores',
    );
  });
});

await test('0026 the bucket is private', async () => {
  // A public bucket would make every path a guessable URL, and the paths are
  // derived from row ids that travel in the metadata sync.
  const bucket = await one(`select public from storage.buckets where id = 'media'`);
  expectEqual(bucket?.public, false, 'bucket is not public');
});

await test('0023 the hoisted sets are scoped to the caller', async () => {
  // Direct assertions on the functions themselves, so a failure names the cause
  // rather than a downstream policy.
  const SOLO = 'eeeeeeee-0000-0000-0000-000000000005';
  await createUser(db, SOLO, 'solo@example.com');
  await asUser(db, SOLO, async () => {
    expectEqual(
      await count(`select count(*)::int n from public.my_expense_group_ids()`),
      0,
      'a user in no groups sees no group ids',
    );
    expectEqual(
      await count(`select count(*)::int n from public.my_expense_ids()`),
      0,
      'a user in no groups sees no expense ids',
    );
  });
});

// ---------------------------------------------------------------------------
console.log('\nshared albums (0027)');
// ---------------------------------------------------------------------------
//
// Modelled on the expense-group suite above, minus anything ledger-shaped and
// plus the two things that make an album different: the name is ciphertext
// (peek must never return it), and membership grants no key material at all
// — accepting an invitation must not touch key_confirmed_at.

const ALBUM_OWNER = '11223344-0000-0000-0000-000000000001';
const ALBUM_PARTNER = '11223344-0000-0000-0000-000000000002';
const ALBUM_OUTSIDER = '11223344-0000-0000-0000-000000000003';
const ALBUM_THIRD = '11223344-0000-0000-0000-000000000004';
const ALBUM_BLOCKER = '11223344-0000-0000-0000-000000000005';
const ALBUM_PEST = '11223344-0000-0000-0000-000000000006';

await createUser(db, ALBUM_OWNER, 'album-owner@example.com');
await createUser(db, ALBUM_PARTNER, 'album-partner@example.com');
await createUser(db, ALBUM_OUTSIDER, 'album-outsider@example.com');
await createUser(db, ALBUM_THIRD, 'album-third@example.com');
await createUser(db, ALBUM_BLOCKER, 'album-blocker@example.com');
await createUser(db, ALBUM_PEST, 'album-pest@example.com');

// 0032's free-plan album/member limits are exercised in their own section,
// below, with dedicated users and a clean count from zero. Every test above
// this point is about membership/RLS/moderation behaviour, not plan limits,
// and several of them put three-plus members on one album on purpose (alb-1
// gets a partner, an outsider placeholder AND a third member across the
// suite) — so ALBUM_OWNER is bumped off the free plan once, here, rather
// than have those unrelated tests start failing the moment 0032 exists.
await asUser(db, ALBUM_OWNER, async () => {
  await db.query(`select public.set_my_plan('plus_monthly', $1)`, [Date.now() + 30 * 86400000]);
});

await test('0027 create_shared_album creates the album and its owner member together', async () => {
  await asUser(db, ALBUM_OWNER, async () => {
    await db.query(
      `select public.create_shared_album('alb-1','cipher:name-1','m-owner',null,'act-created',$1)`,
      [Date.now()],
    );
  });
  expectEqual(
    await count(`select count(*)::int n from public.shared_albums where id = 'alb-1'`),
    1,
    'album row',
  );
  expectEqual(
    await count(
      `select count(*)::int n from public.shared_album_members
        where album_id = 'alb-1' and role = 'owner' and user_id = $1`,
      [ALBUM_OWNER],
    ),
    1,
    'owner member row',
  );
  expectEqual(
    await count(
      `select count(*)::int n from public.shared_album_activity
        where album_id = 'alb-1' and action = 'album_created'`,
    ),
    1,
    'creation activity',
  );
});

await test('0027 a non-member cannot see the album, its members, or its activity', async () => {
  await asUser(db, ALBUM_OUTSIDER, async () => {
    expectEqual(await count(`select count(*)::int n from public.shared_albums`), 0, 'albums');
    expectEqual(
      await count(`select count(*)::int n from public.shared_album_members`),
      0,
      'members',
    );
    expectEqual(
      await count(`select count(*)::int n from public.shared_album_activity`),
      0,
      'activity',
    );
  });
});

await test('0027 an invitation can be created by a member', async () => {
  await asUser(db, ALBUM_OWNER, async () => {
    await db.query(
      `insert into public.shared_album_members
         (id, album_id, user_id, email, display_name, role, created_at, updated_at)
       values ('m-partner','alb-1',null,'album-partner@example.com','Partner','member',$1,$1)`,
      [Date.now()],
    );
    await db.query(
      `select public.create_album_invitation(
         'inv-1','alb-1','m-partner','album-partner@example.com','tok-1',$1,$2)`,
      [Date.now() + 86400000, Date.now()],
    );
  });
  expectEqual(
    await count(`select count(*)::int n from public.shared_album_invitations`),
    1,
    'invitations',
  );
});

await test('0027 peeking reveals only a status — never the ciphertext name', async () => {
  await asUser(db, ALBUM_PARTNER, async () => {
    const r = await one(`select * from public.peek_album_invitation('tok-1',$1)`, [Date.now()]);
    expectEqual(r.status, 'ok');
    expectEqual(
      JSON.stringify(Object.keys(r)),
      JSON.stringify(['status']),
      'no other column is returned',
    );
  });
});

await test('0027 an unknown token is invalid', async () => {
  await asUser(db, ALBUM_PARTNER, async () => {
    const r = await one(`select * from public.peek_album_invitation('nope',$1)`, [Date.now()]);
    expectEqual(r.status, 'invalid');
  });
});

await test('0027 accepting claims the placeholder member, but confirms no key', async () => {
  await asUser(db, ALBUM_PARTNER, async () => {
    expectEqual(
      (await one(`select status from public.accept_album_invitation('tok-1',$1)`, [Date.now()]))
        .status,
      'ok',
    );
  });
  const row = await one(
    `select user_id, key_confirmed_at from public.shared_album_members where id = 'm-partner'`,
  );
  expectEqual(row.user_id, ALBUM_PARTNER, "partner's claimed member row");
  expectEqual(row.key_confirmed_at, null, 'membership grants no key material');
});

await test('0027 the partner can now read the album', async () => {
  await asUser(db, ALBUM_PARTNER, async () => {
    expectEqual(
      await count(`select count(*)::int n from public.shared_albums`),
      1,
      'albums visible',
    );
  });
});

await test('0027 confirm_album_key is scoped to the caller’s own row', async () => {
  await asUser(db, ALBUM_PARTNER, async () => {
    // Confirming your own row works.
    await db.query(`select public.confirm_album_key('m-partner',$1)`, [Date.now()]);
    // Trying to confirm somebody else's row silently affects nothing — same
    // idiom as an UPDATE ... WHERE that matches zero rows, not an error, so a
    // buggy client cannot use the response to distinguish "not your row" from
    // "row doesn't exist".
    await db.query(`select public.confirm_album_key('m-owner',$1)`, [Date.now()]);
  });
  const partnerRow = await one(
    `select key_confirmed_at from public.shared_album_members where id = 'm-partner'`,
  );
  expectEqual(
    partnerRow.key_confirmed_at !== null,
    true,
    'confirm_album_key set the caller’s own row',
  );

  const ownerRow = await one(
    `select key_confirmed_at from public.shared_album_members where id = 'm-owner'`,
  );
  expectEqual(ownerRow.key_confirmed_at, null, "cannot confirm someone else's row");
});

await test('0027 an invitation cannot be redeemed twice', async () => {
  await asUser(db, ALBUM_OUTSIDER, async () => {
    expectEqual(
      (await one(`select status from public.accept_album_invitation('tok-1',$1)`, [Date.now()]))
        .status,
      'already_accepted',
    );
  });
});

await test('0027 an expired invitation is refused', async () => {
  await asUser(db, ALBUM_OWNER, async () => {
    await db.query(
      `insert into public.shared_album_members
         (id, album_id, user_id, email, display_name, role, created_at, updated_at)
       values ('m-outsider','alb-1',null,'album-outsider@example.com','Outsider','member',$1,$1)`,
      [Date.now()],
    );
    await db.query(
      `select public.create_album_invitation(
         'inv-2','alb-1','m-outsider','album-outsider@example.com','tok-old',$1,$2)`,
      [Date.now() - 1000, Date.now()],
    );
  });
  await asUser(db, ALBUM_OUTSIDER, async () => {
    expectEqual(
      (await one(`select status from public.accept_album_invitation('tok-old',$1)`, [Date.now()]))
        .status,
      'expired',
    );
  });
});

await test('0027 any member may add a photo, recorded as their own', async () => {
  await asUser(db, ALBUM_PARTNER, async () => {
    await db.query(
      `insert into public.shared_album_photos
         (id, album_id, added_by, width, height, byte_length, created_at, updated_at)
       values ('photo-1','alb-1',$1,800,600,123456,$2,$2)`,
      [ALBUM_PARTNER, Date.now()],
    );
  });
  expectEqual(
    await count(`select count(*)::int n from public.shared_album_photos where album_id = 'alb-1'`),
    1,
    'photo row',
  );
});

await test('0027 a non-member cannot add a photo to someone else’s album', async () => {
  const LONER = '11223344-0000-0000-0000-000000000009';
  await createUser(db, LONER, 'album-loner@example.com');
  await asUser(db, LONER, async () => {
    await expectRejection(
      () =>
        db.query(
          `insert into public.shared_album_photos
             (id, album_id, added_by, created_at, updated_at)
           values ('photo-forged','alb-1',$1,$2,$2)`,
          [LONER, Date.now()],
        ),
      'row-level security',
    );
  });
});

await test('0027 a blocked user cannot be added to an album', async () => {
  await asUser(db, ALBUM_PEST, async () => {
    await db.query(
      `select public.create_shared_album('alb-pest','cipher:pest',$1,null,'act-pest',$2)`,
      ['m-pest-owner', Date.now()],
    );
  });
  await asUser(db, ALBUM_BLOCKER, async () => {
    await db.query(`select public.block_user($1::uuid)`, [ALBUM_PEST]);
  });
  await asUser(db, ALBUM_PEST, async () => {
    await expectRejection(
      () =>
        db.query(
          `insert into public.shared_album_members
             (id, album_id, user_id, email, display_name, role, created_at, updated_at)
           values ('m-blocker-add','alb-pest',null,'album-blocker@example.com','Blocker','member',$1,$1)`,
          [Date.now()],
        ),
      'cannot be added',
    );
  });
});

await test('0027 a blocked user cannot invite you', async () => {
  await asUser(db, ALBUM_PEST, async () => {
    await expectRejection(
      () =>
        db.query(
          `insert into public.shared_album_invitations
             (id, album_id, member_id, email, token, invited_by, expires_at, created_at)
           values ('inv-pest','alb-pest',null,'album-blocker@example.com','tok-pest',$1,$2,$3)`,
          [ALBUM_PEST, Date.now() + 86400000, Date.now()],
        ),
      'cannot be invited',
    );
  });
});

await test('0027 a token minted before the block cannot be redeemed after it', async () => {
  await asUser(db, ALBUM_BLOCKER, async () => {
    await db.query(`select public.unblock_user($1::uuid)`, [ALBUM_PEST]);
  });
  let inviteRow;
  await asUser(db, ALBUM_PEST, async () => {
    await db.query(
      `insert into public.shared_album_members
         (id, album_id, user_id, email, display_name, role, created_at, updated_at)
       values ('m-blocker-2','alb-pest',null,'album-blocker@example.com','Blocker','member',$1,$1)`,
      [Date.now()],
    );
    inviteRow = await db.query(
      `select public.create_album_invitation(
         'inv-pest-2','alb-pest','m-blocker-2','album-blocker@example.com','tok-pest-2',$1,$2)`,
      [Date.now() + 86400000, Date.now()],
    );
  });
  expectEqual(Boolean(inviteRow), true, 'invitation created while contact was still allowed');

  await asUser(db, ALBUM_BLOCKER, async () => {
    await db.query(`select public.block_user($1::uuid)`, [ALBUM_PEST]);
    expectEqual(
      (
        await one(`select status from public.accept_album_invitation('tok-pest-2',$1)`, [
          Date.now(),
        ])
      ).status,
      'blocked',
      'redeeming a blocked inviter’s token',
    );
  });
});

await test('0027 remove_album_member refuses to remove the owner', async () => {
  await asUser(db, ALBUM_OWNER, async () => {
    await expectRejection(
      () => db.query(`select public.remove_album_member('m-owner','act-rm-1',$1)`, [Date.now()]),
      'owner cannot be removed',
    );
  });
});

await test('0027 only the owner can remove another member', async () => {
  await asUser(db, ALBUM_OWNER, async () => {
    await db.query(
      `insert into public.shared_album_members
         (id, album_id, user_id, display_name, role, created_at, updated_at)
       values ('m-third','alb-1',$1,'Third','member',$2,$2)`,
      [ALBUM_THIRD, Date.now()],
    );
  });
  await asUser(db, ALBUM_PARTNER, async () => {
    await expectRejection(
      () => db.query(`select public.remove_album_member('m-third','act-rm-2',$1)`, [Date.now()]),
      'only the album owner',
    );
  });
});

await test('0027 the owner can remove a member, who immediately loses access', async () => {
  await asUser(db, ALBUM_OWNER, async () => {
    await db.query(`select public.remove_album_member('m-third','act-rm-3',$1)`, [Date.now()]);
  });
  expectEqual(
    await count(
      `select count(*)::int n from public.shared_album_members where id = 'm-third' and deleted_at is not null`,
    ),
    1,
    'tombstoned, not deleted',
  );
  await asUser(db, ALBUM_THIRD, async () => {
    expectEqual(
      await count(`select count(*)::int n from public.shared_albums where id = 'alb-1'`),
      0,
      'removed member can no longer read the album',
    );
  });
});

await test('0027 only the owner can delete the album', async () => {
  await asUser(db, ALBUM_PARTNER, async () => {
    await expectRejection(
      () => db.query(`select public.delete_shared_album('alb-1','act-del-1',$1)`, [Date.now()]),
      'only the album owner',
    );
  });
  await asUser(db, ALBUM_OWNER, async () => {
    await db.query(`select public.delete_shared_album('alb-1','act-del-2',$1)`, [Date.now()]);
  });
  expectEqual(
    await count(
      `select count(*)::int n from public.shared_albums where id = 'alb-1' and deleted_at is not null`,
    ),
    1,
    'album soft-deleted',
  );
});

await test('0027 the hoisted album sets are scoped to the caller', async () => {
  const SOLO = '11223344-0000-0000-0000-000000000099';
  await createUser(db, SOLO, 'album-solo@example.com');
  await asUser(db, SOLO, async () => {
    expectEqual(
      await count(`select count(*)::int n from public.my_album_ids()`),
      0,
      'a user in no albums sees no album ids',
    );
  });
});

// ---------------------------------------------------------------------------
console.log('\nshared album storage (0028)');
// ---------------------------------------------------------------------------
//
// Same isolation model as 0026's media bucket, but the first path segment is
// an album id, not a uid — this is the first storage policy in the codebase
// keyed on group membership. ALBUM_OWNER/ALBUM_PARTNER are still both members
// of 'alb-pest' at this point (alb-1 was deleted above, but deletion of the
// *album* row does not touch the storage.objects rows or membership — using
// alb-pest keeps this section independent of that).

const putAlbumObject = (albumId, path, size, metadata = {}) =>
  db.query(
    `insert into storage.objects (bucket_id, name, metadata)
     values ('shared-albums', $1, jsonb_build_object('size', $2::bigint) || $3::jsonb)`,
    [`${albumId}/${path}`, size, JSON.stringify(metadata)],
  );

// Both uploaders in this section hold premium, because since 0052 a
// shared-album upload without it is refused by `enforce_album_media_premium`
// before anything here gets a chance to be tested. That matters most for the
// non-member case below: a BEFORE ROW trigger fires ahead of the WITH CHECK
// policy, so an unpaid outsider would be turned away by the paywall and the
// test would pass while proving nothing about album isolation. Granted
// directly rather than through `admin_grant_premium`, which is owner-only and
// whose bootstrap is deliberately kept until the end of this file.
await db.query(`update public.profiles set premium_until = $1 where id = any($2::uuid[])`, [
  Date.now() + 365 * 86400000,
  [ALBUM_PEST, ALBUM_OUTSIDER],
]);

await test('0028 a member can store and read an object in their album’s folder', async () => {
  await asUser(db, ALBUM_PEST, async () => {
    await putAlbumObject('alb-pest', 'photo-a.bin', 1024);
    expectEqual(
      await count(`select count(*)::int n from storage.objects where bucket_id = 'shared-albums'`),
      1,
      'own album’s objects visible',
    );
  });
});

await test('0028 a non-member cannot read another album’s object, even with a guessed path', async () => {
  await asUser(db, ALBUM_OUTSIDER, async () => {
    expectEqual(
      await count(`select count(*)::int n from storage.objects where bucket_id = 'shared-albums'`),
      0,
      'another album’s objects are invisible',
    );
  });
});

await test('0028 a non-member cannot write into another album’s folder', async () => {
  await asUser(db, ALBUM_OUTSIDER, async () => {
    await expectRejection(() => putAlbumObject('alb-pest', 'forged.bin', 10), 'row-level security');
  });
});

await test('0028 the uploader is stamped from auth.uid(), never trusted from client metadata', async () => {
  await asUser(db, ALBUM_PEST, async () => {
    // Claims to be someone else's upload; the trigger must overwrite this.
    await putAlbumObject('alb-pest', 'photo-b.bin', 2048, { uploader_id: ALBUM_BLOCKER });
  });
  const row = await one(
    `select metadata->>'uploader_id' as uploader
       from storage.objects
      where bucket_id = 'shared-albums' and name = $1`,
    ['alb-pest/photo-b.bin'],
  );
  expectEqual(row.uploader, ALBUM_PEST, 'stamped from auth.uid(), not the forged claim');
});

await test('0028 the shared-albums quota is enforced on the server, sharing the media cap', async () => {
  let quota;
  await asUser(db, ALBUM_PEST, async () => {
    // Queried as ALBUM_PEST — see the matching comment on the 0026 quota test:
    // since 0037, media_quota_bytes() reads the CALLER's plan.
    quota = Number((await one(`select public.media_quota_bytes() as q`)).q);
  });
  await asUser(db, ALBUM_PEST, async () => {
    // Already used 1024 + 2048 bytes above under this same uploader.
    await putAlbumObject('alb-pest', 'big.bin', quota - 3072 - 100);
    await expectRejection(
      () => putAlbumObject('alb-pest', 'over.bin', 200),
      'shared album storage quota exceeded',
    );
  });
});

await test('0028 usage is reported to the uploader it belongs to', async () => {
  await asUser(db, ALBUM_BLOCKER, async () => {
    expectEqual(
      Number((await one(`select public.shared_album_bytes_used() as b`)).b),
      0,
      'a different account starts at zero however much anyone else stores',
    );
  });
});

await test('0028 the bucket is private', async () => {
  const bucket = await one(`select public from storage.buckets where id = 'shared-albums'`);
  expectEqual(bucket?.public, false, 'bucket is not public');
});

// ---------------------------------------------------------------------------
console.log('\nalbum comments & chat (0029)');
// ---------------------------------------------------------------------------
//
// A fresh album (alb-together) rather than reusing alb-1/alb-pest above —
// alb-1 was soft-deleted by the 0027 suite and alb-pest's membership is
// entangled with the 0028 storage-quota tests, and neither is a clean base
// for "is this flag actually gating the insert". ALBUM_OWNER owns it;
// ALBUM_THIRD and ALBUM_PARTNER are ordinary members; ALBUM_OUTSIDER is
// never added.

await asUser(db, ALBUM_OWNER, async () => {
  await db.query(
    `select public.create_shared_album('alb-together','cipher:together','m-together-owner',null,'act-together',$1)`,
    [Date.now()],
  );
  await db.query(
    `insert into public.shared_album_members
       (id, album_id, user_id, email, display_name, role, created_at, updated_at)
     values
       ('m-together-third','alb-together',$1,'album-third@example.com','Third','member',$3,$3),
       ('m-together-partner','alb-together',$2,'album-partner@example.com','Partner','member',$3,$3)`,
    [ALBUM_THIRD, ALBUM_PARTNER, Date.now()],
  );
});

await test('0029 comments and chat are off by default', async () => {
  const row = await one(
    `select allow_comments, allow_chat from public.shared_albums where id = 'alb-together'`,
  );
  expectEqual(row.allow_comments, false, 'comments default off');
  expectEqual(row.allow_chat, false, 'chat default off');
});

await test('0029 a member cannot comment while comments are off', async () => {
  await asUser(db, ALBUM_THIRD, async () => {
    await expectRejection(
      () =>
        db.query(
          `insert into public.shared_album_comments
             (id, album_id, author_id, author_name, body_ciphertext, created_at, updated_at)
           values ('cmt-early','alb-together',$1,'Third','cipher:hi',$2,$2)`,
          [ALBUM_THIRD, Date.now()],
        ),
      'row-level security',
    );
  });
});

await test('0029 only the owner can turn comments on', async () => {
  await asUser(db, ALBUM_THIRD, async () => {
    await expectRejection(
      () =>
        db.query(
          `update public.shared_albums set allow_comments = true, updated_at = $1 where id = 'alb-together'`,
          [Date.now()],
        ),
      'only the album owner',
    );
  });
  await asUser(db, ALBUM_OWNER, async () => {
    await db.query(
      `update public.shared_albums set allow_comments = true, updated_at = $1 where id = 'alb-together'`,
      [Date.now()],
    );
  });
  const row = await one(
    `select allow_comments from public.shared_albums where id = 'alb-together'`,
  );
  expectEqual(row.allow_comments, true, 'owner turned comments on');
});

await test('0029 a member can comment once comments are on', async () => {
  await asUser(db, ALBUM_THIRD, async () => {
    await db.query(
      `insert into public.shared_album_comments
         (id, album_id, author_id, author_name, body_ciphertext, created_at, updated_at)
       values ('cmt-third','alb-together',$1,'Third','cipher:hi',$2,$2)`,
      [ALBUM_THIRD, Date.now()],
    );
  });
  expectEqual(
    await count(`select count(*)::int n from public.shared_album_comments where id = 'cmt-third'`),
    1,
    'comment stored',
  );
});

await test('0029 the two flags are independent — chat stays off even with comments on', async () => {
  await asUser(db, ALBUM_THIRD, async () => {
    await expectRejection(
      () =>
        db.query(
          `insert into public.shared_album_messages
             (id, album_id, author_id, author_name, body_ciphertext, created_at, updated_at)
           values ('msg-early','alb-together',$1,'Third','cipher:hey',$2,$2)`,
          [ALBUM_THIRD, Date.now()],
        ),
      'row-level security',
    );
  });
});

await test('0029 a non-member cannot read or post comments', async () => {
  await asUser(db, ALBUM_OUTSIDER, async () => {
    expectEqual(
      await count(
        `select count(*)::int n from public.shared_album_comments where album_id = 'alb-together'`,
      ),
      0,
      'invisible to a non-member',
    );
    await expectRejection(
      () =>
        db.query(
          `insert into public.shared_album_comments
             (id, album_id, author_id, author_name, body_ciphertext, created_at, updated_at)
           values ('cmt-outsider','alb-together',$1,'Outsider','cipher:hi',$2,$2)`,
          [ALBUM_OUTSIDER, Date.now()],
        ),
      'row-level security',
    );
  });
});

await test('0029 a fellow member — not the author, not the owner — cannot delete a comment', async () => {
  // RLS's USING clause on UPDATE filters which rows are visible to update,
  // rather than raising — a write that matches nothing simply affects zero
  // rows. So the assertion is that the comment survives untouched, not that
  // the statement throws.
  await asUser(db, ALBUM_PARTNER, async () => {
    await db.query(
      `update public.shared_album_comments set deleted_at = $1, updated_at = $1 where id = 'cmt-third'`,
      [Date.now()],
    );
  });
  const row = await one(
    `select deleted_at from public.shared_album_comments where id = 'cmt-third'`,
  );
  if (row.deleted_at !== null)
    throw new Error('a fellow member should not have been able to delete this');
});

await test('0029 the author can soft-delete their own comment', async () => {
  await asUser(db, ALBUM_THIRD, async () => {
    await db.query(
      `update public.shared_album_comments set deleted_at = $1, updated_at = $1 where id = 'cmt-third'`,
      [Date.now()],
    );
  });
  const row = await one(
    `select deleted_at from public.shared_album_comments where id = 'cmt-third'`,
  );
  if (row.deleted_at === null) throw new Error('expected deleted_at to be set');
});

await test('0029 the owner can moderate — delete a comment they did not write', async () => {
  await asUser(db, ALBUM_PARTNER, async () => {
    await db.query(
      `insert into public.shared_album_comments
         (id, album_id, author_id, author_name, body_ciphertext, created_at, updated_at)
       values ('cmt-partner','alb-together',$1,'Partner','cipher:hi',$2,$2)`,
      [ALBUM_PARTNER, Date.now()],
    );
  });
  await asUser(db, ALBUM_OWNER, async () => {
    await db.query(
      `update public.shared_album_comments set deleted_at = $1, updated_at = $1 where id = 'cmt-partner'`,
      [Date.now()],
    );
  });
  const row = await one(
    `select deleted_at from public.shared_album_comments where id = 'cmt-partner'`,
  );
  if (row.deleted_at === null) throw new Error('owner moderation should have soft-deleted it');
});

await test('0029 chat: off by default, owner-only to enable, then open to members', async () => {
  await asUser(db, ALBUM_THIRD, async () => {
    await expectRejection(
      () =>
        db.query(
          `update public.shared_albums set allow_chat = true, updated_at = $1 where id = 'alb-together'`,
          [Date.now()],
        ),
      'only the album owner',
    );
  });
  await asUser(db, ALBUM_OWNER, async () => {
    await db.query(
      `update public.shared_albums set allow_chat = true, updated_at = $1 where id = 'alb-together'`,
      [Date.now()],
    );
  });
  await asUser(db, ALBUM_THIRD, async () => {
    await db.query(
      `insert into public.shared_album_messages
         (id, album_id, author_id, author_name, body_ciphertext, created_at, updated_at)
       values ('msg-third','alb-together',$1,'Third','cipher:hey',$2,$2)`,
      [ALBUM_THIRD, Date.now()],
    );
  });
  await asUser(db, ALBUM_PARTNER, async () => {
    expectEqual(
      await count(
        `select count(*)::int n from public.shared_album_messages where album_id = 'alb-together'`,
      ),
      1,
      'a fellow member can read the message',
    );
  });
  await asUser(db, ALBUM_OUTSIDER, async () => {
    expectEqual(
      await count(
        `select count(*)::int n from public.shared_album_messages where album_id = 'alb-together'`,
      ),
      0,
      'a non-member cannot',
    );
  });
});

// ---------------------------------------------------------------------------
console.log('\nchat: receipts, disappearing, voice (0053 + 0054)');
// ---------------------------------------------------------------------------
//
// Continues on alb-together with allow_chat now true and 'msg-third' present
// from the 0029 suite above. ALBUM_OUTSIDER is still not a member, which is
// what every negative case here leans on.

await test('0053 a member can edit their own message, and nobody else’s', async () => {
  await asUser(db, ALBUM_THIRD, async () => {
    await db.query(`select public.edit_album_message('msg-third','cipher:hey-fixed')`);
  });
  expectEqual(
    (await one(`select body_ciphertext b from public.shared_album_messages where id='msg-third'`))
      .b,
    'cipher:hey-fixed',
    'the author’s own edit landed',
  );
  expectEqual(
    Boolean(
      (
        await one(
          `select edited_at is not null e from public.shared_album_messages where id='msg-third'`,
        )
      ).e,
    ),
    true,
    'edited_at stamped, so clients can show "edited"',
  );

  // The point of the RPC: 0029's update policy lets any member update any row
  // in their album, so this must be refused by the function, not by RLS.
  await asUser(db, ALBUM_PARTNER, async () => {
    await expectRejection(
      () => db.query(`select public.edit_album_message('msg-third','cipher:forged')`),
      'only the author may edit a message',
    );
  });
});

await test('0053 reactions dedupe, and only their owner can remove one', async () => {
  await asUser(db, ALBUM_PARTNER, async () => {
    for (let i = 0; i < 2; i++) {
      await db.query(
        `insert into public.shared_album_message_reactions
           (message_id, album_id, user_id, emoji, created_at)
         values ('msg-third','alb-together',$1,'👍',$2)
         on conflict do nothing`,
        [ALBUM_PARTNER, Date.now()],
      );
    }
  });
  expectEqual(
    await count(
      `select count(*)::int n from public.shared_album_message_reactions where message_id='msg-third'`,
    ),
    1,
    'reacting twice with the same emoji is one fact, not two',
  );
  await asUser(db, ALBUM_THIRD, async () => {
    await db.query(
      `delete from public.shared_album_message_reactions
        where message_id='msg-third' and user_id=$1`,
      [ALBUM_PARTNER],
    );
  });
  expectEqual(
    await count(
      `select count(*)::int n from public.shared_album_message_reactions where message_id='msg-third'`,
    ),
    1,
    'somebody else’s delete removed nothing',
  );
});

await test('0053 the read marker only ever moves forward', async () => {
  await asUser(db, ALBUM_PARTNER, async () => {
    await db.query(`select public.mark_album_read('alb-together', 5000)`);
    await db.query(`select public.mark_album_read('alb-together', 9000)`);
    // Out of order, as a second device reporting late would be.
    await db.query(`select public.mark_album_read('alb-together', 7000)`);
  });
  expectEqual(
    Number(
      (
        await one(
          `select read_through r from public.shared_album_reads
            where album_id='alb-together' and user_id=$1`,
          [ALBUM_PARTNER],
        )
      ).r,
    ),
    9000,
    'the late, older report did not un-read anything',
  );
});

await test('0054 marking read also marks delivered', async () => {
  // The contradiction this prevents: a blue read tick sitting above a grey
  // undelivered one, permanently, because nothing else would ever move the
  // delivery marker for a message that was already read.
  expectEqual(
    Number(
      (
        await one(
          `select delivered_through d from public.shared_album_deliveries
            where album_id='alb-together' and user_id=$1`,
          [ALBUM_PARTNER],
        )
      ).d,
    ),
    9000,
    'delivery marker carried along by the read above',
  );
});

await test('0054 the delivery marker moves forward independently, and never back', async () => {
  await asUser(db, ALBUM_THIRD, async () => {
    await db.query(`select public.mark_album_delivered('alb-together', 4000)`);
    await db.query(`select public.mark_album_delivered('alb-together', 2000)`);
  });
  expectEqual(
    Number(
      (
        await one(
          `select delivered_through d from public.shared_album_deliveries
            where album_id='alb-together' and user_id=$1`,
          [ALBUM_THIRD],
        )
      ).d,
    ),
    4000,
    'greatest(), same as the read marker',
  );
  // Delivered without read: the whole point of a separate marker.
  expectEqual(
    await count(
      `select count(*)::int n from public.shared_album_reads
        where album_id='alb-together' and user_id=$1`,
      [ALBUM_THIRD],
    ),
    0,
    'a delivery did not invent a read',
  );
});

await test('0054 a non-member cannot mark anything in an album they are not in', async () => {
  await asUser(db, ALBUM_OUTSIDER, async () => {
    await expectRejection(
      () => db.query(`select public.mark_album_delivered('alb-together', 1)`),
      'not a member of this album',
    );
  });
});

await test('0053 the disappearing timer is owner-only and bounded', async () => {
  await asUser(db, ALBUM_THIRD, async () => {
    await expectRejection(
      () => db.query(`select public.set_album_disappearing('alb-together', 3600)`),
      'owner',
    );
  });
  await asUser(db, ALBUM_OWNER, async () => {
    await expectRejection(
      () => db.query(`select public.set_album_disappearing('alb-together', 2)`),
      'timer out of range',
    );
  });
});

await test('0053 the timer stamps at insert, and changing it is not retroactive', async () => {
  const t0 = Date.now();
  await asUser(db, ALBUM_OWNER, async () => {
    await db.query(`select public.set_album_disappearing('alb-together', 60)`);
    await db.query(
      `insert into public.shared_album_messages
         (id, album_id, author_id, author_name, body_ciphertext, created_at, updated_at)
       values ('msg-timed','alb-together',$1,'Owner','cipher:timed',$2,$2)`,
      [ALBUM_OWNER, t0],
    );
  });
  expectEqual(
    Number(
      (await one(`select expires_at e from public.shared_album_messages where id='msg-timed'`)).e,
    ),
    t0 + 60000,
    'expiry copied from the album’s timer at insert',
  );

  // The load-bearing half: a message already said must not be re-dated by a
  // later change to the album's timer.
  await asUser(db, ALBUM_OWNER, async () => {
    await db.query(`select public.set_album_disappearing('alb-together', 5)`);
  });
  expectEqual(
    Number(
      (await one(`select expires_at e from public.shared_album_messages where id='msg-timed'`)).e,
    ),
    t0 + 60000,
    'the already-sent message kept the timer it was sent under',
  );
  await asUser(db, ALBUM_OWNER, async () => {
    await db.query(`select public.set_album_disappearing('alb-together', null)`);
  });
});

await test('0053 the sweep is a SOFT delete — the row stays', async () => {
  const past = Date.now() - 10000;
  await asUser(db, ALBUM_OWNER, async () => {
    await db.query(
      `insert into public.shared_album_messages
         (id, album_id, author_id, author_name, body_ciphertext, created_at, updated_at)
       values ('msg-due','alb-together',$1,'Owner','cipher:due',$2,$2)`,
      [ALBUM_OWNER, past],
    );
    await db.query(`update public.shared_album_messages set expires_at = $1 where id='msg-due'`, [
      past,
    ]);
    expectEqual(
      Number((await one(`select public.expire_album_messages('alb-together') n`)).n),
      1,
      'one message was due',
    );
  });
  expectEqual(
    await count(`select count(*)::int n from public.shared_album_messages where id='msg-due'`),
    1,
    'the row is still there — a hard delete here would be unrecoverable',
  );
  expectEqual(
    Boolean(
      (
        await one(
          `select disappeared_at is not null d from public.shared_album_messages where id='msg-due'`,
        )
      ).d,
    ),
    true,
    'stamped rather than removed',
  );
  await asUser(db, ALBUM_OWNER, async () => {
    expectEqual(
      Number((await one(`select public.expire_album_messages('alb-together') n`)).n),
      0,
      'idempotent — a swept row no longer matches',
    );
  });
});

await test('0054 a voice message carries a recording and a text message may not', async () => {
  await asUser(db, ALBUM_OWNER, async () => {
    await db.query(
      `insert into public.shared_album_messages
         (id, album_id, author_id, author_name, body_ciphertext, created_at, updated_at,
          kind, voice_path, voice_duration_ms, voice_byte_length)
       values ('msg-voice','alb-together',$1,'Owner','cipher:v',$2,$2,
               'voice','alb-together/voice/msg-voice.bin',4200,9000)`,
      [ALBUM_OWNER, Date.now()],
    );
    await expectRejection(
      () =>
        db.query(
          `insert into public.shared_album_messages
             (id, album_id, author_id, author_name, body_ciphertext, created_at, updated_at,
              kind, voice_path)
           values ('msg-bad','alb-together',$1,'Owner','cipher:x',$2,$2,
                   'text','alb-together/voice/nope.bin')`,
          [ALBUM_OWNER, Date.now()],
        ),
      'shared_album_messages_voice_shape',
    );
  });
  expectEqual(
    (await one(`select kind k from public.shared_album_messages where id='msg-voice'`)).k,
    'voice',
    'the voice row stands',
  );
});

await test('0054 a voice note is free, while a photo in the same album is not', async () => {
  // MEDIA_PLAN_FREE is on plus_monthly by the time the 0035/0052 suite has run,
  // so this uses a fresh free account: the whole assertion is about the plan.
  const VOICE_FREE = '99400000-0000-0000-0000-000000000001';
  await createUser(db, VOICE_FREE, 'voice-free@example.com');
  await asUser(db, VOICE_FREE, async () => {
    await db.query(
      `select public.create_shared_album('alb-voice-free','cipher:x','m-voice-free',null,'act-voice-free',$1)`,
      [Date.now()],
    );
    await expectRejection(
      () => putAlbumObject('alb-voice-free', 'photo.bin', 1024),
      'requires a paid plan',
    );
    await putAlbumObject('alb-voice-free', 'voice/note.bin', 1024);
  });
  expectEqual(
    await count(
      `select count(*)::int n from storage.objects
        where bucket_id='shared-albums' and name='alb-voice-free/voice/note.bin'`,
    ),
    1,
    'the voice note went through on a free plan',
  );
});

await test('0054 the voice carve-out is capped, so it is not free storage', async () => {
  const VOICE_FREE = '99400000-0000-0000-0000-000000000001';
  await asUser(db, VOICE_FREE, async () => {
    await expectRejection(
      () => putAlbumObject('alb-voice-free', 'voice/huge.bin', 17 * 1024 * 1024),
      'limited to 16 MiB',
    );
  });
});

await test('0054 an album named "voice" cannot smuggle photos past the gate', async () => {
  // The carve-out reads path segment 2, not segment 1 — this is the test that
  // says so, because reading segment 1 would look identical until someone
  // named an album this.
  //
  // A second free account, because the free plan allows one album at a time
  // and the account above has already spent its one.
  const VOICE_NAMED = '99400000-0000-0000-0000-000000000002';
  await createUser(db, VOICE_NAMED, 'voice-named@example.com');
  await asUser(db, VOICE_NAMED, async () => {
    await db.query(
      `select public.create_shared_album('voice','cipher:x','m-voice-album',null,'act-voice-album',$1)`,
      [Date.now()],
    );
    await expectRejection(() => putAlbumObject('voice', 'photo.bin', 1024), 'requires a paid plan');
  });
});

// ---------------------------------------------------------------------------
console.log('\nshared plans (0038)');
// ---------------------------------------------------------------------------
//
// Reuses alb-together (ALBUM_OWNER/ALBUM_THIRD/ALBUM_PARTNER members,
// ALBUM_OUTSIDER not a member) from the 0029 suite above — no allow_plans
// flag exists, so unlike comments this needs no "turn it on" step.

await test('0038 any member can add a shared plan — no flag required', async () => {
  await asUser(db, ALBUM_THIRD, async () => {
    await db.query(
      `insert into public.shared_album_events
         (id, album_id, title_ciphertext, event_date, author_id, created_at, updated_at)
       values ('evt-third','alb-together','cipher:trip','2026-09-01',$1,$2,$2)`,
      [ALBUM_THIRD, Date.now()],
    );
  });
  expectEqual(
    await count(`select count(*)::int n from public.shared_album_events where id = 'evt-third'`),
    1,
    'plan stored',
  );
});

await test('0038 a non-member cannot read or add a shared plan', async () => {
  await asUser(db, ALBUM_OUTSIDER, async () => {
    expectEqual(
      await count(
        `select count(*)::int n from public.shared_album_events where album_id = 'alb-together'`,
      ),
      0,
      'invisible to a non-member',
    );
    await expectRejection(
      () =>
        db.query(
          `insert into public.shared_album_events
             (id, album_id, title_ciphertext, event_date, author_id, created_at, updated_at)
           values ('evt-outsider','alb-together','cipher:x','2026-09-01',$1,$2,$2)`,
          [ALBUM_OUTSIDER, Date.now()],
        ),
      'row-level security',
    );
  });
});

await test('0038 a fellow member cannot edit someone else’s plan, but the owner can', async () => {
  await asUser(db, ALBUM_PARTNER, async () => {
    await db.query(
      `update public.shared_album_events set title_ciphertext = 'cipher:hijacked', updated_at = $1
        where id = 'evt-third'`,
      [Date.now()],
    );
  });
  expectEqual(
    (await one(`select title_ciphertext from public.shared_album_events where id = 'evt-third'`))
      .title_ciphertext,
    'cipher:trip',
    'a fellow member’s edit did not take',
  );
  await asUser(db, ALBUM_OWNER, async () => {
    await db.query(
      `update public.shared_album_events set deleted_at = $1, updated_at = $1 where id = 'evt-third'`,
      [Date.now()],
    );
  });
  expectEqual(
    (await one(`select deleted_at from public.shared_album_events where id = 'evt-third'`))
      .deleted_at === null,
    false,
    'owner moderation soft-deleted it',
  );
});

// ---------------------------------------------------------------------------
console.log('\ncustom milestones (0039)');
// ---------------------------------------------------------------------------

await test('0039 any member can add a milestone — no flag required', async () => {
  await asUser(db, ALBUM_PARTNER, async () => {
    await db.query(
      `insert into public.shared_album_milestones
         (id, album_id, title_ciphertext, milestone_date, recurring, author_id, created_at, updated_at)
       values ('mst-partner','alb-together','cipher:anniv','2026-06-01',true,$1,$2,$2)`,
      [ALBUM_PARTNER, Date.now()],
    );
  });
  expectEqual(
    await count(
      `select count(*)::int n from public.shared_album_milestones where id = 'mst-partner'`,
    ),
    1,
    'milestone stored',
  );
});

await test('0039 a non-member cannot read or add a milestone', async () => {
  await asUser(db, ALBUM_OUTSIDER, async () => {
    expectEqual(
      await count(
        `select count(*)::int n from public.shared_album_milestones where album_id = 'alb-together'`,
      ),
      0,
      'invisible to a non-member',
    );
    await expectRejection(
      () =>
        db.query(
          `insert into public.shared_album_milestones
             (id, album_id, title_ciphertext, milestone_date, author_id, created_at, updated_at)
           values ('mst-outsider','alb-together','cipher:x','2026-06-01',$1,$2,$2)`,
          [ALBUM_OUTSIDER, Date.now()],
        ),
      'row-level security',
    );
  });
});

await test('0039 the owner can moderate a milestone they did not create', async () => {
  await asUser(db, ALBUM_OWNER, async () => {
    await db.query(
      `update public.shared_album_milestones set deleted_at = $1, updated_at = $1
        where id = 'mst-partner'`,
      [Date.now()],
    );
  });
  expectEqual(
    (await one(`select deleted_at from public.shared_album_milestones where id = 'mst-partner'`))
      .deleted_at === null,
    false,
    'owner moderation soft-deleted it',
  );
});

// ---------------------------------------------------------------------------
console.log('\nshared notes (0040)');
// ---------------------------------------------------------------------------

await test('0040 notes are off by default, independent of comments/chat already being on', async () => {
  const row = await one(`select allow_notes from public.shared_albums where id = 'alb-together'`);
  expectEqual(row.allow_notes, false, 'notes default off even though comments/chat are on by now');
  await asUser(db, ALBUM_THIRD, async () => {
    await expectRejection(
      () =>
        db.query(
          `insert into public.shared_album_notes
             (id, album_id, author_id, author_name, body_ciphertext, created_at, updated_at)
           values ('note-early','alb-together',$1,'Third','cipher:hi',$2,$2)`,
          [ALBUM_THIRD, Date.now()],
        ),
      'row-level security',
    );
  });
});

await test('0040 only the owner can turn notes on, then a member can post', async () => {
  await asUser(db, ALBUM_THIRD, async () => {
    await expectRejection(
      () =>
        db.query(
          `update public.shared_albums set allow_notes = true, updated_at = $1 where id = 'alb-together'`,
          [Date.now()],
        ),
      'only the album owner',
    );
  });
  await asUser(db, ALBUM_OWNER, async () => {
    await db.query(
      `update public.shared_albums set allow_notes = true, updated_at = $1 where id = 'alb-together'`,
      [Date.now()],
    );
  });
  await asUser(db, ALBUM_THIRD, async () => {
    await db.query(
      `insert into public.shared_album_notes
         (id, album_id, author_id, author_name, body_ciphertext, created_at, updated_at)
       values ('note-third','alb-together',$1,'Third','cipher:hi',$2,$2)`,
      [ALBUM_THIRD, Date.now()],
    );
  });
  await asUser(db, ALBUM_PARTNER, async () => {
    expectEqual(
      await count(
        `select count(*)::int n from public.shared_album_notes where album_id = 'alb-together'`,
      ),
      1,
      'a fellow member can read it',
    );
  });
  await asUser(db, ALBUM_OUTSIDER, async () => {
    expectEqual(
      await count(
        `select count(*)::int n from public.shared_album_notes where album_id = 'alb-together'`,
      ),
      0,
      'a non-member cannot',
    );
  });
});

await test('0040 the owner can moderate a note they did not write', async () => {
  await asUser(db, ALBUM_OWNER, async () => {
    await db.query(
      `update public.shared_album_notes set deleted_at = $1, updated_at = $1 where id = 'note-third'`,
      [Date.now()],
    );
  });
  expectEqual(
    (await one(`select deleted_at from public.shared_album_notes where id = 'note-third'`))
      .deleted_at === null,
    false,
    'owner moderation soft-deleted it',
  );
});

// ---------------------------------------------------------------------------
console.log('\nbilling plan (0031) + shared-album plan limits (0032)');
// ---------------------------------------------------------------------------

const PLAN_FREE = '99000000-0000-0000-0000-000000000001';
const PLAN_FRIEND = '99000000-0000-0000-0000-000000000002';
const PLAN_THIRD = '99000000-0000-0000-0000-000000000003';
const PLAN_PAID = '99000000-0000-0000-0000-000000000004';
const PLAN_PAID_FRIEND = '99000000-0000-0000-0000-000000000005';
const PLAN_PAID_THIRD = '99000000-0000-0000-0000-000000000006';

await createUser(db, PLAN_FREE, 'plan-free@example.com');
await createUser(db, PLAN_FRIEND, 'plan-friend@example.com');
await createUser(db, PLAN_THIRD, 'plan-third@example.com');
await createUser(db, PLAN_PAID, 'plan-paid@example.com');
await createUser(db, PLAN_PAID_FRIEND, 'plan-paid-friend@example.com');
await createUser(db, PLAN_PAID_THIRD, 'plan-paid-third@example.com');

await test('0031 a new account defaults to the free plan', async () => {
  await asUser(db, PLAN_FREE, async () => {
    expectEqual((await one(`select public.my_plan_id() as p`)).p, 'free', 'defaults free');
  });
});

await test('0031 set_my_plan updates only the caller’s own row', async () => {
  await asUser(db, PLAN_PAID, async () => {
    await db.query(`select public.set_my_plan('plus_yearly', $1)`, [Date.now() + 365 * 86400000]);
  });
  expectEqual(
    (await one(`select plan_id from public.profiles where id = $1`, [PLAN_PAID])).plan_id,
    'plus_yearly',
    'the caller’s own row changed',
  );
  expectEqual(
    (await one(`select plan_id from public.profiles where id = $1`, [PLAN_FREE])).plan_id,
    'free',
    'nobody else’s row did',
  );
});

await test('0031 an unrecognised plan id is refused', async () => {
  await asUser(db, PLAN_FREE, async () => {
    await expectRejection(
      () => db.query(`select public.set_my_plan('super_deluxe', null)`),
      'unknown plan',
    );
  });
});

await test('0032 a free-plan account can create one shared album, not two', async () => {
  await asUser(db, PLAN_FREE, async () => {
    await db.query(
      `select public.create_shared_album('alb-plan-free','cipher:x','m-plan-free-owner',null,'act-plan-1',$1)`,
      [Date.now()],
    );
    await expectRejection(
      () =>
        db.query(
          `select public.create_shared_album('alb-plan-free-2','cipher:y','m-plan-free-owner-2',null,'act-plan-2',$1)`,
          [Date.now()],
        ),
      'one shared album',
    );
  });
});

await test('0032 a free-plan album is capped at two active members', async () => {
  await asUser(db, PLAN_FREE, async () => {
    await db.query(
      `insert into public.shared_album_members
         (id, album_id, user_id, display_name, role, created_at, updated_at)
       values ('m-plan-friend','alb-plan-free',$1,'Friend','member',$2,$2)`,
      [PLAN_FRIEND, Date.now()],
    );
    await expectRejection(
      () =>
        db.query(
          `insert into public.shared_album_members
             (id, album_id, user_id, display_name, role, created_at, updated_at)
           values ('m-plan-third','alb-plan-free',$1,'Third','member',$2,$2)`,
          [PLAN_THIRD, Date.now()],
        ),
      'two people per shared album',
    );
  });
  expectEqual(
    await count(
      `select count(*)::int n from public.shared_album_members
        where album_id = 'alb-plan-free' and deleted_at is null`,
    ),
    2,
    'owner + one friend, the third never landed',
  );
});

await test('0032 upgrading lifts both limits for the same account', async () => {
  await asUser(db, PLAN_FREE, async () => {
    await db.query(`select public.set_my_plan('plus_monthly', $1)`, [Date.now() + 30 * 86400000]);
    await db.query(
      `select public.create_shared_album('alb-plan-free-2','cipher:y','m-plan-free-owner-2',null,'act-plan-3',$1)`,
      [Date.now()],
    );
    await db.query(
      `insert into public.shared_album_members
         (id, album_id, user_id, display_name, role, created_at, updated_at)
       values ('m-plan-third','alb-plan-free',$1,'Third','member',$2,$2)`,
      [PLAN_THIRD, Date.now()],
    );
  });
  expectEqual(
    await count(
      `select count(*)::int n from public.shared_albums
        where created_by = $1 and deleted_at is null`,
      [PLAN_FREE],
    ),
    2,
    'a second album, once paid',
  );
  expectEqual(
    await count(
      `select count(*)::int n from public.shared_album_members
        where album_id = 'alb-plan-free' and deleted_at is null`,
    ),
    3,
    'a third member on the original album, once paid',
  );
});

await test('0032 the cap follows the album OWNER’s plan, not an invited member’s own plan', async () => {
  // PLAN_PAID is on plus_yearly (set above); PLAN_PAID_FRIEND and
  // PLAN_PAID_THIRD are ordinary free accounts, and both still fit — the
  // album's capacity is the owner's to grow, not each guest's own plan.
  await asUser(db, PLAN_PAID, async () => {
    await db.query(
      `select public.create_shared_album('alb-plan-paid','cipher:z','m-plan-paid-owner',null,'act-plan-4',$1)`,
      [Date.now()],
    );
    await db.query(
      `insert into public.shared_album_members
         (id, album_id, user_id, display_name, role, created_at, updated_at)
       values ('m-plan-paid-friend','alb-plan-paid',$1,'Friend','member',$2,$2)`,
      [PLAN_PAID_FRIEND, Date.now()],
    );
    await db.query(
      `insert into public.shared_album_members
         (id, album_id, user_id, display_name, role, created_at, updated_at)
       values ('m-plan-paid-third','alb-plan-paid',$1,'Third','member',$2,$2)`,
      [PLAN_PAID_THIRD, Date.now()],
    );
  });
  expectEqual(
    await count(
      `select count(*)::int n from public.shared_album_members
        where album_id = 'alb-plan-paid' and deleted_at is null`,
    ),
    3,
    'both free-plan guests fit — the owner is the one who is paid',
  );
});

// ---------------------------------------------------------------------------
console.log('\nadmin roster (0033)');
// ---------------------------------------------------------------------------
//
// ADMIN already exists (inserted near the top of this file, role 'admin',
// no `is_owner`) and is promoted to owner directly here — claim_owner()
// itself can only run once, on a genuinely empty `admins` table, which this
// point in the suite is not; that path gets its own destructive section at
// the very end of this file, after everything that still needs ADMIN's
// ordinary admin rights (billing plans, below) has already run.

const ROSTER_STAFF = '99200000-0000-0000-0000-000000000001';
const ROSTER_ADMIN2 = '99200000-0000-0000-0000-000000000002';
const ROSTER_OUTSIDER = '99200000-0000-0000-0000-000000000003';

await createUser(db, ROSTER_STAFF, 'roster-staff@example.com');
await createUser(db, ROSTER_ADMIN2, 'roster-admin2@example.com');
await createUser(db, ROSTER_OUTSIDER, 'roster-outsider@example.com');

await db.query(`update public.admins set is_owner = true where user_id = $1`, [ADMIN]);

await test('0033 the owner can add a staff operator by email', async () => {
  await asUser(db, ADMIN, async () => {
    await db.query(`select public.admin_add_operator($1, 'staff')`, ['roster-staff@example.com']);
  });
  const row = await one(`select role, is_owner from public.admins where user_id = $1`, [
    ROSTER_STAFF,
  ]);
  expectEqual(row.role, 'staff', 'added at the requested role');
  expectEqual(row.is_owner, false, 'never becomes owner through this path');
});

await test('0033 a non-owner cannot add an operator', async () => {
  await asUser(db, ROSTER_STAFF, async () => {
    await expectRejection(
      () =>
        db.query(`select public.admin_add_operator($1, 'staff')`, ['roster-outsider@example.com']),
      'only the owner',
    );
  });
});

await test('0033 the owner can change an operator’s role', async () => {
  await asUser(db, ADMIN, async () => {
    await db.query(`select public.admin_set_operator_role($1, 'admin')`, [ROSTER_STAFF]);
  });
  expectEqual(
    (await one(`select role from public.admins where user_id = $1`, [ROSTER_STAFF])).role,
    'admin',
    'promoted',
  );
});

await test('0033 the owner’s own row cannot be re-roled or removed through the RPCs', async () => {
  await asUser(db, ADMIN, async () => {
    await expectRejection(
      () => db.query(`select public.admin_set_operator_role($1, 'staff')`, [ADMIN]),
      'owner’s role cannot be changed',
    );
    await expectRejection(
      () => db.query(`select public.admin_remove_operator($1)`, [ADMIN]),
      'owner cannot be removed',
    );
  });
});

await test('0033 admin_add_operator refuses to touch the owner’s row either', async () => {
  await asUser(db, ADMIN, async () => {
    await expectRejection(
      () => db.query(`select public.admin_add_operator('admin@example.com', 'staff')`),
      'owner’s role cannot be changed',
    );
  });
});

await test('0033 the owner can remove an operator', async () => {
  await asUser(db, ADMIN, async () => {
    await db.query(`select public.admin_remove_operator($1)`, [ROSTER_STAFF]);
  });
  expectEqual(
    await count(`select count(*)::int n from public.admins where user_id = $1`, [ROSTER_STAFF]),
    0,
    'gone from the roster',
  );
});

await test('0033 any operator can list the roster, not only the owner', async () => {
  await asUser(db, ADMIN, async () => {
    await db.query(`select public.admin_add_operator($1, 'staff')`, ['roster-staff@example.com']);
  });
  await asUser(db, ROSTER_STAFF, async () => {
    const rows = (await db.query(`select * from public.admin_list_operators()`)).rows;
    if (rows.length < 2) throw new Error('expected at least the owner and this staff member');
    if (!rows.some((r) => r.is_owner)) throw new Error('the owner should be listed');
  });
});

await test('0033 an outsider cannot reach any roster RPC', async () => {
  await asUser(db, ROSTER_OUTSIDER, async () => {
    await expectRejection(
      () => db.query(`select public.admin_list_operators()`),
      'not an operator',
    );
    await expectRejection(
      () =>
        db.query(`select public.admin_add_operator($1, 'staff')`, ['roster-admin2@example.com']),
      'only the owner',
    );
  });
});

// ---------------------------------------------------------------------------
console.log('\nbilling plans (0034)');
// ---------------------------------------------------------------------------

await test('0034 the seeded plans are readable by anyone signed in', async () => {
  await asUser(db, ROSTER_OUTSIDER, async () => {
    expectEqual(
      await count(`select count(*)::int n from public.billing_plans where active`),
      3,
      'the three seeded plans',
    );
  });
});

await test('0034 only an admin can create or edit a plan', async () => {
  await asUser(db, ROSTER_OUTSIDER, async () => {
    await expectRejection(
      () => db.query(`select public.admin_upsert_plan('plan-x','Test',1,100,'usd','month',null,9)`),
      'not an administrator',
    );
  });
  await asUser(db, ADMIN, async () => {
    await db.query(
      `select public.admin_upsert_plan('plan-x','Test',1073741824,299,'usd','month',null,9)`,
    );
  });
  expectEqual(
    (await one(`select price_cents from public.billing_plans where id = 'plan-x'`)).price_cents,
    299,
    'the new plan was created',
  );
});

await test('0034 upsert edits an existing plan in place rather than duplicating it', async () => {
  await asUser(db, ADMIN, async () => {
    await db.query(
      `select public.admin_upsert_plan('plan-x','Test v2',1073741824,399,'usd','month',null,9)`,
    );
  });
  expectEqual(
    await count(`select count(*)::int n from public.billing_plans where id = 'plan-x'`),
    1,
    'still one row',
  );
  expectEqual(
    (await one(`select name, price_cents from public.billing_plans where id = 'plan-x'`))
      .price_cents,
    399,
    'price updated',
  );
});

await test('0034 a plan an admin just created is actually assignable via set_my_plan', async () => {
  // Proves profiles.plan_id is now a real reference to billing_plans rather
  // than the three-value check constraint 0031 originally wrote — an admin
  // adding a fourth plan has to result in something a user can subscribe to.
  await asUser(db, ROSTER_OUTSIDER, async () => {
    await db.query(`select public.set_my_plan('plan-x', $1)`, [Date.now() + 30 * 86400000]);
  });
  expectEqual(
    (await one(`select plan_id from public.profiles where id = $1`, [ROSTER_OUTSIDER])).plan_id,
    'plan-x',
    'assigned to the newly-created plan',
  );
  // Put it back, so later sections that assume ROSTER_OUTSIDER is on 'free'
  // (there are none after this point, but this is the honest thing to do).
  await asUser(db, ROSTER_OUTSIDER, async () => {
    await db.query(`select public.set_my_plan('free', null)`);
  });
});

await test('0034 set_my_plan refuses a plan id that does not exist', async () => {
  await asUser(db, ROSTER_OUTSIDER, async () => {
    await expectRejection(
      () => db.query(`select public.set_my_plan('not-a-real-plan', null)`),
      'unknown plan',
    );
  });
});

await test('0034 an archived plan is invisible to an ordinary account, visible to an admin', async () => {
  await asUser(db, ADMIN, async () => {
    await db.query(`select public.admin_set_plan_active('plan-x', false)`);
  });
  await asUser(db, ROSTER_OUTSIDER, async () => {
    expectEqual(
      await count(`select count(*)::int n from public.billing_plans where id = 'plan-x'`),
      0,
      'hidden from an ordinary account',
    );
  });
  await asUser(db, ADMIN, async () => {
    expectEqual(
      await count(`select count(*)::int n from public.billing_plans where id = 'plan-x'`),
      1,
      'still visible to an admin, to be able to restore it',
    );
  });
});

await test('0034 a staff-tier operator cannot edit plans — only admin', async () => {
  await asUser(db, ROSTER_STAFF, async () => {
    await expectRejection(
      () => db.query(`select public.admin_set_plan_active('plan-x', true)`),
      'not an administrator',
    );
  });
});

await test('0034 an archived plan cannot be self-assigned, even though the row still exists', async () => {
  await asUser(db, ROSTER_OUTSIDER, async () => {
    await expectRejection(
      () => db.query(`select public.set_my_plan('plan-x', null)`),
      'unknown plan',
    );
  });
});

// ---------------------------------------------------------------------------
console.log('\nmedia backup requires a paid plan (0035)');
// ---------------------------------------------------------------------------

const MEDIA_PLAN_FREE = '99300000-0000-0000-0000-000000000001';
await createUser(db, MEDIA_PLAN_FREE, 'media-plan-free@example.com');

await test('0035 a free-plan account cannot back up media at all', async () => {
  await asUser(db, MEDIA_PLAN_FREE, async () => {
    await expectRejection(
      () => put(MEDIA_PLAN_FREE, 'gallery_photos/p1.jpg', 1024),
      'media backup requires a paid plan',
    );
  });
});

await test('0052 a free-plan account can make a shared album but not put photos in it', async () => {
  // 0035 exempted shared-album media so the couple case worked free, and this
  // test asserted exactly that. 0052 reverses the exemption deliberately — see
  // its header, which reverses the promise where the promise was made — so the
  // assertion is inverted here rather than deleted: the reversal is the thing
  // worth holding onto, and a deleted test would let it drift back silently.
  //
  // The album itself is still free to create. Only the upload is gated, and
  // only at upload — nothing already stored is touched.
  await asUser(db, MEDIA_PLAN_FREE, async () => {
    await db.query(
      `select public.create_shared_album('alb-media-free','cipher:x','m-media-free-owner',null,'act-media-free',$1)`,
      [Date.now()],
    );
    await expectRejection(
      () => putAlbumObject('alb-media-free', 'photo-a.bin', 1024),
      'adding photos to a shared album requires a paid plan',
    );
  });
  expectEqual(
    await count(
      `select count(*)::int n from storage.objects
        where bucket_id = 'shared-albums' and name = 'alb-media-free/photo-a.bin'`,
    ),
    0,
    'nothing was stored on the free plan',
  );
});

await test('0052 upgrading the same account lets the photo through', async () => {
  // The other half of the gate: it refuses a plan, not a person. Paired with
  // the test above so a regression that refuses everybody cannot pass as one
  // that merely charges for it.
  await asUser(db, MEDIA_PLAN_FREE, async () => {
    await db.query(`select public.set_my_plan('plus_monthly', $1)`, [Date.now() + 30 * 86400000]);
    await putAlbumObject('alb-media-free', 'photo-a.bin', 1024);
  });
  expectEqual(
    await count(
      `select count(*)::int n from storage.objects
        where bucket_id = 'shared-albums' and name = 'alb-media-free/photo-a.bin'`,
    ),
    1,
    'the same upload succeeds once the account is paid',
  );
});

await test('0035 upgrading lifts the block, still bounded by the existing byte quota', async () => {
  await asUser(db, MEDIA_PLAN_FREE, async () => {
    await db.query(`select public.set_my_plan('plus_monthly', $1)`, [Date.now() + 30 * 86400000]);
    await put(MEDIA_PLAN_FREE, 'gallery_photos/p1.jpg', 1024);
  });
  expectEqual(
    await count(
      `select count(*)::int n from storage.objects
        where bucket_id = 'media' and name = $1`,
      [`${MEDIA_PLAN_FREE}/gallery_photos/p1.jpg`],
    ),
    1,
    'upload succeeded once on a paid plan',
  );

  let quota;
  await asUser(db, MEDIA_PLAN_FREE, async () => {
    // Queried as MEDIA_PLAN_FREE (now on plus_monthly), not the harness's own
    // connection — see the matching comment on the 0026 quota test above.
    quota = Number((await one(`select public.media_quota_bytes() as q`)).q);
  });
  await asUser(db, MEDIA_PLAN_FREE, async () => {
    await expectRejection(
      () => put(MEDIA_PLAN_FREE, 'gallery_photos/over.jpg', quota),
      'media storage quota exceeded',
    );
  });
});

// ---------------------------------------------------------------------------
console.log('\nmedia quota follows the plan (0037)');
// ---------------------------------------------------------------------------

await test('0037 a free account’s quota matches the seeded free plan row', async () => {
  const QUOTA_FREE = '99400000-0000-0000-0000-000000000001';
  await createUser(db, QUOTA_FREE, 'quota-free@example.com');
  await asUser(db, QUOTA_FREE, async () => {
    const quota = Number((await one(`select public.media_quota_bytes() as q`)).q);
    const seeded = Number(
      (await one(`select storage_bytes as b from public.billing_plans where id = 'free'`)).b,
    );
    expectEqual(quota, seeded, 'a free account’s quota is billing_plans’ free row, live');
    expectEqual(quota, 52428800, '50 MB');
  });
});

await test('0037 a paid account’s quota is the plan’s, not the old flat constant', async () => {
  const QUOTA_PLUS = '99400000-0000-0000-0000-000000000002';
  await createUser(db, QUOTA_PLUS, 'quota-plus@example.com');
  await asUser(db, QUOTA_PLUS, async () => {
    await db.query(`select public.set_my_plan('plus_monthly', $1)`, [Date.now() + 30 * 86400000]);
    const quota = Number((await one(`select public.media_quota_bytes() as q`)).q);
    // Before 0037 this was hardcoded to 150 MiB (0030) for every account —
    // paying for Plus bought nothing. It has to actually be the 50 GB the
    // pricing table promises now.
    expectEqual(quota, 53687091200, '50 GB, not the free tier’s number');
  });
});

await test('0037 raising the free plan’s price live raises what a free account sees', async () => {
  // Proves the lookup is live against billing_plans, not cached at CREATE
  // time — the whole point of replacing a hardcoded constant.
  const QUOTA_LIVE = '99400000-0000-0000-0000-000000000003';
  await createUser(db, QUOTA_LIVE, 'quota-live@example.com');
  await asUser(db, ADMIN, async () => {
    await db.query(
      `select public.admin_upsert_plan('free', 'Free', $1, 0, 'usd', 'free', null, 0)`,
      [104857600], // 100 MB, temporarily
    );
  });
  try {
    await asUser(db, QUOTA_LIVE, async () => {
      const quota = Number((await one(`select public.media_quota_bytes() as q`)).q);
      expectEqual(quota, 104857600, 'reflects the just-edited plan, not a stale 50 MB');
    });
  } finally {
    // Restore, so no later test in the suite inherits this edit.
    await asUser(db, ADMIN, async () => {
      await db.query(
        `select public.admin_upsert_plan('free', 'Free', $1, 0, 'usd', 'free', null, 0)`,
        [52428800],
      );
    });
  }
});

// ---------------------------------------------------------------------------
console.log('\nstreak challenge (0048)');
// ---------------------------------------------------------------------------
//
// The settlement state machine is the one place in this schema where a bug is
// both expensive and completely silent: it decides whether somebody keeps a
// year of progress, and it decides it overnight, in a cron job, for people who
// are asleep. Nobody files a bug report saying "my counter should be 90 and it
// is 45" — they uninstall.
//
// So the whole machine is exercised here rather than sampled. It is testable at
// all because 0048 keeps the arithmetic (`challenge_credit_day`,
// `challenge_settle_missed_day`) separate from the clock: both take the day as
// an argument, so a year can be played out in a few statements without any time
// travel and without touching the entry points' window checks — which get their
// own tests further down, through the real RPC, against the real `now()`.

const RUNNER = 'aaaaaaaa-0000-4000-8000-000000000001';
const RUNNER2 = 'aaaaaaaa-0000-4000-8000-000000000002';
await createUser(db, RUNNER, 'runner@example.com');
await createUser(db, RUNNER2, 'runner2@example.com');

const SEASON = (
  await one(
    `insert into public.challenge_seasons (name, enabled) values ('Test Season', true)
     returning id`,
  )
).id;

// The real ladder, because the demotion targets are read off it and a toy
// ladder would not surface the interaction between "previous rung" and the
// 45-day cap that the cap exists to fix.
for (const [dayThreshold, name] of [
  [7, 'Spark'],
  [30, 'Ember'],
  [60, 'Flame'],
  [90, 'Blaze'],
  [120, 'Keystone'],
  [180, 'Half Year'],
  [240, 'Forge'],
  [300, 'Summit'],
  [365, 'Year One'],
]) {
  await db.query(
    `insert into public.challenge_tiers (season_id, day_threshold, name) values ($1, $2, $3)`,
    [SEASON, dayThreshold, name],
  );
}
for (const m of ['habits', 'water', 'journal', 'tasks', 'sleep']) {
  await db.query(`insert into public.challenge_modules (season_id, module_id) values ($1, $2)`, [
    SEASON,
    m,
  ]);
}

const runRow = (user) =>
  one(`select * from public.challenge_enrollments where user_id = $1 and season_id = $2`, [
    user,
    SEASON,
  ]);

const setRun = (user, cols) => {
  const keys = Object.keys(cols);
  const sets = keys.map((k, i) => `${k} = $${i + 3}`).join(', ');
  return db.query(
    `update public.challenge_enrollments set ${sets} where user_id = $1 and season_id = $2`,
    [user, SEASON, ...keys.map((k) => cols[k])],
  );
};

/** Puts a run back to a known state and empties its ledger. */
const resetRun = async (user, cols = {}) => {
  await db.query(`delete from public.challenge_days where user_id = $1`, [user]);
  await db.query(`delete from public.challenge_events where user_id = $1`, [user]);
  await setRun(user, {
    qualified_days: 0,
    perfect_run: 0,
    shields: 0,
    shields_earned: 0,
    recent_misses: 0,
    current_tier_day: 0,
    highest_tier_day: 0,
    shield_earn_days: 30,
    status: 'active',
    completed_at: null,
    ...cols,
  });
};

// Dates are arbitrary and fixed — the arithmetic under test never asks what
// today is.
const BASE = Date.UTC(2026, 0, 1);
const day = (n) => new Date(BASE + n * 86400000).toISOString().slice(0, 10);

const credit = (user, n, modules = '{habits,water,journal}') =>
  one(`select public.challenge_credit_day($1::uuid, $2::uuid, $3::date, $4::text[], 120) as v`, [
    user,
    SEASON,
    day(n),
    modules,
  ]);

const settle = (user, n) =>
  one(`select public.challenge_settle_missed_day($1::uuid, $2::uuid, $3::date) as v`, [
    user,
    SEASON,
    day(n),
  ]);

// --- enrolment -------------------------------------------------------------

await test('0048 enrolling freezes the contract and resolves the shield interval', async () => {
  await asUser(db, RUNNER, async () => {
    await db.query(
      `select public.enroll_in_challenge($1::uuid, 0, $2::text[], $3::text[], 'dev-runner')`,
      [SEASON, '{habits,water,journal}', '{}'],
    );
  });
  const r = await runRow(RUNNER);
  expectEqual(r.shield_earn_days, 30, 'base shield interval');
  expectEqual(r.qualified_days, 0, 'starts at zero');
  expectEqual(r.status, 'active', 'status');
  expectEqual(
    await count(
      `select count(*)::int n from public.challenge_enrollment_modules
        where user_id = $1 and role = 'required' and removed_on is null`,
      [RUNNER],
    ),
    3,
    'required modules',
  );
});

await test('0048 enrolling twice is refused — one live run per account', async () => {
  await asUser(db, RUNNER, async () => {
    await expectRejection(
      () =>
        db.query(
          `select public.enroll_in_challenge($1::uuid, 0, $2::text[], $3::text[], 'dev-other')`,
          [SEASON, '{habits,water,journal}', '{}'],
        ),
      'already in a run',
    );
  });
});

await test('0048 fewer than the required modules is refused', async () => {
  await asUser(db, RUNNER2, async () => {
    await expectRejection(
      () =>
        db.query(
          `select public.enroll_in_challenge($1::uuid, 0, $2::text[], $3::text[], 'dev-2')`,
          [SEASON, '{habits,water}', '{}'],
        ),
      'at least',
    );
  });
});

await test('0048 a module that is not eligible this season is refused', async () => {
  await asUser(db, RUNNER2, async () => {
    await expectRejection(
      () =>
        db.query(
          `select public.enroll_in_challenge($1::uuid, 0, $2::text[], $3::text[], 'dev-2')`,
          [SEASON, '{habits,water,budget}', '{}'],
        ),
      'may not be committed',
    );
  });
});

await test('0048 extras and the annual plan stack down to the shield floor, never below', async () => {
  await db.query(`update public.profiles set plan_id = 'plus_yearly' where id = $1`, [RUNNER2]);
  await asUser(db, RUNNER2, async () => {
    await db.query(
      `select public.enroll_in_challenge($1::uuid, 0, $2::text[], $3::text[], 'dev-runner2')`,
      [SEASON, '{habits,water,journal}', '{tasks,sleep}'],
    );
  });
  const r = await runRow(RUNNER2);
  // 30 base − 5 (two or more extras) − 5 (annual) = 20, which is the floor.
  expectEqual(r.shield_earn_days, 20, 'stacked interval, clamped at the floor');
  expectEqual(r.shields, 1, 'annual head start');
  expectEqual(r.plan_at_enrolment, 'plus_yearly', 'plan recorded at enrolment');
});

// --- crediting a day -------------------------------------------------------

await test('0048 a credited day advances progress, and crediting it again does nothing', async () => {
  await resetRun(RUNNER);
  await credit(RUNNER, 1);
  let r = await runRow(RUNNER);
  expectEqual(r.qualified_days, 1, 'first day');
  expectEqual(r.perfect_run, 1, 'perfect run');

  const again = await credit(RUNNER, 1);
  expectEqual(again.v.alreadyCounted, true, 'reported as already counted');
  r = await runRow(RUNNER);
  expectEqual(r.qualified_days, 1, 'still one day, not two');
});

await test('0048 a shield arrives exactly on the interval, and rungs light as they pass', async () => {
  await resetRun(RUNNER);
  for (let n = 1; n <= 30; n++) await credit(RUNNER, n);
  const r = await runRow(RUNNER);
  expectEqual(r.qualified_days, 30, 'thirty days');
  expectEqual(r.shields, 1, 'one shield');
  expectEqual(r.shields_earned, 1, 'earned once');
  expectEqual(r.current_tier_day, 30, 'standing on the day-30 rung');
  expectEqual(
    await count(
      `select count(*)::int n from public.challenge_events
        where user_id = $1 and kind = 'tier_reached'`,
      [RUNNER],
    ),
    2,
    'rungs 7 and 30 both logged',
  );
});

await test('0048 a fourth shield is never granted, however clean the run', async () => {
  await resetRun(RUNNER, { qualified_days: 60, perfect_run: 29, shields: 3, current_tier_day: 60 });
  await credit(RUNNER, 61);
  const r = await runRow(RUNNER);
  expectEqual(r.perfect_run, 30, 'the interval was reached');
  expectEqual(r.shields, 3, 'and the cap held');
});

await test('0048 misses age out once a clean run is rebuilt', async () => {
  await resetRun(RUNNER, { qualified_days: 40, perfect_run: 29, recent_misses: 2 });
  await credit(RUNNER, 41);
  expectEqual((await runRow(RUNNER)).recent_misses, 0, 'escalation counter cleared');
});

await test('0048 reaching the final rung completes the run', async () => {
  await resetRun(RUNNER, { qualified_days: 364, perfect_run: 364, current_tier_day: 300 });
  const res = await credit(RUNNER, 365);
  expectEqual(res.v.completed, true, 'reported complete');
  const r = await runRow(RUNNER);
  expectEqual(r.status, 'completed', 'status');
  expectEqual(r.current_tier_day, 365, 'final rung');
});

// --- settling a lost day ---------------------------------------------------

await test('0048 a shield absorbs the miss: progress untouched, clean record gone', async () => {
  await resetRun(RUNNER, {
    qualified_days: 50,
    perfect_run: 50,
    shields: 2,
    current_tier_day: 30,
  });
  const res = await settle(RUNNER, 51);
  expectEqual(res.v.outcome, 'shielded', 'outcome');
  const r = await runRow(RUNNER);
  expectEqual(r.qualified_days, 50, 'progress untouched');
  expectEqual(r.shields, 1, 'one shield spent');
  expectEqual(r.perfect_run, 0, 'perfect run broken all the same');
  expectEqual(
    (
      await one(`select outcome from public.challenge_days where user_id = $1 and local_day = $2`, [
        RUNNER,
        day(51),
      ])
    ).outcome,
    'shielded',
    'ledger records the shielded day, not a silent gap',
  );
});

await test('0048 with no shield left, progress falls to the rung below', async () => {
  await resetRun(RUNNER, {
    qualified_days: 93,
    perfect_run: 93,
    shields: 0,
    current_tier_day: 90,
  });
  const res = await settle(RUNNER, 94);
  expectEqual(res.v.outcome, 'missed', 'outcome');
  const r = await runRow(RUNNER);
  expectEqual(r.qualified_days, 90, 'back to the day-90 rung');
  expectEqual(r.current_tier_day, 90, 'and standing on it');
  expectEqual(r.recent_misses, 1, 'escalation counter armed');
  expectEqual(r.highest_tier_day, 0, 'highest reached is never walked back by a fall');
});

await test('0048 a second miss inside the window drops one rung further', async () => {
  await resetRun(RUNNER, {
    qualified_days: 65,
    perfect_run: 0,
    shields: 0,
    recent_misses: 1,
    current_tier_day: 60,
  });
  await settle(RUNNER, 66);
  // 60 is the rung below 65; the second miss steps past it to 30. The 45-day
  // cap would allow anything down to 20, so it does not bind here.
  expectEqual((await runRow(RUNNER)).qualified_days, 30, 'two rungs down');
});

await test('0048 the demotion cap bites at the top of the ladder', async () => {
  await resetRun(RUNNER, {
    qualified_days: 364,
    perfect_run: 364,
    shields: 0,
    current_tier_day: 300,
  });
  await settle(RUNNER, 365);
  const r = await runRow(RUNNER);
  // The rung below 364 is 300, a fall of 64. The cap holds it to 45.
  expectEqual(r.qualified_days, 319, 'lost 45 days, not 64');
  expectEqual(r.current_tier_day, 300, 'which still stands on the 300 rung');
});

await test('0048 settling the same lost day twice changes nothing', async () => {
  await resetRun(RUNNER, { qualified_days: 50, perfect_run: 50, shields: 2 });
  await settle(RUNNER, 51);
  const res = await settle(RUNNER, 51);
  expectEqual(res.v.alreadySettled, true, 'reported as already settled');
  expectEqual((await runRow(RUNNER)).shields, 1, 'and did not spend a second shield');
});

// --- the nightly settler ---------------------------------------------------

await test('0048 the settler closes every unaccounted day up to, but not including, today', async () => {
  await resetRun(RUNNER, { qualified_days: 40, perfect_run: 40, shields: 1 });
  const today = (await one(`select public.challenge_local_day(now(), 0, 0) as d`)).d;
  await db.query(
    `update public.challenge_enrollments
        set last_settled_day = public.challenge_local_day(now(), 0, 0) - 4
      where user_id = $1 and season_id = $2`,
    [RUNNER, SEASON],
  );

  expectEqual((await one(`select public.settle_stale_runs() as n`)).n, 3, 'three days settled');

  expectEqual(
    await count(
      `select count(*)::int n from public.challenge_days
        where user_id = $1 and outcome = 'shielded'`,
      [RUNNER],
    ),
    1,
    'the shield covered the first of them',
  );
  expectEqual(
    await count(
      `select count(*)::int n from public.challenge_days where user_id = $1 and outcome = 'missed'`,
      [RUNNER],
    ),
    2,
    'the other two were misses',
  );
  expectEqual(
    await count(
      `select count(*)::int n from public.challenge_days
        where user_id = $1 and local_day >= $2::date`,
      [RUNNER, today],
    ),
    0,
    'today is still winnable and was left alone',
  );
});

// --- the contract, through the real entry point ----------------------------

const serverDay = (await one(`select public.challenge_local_day(now(), 0, 0)::text as d`)).d;

await test('0048 two of three modules writes nothing and names what is outstanding', async () => {
  await resetRun(RUNNER);
  const res = await asUser(db, RUNNER, () =>
    one(`select public.record_challenge_day($1::date, $2::jsonb, 120, 'dev-runner') as v`, [
      serverDay,
      JSON.stringify({ habits: 2, water: 5 }),
    ]),
  );
  expectEqual(res.v.qualified, false, 'not qualified');
  expectEqual(JSON.stringify(res.v.outstanding), '["journal"]', 'the missing one is named');
  expectEqual(
    await count(`select count(*)::int n from public.challenge_days where user_id = $1`, [RUNNER]),
    0,
    'and nothing was written to the ledger',
  );
});

await test('0048 all three qualifies the day', async () => {
  const res = await asUser(db, RUNNER, () =>
    one(`select public.record_challenge_day($1::date, $2::jsonb, 120, 'dev-runner') as v`, [
      serverDay,
      JSON.stringify({ habits: 2, water: 5, journal: 1 }),
    ]),
  );
  expectEqual(res.v.qualified, true, 'qualified');
  expectEqual((await runRow(RUNNER)).qualified_days, 1, 'progress advanced');
});

await test('0048 an extra module going untouched never costs the day', async () => {
  await resetRun(RUNNER);
  await db.query(
    `insert into public.challenge_enrollment_modules
       (user_id, season_id, module_id, role, added_on)
     values ($1, $2, 'tasks', 'extra', $3::date - 1)`,
    [RUNNER, SEASON, serverDay],
  );
  const res = await asUser(db, RUNNER, () =>
    one(`select public.record_challenge_day($1::date, $2::jsonb, 120, 'dev-runner') as v`, [
      serverDay,
      JSON.stringify({ habits: 1, water: 1, journal: 1 }),
    ]),
  );
  expectEqual(res.v.qualified, true, 'the contract is the required set, not everything');
});

await test('0048 a day outside the window is refused rather than quietly moved', async () => {
  await resetRun(RUNNER);
  const res = await asUser(db, RUNNER, () =>
    one(`select public.record_challenge_day($1::date - 5, $2::jsonb, 120, 'dev-runner') as v`, [
      serverDay,
      JSON.stringify({ habits: 1, water: 1, journal: 1 }),
    ]),
  );
  expectEqual(res.v.ok, false, 'refused');
  expectEqual(res.v.reason, 'day out of window', 'and says why');
});

await test('0048 a session below the floor does not qualify', async () => {
  const res = await asUser(db, RUNNER, () =>
    one(`select public.record_challenge_day($1::date, $2::jsonb, 5, 'dev-runner') as v`, [
      serverDay,
      JSON.stringify({ habits: 1, water: 1, journal: 1 }),
    ]),
  );
  expectEqual(res.v.ok, false, 'refused');
  expectEqual(res.v.reason, 'session too short', 'and says why');
});

// --- swapping --------------------------------------------------------------

await test('0048 the picker is locked for the first thirty days', async () => {
  await asUser(db, RUNNER, async () => {
    await expectRejection(
      () => db.query(`select public.swap_challenge_module('journal', 'sleep')`),
      'locked',
    );
  });
});

await test('0048 a swap takes effect tomorrow, and cannot rescue today', async () => {
  await db.query(
    `update public.challenge_enrollments
        set enrolled_local_day = public.challenge_local_day(now(), 0, 0) - 40
      where user_id = $1 and season_id = $2`,
    [RUNNER, SEASON],
  );
  await asUser(db, RUNNER, async () => {
    await db.query(`select public.swap_challenge_module('journal', 'sleep')`);
  });

  const today = await asUser(db, RUNNER, () => one(`select public.challenge_today() as v`));
  expectEqual(
    JSON.stringify([...today.v.required].sort()),
    JSON.stringify(['habits', 'journal', 'water']),
    'today still owes the module that was swapped out',
  );
  expectEqual(
    (
      await one(
        `select removed_on::text as d from public.challenge_enrollment_modules
          where user_id = $1 and module_id = 'journal'`,
        [RUNNER],
      )
    ).d,
    new Date(new Date(`${serverDay}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10),
    'and it leaves the contract tomorrow, not today',
  );
  expectEqual((await runRow(RUNNER)).swaps_used, 1, 'one swap spent');
});

// --- the part that makes all of the above worth anything -------------------

await test('0048 a signed-in user cannot write their own progress', async () => {
  const before = (await runRow(RUNNER)).qualified_days;
  await asUser(db, RUNNER, async () => {
    // No update policy exists, so this matches no rows rather than raising —
    // which is exactly why the assertion is on the value and not on a throw.
    await db.query(
      `update public.challenge_enrollments set qualified_days = 9999 where user_id = $1`,
      [RUNNER],
    );
  });
  expectEqual((await runRow(RUNNER)).qualified_days, before, 'progress unchanged');
});

await test('0048 a signed-in user cannot forge a day in the ledger', async () => {
  await asUser(db, RUNNER, async () => {
    await expectRejection(
      () =>
        db.query(
          `insert into public.challenge_days (user_id, season_id, local_day, outcome)
           values ($1, $2, $3::date - 9, 'qualified')`,
          [RUNNER, SEASON, serverDay],
        ),
      'row-level security',
    );
  });
});

await test('0048 one account cannot read another account’s run', async () => {
  await asUser(db, RUNNER2, async () => {
    expectEqual(
      await count(`select count(*)::int n from public.challenge_enrollments where user_id = $1`, [
        RUNNER,
      ]),
      0,
      'somebody else’s enrolment is invisible',
    );
  });
});

await test('0048 the season and its ladder are readable by anyone, including signed out', async () => {
  await asAnon(db, async () => {
    expectEqual(
      await count(`select count(*)::int n from public.challenge_tiers where season_id = $1`, [
        SEASON,
      ]),
      9,
      'the ladder describes the program, not a person',
    );
  });
});

// --- the switch, and standing -----------------------------------------------

await test('0050 the challenge ships switched off', async () => {
  // `module_flags` treats an absent row as enabled, so "off by default" is only
  // true if a row actually says so. Every comment in 0048 claimed this; nothing
  // did it until 0050.
  const row = await one(`select enabled from public.module_flags where module = 'rewards'`);
  expectEqual(row?.enabled, false, 'rewards flag');
});

await test('0050 rank stays quiet until the cohort is big enough to mean anything', async () => {
  await asUser(db, RUNNER, async () => {
    const v = (await one(`select public.challenge_rank() as v`)).v;
    expectEqual(v.ranked, false, 'two runners is not a leaderboard');
  });
});

await test('0050 rank places somebody once there is a cohort', async () => {
  // Five more runs, all behind RUNNER, so the answer is checkable rather than
  // merely present.
  for (let i = 0; i < 5; i++) {
    const id = `bbbbbbbb-0000-4000-8000-00000000000${i}`;
    await createUser(db, id, `pack${i}@example.com`);
    await db.query(
      `insert into public.challenge_enrollments
         (user_id, season_id, enrolled_local_day, last_settled_day, tz_offset_minutes,
          shield_earn_days, qualified_days)
       values ($1::uuid, $2::uuid, current_date, current_date - 1, 0, 30, 1)`,
      [id, SEASON],
    );
  }
  await setRun(RUNNER, { qualified_days: 100 });

  await asUser(db, RUNNER, async () => {
    const v = (await one(`select public.challenge_rank() as v`)).v;
    expectEqual(v.ranked, true, 'ranked');
    expectEqual(v.cohort, 7, 'everybody in the season counts');
    expectEqual(v.topPercent, 1, 'clear of the whole field, floored at 1%');
  });
});

await test('0050 rank tells you nothing about anybody else', async () => {
  // There is no argument to point it at another account, which is the whole
  // reason it can read the cohort at all.
  await expectRejection(
    () => db.query(`select public.challenge_rank($1::uuid)`, [RUNNER]),
    'does not exist',
  );
});

// --- operator --------------------------------------------------------------

await test('0048 granting a shield needs a reason, and still respects the cap', async () => {
  await resetRun(RUNNER, { shields: 2 });
  await asUser(db, ADMIN, async () => {
    await expectRejection(
      () => db.query(`select public.admin_grant_challenge_shield($1::uuid, 1, '  ')`, [RUNNER]),
      'reason is required',
    );
    expectEqual(
      (
        await one(
          `select public.admin_grant_challenge_shield($1::uuid, 5, 'outage on our side') as n`,
          [RUNNER],
        )
      ).n,
      3,
      'clamped to the cap',
    );
  });
});

await test('0048 an ordinary account cannot grant itself anything', async () => {
  await asUser(db, RUNNER, async () => {
    await expectRejection(
      () =>
        db.query(`select public.admin_grant_challenge_shield($1::uuid, 3, 'because')`, [RUNNER]),
      'not an administrator',
    );
  });
});

await test('0048 operator actions land in the shared audit log', async () => {
  expectEqual(
    await count(
      `select count(*)::int n from public.admin_audit_log
        where action = 'challenge_grant_shield' and target_user = $1`,
      [RUNNER],
    ),
    1,
    'audited alongside every other operator action',
  );
});

// ---------------------------------------------------------------------------
console.log('\nseason state and the operator console (0055)');
// ---------------------------------------------------------------------------
//
// `challenge_season_state()` is the single derivation both consoles quote, and
// the reason it exists is a bug that no unit test could have caught: the app
// decided "is it open" from the module list, the operator screen decided it
// from `enabled` and two dates, both were right, and they disagreed for weeks
// with nothing on either screen able to show the other's answer.
//
// So the states are exercised here, against real rows, one condition at a time
// — and in the order the function checks them, because the first failure is the
// one it is supposed to report.

const STATE_SEASON = (
  await one(
    `insert into public.challenge_seasons (name, enabled, required_modules)
     values ('State Season', false, 3) returning id`,
  )
).id;

// Its own runner. `challenge_enrollments` allows one active run per account and
// the 0048 accounts are already spending theirs, so borrowing one here would
// fail on the unique index rather than on anything this section is testing.
const STATE_RUNNER = 'aaaaaaaa-0000-4000-8000-000000000003';
await createUser(db, STATE_RUNNER, 'state-runner@example.com');

const stateOf = async (season) =>
  (await one(`select public.challenge_season_state($1::uuid) as v`, [season])).v;

const setSeason = async (sets, params) =>
  db.query(`update public.challenge_seasons set ${sets} where id = $1`, [STATE_SEASON, ...params]);

await test('0055 a season nobody switched on is closed, whatever its dates say', async () => {
  expectEqual(await stateOf(STATE_SEASON), 'closed', 'the season’s own switch comes first');
});

await test('0055 a season with no modules is not open, however enabled it is', async () => {
  // The exact shape staging was in: enabled, inside its window, and impossible
  // to join. The old console called this Open.
  await setSeason(`enabled = true`, []);
  expectEqual(await stateOf(STATE_SEASON), 'notReady', 'nothing to commit to');
});

await test('0055 too few eligible modules is as unjoinable as none at all', async () => {
  // `required_modules` is 3. Two eligible modules fails the picker just as
  // surely as zero, only further along, which is why the check is a comparison
  // rather than an emptiness test.
  for (const m of ['habits', 'water']) {
    await db.query(`insert into public.challenge_modules (season_id, module_id) values ($1, $2)`, [
      STATE_SEASON,
      m,
    ]);
  }
  expectEqual(await stateOf(STATE_SEASON), 'notReady', 'two of the three it asks for');

  await db.query(
    `insert into public.challenge_modules (season_id, module_id) values ($1, 'tasks')`,
    [STATE_SEASON],
  );
  expectEqual(await stateOf(STATE_SEASON), 'open', 'the third one opens it');
});

await test('0055 an ineligible module does not count toward the requirement', async () => {
  await db.query(
    `update public.challenge_modules set eligible = false
      where season_id = $1 and module_id = 'tasks'`,
    [STATE_SEASON],
  );
  expectEqual(await stateOf(STATE_SEASON), 'notReady', 'curation is subtraction');
  await db.query(
    `update public.challenge_modules set eligible = true
      where season_id = $1 and module_id = 'tasks'`,
    [STATE_SEASON],
  );
});

await test('0055 a season that has not started reads as upcoming, not as nothing', async () => {
  await setSeason(`starts_at = now() + interval '10 days'`, []);
  expectEqual(await stateOf(STATE_SEASON), 'upcoming', 'waiting, not missing');
  await setSeason(`starts_at = null`, []);
});

await test('0055 a season past its end date reads as ended', async () => {
  await setSeason(`ends_at = now() - interval '1 day'`, []);
  expectEqual(await stateOf(STATE_SEASON), 'ended', 'finished, not broken');
  await setSeason(`ends_at = null`, []);
});

await test('0055 the switch outranks the dates', async () => {
  // A season both closed and out of window is reported closed, because that is
  // the one an operator has to act on first.
  await setSeason(`enabled = false, starts_at = now() + interval '5 days'`, []);
  expectEqual(await stateOf(STATE_SEASON), 'closed', 'first failure wins');
  await setSeason(`enabled = true, starts_at = null`, []);
});

await test('0055 a season reaching its cap reads as full, and only then', async () => {
  await setSeason(`max_enrollments = 1`, []);
  expectEqual(await stateOf(STATE_SEASON), 'open', 'a cap nobody has reached changes nothing');

  await asUser(db, STATE_RUNNER, async () => {
    await db.query(
      `select public.enroll_in_challenge($1::uuid, 0, $2::text[], '{}'::text[], 'dev-state')`,
      [STATE_SEASON, ['habits', 'water', 'tasks']],
    );
  });
  expectEqual(await stateOf(STATE_SEASON), 'full', 'the cap bites once it is met');
});

await test('0055 the app is told which season it could join, and why not', async () => {
  // 0048's season is enabled and older, so it wins the pick. Switched off for
  // the length of this assertion so the answer is about the season under test.
  await db.query(`update public.challenge_seasons set enabled = false where id = $1`, [SEASON]);
  const status = (await one(`select public.challenge_season_status() as v`)).v;
  // Reported rather than hidden: a full season is still the season, and the
  // screen has a sentence for it. Returning nothing is what produced the dead
  // end this whole migration is about.
  expectEqual(status.state, 'full', 'the state travels to the client');
  expectEqual(status.seatsLeft, 0, 'zero seats is an answer, not an absence');
  expectEqual(status.requiredModules, 3, 'the picker’s rule comes with it');
  expectEqual(Array.isArray(status.modules), true, 'and the modules to pick from');
  await db.query(`update public.challenge_seasons set enabled = true where id = $1`, [SEASON]);
});

await test('0055 a run inside a paused season is told so, rather than failing quietly', async () => {
  // The symptom this fixes: `record_challenge_day` refuses with 'season paused'
  // and the checklist, having no field for a reason, renders an ordinary
  // unfinished day forever.
  await setSeason(`enabled = false`, []);
  await asUser(db, STATE_RUNNER, async () => {
    const today = (await one(`select public.challenge_today() as v`)).v;
    expectEqual(today.enrolled, true, 'still enrolled — a pause is not an eviction');
    expectEqual(today.seasonState, 'closed', 'and told what the season is doing');
    expectEqual(today.seasonName, 'State Season', 'by name, so it is clear which one');
  });
  await setSeason(`enabled = true`, []);
});

await test('0055 seeding fills an empty season and leaves a curated one alone', async () => {
  const empty = (
    await one(`insert into public.challenge_seasons (name) values ('Seed Me') returning id`)
  ).id;

  await asUser(db, ADMIN, async () => {
    await db.query(`select public.admin_seed_challenge_season($1::uuid)`, [empty]);
  });
  expectEqual(
    await count(`select count(*)::int n from public.challenge_modules where season_id = $1`, [
      empty,
    ]),
    8,
    'the naturally-daily set',
  );
  expectEqual(
    await count(`select count(*)::int n from public.challenge_tiers where season_id = $1`, [empty]),
    9,
    'and the reference ladder',
  );

  // The curated season already has three modules and no ladder. Seeding must
  // add the ladder and touch nothing else — an operator pressing this button is
  // usually not the person who made the curation.
  await asUser(db, ADMIN, async () => {
    await db.query(`select public.admin_seed_challenge_season($1::uuid)`, [STATE_SEASON]);
  });
  expectEqual(
    await count(`select count(*)::int n from public.challenge_modules where season_id = $1`, [
      STATE_SEASON,
    ]),
    3,
    'the curation survives the button',
  );
});

await test('0055 a patch changes only what it names', async () => {
  // The reason the patch exists: 0048's upsert coalesces every absent setting
  // to a factory default, so moving an end date would quietly reset the shield
  // economy of a season people are two hundred days into.
  await db.query(
    `update public.challenge_seasons set shield_cap = 2, min_writes = 4 where id = $1`,
    [STATE_SEASON],
  );
  await asUser(db, ADMIN, async () => {
    await db.query(`select public.admin_update_challenge_season($1::uuid, $2::jsonb)`, [
      STATE_SEASON,
      JSON.stringify({ endsAt: '2027-01-01T00:00:00Z' }),
    ]);
  });
  const row = await one(
    `select shield_cap, min_writes, ends_at from public.challenge_seasons where id = $1`,
    [STATE_SEASON],
  );
  expectEqual(row.shield_cap, 2, 'untouched');
  expectEqual(row.min_writes, 4, 'untouched');
  expectEqual(row.ends_at !== null, true, 'and the one named key did change');
});

await test('0055 an explicit null clears a date, while an absent key leaves it', async () => {
  await asUser(db, ADMIN, async () => {
    await db.query(`select public.admin_update_challenge_season($1::uuid, $2::jsonb)`, [
      STATE_SEASON,
      JSON.stringify({ endsAt: null }),
    ]);
  });
  expectEqual(
    (await one(`select ends_at from public.challenge_seasons where id = $1`, [STATE_SEASON]))
      .ends_at,
    null,
    'clearing is a thing a patch can express',
  );
});

await test('0055 closing a season is one call that cannot change anything else', async () => {
  await asUser(db, ADMIN, async () => {
    await db.query(`select public.admin_set_challenge_season_enabled($1::uuid, false)`, [
      STATE_SEASON,
    ]);
  });
  expectEqual(await stateOf(STATE_SEASON), 'closed', 'the switch that actually closes it');
  await asUser(db, ADMIN, async () => {
    await db.query(`select public.admin_set_challenge_season_enabled($1::uuid, true)`, [
      STATE_SEASON,
    ]);
  });
});

await test('0055 a season somebody has joined is refused deletion, not silently emptied', async () => {
  // Every challenge table cascades from this row. Deleting one with runs in it
  // would take the ledger and event history of everybody in it.
  await asUser(db, ADMIN, async () => {
    await expectRejection(
      () => db.query(`select public.admin_delete_challenge_season($1::uuid)`, [STATE_SEASON]),
      'close it instead',
    );
  });
});

await test('0055 an ordinary account can read the programme but not change it', async () => {
  await asUser(db, RUNNER, async () => {
    // Readable, like the tables underneath it — it describes the programme, not
    // a person, which is what lets a signed-out visitor see what is on offer.
    const status = (await one(`select public.challenge_season_status() as v`)).v;
    expectEqual(typeof status.state, 'string', 'anyone may ask what is running');

    await expectRejection(
      () => db.query(`select public.admin_challenge_seasons()`),
      'not an administrator',
    );
    await expectRejection(
      () =>
        db.query(`select public.admin_set_challenge_season_enabled($1::uuid, false)`, [
          STATE_SEASON,
        ]),
      'not an administrator',
    );
    await expectRejection(
      () =>
        db.query(`select public.admin_update_challenge_season($1::uuid, '{}'::jsonb)`, [
          STATE_SEASON,
        ]),
      'not an administrator',
    );
  });
});

await test('0055 a signed-out visitor is told what is on offer', async () => {
  await asAnon(db, async () => {
    const status = (await one(`select public.challenge_season_status() as v`)).v;
    expectEqual(typeof status.state, 'string', 'the join screen can show the pitch first');
  });
});

await test('0055 every console write lands in the shared audit log', async () => {
  expectEqual(
    (await count(
      `select count(*)::int n from public.admin_audit_log
        where action in ('challenge_season_enabled', 'challenge_season_patch',
                         'challenge_season_seed')`,
    )) > 0,
    true,
    'the same timeline as every other operator action',
  );
});

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
console.log('\ntask subtasks (0057)');
// ---------------------------------------------------------------------------

/** Its own account, because by this point in the suite the shared fixtures have
 *  been blocked, reported and unblocked by the moderation sections, and
 *  `may_access_own_data()` is exactly what those leave behind. A table's
 *  isolation should be asserted against a plain user, not against whatever
 *  state an unrelated test finished in. */
const CHECKLIST_OWNER = '7ac57a5c-0000-4000-8000-00000000c001';
const CHECKLIST_OTHER = '7ac57a5c-0000-4000-8000-00000000c002';
await createUser(db, CHECKLIST_OWNER, 'checklist-owner@example.com');
await createUser(db, CHECKLIST_OTHER, 'checklist-other@example.com');

await test('0057 a checklist item belongs to the account that wrote it', async () => {
  await asUser(db, CHECKLIST_OWNER, async () => {
    await db.query(
      `insert into public.task_subtasks
         (id, task_id, user_id, title, created_at, updated_at)
       values ('st-1', 'task-1', $1::uuid, 'Buy the paint', 1, 1)`,
      [CHECKLIST_OWNER],
    );
    expectEqual(
      await count(`select count(*)::int n from public.task_subtasks`),
      1,
      'owner sees it',
    );
  });

  await asUser(db, CHECKLIST_OTHER, async () => {
    expectEqual(
      await count(`select count(*)::int n from public.task_subtasks`),
      0,
      "another account's view",
    );
  });
});

await test('0057 one account cannot file a checklist item under another', async () => {
  await asUser(db, CHECKLIST_OTHER, async () => {
    await expectRejection(
      () =>
        db.query(
          `insert into public.task_subtasks
             (id, task_id, user_id, title, created_at, updated_at)
           values ('st-forged', 'task-1', $1::uuid, 'Not mine to write', 1, 1)`,
          [CHECKLIST_OWNER],
        ),
      'row-level security',
    );
  });
});

await test('0057 a signed-out visitor sees no checklist at all', async () => {
  await asAnon(db, async () => {
    expectEqual(await count(`select count(*)::int n from public.task_subtasks`), 0, 'anon rows');
  });
});

await test('0057 deleting the account takes its checklist with it', async () => {
  // The 0020 contract, asserted at birth rather than after a sweep: the
  // reference is in the CREATE, so this table can never join the list of
  // tables that had to be de-orphaned before they could get one.
  await db.query(`delete from auth.users where id = $1::uuid`, [CHECKLIST_OWNER]);
  expectEqual(
    await count(`select count(*)::int n from public.task_subtasks where id = 'st-1'`),
    0,
    'rows surviving the account',
  );
});

await test('0057 an operator can reach the checklist of a task they are handling', async () => {
  // A whitelist miss does not error — it makes the moderation surface show a
  // task whose checklist is silently absent, which reads as "nothing here".
  const tables = (await one(`select public.operator_readable_tables() as t`)).t;
  if (!tables.includes('task_subtasks')) {
    throw new Error('task_subtasks missing from operator_readable_tables()');
  }
});

// ---------------------------------------------------------------------------
console.log('\ntask recurrence rules (0056)');
// ---------------------------------------------------------------------------

await test('0056 the recurrence columns exist with the types the engine pushes', async () => {
  const columns = Object.fromEntries(
    (
      await db.query(
        `select column_name, data_type from information_schema.columns
          where table_schema = 'public' and table_name = 'tasks'`,
      )
    ).rows.map((row) => [row.column_name, row.data_type]),
  );
  // The engine builds its upsert from the local column names, so a column
  // missing here is a failed push for the whole tasks table rather than one
  // absent field.
  for (const [column, type] of Object.entries({
    recurrence_interval: 'bigint',
    recurrence_days_of_week: 'text',
    recurrence_anchor: 'text',
  })) {
    expectEqual(columns[column] ?? 'nothing', type, `tasks.${column}`);
  }
});

await test('0056 a row from an older build describes the behaviour it actually had', async () => {
  // An older client does not send these columns. What its rows land on must be
  // the rule it was really following — every N=1, counted from the due date —
  // because any other default rewrites the user's cadence on their behalf while
  // two app versions are pushing to this table at once.
  //
  // Deliberately NOT run through asUser: this asserts a column default, not a
  // policy, and by this point in the suite ALICE's write path is shaped by
  // every moderation migration that has run since 0001. Those are asserted
  // where they belong; borrowing them here would only make the default's
  // failure mode look like an RLS failure.
  await db.query(
    `insert into public.tasks (id, user_id, title, created_at, updated_at)
       values ('t-legacy-recurrence', $1::uuid, 'Weekly review', 1, 1)`,
    [ALICE],
  );
  const row = await one(
    `select recurrence_interval, recurrence_days_of_week, recurrence_anchor
       from public.tasks where id = 't-legacy-recurrence'`,
  );
  expectEqual(Number(row.recurrence_interval), 1, 'interval');
  expectEqual(row.recurrence_days_of_week, null, 'chosen weekdays');
  expectEqual(row.recurrence_anchor, 'due_date', 'anchor');
});

console.log('\nowner bootstrap (0033, continued — destructive, kept last)');
// ---------------------------------------------------------------------------
//
// Everything above this point in the whole suite needed ADMIN's ordinary
// admin rights or the roster as already populated. Nothing after this point
// does — this section empties `admins` entirely to exercise claim_owner()'s
// actual guard ("does any row exist"), so it has to be the last thing that
// runs.

await test('0033 admin_has_owner reflects the roster truthfully', async () => {
  expectEqual((await one(`select public.admin_has_owner() as v`)).v, true, 'an owner exists');
});

await test('0033 claim_owner refuses once an owner already exists', async () => {
  await asUser(db, ROSTER_OUTSIDER, async () => {
    await expectRejection(() => db.query(`select public.claim_owner()`), 'already has an owner');
  });
});

await test('0033 claim_owner succeeds exactly once, for the first caller, on an empty roster', async () => {
  await db.query(`delete from public.admins`);
  expectEqual((await one(`select public.admin_has_owner() as v`)).v, false, 'roster is now empty');

  await asUser(db, ROSTER_OUTSIDER, async () => {
    await db.query(`select public.claim_owner()`);
  });
  const row = await one(`select role, is_owner from public.admins where user_id = $1`, [
    ROSTER_OUTSIDER,
  ]);
  expectEqual(row.role, 'admin', 'the claimant becomes admin');
  expectEqual(row.is_owner, true, 'and owner');
  expectEqual(
    await count(`select count(*)::int n from public.admins`),
    1,
    'the only row on the roster',
  );

  await asUser(db, ROSTER_ADMIN2, async () => {
    await expectRejection(() => db.query(`select public.claim_owner()`), 'already has an owner');
  });
});

summary();
