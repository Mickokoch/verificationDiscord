// Stockage persistant : la table `links` (`HMAC(id Discord) -> HMAC(adresse)`, sans date,
// sans pseudo, sans adresse en clair) et quelques réglages du bot (`settings`).

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface LinkStore {
  memberHashForEmail(emailHash: string): string | null;
  hasMember(memberHash: string): boolean;
  // Lie l'adresse au membre. Si l'adresse était liée à un autre membre,
  // ce lien est supprimé et l'empreinte de l'ancien membre est renvoyée.
  link(memberHash: string, emailHash: string): { previousMemberHash: string | null };
  deleteMember(memberHash: string): boolean;
  count(): number;
}

// Réglages internes du bot (ex. : emplacement du message de choix des rôles).
export interface SettingsStore {
  getSetting(key: string): string | null;
  setSetting(key: string, value: string): void;
}

export class SqliteLinkStore implements LinkStore, SettingsStore {
  private readonly db: Database.Database;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS links (
        member_hash TEXT PRIMARY KEY,
        email_hash  TEXT NOT NULL UNIQUE
      ) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) WITHOUT ROWID;
    `);
  }

  memberHashForEmail(emailHash: string): string | null {
    const row = this.db.prepare("SELECT member_hash FROM links WHERE email_hash = ?").get(emailHash) as
      | { member_hash: string }
      | undefined;
    return row?.member_hash ?? null;
  }

  hasMember(memberHash: string): boolean {
    return this.db.prepare("SELECT 1 FROM links WHERE member_hash = ?").get(memberHash) !== undefined;
  }

  link(memberHash: string, emailHash: string): { previousMemberHash: string | null } {
    return this.db.transaction(() => {
      const previous = this.memberHashForEmail(emailHash);
      this.db.prepare("DELETE FROM links WHERE email_hash = ? OR member_hash = ?").run(emailHash, memberHash);
      this.db.prepare("INSERT INTO links (member_hash, email_hash) VALUES (?, ?)").run(memberHash, emailHash);
      return { previousMemberHash: previous !== null && previous !== memberHash ? previous : null };
    })();
  }

  deleteMember(memberHash: string): boolean {
    return this.db.prepare("DELETE FROM links WHERE member_hash = ?").run(memberHash).changes > 0;
  }

  count(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM links").get() as { n: number }).n;
  }

  getSetting(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setSetting(key: string, value: string): void {
    this.db
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, value);
  }

  close(): void {
    this.db.close();
  }
}
