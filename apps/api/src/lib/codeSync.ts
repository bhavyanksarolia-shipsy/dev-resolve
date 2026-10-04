import "server-only";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CODE_ROOT, cfgValue, getAccounts, readConfigEnv } from "./config";

/**
 * Keeps the code the agent reads (CODE_ROOT/<repo>) in sync with GitHub: shallow, read-only, one branch.
 * Settings come from the service's variables or Admin → Connections → Source code (CODE_GIT_BASE, CODE_GIT_BRANCH,
 * GITHUB_TOKEN). The token is sent as a header per request — never written into .git/config or a remote URL.
 */
interface RepoResult { repo: string; ok: boolean; commit?: string; error?: string }
interface SyncResult { at: string; ok: boolean; repos: RepoResult[]; error?: string }
let last: SyncResult | null = null;
let running: Promise<SyncResult> | null = null;

export const codeRepos = () => Array.from(new Set(getAccounts().flatMap((a) => a.code_repos ?? []))).sort();
// Values saved in Admin → Connections → Source code win over the service's variables (Railway), so changing the
// token in the UI actually takes effect even when an older GITHUB_TOKEN variable is still set.
const saved = (k: string) => readConfigEnv()[k] || undefined;
const pick = (k: string) => saved(k) || cfgValue(k);
const base = () => (pick("CODE_GIT_BASE") || "").replace(/\/+$/, "");
const branch = () => pick("CODE_GIT_BRANCH") || "main";
const githubToken = () => pick("GITHUB_TOKEN");
const tokenSource = () => (saved("GITHUB_TOKEN") ? "saved in Admin" : process.env.GITHUB_TOKEN ? "server variable" : null);

function git(args: string[], token?: string): Promise<string> {
  const auth = token ? ["-c", `http.extraHeader=Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`] : [];
  return new Promise((resolve, reject) =>
    execFile("git", [...auth, ...args], { timeout: 10 * 60_000, maxBuffer: 4 << 20, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }, (err, out, errOut) =>
      err ? reject(new Error((errOut || err.message).replace(/Authorization: Basic \S+/g, "Authorization: ***").trim().split("\n").slice(-2).join(" "))) : resolve(out.trim())));
}

/** Ask GitHub's API why a token can't read a repo — far clearer than git's errors. null = looks fine. */
async function tokenProblem(repo: string, token?: string): Promise<string | null> {
  const m = base().match(/^https:\/\/github\.com\/([^/]+)$/i);
  if (!m) return null; // not github.com/<org> — let git report
  const res = await fetch(`https://api.github.com/repos/${m[1]}/${repo}`, {
    headers: { Accept: "application/vnd.github+json", ...(token && { Authorization: `Bearer ${token}` }) },
  }).catch(() => null);
  if (!res || res.ok) return null;
  const sso = res.headers.get("x-github-sso");
  if (res.status === 401) return token ? "GitHub rejected the token (wrong, expired or not fully copied) — paste a fresh one" : "no token set — this repo is private";
  if (res.status === 403 && sso) return "the token isn't authorised for the organisation's SSO — on GitHub: Configure SSO → Authorize";
  if (res.status === 403) return "the token isn't allowed to read this repo yet (fine-grained tokens need the organisation's approval)";
  if (res.status === 404) {
    // Private repos look "not found" to a token that can't reach them — say whose token it is and what it can do.
    const me = token ? await fetch("https://api.github.com/user", { headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}` } }).catch(() => null) : null;
    const login = me?.ok ? ((await me.json()) as { login?: string }).login : undefined;
    const scopes = me?.headers.get("x-oauth-scopes"); // classic tokens only
    const who = login ? `the token belongs to GitHub user "${login}"` : "the token";
    if (scopes != null && !scopes.split(/,\s*/).includes("repo")) return `${who} but lacks the "repo" scope (has: ${scopes || "none"}) — tick "repo" when creating the classic token`;
    if (scopes != null) return `${who} (scope repo ✓) but can't see ${m[1]}/${repo} — is "${login}" a member with access to it? If yes: Configure SSO → Authorize for ${m[1]}`;
    return `${who} can't see ${m[1]}/${repo} — for a fine-grained token: Resource owner = ${m[1]}, Contents: Read on this repo, and org approval`;
  }
  return `GitHub answered ${res.status}`;
}

async function syncOne(repo: string, token?: string): Promise<RepoResult> {
  const dir = path.join(CODE_ROOT, repo);
  const problem = await tokenProblem(repo, token);
  if (problem) return { repo, ok: false, error: problem };
  try {
    if (existsSync(path.join(dir, ".git"))) {
      await git(["-C", dir, "fetch", "--quiet", "--depth", "1", "origin", branch()], token);
      await git(["-C", dir, "reset", "--quiet", "--hard", "FETCH_HEAD"]);
    } else {
      await git(["clone", "--quiet", "--depth", "1", "--single-branch", "--branch", branch(), `${base()}/${repo}.git`, dir], token);
    }
    return { repo, ok: true, commit: await git(["-C", dir, "log", "-1", "--format=%h · %cd", "--date=short"]) };
  } catch (e) {
    const m = (e as Error).message;
    // GitHub says "Write access … not granted" / 403 even for a read when the token can't see the repo.
    const error = /403|access to repository not granted|Authentication failed|could not read Username/i.test(m)
      ? "the token can't read this repo (give it Contents: Read on it, and approve it for the organisation / authorise SSO)"
      : /not found|404/i.test(m) ? "repo or branch not found — check the GitHub address and branch"
      : m;
    return { repo, ok: false, error };
  }
}

export function syncCode(): Promise<SyncResult> {
  if (running) return running;
  running = (async (): Promise<SyncResult> => {
    if (!base()) {
      last = { at: new Date().toISOString(), ok: false, repos: [], error: "Source code isn't set up — add the GitHub address in Admin → Connections → Source code" };
      return last;
    }
    mkdirSync(CODE_ROOT, { recursive: true });
    const token = githubToken();
    const repos: RepoResult[] = [];
    for (const r of codeRepos()) repos.push(await syncOne(r, token));
    last = { at: new Date().toISOString(), ok: repos.every((r) => r.ok), repos };
    try { writeFileSync(path.join(CODE_ROOT, ".last-sync"), last.at + "\n"); } catch {}
    for (const r of repos) console.log(`[code] ${r.ok ? `synced ${r.repo} → ${r.commit}` : `FAILED ${r.repo}: ${r.error}`}`);
    return last;
  })().finally(() => { running = null; });
  return running;
}

/** For code_search: if a repo is missing on this server, try one sync (at most every 5 minutes) before giving up. */
let lastAttempt = 0;
export async function ensureRepos(repos: string[]) {
  if (repos.every((r) => existsSync(path.join(CODE_ROOT, r))) || !base() || Date.now() - lastAttempt < 5 * 60_000) return;
  lastAttempt = Date.now();
  await syncCode();
}

export function codeStatus() {
  return {
    base: base(), branch: branch(), tokenSet: !!githubToken(), tokenSource: tokenSource(), root: CODE_ROOT, syncing: !!running, last,
    repos: codeRepos().map((r) => ({ repo: r, present: existsSync(path.join(CODE_ROOT, r, ".git")) || existsSync(path.join(CODE_ROOT, r)) })),
  };
}

/** Server start: sync now, then every CODE_SYNC_SECONDS (default 30 min). Local dev (no CODE_GIT_BASE) does nothing. */
export function startCodeSync() {
  if (!base()) return console.log("[code] CODE_GIT_BASE not set — set it in Admin → Connections → Source code");
  void syncCode();
  setInterval(() => void syncCode(), Number(cfgValue("CODE_SYNC_SECONDS") || 1800) * 1000).unref();
}

let orgRepoCache: { at: number; key: string; repos: string[] } | null = null;
/** Repos the saved token can read in the configured org (for the client "Code the agent reads" picker). Cached 10 min. */
export async function availableRepos(): Promise<string[]> {
  const m = base().match(/^https:\/\/github\.com\/([^/]+)$/i);
  const token = githubToken();
  if (!m || !token) return localRepos(); // local setup: the checkouts already in CODE_ROOT
  const key = `${m[1]}|${token.slice(-6)}`;
  if (orgRepoCache && orgRepoCache.key === key && Date.now() - orgRepoCache.at < 10 * 60 * 1000) return orgRepoCache.repos;
  const repos: string[] = [];
  for (let page = 1; page <= 20; page++) {
    const r = await fetch(`https://api.github.com/orgs/${m[1]}/repos?per_page=100&type=all&sort=full_name&page=${page}`,
      { headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}` } }).catch(() => null);
    if (!r?.ok) break;
    const batch = (await r.json()) as { name: string; archived?: boolean }[];
    repos.push(...batch.filter((x) => !x.archived).map((x) => x.name));
    if (batch.length < 100) break;
  }
  orgRepoCache = { at: Date.now(), key, repos };
  return repos;
}

/** Git checkouts directly under CODE_ROOT (local machine without GitHub sync). */
function localRepos(): string[] {
  try {
    return readdirSync(CODE_ROOT, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith(".") && existsSync(path.join(CODE_ROOT, d.name, ".git")))
      .map((d) => d.name).sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}
