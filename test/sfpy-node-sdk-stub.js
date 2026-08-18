/**
 * Stands in for the `https://esm.sh/@sfpy/node-sdk` URL import in
 * supabase/functions/_shared/safepay.ts.
 *
 * Same reason as test/supabase-js-stub.js: Jest cannot resolve a URL specifier,
 * so importing it made safepay-checkout and safepay-webhook untestable — which
 * is a poor place to have no tests, since between them they are the only things
 * that decide whether somebody is on a paid plan.
 *
 * Driven by `globalThis.__safepayStub`, set per-test:
 *
 *   verifyWebhook   (req) => boolean | Promise<boolean> | throws
 *   createSubscription (input) => string   the checkout URL
 *   cancel          (subscriptionId) => void
 *
 * Calls are recorded on the same object so a test can assert that a replayed
 * checkout created NO new subscription at the provider — which is the property
 * the idempotency work exists to guarantee, and the one that cannot be seen
 * from the response body alone.
 */
class Safepay {
  constructor(config) {
    const stub = (globalThis.__safepayStub = globalThis.__safepayStub ?? {});
    stub.configs = stub.configs ?? [];
    stub.configs.push(config);
    stub.calls = stub.calls ?? [];

    this.verify = {
      webhook: async (req) => {
        stub.calls.push({ name: 'verify.webhook' });
        if (!stub.verifyWebhook) return true;
        return stub.verifyWebhook(req);
      },
    };

    this.checkout = {
      createSubscription: async (input) => {
        stub.calls.push({ name: 'checkout.createSubscription', input });
        return stub.createSubscription
          ? stub.createSubscription(input)
          : `https://sandbox.getsafepay.com/checkout/${input.reference}`;
      },
    };

    this.subscription = {
      cancel: async (id) => {
        stub.calls.push({ name: 'subscription.cancel', id });
        return stub.cancel ? stub.cancel(id) : undefined;
      },
    };
  }
}

module.exports = Safepay;
module.exports.default = Safepay;
