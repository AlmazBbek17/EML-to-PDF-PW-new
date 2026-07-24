-- db/schema.sql
-- Run once against a fresh Postgres database (see db/migrate.js for a
-- one-command way to apply this).
--
-- Entitlement model: an email either has `lifetime = TRUE` (permanent),
-- or an active subscription (`plan` = 'month'/'year', `status` = 'active',
-- and `current_period_end` in the future). `spend`/access checks in
-- entitlements.js treat "lifetime OR (status='active' AND period not
-- expired)" as unlocked -- there is no credits/quota concept anymore,
-- subscriptions are just unlimited-while-active.

CREATE TABLE IF NOT EXISTS eml2pdf_entitlements (
  email               TEXT PRIMARY KEY,
  lifetime            BOOLEAN NOT NULL DEFAULT FALSE,
  plan                TEXT,              -- 'month' | 'year' | NULL
  status               TEXT,              -- 'active' | 'on_hold' | 'cancelled' | 'failed' | NULL
  dodo_subscription_id TEXT,              -- Dodo's subscription_id, so renewal/cancel webhooks know which row to update
  current_period_end  TIMESTAMPTZ,        -- subscription access valid until this timestamp
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotency for one-time (lifetime) payments -- same dodo_payment_id
-- processed twice (webhook retries) must not double-grant.
CREATE TABLE IF NOT EXISTS eml2pdf_purchases (
  id              SERIAL PRIMARY KEY,
  email           TEXT NOT NULL,
  product_id      TEXT NOT NULL,
  dodo_payment_id TEXT UNIQUE NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotency for subscription lifecycle events -- Dodo sends an
-- event_id per webhook delivery; store it so retried deliveries
-- (guaranteed at-least-once) don't reapply the same state change twice.
CREATE TABLE IF NOT EXISTS eml2pdf_webhook_events (
  event_id    TEXT PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_eml2pdf_purchases_email ON eml2pdf_purchases (email);
CREATE INDEX IF NOT EXISTS idx_eml2pdf_entitlements_sub ON eml2pdf_entitlements (dodo_subscription_id);
