// Envoi des codes via Gmail (SMTP) et purge de la boîte via IMAP.
//
// Le compte Gmail doit être réservé au bot : la purge supprime TOUS les messages
// (envoyés, reçus, mails d'erreur, corbeille), car ils contiennent les adresses.

import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";

export interface MailerOptions {
  user: string;
  appPassword: string;
  fromName: string;
  codeTtlMinutes: number;
}

export class GmailMailer {
  private readonly transport;
  private purging: Promise<void> | null = null;
  private purgeAgain = false;

  constructor(private readonly options: MailerOptions) {
    this.transport = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: options.user, pass: options.appPassword },
    });
  }

  async verifyConnection(): Promise<void> {
    await this.transport.verify();
  }

  // Le mail ne mentionne jamais le pseudo Discord du demandeur.
  async sendCode(email: string, code: string): Promise<void> {
    const { fromName, user, codeTtlMinutes } = this.options;
    await this.transport.sendMail({
      from: { name: fromName, address: user },
      to: email,
      subject: `Ton code de vérification : ${code}`,
      text: [
        `Ton code de vérification Discord est : ${code}`,
        "",
        `Il est valable ${codeTtlMinutes} minutes.`,
        "Si tu n'as rien demandé, ignore simplement ce mail.",
      ].join("\n"),
    });
  }

  // Lance une purge ; si une purge tourne déjà, en programme une autre juste après
  // (pour couvrir les mails envoyés pendant la purge en cours).
  purge(): Promise<void> {
    if (this.purging) {
      this.purgeAgain = true;
      return this.purging;
    }
    this.purging = (async () => {
      try {
        do {
          this.purgeAgain = false;
          await this.purgeOnce();
        } while (this.purgeAgain);
      } finally {
        this.purging = null;
      }
    })();
    return this.purging;
  }

  private async purgeOnce(): Promise<void> {
    const client = new ImapFlow({
      host: "imap.gmail.com",
      port: 993,
      secure: true,
      auth: { user: this.options.user, pass: this.options.appPassword },
      logger: false,
    });
    await client.connect();
    try {
      const mailboxes = await client.list();
      const byFlag = (flag: string) => mailboxes.find((box) => box.specialUse === flag)?.path;
      // La corbeille en dernier : sur Gmail, supprimer ailleurs peut y déplacer les messages.
      const targets = ["INBOX", byFlag("\\Sent"), byFlag("\\Junk"), byFlag("\\All"), byFlag("\\Trash")];

      for (const path of targets) {
        if (!path) continue;
        const lock = await client.getMailboxLock(path);
        try {
          if (client.mailbox && client.mailbox.exists > 0) {
            await client.messageDelete("1:*");
          }
        } finally {
          lock.release();
        }
      }
    } finally {
      await client.logout();
    }
  }
}
