/**
 * Stands in for the `https://esm.sh/@supabase/supabase-js@2` URL import that
 * the Deno edge functions use.
 *
 * Jest cannot resolve a URL specifier, so without this the edge functions are
 * simply untestable — which is how the invite email kept its pre-rebrand
 * wordmark through a whole rename. Mapped in jest.config.js.
 *
 * Behaviour is driven by `globalThis.__supabaseStub`, set per-test, so each
 * case can choose what `getUser` and `rpc` return without a mocking framework.
 */
function createClient(_url, _key, options) {
  const stub = globalThis.__supabaseStub ?? {};
  // Recorded so a test can assert the caller's JWT is forwarded — that header
  // is what makes RLS, not the function, decide who may invite.
  stub.clientOptions = options;
  return {
    auth: {
      getUser: async () => (stub.getUser ? stub.getUser() : { data: { user: null } }),
    },
    rpc: async (name, params) => {
      stub.rpcCalls = stub.rpcCalls ?? [];
      stub.rpcCalls.push({ name, params });
      return stub.rpc ? stub.rpc(name, params) : { error: null };
    },
  };
}

module.exports = { createClient };
