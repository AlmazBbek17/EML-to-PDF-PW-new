// lib/google-auth.js
//
// Verifies the OAuth ACCESS token the extension gets back from
// chrome.identity.getAuthToken() (see extension/paywall.js). This is a
// different token type than an id_token: chrome.identity.getAuthToken is
// the Chrome-native flow (OAuth client registered as "Chrome Extension"
// type in Google Cloud Console -- no redirect_uri, Chrome handles the
// whole exchange internally), and it hands back a plain OAuth2 access
// token, not a signed JWT. So instead of verifying a signature locally
// (like verifyIdToken does for id_tokens), we ask Google directly:
// "is this access token real, and who does it belong to?" via the
// tokeninfo endpoint. Either way, the principle is the same as before --
// never trust an email the extension just tells us directly, always
// confirm it with Google first.

const GOOGLE_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID;

/**
 * @param {string} accessToken - the OAuth access token from chrome.identity.getAuthToken
 * @returns {Promise<{ email: string, emailVerified: boolean }>}
 * @throws if the token is invalid/expired, or was issued for a different client
 */
async function verifyGoogleAccessToken(accessToken) {
  const res = await fetch(
    `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${encodeURIComponent(accessToken)}`
  );
  if (!res.ok) {
    throw new Error('Google rejected this access token');
  }
  const info = await res.json();

  // aud is the client_id the token was issued for -- checking it stops
  // someone from handing us a valid Google token that was meant for some
  // completely different app.
  if (!GOOGLE_CLIENT_ID || info.aud !== GOOGLE_CLIENT_ID) {
    throw new Error('Access token was not issued for this app');
  }
  if (!info.email) {
    throw new Error('Google token has no associated email');
  }

  return { email: info.email.toLowerCase(), emailVerified: info.email_verified === 'true' || info.email_verified === true };
}

module.exports = { verifyGoogleAccessToken };
