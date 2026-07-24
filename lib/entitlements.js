// lib/entitlements.js  (formerly credits.js)
//
// Email-keyed entitlement store: lifetime flag OR an active subscription
// with a current_period_end. Written against `pg` (Postgres).

/**
 * @param {import('pg').Pool} pool
 */
function makeEntitlementsStore(pool) {
  function isActive(row) {
    if (!row) return false;
    if (row.lifetime) return true;
    if (row.status === 'active' && row.current_period_end && new Date(row.current_period_end) > new Date()) {
      return true;
    }
    return false;
  }

  async function getStatus(email) {
    const { rows } = await pool.query(
      `SELECT lifetime, plan, status, current_period_end
       FROM eml2pdf_entitlements WHERE email = $1`,
      [email]
    );
    const row = rows[0];
    return {
      unlocked: isActive(row),
      lifetime: !!row?.lifetime,
      plan: row?.plan || null,
      status: row?.status || null,
      currentPeriodEnd: row?.current_period_end || null,
    };
  }

  // Whether this exact webhook delivery has already been processed --
  // Dodo webhooks are at-least-once, so every handler needs this guard.
  async function markEventProcessed(eventId) {
    const { rows } = await pool.query(
      `INSERT INTO eml2pdf_webhook_events (event_id) VALUES ($1)
       ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
      [eventId]
    );
    return rows.length > 0; // true = first time seeing it, proceed
  }

  /** One-time lifetime purchase. */
  async function grantLifetime({ email, productId, dodoPaymentId }) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        `INSERT INTO eml2pdf_purchases (email, product_id, dodo_payment_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (dodo_payment_id) DO NOTHING RETURNING id`,
        [email, productId, dodoPaymentId]
      );
      if (!inserted.rows.length) {
        await client.query('ROLLBACK');
        return { alreadyProcessed: true };
      }
      await client.query(
        `INSERT INTO eml2pdf_entitlements (email, lifetime, updated_at)
         VALUES ($1, TRUE, now())
         ON CONFLICT (email) DO UPDATE SET lifetime = TRUE, updated_at = now()`,
        [email]
      );
      await client.query('COMMIT');
      return { alreadyProcessed: false };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /** Subscription became active / renewed -- upsert plan + period end. */
  async function upsertSubscription({ email, plan, status, dodoSubscriptionId, currentPeriodEnd }) {
    await pool.query(
      `INSERT INTO eml2pdf_entitlements (email, plan, status, dodo_subscription_id, current_period_end, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (email) DO UPDATE SET
         plan = EXCLUDED.plan,
         status = EXCLUDED.status,
         dodo_subscription_id = EXCLUDED.dodo_subscription_id,
         current_period_end = EXCLUDED.current_period_end,
         updated_at = now()`,
      [email, plan, status, dodoSubscriptionId, currentPeriodEnd]
    );
  }

  /** Subscription cancelled/failed/on_hold -- flip status, keep period_end as-is (access ends when it naturally lapses). */
  async function setSubscriptionStatus({ dodoSubscriptionId, status }) {
    await pool.query(
      `UPDATE eml2pdf_entitlements SET status = $2, updated_at = now()
       WHERE dodo_subscription_id = $1`,
      [dodoSubscriptionId, status]
    );
  }

  return { getStatus, markEventProcessed, grantLifetime, upsertSubscription, setSubscriptionStatus };
}

module.exports = { makeEntitlementsStore };
