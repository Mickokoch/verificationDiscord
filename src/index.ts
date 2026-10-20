// Point d'entrée : assemble la configuration, le stockage, les mails et le bot.

import { VerificationBot } from "./bot.js";
import { loadConfig } from "./config.js";
import { Hasher } from "./crypto.js";
import { GmailMailer } from "./mailer.js";
import { SqliteLinkStore } from "./store.js";
import { VerificationService } from "./verification.js";

const config = loadConfig();
const hasher = new Hasher(config.hmacSecret);
const store = new SqliteLinkStore(config.dbPath);
const mailer = new GmailMailer({
  user: config.gmailUser,
  appPassword: config.gmailAppPassword,
  fromName: config.mailFromName,
  codeTtlMinutes: Math.round(config.codeTtlMs / 60_000),
});

// Les erreurs SMTP peuvent contenir l'adresse du destinataire :
// on ne journalise que leur code, jamais leur message.
function logMailError(context: string, error: unknown): void {
  const { code, responseCode } = (error ?? {}) as { code?: unknown; responseCode?: unknown };
  console.error(`${context} (code=${String(code ?? "?")}, smtp=${String(responseCode ?? "?")})`);
}

function purge(): void {
  mailer.purge().catch((error) => logMailError("Échec de la purge IMAP", error));
}

const service = new VerificationService(
  store,
  hasher,
  async (email, code) => {
    try {
      await mailer.sendCode(email, code);
    } catch (error) {
      logMailError("Échec d'envoi d'un code", error);
      throw new Error("mail_failed");
    }
    purge();
  },
  {
    allowedDomains: config.allowedDomains,
    codeTtlMs: config.codeTtlMs,
    codeMaxAttempts: config.codeMaxAttempts,
    resendCooldownMs: config.resendCooldownMs,
    maxMailsPerMemberPerDay: config.maxMailsPerMemberPerDay,
  },
);

try {
  await mailer.verifyConnection();
} catch (error) {
  logMailError("Connexion SMTP à Gmail impossible : vérifie GMAIL_USER et GMAIL_APP_PASSWORD", error);
  process.exit(1);
}

const bot = new VerificationBot(config, service, hasher);
console.log(`Base chargée : ${store.count()} vérification(s) enregistrée(s).`);

purge();
const timers = [setInterval(purge, config.purgeIntervalMs), setInterval(() => service.sweep(), 60_000)];

function shutdown(signal: string): void {
  console.log(`${signal} reçu, arrêt…`);
  timers.forEach(clearInterval);
  void bot.client.destroy().finally(() => {
    store.close();
    process.exit(0);
  });
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

await bot.start();
