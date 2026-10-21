// Lecture et validation de la configuration (variables d'environnement).
// Le bot refuse de démarrer si une valeur obligatoire manque ou est invalide.

function defaultMailFooter(contact: string): string {
  return [
    "Ce mail vous a été envoyé par le bot de vérification du serveur Discord « étudiant·es de SU Sciences », " +
      "géré par des étudiant·es et non affilié à Sorbonne Université.",
    "Seule une empreinte cryptographique de votre adresse est enregistrée, afin qu'une même adresse ne puisse " +
      "vérifier qu'un seul compte ; votre adresse elle-même n'est pas stockée. Vous pouvez supprimer votre " +
      `vérification à tout moment avec la commande /unlink sur le serveur. Contact : ${contact}`,
  ].join("\n");
}

export interface Config {
  discordToken: string;
  guildId: string;
  verifiedRoleId: string;
  logChannelId: string | null;
  logRetentionMs: number;
  allowedDomains: string[];
  hmacSecret: Buffer;
  gmailUser: string;
  gmailAppPassword: string;
  mailFromName: string;
  mailFooter: string;
  dbPath: string;
  codeTtlMs: number;
  codeMaxAttempts: number;
  resendCooldownMs: number;
  maxMailsPerMemberPerDay: number;
  purgeIntervalMs: number;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Variable d'environnement manquante : ${name}`);
  return value;
}

function optional(env: NodeJS.ProcessEnv, name: string): string | null {
  const value = env[name]?.trim();
  return value ? value : null;
}

function positiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = optional(env, name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} doit être un entier strictement positif (reçu : ${raw})`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const hmacSecret = Buffer.from(required(env, "HMAC_SECRET"), "hex");
  if (hmacSecret.length < 32) {
    throw new Error("HMAC_SECRET doit faire au moins 32 octets en hexadécimal (64 caractères). Générer avec : openssl rand -hex 32");
  }

  // Liste séparée par des virgules. ALLOWED_DOMAIN (singulier) reste accepté.
  const rawDomains = optional(env, "ALLOWED_DOMAINS") ?? required(env, "ALLOWED_DOMAIN");
  const allowedDomains = [
    ...new Set(
      rawDomains
        .split(",")
        .map((domain) => domain.trim().toLowerCase().replace(/^@/, ""))
        .filter(Boolean),
    ),
  ];
  if (allowedDomains.length === 0) throw new Error("ALLOWED_DOMAINS ne contient aucun domaine");

  const gmailUser = required(env, "GMAIL_USER");

  return {
    discordToken: required(env, "DISCORD_TOKEN"),
    guildId: required(env, "GUILD_ID"),
    verifiedRoleId: required(env, "VERIFIED_ROLE_ID"),
    logChannelId: optional(env, "LOG_CHANNEL_ID"),
    logRetentionMs: positiveInt(env, "LOG_RETENTION_DAYS", 30) * 24 * 3600_000,
    allowedDomains,
    hmacSecret,
    gmailUser,
    gmailAppPassword: required(env, "GMAIL_APP_PASSWORD").replace(/\s+/g, ""),
    mailFromName: optional(env, "MAIL_FROM_NAME") ?? "Vérification Discord",
    // Pied de mail ; `\n` dans la variable = retour à la ligne.
    mailFooter: (optional(env, "MAIL_FOOTER") ?? defaultMailFooter(gmailUser)).replaceAll("\\n", "\n"),
    dbPath: optional(env, "DB_PATH") ?? "./data/verification.sqlite",
    codeTtlMs: positiveInt(env, "CODE_TTL_MINUTES", 10) * 60_000,
    codeMaxAttempts: positiveInt(env, "CODE_MAX_ATTEMPTS", 5),
    resendCooldownMs: positiveInt(env, "RESEND_COOLDOWN_SECONDS", 60) * 1000,
    maxMailsPerMemberPerDay: positiveInt(env, "MAX_MAILS_PER_MEMBER_PER_DAY", 5),
    purgeIntervalMs: positiveInt(env, "PURGE_INTERVAL_MINUTES", 60) * 60_000,
  };
}
