#!/usr/bin/env node
// Runs after a GitHub Release is published (see
// .github/workflows/discord-release-notify.yml). This repo is private, so a
// release asset's own browser_download_url only works for someone logged
// into GitHub with repo access — no good for a public Discord channel. This
// script re-uploads the same installer files to a public Google Drive
// folder (via a service account) and posts links to THOSE instead.
//
// Auth for Drive: a Google Cloud service account, not OAuth2 user consent —
// there's no human available to click through a consent screen in CI. The
// service account's own JWT is signed locally (Node's built-in `crypto`
// covers RS256, no extra dependency needed) and exchanged for an access
// token via Google's standard OAuth2 token endpoint.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const GITHUB_TOKEN = requireEnv("GITHUB_TOKEN");
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const GDRIVE_SERVICE_ACCOUNT_JSON = process.env.GDRIVE_SERVICE_ACCOUNT_JSON;
const GDRIVE_FOLDER_ID = process.env.GDRIVE_FOLDER_ID;
const GITHUB_EVENT_PATH = requireEnv("GITHUB_EVENT_PATH");

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

function warnAndExit(message) {
  console.warn(`::warning::${message}`);
  process.exit(0);
}

// One representative installer per platform — tauri-action also uploads
// .sig signature files and raw .app.tar.gz/.tar.gz archives alongside
// these; only the thing a human actually downloads and double-clicks
// belongs in the announcement.
const ASSET_PICKS = [
  ["macOS (.dmg)", (n) => n.endsWith(".dmg")],
  ["Windows (.msi)", (n) => n.endsWith(".msi")],
  ["Linux (.AppImage)", (n) => n.endsWith(".appimage")],
  ["Linux (.deb)", (n) => n.endsWith(".deb")],
];

async function downloadGitHubAsset(asset, destPath) {
  // The plain browser_download_url requires a logged-in browser session for
  // a private repo; the API asset endpoint with a token + the raw-content
  // Accept header is the authenticated equivalent used here.
  const res = await fetch(asset.url, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/octet-stream",
      "User-Agent": "relay-release-notify",
    },
  });
  if (!res.ok) throw new Error(`Failed to download ${asset.name} from GitHub: ${res.status} ${await res.text()}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buf);
}

function base64url(input) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Google's service-account OAuth2 flow: a signed JWT asserting who we are,
// exchanged for a short-lived access token. drive.file scope only — this
// service account can only see/manage files it created (or that were
// explicitly shared with it, like the target folder), never a user's whole
// Drive.
async function getDriveAccessToken() {
  const creds = JSON.parse(GDRIVE_SERVICE_ACCOUNT_JSON);
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64url(
    JSON.stringify({
      iss: creds.client_email,
      scope: "https://www.googleapis.com/auth/drive.file",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })
  );
  const signInput = `${header}.${claim}`;
  const signature = crypto.createSign("RSA-SHA256").update(signInput).sign(creds.private_key);
  const assertion = `${signInput}.${base64url(signature)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Google token exchange failed: ${JSON.stringify(body)}`);
  return body.access_token;
}

// Multipart upload (metadata + file content in one request) — the simplest
// of Drive API v3's upload modes, fine for installer-sized files (tens to
// low hundreds of MB, well under the 5MB simple-upload / resumable-upload
// boundary Google recommends switching at).
async function uploadFileToDrive(accessToken, filePath, fileName) {
  const boundary = `relay-release-${crypto.randomBytes(8).toString("hex")}`;
  const metadata = JSON.stringify({ name: fileName, parents: [GDRIVE_FOLDER_ID] });
  const fileBuf = fs.readFileSync(filePath);

  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`),
    fileBuf,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Drive upload failed for ${fileName}: ${JSON.stringify(json)}`);
  return json.id;
}

// The folder being shared with this service account as Editor does NOT
// automatically make files the service account uploads publicly viewable —
// Drive permissions on a new file are independent of its parent folder's
// sharing unless it's a Shared Drive. Explicitly grant "anyone with the
// link can view" per file so a Discord member with no Google account at
// all can still open it.
async function makeFilePublic(accessToken, fileId) {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ role: "reader", type: "anyone" }),
  });
  if (!res.ok) throw new Error(`Failed to make Drive file public: ${res.status} ${await res.text()}`);
}

function driveViewLink(fileId) {
  return `https://drive.google.com/file/d/${fileId}/view?usp=sharing`;
}

async function postToDiscord(release, links) {
  const description = links.map(([label, link]) => `**${label}** — [Download](${link})`).join("\n");
  const payload = {
    embeds: [
      {
        title: `Relay ${release.tag_name} is out`,
        url: release.html_url,
        description,
        color: 0x5865f2,
      },
    ],
  };
  const res = await fetch(DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Discord webhook returned ${res.status}: ${await res.text()}`);
}

async function main() {
  if (!DISCORD_WEBHOOK_URL) warnAndExit("DISCORD_WEBHOOK_URL secret not set — skipping.");
  if (!GDRIVE_SERVICE_ACCOUNT_JSON || !GDRIVE_FOLDER_ID) warnAndExit("GDRIVE_SERVICE_ACCOUNT_JSON/GDRIVE_FOLDER_ID secret not set — skipping.");

  const event = JSON.parse(fs.readFileSync(GITHUB_EVENT_PATH, "utf8"));
  const release = event.release;
  const assets = release.assets || [];

  const picked = ASSET_PICKS.map(([label, test]) => [label, assets.find((a) => test(a.name.toLowerCase()))]).filter(([, asset]) => asset);

  if (picked.length === 0) warnAndExit("No recognizable installer assets found on this release — skipping.");

  const accessToken = await getDriveAccessToken();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-release-"));
  const links = [];

  for (const [label, asset] of picked) {
    const localPath = path.join(tmpDir, asset.name);
    console.log(`Downloading ${asset.name} from GitHub...`);
    await downloadGitHubAsset(asset, localPath);

    console.log(`Uploading ${asset.name} to Google Drive...`);
    const fileId = await uploadFileToDrive(accessToken, localPath, asset.name);
    await makeFilePublic(accessToken, fileId);
    links.push([label, driveViewLink(fileId)]);

    fs.rmSync(localPath);
  }

  console.log("Posting to Discord...");
  await postToDiscord(release, links);
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
