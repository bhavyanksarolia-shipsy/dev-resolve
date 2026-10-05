import "server-only";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Account, loadProjectsFile, ROOT } from "./config";
import { saveProjectsFile } from "./adminConfig";
import { savePrivate } from "./privateStore";

/**
 * Agent skills: playbooks an admin uploads as a SKILL.md (frontmatter `name` + `description`, then markdown).
 * Stored in .claude/skills/<name>/SKILL.md and saved to Postgres with the other private files (never in git), so
 * they survive redeploys. Each skill is used for the clients it's assigned to (account.skills) or for every client
 * (projects.json "all_client_skills"). The agent sees the name + description and opens the full text with
 * read_skill when the ticket matches — like Claude's own skills.
 */
export const SKILLS_DIR = path.join(ROOT, ".claude/skills");
/** Helpers that ship with the code (used by a tool, not given to the agent as a skill). */
const BUILT_IN = new Set(["metabase-sql"]);
const MAX_BYTES = 200 * 1024;
export const SKILL_NAME = /^[a-z0-9][a-z0-9-]{1,63}$/;

export interface SkillMeta { name: string; description: string; bytes: number; updatedAt: string; builtIn: boolean }

/** `---\nname: x\ndescription: y\n---\nbody` → fields + body. Values may be quoted; only single-line values. */
export function parseSkill(md: string) {
  const m = md.replace(/^﻿/, "").match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return null;
  const fields: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
    if (kv) fields[kv[1].toLowerCase()] = kv[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return { name: fields.name ?? "", description: fields.description ?? "", body: m[2] };
}

const fileOf = (name: string) => path.join(SKILLS_DIR, name, "SKILL.md");

export function listSkills(): SkillMeta[] {
  if (!existsSync(SKILLS_DIR)) return [];
  return readdirSync(SKILLS_DIR)
    .filter((n) => SKILL_NAME.test(n) && existsSync(fileOf(n)))
    .map((n) => {
      const st = statSync(fileOf(n));
      const p = parseSkill(readFileSync(fileOf(n), "utf8"));
      return { name: n, description: p?.description || "(no description)", bytes: st.size, updatedAt: st.mtime.toISOString(), builtIn: BUILT_IN.has(n) };
    })
    .sort((a, b) => Number(a.builtIn) - Number(b.builtIn) || a.name.localeCompare(b.name));
}

export function readSkill(name: string): string | null {
  return SKILL_NAME.test(name) && existsSync(fileOf(name)) ? readFileSync(fileOf(name), "utf8") : null;
}

const allClientSkills = (file = loadProjectsFile()) => ((file.all_client_skills as string[] | undefined) ?? []).filter((n) => typeof n === "string");

/** Who uses each skill: every client, or these client slugs. */
export function skillAssignments() {
  const file = loadProjectsFile();
  const all = new Set(allClientSkills(file));
  const by = new Map<string, string[]>();
  for (const a of file.accounts) for (const s of a.skills ?? []) by.set(s, [...(by.get(s) ?? []), a.slug]);
  return (name: string) => ({ all: all.has(name), clients: by.get(name) ?? [] });
}

/** The skills the agent may use for these accounts (assigned to any of them, or to all clients), that exist. */
export function skillsFor(accounts: Account[]): SkillMeta[] {
  const names = new Set([...allClientSkills(), ...accounts.flatMap((a) => a.skills ?? [])]);
  return listSkills().filter((s) => !s.builtIn && names.has(s.name));
}

export async function saveSkill(markdown: string, by: string, expectName?: string) {
  if (Buffer.byteLength(markdown) > MAX_BYTES) throw new Error("A skill can be up to 200 KB");
  const p = parseSkill(markdown);
  if (!p) throw new Error("The file must start with a --- block holding name: and description: (SKILL.md format)");
  const name = p.name.trim().toLowerCase();
  if (!SKILL_NAME.test(name)) throw new Error('name: must be 2–64 characters of a-z, 0-9 and "-" (e.g. ffo-miss-analysis)');
  if (BUILT_IN.has(name)) throw new Error(`"${name}" is built in and can't be replaced`);
  if (expectName && expectName !== name) throw new Error(`This file's name: is "${name}", not "${expectName}" — change it in the file, or upload it as a new skill`);
  if (p.description.length < 20) throw new Error("description: is what tells the agent when to use the skill — write a sentence or two");
  if (!p.body.trim()) throw new Error("The skill has no instructions after the --- block");
  const existed = existsSync(fileOf(name));
  mkdirSync(path.dirname(fileOf(name)), { recursive: true });
  writeFileSync(fileOf(name), markdown.replace(/\r\n/g, "\n"), { mode: 0o644 });
  await savePrivate(fileOf(name), by);
  return { name, existed };
}

export async function assignSkill(name: string, all: boolean, clients: string[], by: string) {
  if (!readSkill(name) || BUILT_IN.has(name)) throw new Error("Unknown skill");
  const file = loadProjectsFile();
  const want = new Set(clients);
  for (const a of file.accounts) {
    const has = (a.skills ?? []).includes(name);
    if (want.has(a.slug) && !has) a.skills = [...(a.skills ?? []), name];
    if (!want.has(a.slug) && has) a.skills = (a.skills ?? []).filter((s) => s !== name);
    if (a.skills && !a.skills.length) delete a.skills;
  }
  const rest = allClientSkills(file).filter((s) => s !== name);
  file.all_client_skills = all ? [...rest, name] : rest;
  await saveProjectsFile(file, by);
}

export async function deleteSkill(name: string, by: string) {
  if (!readSkill(name) || BUILT_IN.has(name)) throw new Error("Unknown skill");
  await assignSkill(name, false, [], by);
  rmSync(path.join(SKILLS_DIR, name), { recursive: true, force: true });
  await savePrivate(fileOf(name), by); // file gone → removed from the database too
}
