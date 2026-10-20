// Stockage persistant : une seule table `HMAC(id Discord) -> HMAC(adresse)`.
// Pas de date, pas de pseudo, pas d'adresse en clair.

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

export class SqliteLinkStore implements LinkStore {
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

  close(): void {
    this.db.close();
  }
}
