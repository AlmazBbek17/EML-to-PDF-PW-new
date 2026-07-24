# EML → PDF — paywall backend

Standalone server for the EML → PDF Chrome extension's paywall. Handles:
Google sign-in verification, starting a Dodo Payments checkout, the Dodo
webhook that grants credits, and a balance/spend API the extension calls
before each batch of conversions.

**The actual email→PDF conversion is NOT here** — that runs entirely
inside the Chrome extension (html2canvas + jsPDF, client-side). This
server only ever sees: an email address (from Google), which product was
bought, and how many credits are left. It never sees email content or
`.eml` files.

## 1. Create a Postgres database

Any managed Postgres works — Railway, Render, Neon, and Supabase all give
you a `DATABASE_URL` in a couple of clicks on their free tiers, which is
plenty for this.

## 2. Create Dodo Payments products

Dodo dashboard → Products → create 3 one-time products:

| Product | Price |

| EML→PDF Lifetime | $9.00 |

Copy each `product_id` into `lib/products.js`.

## 3. Create the Dodo webhook

Dodo dashboard → Webhooks → Add endpoint. You won't have a real URL until
after step 5's first deploy — deploy once with a placeholder, then come
back and set:
- URL: `https://<your-deployed-domain>/eml2pdf/webhooks/dodo`
- Events: `checkout.session.completed` (and `payment.succeeded` if it's
  offered as a separate event)
- Copy the signing secret → `DODO_PAYMENTS_WEBHOOK_SECRET`

## 4. Create the Google OAuth Client

console.cloud.google.com → APIs & Services → Credentials → Create
Credentials → OAuth client ID → **Web application**.

Load the extension unpacked once (`chrome://extensions` → Developer mode →
Load unpacked), copy its extension ID, and add this as an authorized
redirect URI:

```
https://<EXTENSION_ID>.chromiumapp.org/
```

Copy the **Client ID** (not the secret — it's not needed for this flow)
into `GOOGLE_OAUTH_CLIENT_ID` here, and into `paywall.js` -> `CONFIG.GOOGLE_CLIENT_ID`
in the extension.

## 5. Deploy

Pick one — all three work fine for this size of app (a handful of routes,
one Postgres connection pool):

### Railway (simplest — Postgres + app in one place)
1. `railway init` in this folder, or connect the GitHub repo in the Railway dashboard
2. Add a Postgres plugin — it sets `DATABASE_URL` for you automatically
3. Add the other env vars from `.env.example` in the Railway dashboard
4. Deploy — Railway detects `npm start` from `package.json` automatically

### Render
1. New → Web Service → connect this repo
2. Build command: `npm install` · Start command: `npm start`
3. New → PostgreSQL → copy its connection string into `DATABASE_URL`
4. Add the other env vars in the service's Environment tab

### Fly.io
1. `fly launch` in this folder (it'll detect Node and generate a `fly.toml`)
2. `fly postgres create` and `fly postgres attach` to wire up `DATABASE_URL`
3. `fly secrets set DODO_PAYMENTS_API_KEY=... DODO_PAYMENTS_WEBHOOK_SECRET=... GOOGLE_OAUTH_CLIENT_ID=...`
4. `fly deploy`

After the first deploy, run the migration once:

```
npm run migrate
```

(Run it locally pointed at the production `DATABASE_URL`, or add it as a
one-off/release command in whichever platform you picked — Railway and
Render both support a "pre-deploy command" for exactly this.)

Then go back to step 3 and register the real webhook URL now that you
have a real domain.

## 6. Point the extension at it

In the extension's `paywall.js`:
- `CONFIG.API_BASE` -> `https://<your-deployed-domain>/eml2pdf`
- `CONFIG.GOOGLE_CLIENT_ID` -> from step 4

In the extension's `manifest.json`, replace `api.YOURDOMAIN.com` (two
places — `host_permissions` and the CSP `connect-src`) with your real
domain.

## 7. Test end to end before going live

1. Keep `DODO_ENV=test_mode` and use Dodo's test card numbers (in their
   docs) to run through: sign in -> buy a pack -> webhook fires -> credits
   show up -> 8th file converts.
2. Check your server logs for the webhook route — you should see it hit
   once per test purchase, not silently failing signature verification.
3. Only then flip `DODO_ENV=live_mode` and switch to your live Dodo API
   key/webhook secret.

## Local development

```
npm install
cp .env.example .env   # fill in the values
npm run migrate
npm run dev
```

The webhook won't reach `localhost` directly from Dodo — use a tunnel
(`ngrok http 3000`) and register the ngrok URL as the webhook endpoint
while testing locally.
