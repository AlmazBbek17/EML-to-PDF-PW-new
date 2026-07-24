// routes/eml2pdf.js
//
// Three plans (month / year / lifetime), each with a full-price and a
// discount-price Dodo product (see lib/products.js). Sign in with
// Google happens BEFORE checkout, same as before, so the email tied to
// the payment/subscription is one the person has actually proven they
// own.

const express = require('express');
const { Webhook } = require('standardwebhooks');
const { makeEntitlementsStore } = require('../lib/entitlements');
const { findByDodoProductId } = require('../lib/products');
const { verifyGoogleAccessToken } = require('../lib/google-auth');
const { createCheckoutSession } = require('../lib/dodo');

let _wh = null;
function getWebhookVerifier() {
  if (_wh) return _wh;
  if (!process.env.DODO_PAYMENTS_WEBHOOK_SECRET) {
    throw new Error(
      'DODO_PAYMENTS_WEBHOOK_SECRET is not set. Add it in your hosting platform\'s ' +
      'environment variables and redeploy.'
    );
  }
  _wh = new Webhook(process.env.DODO_PAYMENTS_WEBHOOK_SECRET);
  return _wh;
}

module.exports = function eml2pdfRoutes(pool) {
  const entitlements = makeEntitlementsStore(pool);
  const router = express.Router();

  // NOTE: this router is mounted in server.js BEFORE the global
  // express.json() middleware (the webhook route needs the raw body).
  // Every other route here needs its own express.json().

  // ---- Sign in ------------------------------------------------------
  router.post('/auth/google', express.json(), async (req, res) => {
    try {
      const { accessToken } = req.body;
      if (!accessToken) return res.status(400).json({ error: 'accessToken required' });
      const { email, emailVerified } = await verifyGoogleAccessToken(accessToken);
      if (!emailVerified) return res.status(403).json({ error: 'Email not verified with Google' });
      res.json({ email });
    } catch (err) {
      console.error('[eml2pdf] /auth/google failed:', err);
      res.status(401).json({ error: 'Invalid Google token' });
    }
  });

  // ---- Check current plan status ------------------------------------
  router.post('/balance', express.json(), async (req, res) => {
    try {
      const { accessToken } = req.body;
      if (!accessToken) return res.status(400).json({ error: 'accessToken required' });
      const { email, emailVerified } = await verifyGoogleAccessToken(accessToken);
      if (!emailVerified) return res.status(403).json({ error: 'Email not verified with Google' });
      const status = await entitlements.getStatus(email);
      res.json({ email, ...status });
    } catch (err) {
      console.error('[eml2pdf] /balance failed:', err);
      res.status(401).json({ error: 'Invalid Google token' });
    }
  });

  // ---- Start checkout for a given SKU --------------------------------
  // sku is one of the keys in lib/products.js (e.g. 'month',
  // 'month_discount', 'year', 'lifetime_discount', ...). We create the
  // session server-side (rather than a static Payment Link) because
  // subscriptions need proper customer/metadata wiring and because this
  // keeps the six product_ids out of the extension bundle entirely.
  router.post('/checkout', express.json(), async (req, res) => {
    try {
      const { accessToken, sku, returnUrl } = req.body;
      if (!accessToken || !sku) return res.status(400).json({ error: 'accessToken and sku required' });

      const { email, emailVerified } = await verifyGoogleAccessToken(accessToken);
      if (!emailVerified) return res.status(403).json({ error: 'Email not verified with Google' });

      const { PRODUCTS } = require('../lib/products');
      const product = PRODUCTS[sku];
      if (!product) return res.status(400).json({ error: 'Unknown sku' });

      const session = await createCheckoutSession({
        productId: product.dodoProductId,
        customerEmail: email,
        returnUrl: returnUrl || 'https://eml-to-pdf-paywall-production.up.railway.app/thanks',
      });
      res.json({ checkoutUrl: session.checkout_url });
    } catch (err) {
      console.error('[eml2pdf] /checkout failed:', err);
      res.status(500).json({ error: 'Could not start checkout' });
    }
  });

  // ---- Dodo webhook ---------------------------------------------------
  router.post(
    '/webhooks/dodo',
    express.raw({ type: 'application/json' }),
    async (req, res) => {
      let event;
      try {
        event = getWebhookVerifier().verify(req.body, {
          'webhook-id': req.headers['webhook-id'],
          'webhook-signature': req.headers['webhook-signature'],
          'webhook-timestamp': req.headers['webhook-timestamp'],
        });
      } catch (err) {
        console.error('[eml2pdf] webhook signature verification failed:', err);
        return res.status(400).send('Invalid signature');
      }

      try {
        const eventId = req.headers['webhook-id'];
        if (eventId) {
          const firstTime = await entitlements.markEventProcessed(eventId);
          if (!firstTime) return res.status(200).send('duplicate, already processed');
        }

        const data = event.data || {};
        const email = (data.customer && data.customer.email) || (data.metadata && data.metadata.customer_email);
        const eventType = event.event_type || event.type;

        // ---- One-time lifetime payment ----
        if (eventType === 'payment.succeeded' || eventType === 'checkout.session.completed') {
          const dodoProductId = data.product_id || (data.product_cart && data.product_cart[0] && data.product_cart[0].product_id);
          const dodoPaymentId = data.payment_id || data.id;
          if (!email || !dodoProductId || !dodoPaymentId) {
            console.error('[eml2pdf] payment webhook missing fields:', data);
            return res.status(200).send('missing fields, ignored');
          }
          const product = findByDodoProductId(dodoProductId);
          if (!product) return res.status(200).send('unknown product, ignored');

          if (product.lifetime) {
            await entitlements.grantLifetime({ email: email.toLowerCase(), productId: dodoProductId, dodoPaymentId });
          }
          // if it's a subscription product, the subscription.* events below handle it
          return res.status(200).send('ok');
        }

        // ---- Subscription lifecycle ----
        if (eventType === 'subscription.active' || eventType === 'subscription.renewed') {
          const dodoProductId = data.product_id;
          const product = findByDodoProductId(dodoProductId);
          if (!email || !product) return res.status(200).send('missing/unknown, ignored');
          await entitlements.upsertSubscription({
            email: email.toLowerCase(),
            plan: product.plan,
            status: 'active',
            dodoSubscriptionId: data.subscription_id || data.id,
            currentPeriodEnd: data.current_period_end || data.next_billing_date,
          });
          return res.status(200).send('ok');
        }

        if (['subscription.on_hold', 'subscription.cancelled', 'subscription.failed', 'subscription.expired'].includes(eventType)) {
          const dodoSubscriptionId = data.subscription_id || data.id;
          const status = eventType.replace('subscription.', ''); // on_hold | cancelled | failed | expired
          await entitlements.setSubscriptionStatus({ dodoSubscriptionId, status });
          return res.status(200).send('ok');
        }

        return res.status(200).send('ignored');
      } catch (err) {
        console.error('[eml2pdf] webhook processing failed:', err);
        res.status(500).send('processing error'); // 500 -> Dodo retries
      }
    }
  );

  return router;
};
