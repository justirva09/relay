import { AwsSigV4Config } from "../types";

// AWS SigV4, computed client-side via WebCrypto instead of Rust. Sending
// through Rust is about avoiding the webview's fetch/CORS layer, not crypto,
// and this way the secret key never has to cross the JS/Rust IPC boundary.

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(data: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return toHex(digest);
}

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey("raw", key as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
}

function amzDate(d: Date): { amzDate: string; dateStamp: string } {
  const iso = d.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

function encodeRfc3986(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

function canonicalQueryString(search: string): string {
  const params = new URLSearchParams(search);
  const pairs = Array.from(params.entries()).map(([k, v]) => [encodeRfc3986(k), encodeRfc3986(v)] as [string, string]);
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  return pairs.map(([k, v]) => `${k}=${v}`).join("&");
}

// returns the extra headers to merge in, doesn't mutate the caller's list
export async function signAwsSigV4(
  method: string,
  url: string,
  headers: [string, string][],
  body: string | undefined,
  config: AwsSigV4Config
): Promise<[string, string][]> {
  const u = new URL(url);
  const { amzDate: xAmzDate, dateStamp } = amzDate(new Date());

  const headerMap = new Map<string, string>();
  for (const [k, v] of headers) headerMap.set(k.toLowerCase(), v);
  headerMap.set("host", u.host);
  headerMap.set("x-amz-date", xAmzDate);
  if (config.sessionToken) headerMap.set("x-amz-security-token", config.sessionToken);

  const sortedHeaderNames = Array.from(headerMap.keys()).sort();
  const canonicalHeaders = sortedHeaderNames.map((k) => `${k}:${headerMap.get(k)!.trim()}\n`).join("");
  const signedHeaders = sortedHeaderNames.join(";");

  const payloadHash = await sha256Hex(body ?? "");
  const canonicalUri = (u.pathname || "/").split("/").map(encodeRfc3986).join("/");
  const canonicalRequest = [
    method.toUpperCase(),
    canonicalUri,
    canonicalQueryString(u.search.replace(/^\?/, "")),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${config.region}/${config.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", xAmzDate, credentialScope, await sha256Hex(canonicalRequest)].join("\n");

  const kDate = await hmac(new TextEncoder().encode(`AWS4${config.secretAccessKey}`), dateStamp);
  const kRegion = await hmac(kDate, config.region);
  const kService = await hmac(kRegion, config.service);
  const kSigning = await hmac(kService, "aws4_request");
  const signature = toHex(await hmac(kSigning, stringToSign));

  const authorization = `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const extra: [string, string][] = [
    ["X-Amz-Date", xAmzDate],
    ["Authorization", authorization],
  ];
  if (config.sessionToken) extra.push(["X-Amz-Security-Token", config.sessionToken]);
  return extra;
}
