import { randomBytes, scrypt as _scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(_scrypt) as (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;
const N = 2 ** 15, R = 8, P = 1, LEN = 32;

/** scrypt$N$r$p$salt$hash (base64url) — memory-hard, no native deps. */
export async function hashPassword(pw: string) {
  const salt = randomBytes(16);
  const h = await scrypt(pw, salt, LEN, { N, r: R, p: P, maxmem: 128 * N * R * 2 });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64url")}$${h.toString("base64url")}`;
}

export async function verifyPassword(pw: string, stored: string) {
  const [alg, n, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !salt || !hash) return false;
  const want = Buffer.from(hash, "base64url");
  const got = await scrypt(pw, Buffer.from(salt, "base64url"), want.length, { N: +n, r: +r, p: +p, maxmem: 128 * +n * +r * 2 });
  return got.length === want.length && timingSafeEqual(got, want);
}

export function passwordProblem(pw: string, name?: string): string | null {
  if (pw.length < 12) return "Use at least 12 characters.";
  if (name && pw.toLowerCase().includes(name.toLowerCase())) return "Don't include the user name in the password.";
  if (/^(.)\1+$/.test(pw) || ["password1234", "123456789012", "qwertyuiop12"].includes(pw.toLowerCase())) return "That password is too easy to guess.";
  return null;
}
