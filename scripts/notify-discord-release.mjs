#!/usr/bin/env node
// Runs after a GitHub Release is published (see
// .github/workflows/discord-release-notify.yml). This repo is private, so a
// release asset's own browser_download_url only works for someone logged
// into GitHub with repo access — no good for a public Discord channel. This
// script re-uploads the same installer files to a public Google Drive
// folder and posts links to THOSE instead.
//
// Auth for Drive: OAuth2 with a stored refresh token for the folder
// owner's own Google account — NOT a service account. Service accounts
// have zero Drive storage quota of their own and can't create files in a
// regular "My Drive" folder even when shared as Editor (only Workspace
// Shared Drives support that, which a personal Gmail account doesn't have).
// Uploading as the actual account owner uses their normal Drive quota
// instead. The refresh token was minted once, by hand, via Google's OAuth
// Playground — see the repo's release-notify setup notes for that flow.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const GITHUB_TOKEN = requireEnv("GITHUB_TOKEN");
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const GDRIVE_CLIENT_ID = process.env.GDRIVE_CLIENT_ID;
const GDRIVE_CLIENT_SECRET = process.env.GDRIVE_CLIENT_SECRET;
const GDRIVE_REFRESH_TOKEN = process.env.GDRIVE_REFRESH_TOKEN;
const GDRIVE_FOLDER_ID = process.env.GDRIVE_FOLDER_ID;
const GITHUB_EVENT_PATH = requireEnv("GITHUB_EVENT_PATH");
const GITHUB_REPOSITORY = requireEnv("GITHUB_REPOSITORY");
const RELEASE_TAG = process.env.RELEASE_TAG;

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

// Standard OAuth2 refresh-token grant — exchanges the long-lived refresh
// token for a fresh ~1h access token on every run. No JWT signing needed
// (that's the service-account flow this replaced); this is just a plain
// token-endpoint POST.
async function getDriveAccessToken() {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: GDRIVE_CLIENT_ID,
      client_secret: GDRIVE_CLIENT_SECRET,
      refresh_token: GDRIVE_REFRESH_TOKEN,
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Google token refresh failed: ${JSON.stringify(body)}`);
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

// workflow_dispatch (manual retry) has no `release` object in its event
// payload — only the `tag` input we defined in the workflow. Look the
// release up by tag via the API instead, the same way the `published`
// event's payload would already have handed it to us.
async function fetchReleaseByTag(tag) {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}/releases/tags/${encodeURIComponent(tag)}`, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "relay-release-notify",
    },
  });
  if (!res.ok) throw new Error(`Failed to look up release for tag "${tag}": ${res.status} ${await res.text()}`);
  return res.json();
}

async function main() {
  if (!DISCORD_WEBHOOK_URL) warnAndExit("DISCORD_WEBHOOK_URL secret not set — skipping.");
  if (!GDRIVE_CLIENT_ID || !GDRIVE_CLIENT_SECRET || !GDRIVE_REFRESH_TOKEN || !GDRIVE_FOLDER_ID) {
    warnAndExit("GDRIVE_CLIENT_ID/GDRIVE_CLIENT_SECRET/GDRIVE_REFRESH_TOKEN/GDRIVE_FOLDER_ID secret not set — skipping.");
  }

  let release;
  if (RELEASE_TAG) {
    console.log(`Manual run — looking up release for tag "${RELEASE_TAG}"...`);
    release = await fetchReleaseByTag(RELEASE_TAG);
  } else {
    const event = JSON.parse(fs.readFileSync(GITHUB_EVENT_PATH, "utf8"));
    release = event.release;
  }
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
