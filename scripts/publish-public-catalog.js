const fs = require("node:fs");
const path = require("node:path");
const { sanitizeVirtualCache, sanitizeSmmServices } = require("../src/services/publicCatalog");

const BRANCH = "provider-catalog";
const FILES = ["virtual-number-cache.json", "smm-services.json", "status.json"];

function loadPublicFiles(outputDir, secrets = []) {
  if (!fs.existsSync(path.join(outputDir, "status.json"))) return [];
  const read = (name) => JSON.parse(fs.readFileSync(path.join(outputDir, name), "utf8"));
  const status = read("status.json");
  const providers = {};
  let refreshed = 0;
  for (const name of ["HeroSMS", "Grizzly", "SMM"]) {
    const entry = status.providers?.[name];
    const count = Number(entry?.refreshedServices);
    if (!Number.isSafeInteger(count) || count < 0 || !["updated", "unavailable", "missing_configuration"].includes(entry?.status)) continue;
    providers[name] = { status: entry.status, refreshedServices: count };
    if (entry.status === "updated") refreshed += count;
  }
  if (!refreshed) return [];
  const virtual = sanitizeVirtualCache(read(FILES[0]), { secrets });
  const rawSmm = read(FILES[1]);
  const smm = { at: Number(rawSmm.at) || 0, services: sanitizeSmmServices(rawSmm, { secrets }) };
  const payloads = [virtual, smm, { checkedAt: Number(status.checkedAt) || 0, providers }];
  return FILES.map((name, index) => ({ path: `catalog/${name}`, mode: "100644", type: "blob", content: `${JSON.stringify(payloads[index], null, 2)}\n` }));
}

async function publishCatalog({ repository, token, outputDir, secrets = [], fetchImpl = fetch } = {}) {
  const tree = loadPublicFiles(outputDir, [token, ...secrets].filter(Boolean));
  if (!tree.length) return { published: false };
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(repository)) || !token) throw new Error("Missing GitHub publishing configuration");
  const baseUrl = `https://api.github.com/repos/${repository}`;
  async function api(endpoint, { method = "GET", body, optional = false } = {}) {
    const response = await fetchImpl(`${baseUrl}${endpoint}`, {
      method, signal: AbortSignal.timeout(15000), redirect: "error",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (optional && response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub catalog API failed (HTTP ${response.status})`);
    return response.json();
  }
  const ref = await api(`/git/ref/heads/${BRANCH}`, { optional: true });
  // The tree deliberately contains ONLY whitelisted catalog files. New branches
  // are orphan branches, and publishing never copies the application's data.
  const newTree = await api("/git/trees", { method: "POST", body: { tree } });
  const commit = await api("/git/commits", { method: "POST", body: {
    message: "chore(catalog): refresh public provider services and prices",
    tree: newTree.sha,
    ...(ref ? { parents: [ref.object.sha] } : {}),
  } });
  if (ref) await api(`/git/refs/heads/${BRANCH}`, { method: "PATCH", body: { sha: commit.sha, force: false } });
  else await api("/git/refs", { method: "POST", body: { ref: `refs/heads/${BRANCH}`, sha: commit.sha } });
  return { published: true, sha: commit.sha };
}

if (require.main === module) publishCatalog({
  repository: process.env.GITHUB_REPOSITORY,
  token: process.env.GITHUB_TOKEN,
  outputDir: path.resolve(process.env.CATALOG_OUTPUT_DIR || "catalog-output"),
  secrets: [process.env.HERO_SMS_API_KEY, process.env.HERO_API_KEY, process.env.GRIZZLY_API_KEY, process.env.SMM_API_KEY].filter(Boolean),
}).then((result) => console.log(result.published ? "Published sanitized provider catalog." : "No successful updates; catalog unchanged.")).catch((error) => {
  console.error(error.message.startsWith("GitHub catalog API failed") ? error.message : "Catalog publishing failed; existing branch retained.");
  process.exitCode = 1;
});

module.exports = { loadPublicFiles, publishCatalog };
