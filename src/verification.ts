// Logique de vérification, indépendante de Discord (testable seule).
//
// L'état temporaire (membre -> empreinte de l'adresse + code) vit uniquement en
// mémoire et disparaît à l'expiration du code. L'adresse en clair n'est gardée
// que le temps d'envoyer le mail.

import { codesMatch, generateCode, isAllowedEmail, normalizeEmail, type Hasher } from "./crypto.js";
import type { LinkStore } from "./store.js";

export type SendCode = (email: string, code: string) => Promise<void>;

export interface VerificationLimits {
  allowedDomain: string;
  codeTtlMs: number;
  codeMaxAttempts: number;
  resendCooldownMs: number;
  maxMailsPerMemberPerDay: number;
}

export type StartResult =
  | { ok: true }
  | { ok: false; reason: "already_verified" | "invalid_email" | "daily_limit" | "mail_failed" }
  | { ok: false; reason: "cooldown"; retryInMs: number };

export type ConfirmResult =
  | { ok: true; previousMemberHash: string | null }
  | { ok: false; reason: "no_pending" | "expired" | "too_many_attempts" }
  | { ok: false; reason: "wrong_code"; attemptsLeft: number };

interface Pending {
  emailHash: string;
  code: string;
  expiresAt: number;
  attemptsLeft: number;
}

interface MailQuota {
  day: string;
  count: number;
  lastSentAt: number;
}

export class VerificationService {
  private readonly pending = new Map<string, Pending>();
  private readonly quotas = new Map<string, MailQuota>();

  constructor(
    private readonly store: LinkStore,
    private readonly hasher: Hasher,
    private readonly sendCode: SendCode,
    private readonly limits: VerificationLimits,
    private readonly now: () => number = Date.now,
  ) {}

  isVerified(memberId: string): boolean {
    return this.store.hasMember(this.hasher.member(memberId));
  }

  async start(memberId: string, rawEmail: string): Promise<StartResult> {
    if (this.isVerified(memberId)) return { ok: false, reason: "already_verified" };

    const email = normalizeEmail(rawEmail);
    if (!isAllowedEmail(email, this.limits.allowedDomain)) return { ok: false, reason: "invalid_email" };

    const now = this.now();
    const day = dayKey(now);
    const previous = this.quotas.get(memberId);
    const quota: MailQuota = previous && previous.day === day ? previous : { day, count: 0, lastSentAt: 0 };

    const retryInMs = quota.lastSentAt + this.limits.resendCooldownMs - now;
    if (retryInMs > 0) return { ok: false, reason: "cooldown", retryInMs };
    if (quota.count >= this.limits.maxMailsPerMemberPerDay) return { ok: false, reason: "daily_limit" };

    // Réservé avant l'envoi pour bloquer les demandes simultanées.
    const reserved: MailQuota = { day, count: quota.count + 1, lastSentAt: now };
    this.quotas.set(memberId, reserved);

    const code = generateCode();
    try {
      await this.sendCode(email, code);
    } catch {
      // Échec de notre côté : on ne pénalise pas le membre.
      this.quotas.set(memberId, quota);
      return { ok: false, reason: "mail_failed" };
    }

    this.pending.set(memberId, {
      emailHash: this.hasher.email(email),
      code,
      expiresAt: now + this.limits.codeTtlMs,
      attemptsLeft: this.limits.codeMaxAttempts,
    });
    return { ok: true };
  }

  confirm(memberId: string, givenCode: string): ConfirmResult {
    const entry = this.pending.get(memberId);
    if (!entry) return { ok: false, reason: "no_pending" };

    if (this.now() >= entry.expiresAt) {
      this.pending.delete(memberId);
      return { ok: false, reason: "expired" };
    }

    if (!codesMatch(entry.code, givenCode)) {
      entry.attemptsLeft -= 1;
      if (entry.attemptsLeft <= 0) {
        this.pending.delete(memberId);
        return { ok: false, reason: "too_many_attempts" };
      }
      return { ok: false, reason: "wrong_code", attemptsLeft: entry.attemptsLeft };
    }

    this.pending.delete(memberId);
    const { previousMemberHash } = this.store.link(this.hasher.member(memberId), entry.emailHash);
    return { ok: true, previousMemberHash };
  }

  // Utilisé par /unlink, /forget et le départ du serveur.
  forget(memberId: string): boolean {
    this.pending.delete(memberId);
    return this.store.deleteMember(this.hasher.member(memberId));
  }

  // Supprime les codes expirés et les quotas des jours passés.
  sweep(): void {
    const now = this.now();
    const today = dayKey(now);
    for (const [id, entry] of this.pending) if (now >= entry.expiresAt) this.pending.delete(id);
    for (const [id, quota] of this.quotas) if (quota.day !== today) this.quotas.delete(id);
  }
}

function dayKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}
