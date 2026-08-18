/**
 * Stands in for the `https://esm.sh/@supabase/supabase-js@2` URL import that
 * the Deno edge functions use.
 *
 * Jest cannot resolve a URL specifier, so without this the edge functions are
 * simply untestable — which is how the invite email kept its pre-rebrand
 * wordmark through a whole rename. Mapped in jest.config.js.
 *
 * Behaviour is driven by `globalThis.__supabaseStub`, set per-test, so each
 * case can choose what `getUser`, `rpc` and the table queries return without a
 * mocking framework.
 *
 * ## The query builder
 *
 * `.from(...)` returns a chainable builder that records what was asked for and
 * hands one descriptor to `stub.query(descriptor)`:
 *
 *   { table, op, filters: [{ type, column, value }], payload, columns,
 *     order, limit, rowMode }
 *
 * A single hook rather than a per-method mock, because the thing worth
 * asserting about safepay-checkout is the *sequence* of statements — claim
 * before create, replay instead of insert — and a descriptor per call makes that
 * sequence directly readable. Tests that never touch `.from()` are unaffected:
 * without a `query` hook every builder resolves to `{ data: null, error: null }`.
 */

/** Terminal shape supabase-js resolves to. */
const empty = { data: null, error: null };

function makeBuilder(stub, table) {
  const descriptor = {
    table,
    op: 'select',
    filters: [],
    payload: undefined,
    columns: undefined,
    order: undefined,
    limit: undefined,
    /** 'single' | 'maybeSingle' | null — whether the caller wants one row. */
    rowMode: null,
  };

  const filter = (type) => (column, value) => {
    descriptor.filters.push({ type, column, value });
    return builder;
  };

  const run = () => {
    stub.queries = stub.queries ?? [];
    stub.queries.push(descriptor);
    const result = stub.query ? stub.query(descriptor) : empty;
    return Promise.resolve(result ?? empty);
  };

  const builder = {
    select(columns) {
      descriptor.columns = columns;
      return builder;
    },
    insert(payload) {
      descriptor.op = 'insert';
      descriptor.payload = payload;
      return builder;
    },
    update(payload) {
      descriptor.op = 'update';
      descriptor.payload = payload;
      return builder;
    },
    upsert(payload, options) {
      descriptor.op = 'upsert';
      descriptor.payload = payload;
      descriptor.options = options;
      return builder;
    },
    delete() {
      descriptor.op = 'delete';
      return builder;
    },
    eq: filter('eq'),
    neq: filter('neq'),
    gt: filter('gt'),
    gte: filter('gte'),
    lt: filter('lt'),
    lte: filter('lte'),
    is: filter('is'),
    in: filter('in'),
    order(column, options) {
      descriptor.order = { column, ...options };
      return builder;
    },
    limit(n) {
      descriptor.limit = n;
      return builder;
    },
    single() {
      descriptor.rowMode = 'single';
      return run();
    },
    maybeSingle() {
      descriptor.rowMode = 'maybeSingle';
      return run();
    },
    // Thenable, so `await client.from('x').update(...).eq(...)` resolves without
    // a terminal `single()`/`maybeSingle()` — which is how several of these
    // functions write.
    then(onFulfilled, onRejected) {
      return run().then(onFulfilled, onRejected);
    },
  };

  return builder;
}

function createClient(_url, key, options) {
  const stub = globalThis.__supabaseStub ?? {};
  // Recorded so a test can assert the caller's JWT is forwarded — that header
  // is what makes RLS, not the function, decide who may invite.
  stub.clientOptions = options;
  // Which key each client was built with, so a test can tell the caller-scoped
  // client from the service-role one. Both are needed in the payment functions
  // and they are emphatically not interchangeable.
  stub.clientKeys = stub.clientKeys ?? [];
  stub.clientKeys.push(key);

  return {
    auth: {
      getUser: async () => (stub.getUser ? stub.getUser() : { data: { user: null } }),
      admin: {
        updateUserById: async (id, attrs) => {
          stub.adminCalls = stub.adminCalls ?? [];
          stub.adminCalls.push({ name: 'updateUserById', id, attrs });
          return stub.updateUserById ? stub.updateUserById(id, attrs) : { error: null };
        },
        deleteUser: async (id) => {
          stub.adminCalls = stub.adminCalls ?? [];
          stub.adminCalls.push({ name: 'deleteUser', id });
          return stub.deleteUser ? stub.deleteUser(id) : { error: null };
        },
      },
    },
    rpc: async (name, params) => {
      stub.rpcCalls = stub.rpcCalls ?? [];
      stub.rpcCalls.push({ name, params });
      return stub.rpc ? stub.rpc(name, params) : { error: null };
    },
    from: (table) => makeBuilder(stub, table),
  };
}

module.exports = { createClient };
