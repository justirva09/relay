#!/usr/bin/env node
// Runs after a GitHub Release is published. Relay's public now so a release
// asset's browser_download_url just works, no re-hosting needed.
import fs from "node:fs";

const GITHUB_TOKEN = requireEnv("GITHUB_TOKEN");
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
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

// one installer per platform, tauri-action also uploads .sig/.tar.gz files we don't want here
const ASSET_PICKS = [
  ["macOS (.dmg)", (n) => n.endsWith(".dmg")],
  ["Windows (.msi)", (n) => n.endsWith(".msi")],
  ["Linux (.AppImage)", (n) => n.endsWith(".appimage")],
  ["Linux (.deb)", (n) => n.endsWith(".deb")],
];

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

// manual retry has no release object in the event payload, just the tag input, so look it up
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

  const links = picked.map(([label, asset]) => [label, asset.browser_download_url]);

  console.log("Posting to Discord...");
  await postToDiscord(release, links);
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
