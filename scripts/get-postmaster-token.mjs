/**
 * One-time script to get a Google Postmaster Tools OAuth2 refresh token.
 * Run with: node scripts/get-postmaster-token.mjs
 *
 * Starts a local server on port 3000 to catch the OAuth callback.
 * Make sure your Next.js dev server is NOT running when you run this.
 */

import http from "http";
import { exec } from "child_process";

const CLIENT_ID = process.env.POSTMASTER_CLIENT_ID;
const CLIENT_SECRET = process.env.POSTMASTER_CLIENT_SECRET;
const REDIRECT_URI = "http://localhost:3000/oauth/callback";
const SCOPE = "https://www.googleapis.com/auth/postmaster.readonly";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    "\nMissing credentials. Run with:\n" +
    "  POSTMASTER_CLIENT_ID=xxx POSTMASTER_CLIENT_SECRET=yyy node scripts/get-postmaster-token.mjs\n"
  );
  process.exit(1);
}

const authUrl =
  `https://accounts.google.com/o/oauth2/auth` +
  `?client_id=${CLIENT_ID}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  `&response_type=code` +
  `&scope=${encodeURIComponent(SCOPE)}` +
  `&access_type=offline` +
  `&prompt=consent`;

console.log("\n Opening browser for Google authorization...\n");
console.log("If the browser doesn't open, visit this URL manually:\n");
console.log(authUrl + "\n");

// Open in browser
const openCmd =
  process.platform === "darwin" ? `open "${authUrl}"` :
  process.platform === "win32" ? `start "" "${authUrl}"` :
  `xdg-open "${authUrl}"`;
exec(openCmd);

// Start local server to catch the callback
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost:3000");
  if (url.pathname !== "/oauth/callback") {
    res.end("Not found");
    return;
  }

  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    res.end(`<h2>Error: ${error}</h2><p>You can close this tab.</p>`);
    console.error("\nOAuth error:", error);
    server.close();
    return;
  }

  if (!code) {
    res.end("<h2>No code received.</h2><p>You can close this tab.</p>");
    server.close();
    return;
  }

  console.log("Received authorization code. Exchanging for tokens...\n");

  // Exchange code for tokens
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });

  const tokens = await tokenRes.json();

  if (tokens.error) {
    res.end(`<h2>Token error: ${tokens.error}</h2><p>You can close this tab.</p>`);
    console.error("\nToken exchange error:", tokens);
    server.close();
    return;
  }

  res.end("<h2>Success! You can close this tab and check your terminal.</h2>");

  console.log("=".repeat(60));
  console.log("SUCCESS — add these to your .env.local and Vercel env vars:");
  console.log("=".repeat(60));
  console.log(`\nPOSTMASTER_CLIENT_ID=${CLIENT_ID}`);
  console.log(`POSTMASTER_CLIENT_SECRET=${CLIENT_SECRET}`);
  console.log(`POSTMASTER_REFRESH_TOKEN=${tokens.refresh_token}\n`);
  console.log("=".repeat(60));

  server.close();
});

server.listen(3000, () => {
  console.log("Waiting for OAuth callback on http://localhost:3000/oauth/callback ...\n");
});
