// Relay Pro licensing — Sign in with GitHub via Supabase Auth (PKCE, same
// loopback-listener infra as the Auth tab's generic OAuth2 flow), fetch a
// signed entitlement from the `issue-license` Edge Function, verify it
// offline with a public key baked into this file, and cache the verified
// result so feature checks never need a network round trip.
//
// This is intentionally NOT workspace-scoped (see cookie_jar.rs/theme.tsx
// for the pattern this follows) — one Relay install has one signed-in
// account regardless of which workspace folder is open, so the session and
// license cache both live in localStorage, not a per-workspace file.
import { open } from "@tauri-apps/plugin-shell";
import { oauth2AwaitCallback, sendHttpRequest } from "./tauri";
import { randomToken, codeChallengeFor } from "./pkce";

const SUPABASE_URL = "https://qqbzadmyejqpumydulpf.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFxYnphZG15ZWpxcHVteWR1bHBmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcwODAwNjQsImV4cCI6MjEwMjY1NjA2NH0.I5RXxW8LeOkKYqb65T_cV-oXXYhw6fU6ICdkL5vrkzw";

// Public half of the Ed25519 keypair whose private half only ever lives as
// a Supabase Edge Function secret (LICENSE_SIGNING_PRIVATE_KEY) — safe to
// ship in the binary, it can only verify signatures, never create them.
const LICENSE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAVZSaqzV6kzxK1vrPmMwxoVBe5fZZ6uJI4/p2jh0h+xM=
-----END PUBLIC KEY-----`;

const REDIRECT_PORT = 43298;
const CALLBACK_TIMEOUT_SECS = 180;

const SESSION_KEY = "relay-license-session";
const LICENSE_KEY = "relay-license-cache";

export interface LicenseSession {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  userId: string;
  email?: string;
}

export interface LicensePayload {
  user_id: string;
  plan: string;
  status: string;
  features: string[];
  issued_at: string;
  expires_at: string | null;
}

export interface LicenseState {
  session: LicenseSession | null;
  license: LicensePayload | null;
  // When the last successful (network + signature) refresh happened — not
  // the same as license.issued_at, which comes from the server.
  verifiedAt: number | null;
  loading: boolean;
  error: string | null;
}

// The cache holds the RAW signed blob (base64url payload + signature), not
// the already-parsed feature list — hasFeature() must never trust a plain
// JSON object that could've been hand-edited in localStorage. `license` in
// state only ever gets set after a real crypto.subtle.verify() against
// these exact bytes, so tampering with the cached strings just makes the
// signature fail to verify instead of quietly forging extra features.
interface CachedLicenseBlob {
  payloadB64: string;
  signatureB64: string;
  verifiedAt: number;
}

let state: LicenseState = {
  session: loadJson<LicenseSession>(SESSION_KEY),
  license: null,
  verifiedAt: null,
  loading: false,
  error: null,
};

const listeners = new Set<() => void>();

function loadJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function setState(patch: Partial<LicenseState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function getLicenseState(): LicenseState {
  return state;
}

export function subscribeLicense(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Checked entirely against the cached signed license, no network needed —
// but a cache is only ever trustworthy up to the expiry it was signed with.
// The server already excludes features for a non-active subscription
// (see issue-license's effectivePlan), but that's only as fresh as the last
// refresh; expires_at is a concrete timestamp, so it's checked here too as
// a client-side backstop against a stale-but-still-cached license outliving
// the period it was actually valid for.
export function isLicenseValid(): boolean {
  if (!state.license) return false;
  if (state.license.expires_at && Date.parse(state.license.expires_at) <= Date.now()) return false;
  return true;
}

export function hasFeature(id: string): boolean {
  if (!isLicenseValid()) return false;
  return state.license!.features.includes(id);
}

function base64UrlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function importPublicKey(pem: string): Promise<CryptoKey> {
  const body = pem.replace(/-----BEGIN PUBLIC KEY-----/, "").replace(/-----END PUBLIC KEY-----/, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("spki", der, { name: "Ed25519" }, false, ["verify"]);
}

// Verifies the Ed25519 signature over the raw payload bytes and returns the
// parsed payload only if it checks out — never trust an unsigned/mismatched
// payload, even locally. This is the ONLY path allowed to produce a
// LicensePayload; nothing else in this module may construct one directly.
async function verifySignedLicense(payloadB64: string, signatureB64: string): Promise<LicensePayload | null> {
  const key = await importPublicKey(LICENSE_PUBLIC_KEY_PEM);
  const payloadBytes = base64UrlDecode(payloadB64);
  const signatureBytes = base64UrlDecode(signatureB64);
  const ok = await crypto.subtle.verify("Ed25519", key, signatureBytes as BufferSource, payloadBytes as BufferSource);
  if (!ok) return null;
  try {
    return JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return null;
  }
}

// Supabase access tokens expire (~1h) — refreshLicense used to send the raw
// stored accessToken forever, so any session older than that expiry hit
// issue-license's supabase.auth.getUser() check and got a 401. This exchanges
// the refresh_token for a new access_token whenever the cached one is
// expired or about to be, before making the actual issue-license call.
async function ensureFreshAccessToken(session: LicenseSession): Promise<LicenseSession> {
  const expiringSoon = !session.expiresAt || session.expiresAt <= Date.now() + 60_000;
  if (!expiringSoon || !session.refreshToken) return session;

  const res = await sendHttpRequest({
    method: "POST",
    url: `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
    headers: [
      ["Content-Type", "application/json"],
      ["apikey", SUPABASE_ANON_KEY],
    ],
    body: JSON.stringify({ refresh_token: session.refreshToken }),
  });
  if (!res.ok) throw new Error(`Session refresh failed: ${res.status} ${res.status_text}`);

  const body = JSON.parse(res.body);
  if (!body.access_token) throw new Error(`No access_token in refresh response: ${res.body}`);

  const refreshed: LicenseSession = {
    ...session,
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? session.refreshToken,
    expiresAt: typeof body.expires_in === "number" ? Date.now() + body.expires_in * 1000 : undefined,
  };
  persistSession(refreshed);
  setState({ session: refreshed });
  return refreshed;
}

function persistSession(session: LicenseSession | null) {
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(SESSION_KEY);
}

function persistLicenseBlob(blob: CachedLicenseBlob | null) {
  if (blob) localStorage.setItem(LICENSE_KEY, JSON.stringify(blob));
  else localStorage.removeItem(LICENSE_KEY);
}

// Re-verifies whatever raw blob is cached, if any, and only then updates
// state — called once at module load, so a page/app reload never trusts
// the cache blindly. If the signature doesn't check out (tampered, or the
// key ever rotates), this just leaves state.license as null rather than
// throwing, same as any other "no valid license" case.
async function rehydrateCachedLicense(): Promise<void> {
  const cached = loadJson<CachedLicenseBlob>(LICENSE_KEY);
  if (!cached) return;
  const verified = await verifySignedLicense(cached.payloadB64, cached.signatureB64);
  if (verified) setState({ license: verified, verifiedAt: cached.verifiedAt });
}
rehydrateCachedLicense();

// Calls issue-license with the current session's token, verifies the
// signature, and updates both in-memory state and the local cache. Safe to
// call opportunistically (e.g. on app start, or a manual "Refresh" button)
// — failures just leave the last verified license in place rather than
// clearing it, so a flaky/offline moment doesn't lock a user out of
// features they already legitimately unlocked.
export async function refreshLicense(): Promise<void> {
  const session = state.session;
  if (!session) return;

  setState({ loading: true, error: null });
  try {
    const freshSession = await ensureFreshAccessToken(session);
    const res = await sendHttpRequest({
      method: "POST",
      url: `${SUPABASE_URL}/functions/v1/issue-license`,
      headers: [
        ["Authorization", `Bearer ${freshSession.accessToken}`],
        ["apikey", SUPABASE_ANON_KEY],
      ],
    });
    if (!res.ok) throw new Error(`issue-license failed: ${res.status} ${res.status_text}`);

    const body = JSON.parse(res.body);
    const verified = await verifySignedLicense(body.payload, body.signature);
    if (!verified) throw new Error("License signature did not verify");

    const verifiedAt = Date.now();
    persistLicenseBlob({ payloadB64: body.payload, signatureB64: body.signature, verifiedAt });
    setState({ license: verified, verifiedAt, loading: false });
  } catch (e: any) {
    setState({ loading: false, error: e?.message ?? String(e) });
  }
}

// Runs Supabase Auth's PKCE flow for GitHub: opens the system browser to
// Supabase's own /authorize endpoint (which fronts GitHub's OAuth), catches
// the redirect locally, exchanges the code for a Supabase session, then
// immediately fetches and verifies a license for it.
export async function signInWithGitHub(): Promise<void> {
  setState({ loading: true, error: null });
  try {
    const verifier = randomToken(32);
    const challenge = await codeChallengeFor(verifier);
    const redirectTo = `http://127.0.0.1:${REDIRECT_PORT}/callback`;

    const authorizeUrl = new URL(`${SUPABASE_URL}/auth/v1/authorize`);
    authorizeUrl.searchParams.set("provider", "github");
    authorizeUrl.searchParams.set("redirect_to", redirectTo);
    authorizeUrl.searchParams.set("code_challenge", challenge);
    authorizeUrl.searchParams.set("code_challenge_method", "s256");

    const callbackPromise = oauth2AwaitCallback(REDIRECT_PORT, CALLBACK_TIMEOUT_SECS);
    await open(authorizeUrl.toString());

    const callback = await callbackPromise;
    if (callback.error) throw new Error(`Sign-in was denied: ${callback.error}`);
    if (!callback.code) throw new Error("No authorization code came back from Supabase");

    const res = await sendHttpRequest({
      method: "POST",
      url: `${SUPABASE_URL}/auth/v1/token?grant_type=pkce`,
      headers: [
        ["Content-Type", "application/json"],
        ["apikey", SUPABASE_ANON_KEY],
      ],
      body: JSON.stringify({ auth_code: callback.code, code_verifier: verifier }),
    });
    if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${res.status_text} — ${res.body}`);

    const body = JSON.parse(res.body);
    if (!body.access_token) throw new Error(`No access_token in response: ${res.body}`);

    const session: LicenseSession = {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresAt: typeof body.expires_in === "number" ? Date.now() + body.expires_in * 1000 : undefined,
      userId: body.user?.id,
      email: body.user?.email,
    };
    persistSession(session);
    setState({ session, loading: false });

    await refreshLicense();
  } catch (e: any) {
    setState({ loading: false, error: e?.message ?? String(e) });
  }
}

export function signOut(): void {
  persistSession(null);
  persistLicenseBlob(null);
  setState({ session: null, license: null, verifiedAt: null, error: null });
}
