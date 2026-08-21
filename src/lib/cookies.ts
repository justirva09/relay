import { StoredCookie, uid } from "../types";

// Follows RFC 6265 §5.2-5.3 defaults: no Domain attribute means host-only
// cookie scoped to the exact request host, no Path means the request URL's
// directory (not the full path).
export function parseSetCookieHeader(headerValue: string, requestUrl: string): StoredCookie | null {
  const parts = headerValue.split(";").map((p) => p.trim());
  const [nameValue, ...attrs] = parts;
  const eqIdx = nameValue.indexOf("=");
  if (eqIdx === -1) return null;
  const name = nameValue.slice(0, eqIdx).trim();
  const value = nameValue.slice(eqIdx + 1).trim();
  if (!name) return null;

  let requestHost = "";
  let requestPath = "/";
  try {
    const u = new URL(requestUrl);
    requestHost = u.hostname;
    requestPath = u.pathname || "/";
  } catch {
    return null;
  }

  const cookie: StoredCookie = {
    id: uid(),
    domain: requestHost,
    path: requestPath.slice(0, requestPath.lastIndexOf("/") + 1) || "/",
    name,
    value,
    secure: false,
    httpOnly: false,
  };

  for (const attr of attrs) {
    const [rawKey, ...rest] = attr.split("=");
    const key = rawKey.trim().toLowerCase();
    const attrValue = rest.join("=").trim();
    switch (key) {
      case "domain":
        cookie.domain = attrValue.replace(/^\./, "");
        break;
      case "path":
        cookie.path = attrValue || "/";
        break;
      case "secure":
        cookie.secure = true;
        break;
      case "httponly":
        cookie.httpOnly = true;
        break;
      case "max-age": {
        const seconds = Number(attrValue);
        if (Number.isFinite(seconds)) cookie.expires = Date.now() + seconds * 1000;
        break;
      }
      case "expires": {
        const ts = Date.parse(attrValue);
        if (!Number.isNaN(ts)) cookie.expires = ts;
        break;
      }
      default:
        break;
    }
  }

  return cookie;
}

function domainMatches(cookieDomain: string, host: string): boolean {
  return host === cookieDomain || host.endsWith(`.${cookieDomain}`);
}

function pathMatches(cookiePath: string, urlPath: string): boolean {
  if (cookiePath === "/") return true;
  if (urlPath === cookiePath) return true;
  const withSlash = cookiePath.endsWith("/") ? cookiePath : `${cookiePath}/`;
  return urlPath.startsWith(withSlash) || urlPath.startsWith(cookiePath);
}

// Cookies eligible to send on a request to this URL, by domain/path/secure/expiry.
export function matchCookiesForUrl(cookies: StoredCookie[], url: string): StoredCookie[] {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return [];
  }
  const now = Date.now();
  return cookies.filter((c) => {
    if (c.expires !== undefined && c.expires <= now) return false;
    if (c.secure && u.protocol !== "https:") return false;
    if (!domainMatches(c.domain, u.hostname)) return false;
    return pathMatches(c.path, u.pathname || "/");
  });
}

export function buildCookieHeaderValue(cookies: StoredCookie[]): string {
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

// Upserts by (domain, path, name), same identity browsers use. Drops expired
// cookies so a server's `Max-Age=0` actually clears the jar entry.
export function mergeCookies(existing: StoredCookie[], incoming: StoredCookie[]): StoredCookie[] {
  const key = (c: StoredCookie) => JSON.stringify([c.domain, c.path, c.name]);
  const byKey = new Map(existing.map((c) => [key(c), c]));
  for (const c of incoming) byKey.set(key(c), c);
  const now = Date.now();
  return Array.from(byKey.values()).filter((c) => c.expires === undefined || c.expires > now);
}
