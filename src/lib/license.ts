// Relay Pro licensing. GitHub sign-in via Supabase Auth (PKCE, reuses the
// loopback listener from the Auth tab's OAuth2 flow), fetch a signed
// entitlement from the issue-license Edge Function, verify it offline with
// the public key below, cache it so feature checks don't need a network call.
//
// Not workspace-scoped on purpose: one install, one signed-in account, so
// session and license cache live in localStorage instead of a per-workspace file.
import { open } from "@tauri-apps/plugin-shell";
import { oauth2AwaitCallback, sendHttpRequest } from "./tauri";
import { randomToken, codeChallengeFor } from "./pkce";

const SUPABASE_URL = "https://qqbzadmyejqpumydulpf.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFxYnphZG15ZWpxcHVteWR1bHBmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcwODAwNjQsImV4cCI6MjEwMjY1NjA2NH0.I5RXxW8LeOkKYqb65T_cV-oXXYhw6fU6ICdkL5vrkzw";

// Public half of the Ed25519 keypair, private half lives only as a Supabase
// secret. Safe to ship in the binary, this can only verify signatures.
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
  // last successful refresh, not the same as license.issued_at from the server
  verifiedAt: number | null;
  loading: boolean;
  error: string | null;
}

// Cache stores the raw signed blob (payload + signature), not the parsed
// feature list. state.license only gets set after crypto.subtle.verify()
// passes, so editing the cached strings by hand just breaks the signature
// instead of forging features.
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

// Checked against the cached signed license, no network call. The server
// already drops features once a subscription lapses, but that's only as
// fresh as the last refresh, so expires_at gets checked here too as a
// backstop against a stale cached license.
export function isLicenseValid(): boolean {
  if (!state.license) return false;
  if (state.license.expires_at && Date.parse(state.license.expires_at) <= Date.now()) return false;
  return true;
}

// Everything's free for the initial launch, nothing is Pro-gated yet. The
// licensing plumbing stays wired up so gating a feature later is just
// deleting this early return.
export function hasFeature(_id: string): boolean {
  return true;
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

// Only path allowed to produce a LicensePayload. Returns null if the
// signature doesn't check out, even locally.
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

// Supabase access tokens expire in about an hour. Refresh before that
// happens instead of sending a stale token and getting a 401 from issue-license.
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

// Re-verifies the cached blob before trusting it, so a reload never trusts
// localStorage blindly. Bad signature just means no license, not a crash.
async function rehydrateCachedLicense(): Promise<void> {
  const cached = loadJson<CachedLicenseBlob>(LICENSE_KEY);
  if (!cached) return;
  const verified = await verifySignedLicense(cached.payloadB64, cached.signatureB64);
  if (verified) setState({ license: verified, verifiedAt: cached.verifiedAt });
}
rehydrateCachedLicense();

// Safe to call opportunistically (app start, manual refresh button).
// Failures leave the last verified license in place instead of clearing it,
// so a flaky/offline moment doesn't lock someone out of features they
// already unlocked.
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

// Supabase's PKCE flow for GitHub: open the system browser to /authorize
// (fronting GitHub's OAuth), catch the redirect locally, exchange the code
// for a session, then fetch a license for it.
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
