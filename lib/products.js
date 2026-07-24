// lib/products.js
//
// Three plans (month / year / lifetime), each with TWO Dodo products:
// a "full price" one and a "discount price" one. The discount price is
// a real, separate Dodo product/price -- not a coupon code -- because
// that's the simplest thing to make bulletproof against retries, race
// conditions, and "what price did they actually pay" bookkeeping. The
// extension decides which product_id to send to checkout based on
// whether the person is still inside their 4-hour discount window; the
// webhook just trusts whichever product_id actually got paid for and
// looks up the plan from it.
//
// Fill in the six dodoProductId values below after creating the
// products in the Dodo dashboard (see README section "Dodo setup").

const PRODUCTS = {
  month: {
    dodoProductId: 'pdt_0Njt5466kgqtPF10rV3wv',   // Monthly EML To PDF -- $7/mo subscription
    plan: 'month',
    recurring: true,
    lifetime: false,
  },
  month_discount: {
    dodoProductId: 'pdt_0Njt6t1a0HEZR1ZiCY7JL',   // Monthly EML To PDF Discount -- $5/mo subscription
    plan: 'month',
    recurring: true,
    lifetime: false,
  },
  year: {
    dodoProductId: 'pdt_0Njt5NW2HiBiVIvsO7sZ4',   // Yearly EML To PDF -- $23/yr subscription
    plan: 'year',
    recurring: true,
    lifetime: false,
  },
  year_discount: {
    dodoProductId: 'pdt_0Njt6zGQfyUqPUy5BV2xT',   // Yearly EML To PDF Discount -- $17/yr subscription
    plan: 'year',
    recurring: true,
    lifetime: false,
  },
  lifetime: {
    dodoProductId: 'pdt_0NJt7GNiiGxbssRrwQY3M',   // Lifetime EML To PDF 2 -- $50 one-time
    plan: 'lifetime',
    recurring: false,
    lifetime: true,
  },
  lifetime_discount: {
    dodoProductId: 'pdt_0Njt5sgxNjGgsUXriBPK',    // Lifetime EML To PDF 2 Discount -- $35 one-time (NOTE: dashboard shows $35, spec said $39 -- verify which is intended)
    plan: 'lifetime',
    recurring: false,
    lifetime: true,
  },
};

function findByDodoProductId(dodoProductId) {
  const entry = Object.entries(PRODUCTS).find(([, p]) => p.dodoProductId === dodoProductId);
  if (!entry) return null;
  const [sku, product] = entry;
  return { sku, ...product };
}

module.exports = { PRODUCTS, findByDodoProductId };
