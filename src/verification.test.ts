import assert from "node:assert/strict";
import { test } from "node:test";
import { Hasher, isAllowedEmail, normalizeEmail } from "./crypto.js";
import { SqliteLinkStore } from "./store.js";
import { VerificationService, type VerificationLimits } from "./verification.js";

const limits: VerificationLimits = {
  allowedDomain: "truc.fr",
  codeTtlMs: 10 * 60_000,
  codeMaxAttempts: 5,
  resendCooldownMs: 60_000,
  maxMailsPerMemberPerDay: 5,
};

function setup(overrides: Partial<VerificationLimits> = {}) {
  let now = Date.parse("2026-10-20T12:00:00Z");
  const sent: { email: string; code: string }[] = [];
  let failNextSend = false;
  const store = new SqliteLinkStore(":memory:");
  const hasher = new Hasher(Buffer.alloc(32, 7));
  const service = new VerificationService(
    store,
    hasher,
    async (email, code) => {
      if (failNextSend) {
        failNextSend = false;
        throw new Error("smtp down");
      }
      sent.push({ email, code });
    },
    { ...limits, ...overrides },
    () => now,
  );
  return {
    service,
    store,
    sent,
    lastCode: () => sent.at(-1)!.code,
    advance: (ms: number) => (now += ms),
    failNextSend: () => (failNextSend = true),
  };
}

async function verify(t: ReturnType<typeof setup>, memberId: string, email: string) {
  assert.deepEqual(await t.service.start(memberId, email), { ok: true });
  return t.service.confirm(memberId, t.lastCode());
}

test("normalisation et domaine : correspondance exacte, minuscules", () => {
  assert.equal(normalizeEmail("  Jean.Dupont@TRUC.fr "), "jean.dupont@truc.fr");
  assert.ok(isAllowedEmail("jean.dupont@truc.fr", "truc.fr"));
  assert.ok(!isAllowedEmail("jean@etu.truc.fr", "truc.fr"));
  assert.ok(!isAllowedEmail("jean@truc.fr.evil.com", "truc.fr"));
  assert.ok(!isAllowedEmail("@truc.fr", "truc.fr"));
  assert.ok(!isAllowedEmail("a@b@truc.fr", "truc.fr"));
  assert.ok(!isAllowedEmail("jean dupont@truc.fr", "truc.fr"));
});

test("parcours nominal : code envoyé à l'adresse normalisée, puis membre vérifié", async () => {
  const t = setup();
  assert.deepEqual(await verify(t, "111", "Jean.Dupont@truc.fr"), { ok: true, previousMemberHash: null });
  assert.equal(t.sent[0]!.email, "jean.dupont@truc.fr");
  assert.match(t.sent[0]!.code, /^\d{6}$/);
  assert.ok(t.service.isVerified("111"));
});

test("la base ne contient aucune donnée en clair", async () => {
  const t = setup();
  await verify(t, "111", "jean.dupont@truc.fr");
  const rows = (t.store as unknown as { db: { prepare(s: string): { all(): object[] } } }).db
    .prepare("SELECT * FROM links")
    .all();
  const dump = JSON.stringify(rows);
  assert.ok(!dump.includes("jean"));
  assert.ok(!dump.includes("111"));
});

test("domaine refusé : aucun mail envoyé", async () => {
  const t = setup();
  assert.deepEqual(await t.service.start("111", "jean@gmail.com"), { ok: false, reason: "invalid_email" });
  assert.equal(t.sent.length, 0);
});

test("déjà vérifié : /verify refusé", async () => {
  const t = setup();
  await verify(t, "111", "jean@truc.fr");
  assert.deepEqual(await t.service.start("111", "autre@truc.fr"), { ok: false, reason: "already_verified" });
});

test("délai entre deux envois et limite quotidienne", async () => {
  const t = setup({ maxMailsPerMemberPerDay: 2 });
  await t.service.start("111", "jean@truc.fr");
  const second = await t.service.start("111", "jean@truc.fr");
  assert.equal(second.ok, false);
  assert.equal(!second.ok && second.reason, "cooldown");

  t.advance(60_000);
  assert.deepEqual(await t.service.start("111", "jean@truc.fr"), { ok: true });
  t.advance(60_000);
  assert.deepEqual(await t.service.start("111", "jean@truc.fr"), { ok: false, reason: "daily_limit" });

  t.advance(24 * 3600_000);
  assert.deepEqual(await t.service.start("111", "jean@truc.fr"), { ok: true });
});

test("échec d'envoi : le quota n'est pas consommé", async () => {
  const t = setup();
  t.failNextSend();
  assert.deepEqual(await t.service.start("111", "jean@truc.fr"), { ok: false, reason: "mail_failed" });
  assert.deepEqual(await t.service.start("111", "jean@truc.fr"), { ok: true });
});

test("mauvais code : essais décomptés puis code invalidé", async () => {
  const t = setup({ codeMaxAttempts: 2 });
  await t.service.start("111", "jean@truc.fr");
  const wrong = t.lastCode() === "000000" ? "000001" : "000000";
  assert.deepEqual(t.service.confirm("111", wrong), { ok: false, reason: "wrong_code", attemptsLeft: 1 });
  assert.deepEqual(t.service.confirm("111", wrong), { ok: false, reason: "too_many_attempts" });
  assert.deepEqual(t.service.confirm("111", t.lastCode()), { ok: false, reason: "no_pending" });
});

test("code expiré", async () => {
  const t = setup();
  await t.service.start("111", "jean@truc.fr");
  t.advance(10 * 60_000);
  assert.deepEqual(t.service.confirm("111", t.lastCode()), { ok: false, reason: "expired" });
});

test("le code est lié au membre qui l'a demandé", async () => {
  const t = setup();
  await t.service.start("111", "jean@truc.fr");
  assert.deepEqual(t.service.confirm("222", t.lastCode()), { ok: false, reason: "no_pending" });
});

test("même adresse sur un nouveau compte : transfert, l'ancien compte est renvoyé", async () => {
  const t = setup();
  await verify(t, "111", "jean@truc.fr");
  const result = await verify(t, "222", "JEAN@truc.fr");
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.previousMemberHash, new Hasher(Buffer.alloc(32, 7)).member("111"));
  assert.ok(!t.service.isVerified("111"));
  assert.ok(t.service.isVerified("222"));
  assert.equal(t.store.count(), 1);
});

test("départ, /unlink ou /forget : l'adresse est libérée et réutilisable sans transfert", async () => {
  const t = setup();
  await verify(t, "111", "jean@truc.fr");
  assert.ok(t.service.forget("111"));
  assert.ok(!t.service.forget("111"));
  assert.equal(t.store.count(), 0);

  t.advance(60_000);
  assert.deepEqual(await verify(t, "111", "jean@truc.fr"), { ok: true, previousMemberHash: null });
});
