// lib/dodo.js
//
// Thin wrapper around the official `dodopayments` SDK. Nothing here is
// EML->PDF specific -- reuse it if you add more products later.
//
// npm install dodopayments
//
// Requires DODO_PAYMENTS_API_KEY in your server's environment (never sent
// to the extension). Set DODO_ENV=live_mode in production, defaults to
// test_mode otherwise so you don't accidentally take real payments while
// wiring this up.
//
// The client is built LAZILY (on first use, not at require() time) on
// purpose -- the SDK throws in its constructor if the API key is missing,
// and that constructor used to run at module-load time. That meant a
// missing/typo'd env var didn't just break Dodo calls, it crashed the
// ENTIRE server before it could even bind to a port -- including totally
// unrelated routes like /health. Building it lazily means the server
// still starts and answers /health even with Dodo unconfigured; you only
// get the real error when something actually tries to call Dodo.

const DodoPayments = require('dodopayments');

let _client = null;
function getClient() {
  if (_client) return _client;
  if (!process.env.DODO_PAYMENTS_API_KEY) {
    throw new Error(
      'DODO_PAYMENTS_API_KEY is not set. Add it in your hosting platform\'s ' +
      'environment variables (see .env.example) and redeploy.'
    );
  }
  _client = new DodoPayments({
    bearerToken: process.env.DODO_PAYMENTS_API_KEY,
    environment: process.env.DODO_ENV === 'live_mode' ? 'live_mode' : 'test_mode',
  });
  return _client;
}

/**
 * Creates a checkout session for a single product and returns the hosted
 * checkout_url to redirect the browser to. `customerEmail` comes from the
 * Google sign-in step, so the purchase is tied to that email from the
 * start -- no separate account/login system needed on our side.
 */
async function createCheckoutSession({ productId, customerEmail, returnUrl }) {
  const session = await getClient().checkoutSessions.create({
    product_cart: [{ product_id: productId, quantity: 1 }],
    customer: { email: customerEmail },
    return_url: returnUrl,
    metadata: { app: 'eml-to-pdf', customer_email: customerEmail },
  });
  return session; // { session_id, checkout_url, ... }
}

/**
 * Live prices for the paywall UI, so changing a price in the Dodo
 * dashboard shows up in the extension without shipping a new version.
 * Call this through a cached route handler (a few minutes' TTL) -- don't
 * hit it on every single paywall render.
 */
async function getProductPrices(productIds) {
  const results = await Promise.all(
    productIds.map((id) => getClient().products.retrieve(id))
  );
  const byId = {};
  for (const p of results) {
    byId[p.product_id] = {
      amount: p.price.price, // smallest currency unit, e.g. cents
      currency: p.price.currency,
      name: p.name,
    };
  }
  return byId;
}

module.exports = { getClient, createCheckoutSession, getProductPrices };
