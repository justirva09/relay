import { open } from "@tauri-apps/plugin-shell";
import { OAuth2Config } from "../types";
import { oauth2AwaitCallback, sendHttpRequest } from "./tauri";
import { randomToken, codeChallengeFor } from "./pkce";

const CALLBACK_TIMEOUT_SECS = 180;

export interface OAuth2Result {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

// Runs the full Authorization Code + PKCE flow: opens the user's system
// browser (Relay itself has no embedded browser view to navigate), catches
// the redirect via a one-shot local listener (see oauth.rs), then exchanges
// the code for a token through Rust's http_request — same path all of
// Relay's real HTTP traffic takes, not a webview fetch().
export async function runAuthorizationCodePkceFlow(config: OAuth2Config): Promise<OAuth2Result> {
  if (!config.authUrl || !config.tokenUrl || !config.clientId) {
    throw new Error("Authorization URL, Token URL, and Client ID are required");
  }

  const verifier = randomToken(32);
  const state = randomToken(16);
  const challenge = await codeChallengeFor(verifier);
  const redirectUri = `http://127.0.0.1:${config.redirectPort}/callback`;

  const authUrl = new URL(config.authUrl);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", config.clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  if (config.scope) authUrl.searchParams.set("scope", config.scope);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  // Start listening BEFORE opening the browser — otherwise a fast provider
  // could redirect back before the local listener is bound to accept it.
  const callbackPromise = oauth2AwaitCallback(config.redirectPort, CALLBACK_TIMEOUT_SECS);
  await open(authUrl.toString());

  const callback = await callbackPromise;
  if (callback.error) throw new Error(`Authorization was denied: ${callback.error}`);
  if (!callback.code) throw new Error("No authorization code came back from the provider");
  if (callback.state !== state) throw new Error("State mismatch — possible CSRF, aborting");

  const form = new URLSearchParams();
  form.set("grant_type", "authorization_code");
  form.set("code", callback.code);
  form.set("redirect_uri", redirectUri);
  form.set("client_id", config.clientId);
  if (config.clientSecret) form.set("client_secret", config.clientSecret);
  form.set("code_verifier", verifier);

  const res = await sendHttpRequest({
    method: "POST",
    url: config.tokenUrl,
    headers: [["Content-Type", "application/x-www-form-urlencoded"]],
    body: form.toString(),
  });

  if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${res.status_text} — ${res.body}`);

  let parsed: any;
  try {
    parsed = JSON.parse(res.body);
  } catch {
    throw new Error(`Token endpoint did not return JSON: ${res.body}`);
  }
  if (!parsed.access_token) throw new Error(`Token endpoint response had no access_token: ${res.body}`);

  return {
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token,
    expiresAt: typeof parsed.expires_in === "number" ? Date.now() + parsed.expires_in * 1000 : undefined,
  };
}
