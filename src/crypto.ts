// Empreintes HMAC, normalisation des adresses et génération des codes.
// Aucune adresse ni identifiant n'est jamais stocké en clair : seulement leur HMAC.

import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

export class Hasher {
  constructor(private readonly secret: Buffer) {}

  // Préfixes distincts : une même chaîne ne donne pas la même empreinte
  // selon qu'elle est traitée comme une adresse ou comme un identifiant.
  email(normalizedEmail: string): string {
    return this.hmac(`email:${normalizedEmail}`);
  }

  member(discordId: string): string {
    return this.hmac(`member:${discordId}`);
  }

  private hmac(value: string): string {
    return createHmac("sha256", this.secret).update(value, "utf8").digest("hex");
  }
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

// Correspondance exacte sur le domaine : `x@truc.fr` oui, `x@etu.truc.fr` non.
export function isAllowedEmail(normalizedEmail: string, allowedDomain: string): boolean {
  const at = normalizedEmail.lastIndexOf("@");
  if (at <= 0 || normalizedEmail.indexOf("@") !== at) return false;
  const local = normalizedEmail.slice(0, at);
  const domain = normalizedEmail.slice(at + 1);
  return domain === allowedDomain && local.length <= 64 && /^[^\s@<>()\[\],;:"\\]+$/.test(local);
}

export function generateCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function codesMatch(expected: string, given: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(given.trim(), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
