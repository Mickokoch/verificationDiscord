// Partie Discord : commandes, formulaires (modals), boutons et événements.

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  Client,
  Events,
  GatewayIntentBits,
  InteractionContextType,
  MessageFlags,
  ModalBuilder,
  Partials,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type Guild,
  type GuildMember,
  type Interaction,
  type ModalSubmitInteraction,
  type PartialGuildMember,
} from "discord.js";
import type { Config } from "./config.js";
import type { Hasher } from "./crypto.js";
import type { VerificationService } from "./verification.js";

const ID = {
  emailModal: "verify:email-modal",
  emailInput: "verify:email",
  codeButton: "verify:code-button",
  codeModal: "verify:code-modal",
  codeInput: "verify:code",
  unlinkConfirm: "unlink:confirm",
} as const;

const commands = [
  new SlashCommandBuilder()
    .setName("verify")
    .setDescription("Vérifier ton adresse étudiante pour obtenir le rôle")
    .setContexts(InteractionContextType.Guild),
  new SlashCommandBuilder()
    .setName("unlink")
    .setDescription("Supprimer ta vérification (ton rôle et tes données)")
    .setContexts(InteractionContextType.Guild),
  new SlashCommandBuilder()
    .setName("forget")
    .setDescription("[Admin] Supprimer la vérification d'un membre et libérer son adresse")
    .addUserOption((option) => option.setName("membre").setDescription("Le compte à dé-vérifier").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setContexts(InteractionContextType.Guild),
].map((command) => command.toJSON());

export class VerificationBot {
  // Partials.GuildMember : reçoit aussi les départs de membres absents du cache.
  readonly client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
    partials: [Partials.GuildMember],
  });

  constructor(
    private readonly config: Config,
    private readonly service: VerificationService,
    private readonly hasher: Hasher,
  ) {
    this.client.once(Events.ClientReady, () => void this.onReady().catch((error) => this.fatal(error)));
    this.client.on(Events.InteractionCreate, (interaction) => void this.onInteraction(interaction));
    this.client.on(Events.GuildMemberRemove, (member) => void this.onMemberRemove(member));
  }

  start(): Promise<string> {
    return this.client.login(this.config.discordToken);
  }

  // --- Démarrage ---------------------------------------------------------

  private async onReady(): Promise<void> {
    const guild = await this.guild();
    await guild.commands.set(commands);

    const role = await guild.roles.fetch(this.config.verifiedRoleId);
    if (!role) throw new Error(`Rôle ${this.config.verifiedRoleId} introuvable sur le serveur`);
    const me = await guild.members.fetchMe();
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      console.warn("⚠️  Le bot n'a pas la permission « Gérer les rôles ».");
    }
    if (me.roles.highest.comparePositionTo(role) <= 0) {
      console.warn(`⚠️  Le rôle du bot doit être placé AU-DESSUS du rôle « ${role.name} » dans les paramètres du serveur.`);
    }

    console.log(`Connecté en tant que ${this.client.user?.tag} sur « ${guild.name} ».`);
  }

  private fatal(error: unknown): void {
    console.error("Erreur au démarrage :", error);
    process.exit(1);
  }

  private guild(): Promise<Guild> {
    return this.client.guilds.fetch(this.config.guildId);
  }

  // --- Routage -----------------------------------------------------------

  private async onInteraction(interaction: Interaction): Promise<void> {
    if (interaction.guildId !== this.config.guildId) return;
    try {
      if (interaction.isChatInputCommand()) {
        if (interaction.commandName === "verify") return await this.onVerifyCommand(interaction);
        if (interaction.commandName === "unlink") return await this.onUnlinkCommand(interaction);
        if (interaction.commandName === "forget") return await this.onForgetCommand(interaction);
      } else if (interaction.isModalSubmit()) {
        if (interaction.customId === ID.emailModal) return await this.onEmailSubmitted(interaction);
        if (interaction.customId === ID.codeModal) return await this.onCodeSubmitted(interaction);
      } else if (interaction.isButton()) {
        if (interaction.customId === ID.codeButton) return await this.onCodeButton(interaction);
        if (interaction.customId === ID.unlinkConfirm) return await this.onUnlinkConfirm(interaction);
      }
    } catch (error) {
      console.error(`Erreur pendant l'interaction ${describe(interaction)} :`, error);
      await this.replyError(interaction);
    }
  }

  // --- /verify -----------------------------------------------------------

  private async onVerifyCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (this.service.isVerified(interaction.user.id)) {
      // Rôle retiré à la main ou attribution ratée : on le remet.
      await this.addRole(interaction.user.id);
      await interaction.reply({ content: "✅ Tu es déjà vérifié.", flags: MessageFlags.Ephemeral });
      return;
    }

    const input = new TextInputBuilder()
      .setCustomId(ID.emailInput)
      .setLabel("Adresse étudiante")
      .setPlaceholder(`prenom.nom@${this.config.allowedDomains[0]}`)
      .setStyle(TextInputStyle.Short)
      .setMaxLength(254)
      .setRequired(true);

    await interaction.showModal(
      new ModalBuilder()
        .setCustomId(ID.emailModal)
        .setTitle("Vérification étudiante")
        .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input)),
    );
  }

  private async onEmailSubmitted(interaction: ModalSubmitInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await this.service.start(interaction.user.id, interaction.fields.getTextInputValue(ID.emailInput));

    if (!result.ok) {
      const messages = {
        already_verified: "✅ Tu es déjà vérifié.",
        invalid_email: `❌ Adresse invalide : elle doit se terminer par ${this.config.allowedDomains.map((domain) => `**@${domain}**`).join(" ou ")}.`,
        daily_limit: "⏳ Tu as atteint le nombre maximum de codes pour aujourd'hui. Réessaie demain.",
        mail_failed: "❌ Le mail n'a pas pu être envoyé. Réessaie dans quelques minutes, ou préviens un modérateur.",
        cooldown: `⏳ Attends encore ${Math.ceil((result.reason === "cooldown" ? result.retryInMs : 0) / 1000)} s avant de redemander un code.`,
      } satisfies Record<typeof result.reason, string>;
      await interaction.editReply(messages[result.reason]);
      if (result.reason === "mail_failed") await this.log(`⚠️ Échec d'envoi d'un code pour <@${interaction.user.id}>.`);
      return;
    }

    const minutes = Math.round(this.config.codeTtlMs / 60_000);
    await interaction.editReply({
      content:
        `📧 Un code à 6 chiffres vient d'être envoyé à ton adresse. Il est valable ${minutes} minutes.\n` +
        "Pense à regarder dans tes spams. Clique ensuite sur le bouton ci-dessous.",
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(ID.codeButton).setLabel("Entrer le code").setStyle(ButtonStyle.Primary),
        ),
      ],
    });
  }

  private async onCodeButton(interaction: ButtonInteraction): Promise<void> {
    const input = new TextInputBuilder()
      .setCustomId(ID.codeInput)
      .setLabel("Code reçu par mail")
      .setPlaceholder("123456")
      .setStyle(TextInputStyle.Short)
      .setMinLength(6)
      .setMaxLength(6)
      .setRequired(true);

    await interaction.showModal(
      new ModalBuilder()
        .setCustomId(ID.codeModal)
        .setTitle("Code de vérification")
        .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input)),
    );
  }

  private async onCodeSubmitted(interaction: ModalSubmitInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = this.service.confirm(interaction.user.id, interaction.fields.getTextInputValue(ID.codeInput));

    if (!result.ok) {
      const messages = {
        no_pending: "❌ Aucun code en attente. Relance `/verify`.",
        expired: "⌛ Ce code a expiré. Relance `/verify` pour en recevoir un nouveau.",
        too_many_attempts: "❌ Trop d'essais. Relance `/verify` pour recevoir un nouveau code.",
        wrong_code: `❌ Code incorrect. Il te reste ${result.reason === "wrong_code" ? result.attemptsLeft : 0} essai(s) : reclique sur « Entrer le code ».`,
      } satisfies Record<typeof result.reason, string>;
      await interaction.editReply(messages[result.reason]);
      return;
    }

    await this.addRole(interaction.user.id);
    await interaction.editReply("🎉 Vérification réussie, ton rôle t'a été attribué !");

    if (result.previousMemberHash) {
      const previous = await this.findMemberByHash(result.previousMemberHash);
      if (previous) await this.removeRole(previous);
      await this.log(
        `🔁 <@${interaction.user.id}> vérifié avec une adresse déjà utilisée : ` +
          (previous ? `rôle retiré à l'ancien compte <@${previous.id}>.` : "l'ancien compte n'est plus sur le serveur."),
      );
    } else {
      await this.log(`✅ <@${interaction.user.id}> vérifié.`);
    }
  }

  // --- /unlink -----------------------------------------------------------

  private async onUnlinkCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!this.service.isVerified(interaction.user.id)) {
      await interaction.reply({ content: "Tu n'es pas vérifié, il n'y a rien à supprimer.", flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.reply({
      content:
        "⚠️ Ta vérification va être supprimée : tu perdras le rôle et ton adresse sera libérée.\n" +
        "Ignore ce message pour annuler.",
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(ID.unlinkConfirm).setLabel("Confirmer la suppression").setStyle(ButtonStyle.Danger),
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }

  private async onUnlinkConfirm(interaction: ButtonInteraction): Promise<void> {
    const removed = this.service.forget(interaction.user.id);
    await this.removeRole(interaction.user.id);
    await interaction.update({
      content: removed ? "🗑️ Ta vérification a été supprimée." : "Tu n'étais déjà plus vérifié.",
      components: [],
    });
    if (removed) await this.log(`🗑️ <@${interaction.user.id}> a supprimé sa vérification (/unlink).`);
  }

  // --- /forget (admin) ---------------------------------------------------

  private async onForgetCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const target = interaction.options.getUser("membre", true);
    const removed = this.service.forget(target.id);
    await this.removeRole(target.id);
    await interaction.reply({
      content: removed
        ? `🗑️ Vérification de <@${target.id}> supprimée, son adresse est libérée.`
        : `<@${target.id}> n'avait pas de vérification enregistrée (rôle retiré s'il l'avait).`,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
    if (removed) await this.log(`🛠️ <@${interaction.user.id}> a supprimé la vérification de <@${target.id}> (/forget).`);
  }

  // --- Départ du serveur -------------------------------------------------

  private async onMemberRemove(member: GuildMember | PartialGuildMember): Promise<void> {
    if (member.guild.id !== this.config.guildId) return;
    try {
      if (this.service.forget(member.id)) await this.log(`👋 <@${member.id}> a quitté le serveur : vérification supprimée.`);
    } catch (error) {
      console.error("Erreur lors du départ d'un membre :", error);
    }
  }

  // --- Utilitaires -------------------------------------------------------

  private async addRole(memberId: string): Promise<void> {
    const guild = await this.guild();
    const member = await guild.members.fetch(memberId);
    if (!member.roles.cache.has(this.config.verifiedRoleId)) {
      await member.roles.add(this.config.verifiedRoleId, "Vérification étudiante");
    }
  }

  private async removeRole(memberOrId: GuildMember | string): Promise<void> {
    const guild = await this.guild();
    const member =
      typeof memberOrId === "string" ? await guild.members.fetch(memberOrId).catch(() => null) : memberOrId;
    if (member?.roles.cache.has(this.config.verifiedRoleId)) {
      await member.roles.remove(this.config.verifiedRoleId, "Vérification supprimée");
    }
  }

  // Seule l'empreinte de l'ancien compte est connue : on la compare à celle de chaque membre.
  private async findMemberByHash(memberHash: string): Promise<GuildMember | null> {
    const guild = await this.guild();
    const members = await guild.members.fetch();
    return members.find((member) => this.hasher.member(member.id) === memberHash) ?? null;
  }

  private async log(message: string): Promise<void> {
    if (!this.config.logChannelId) return;
    try {
      const channel = await this.client.channels.fetch(this.config.logChannelId);
      if (channel?.isSendable()) await channel.send({ content: message, allowedMentions: { parse: [] } });
    } catch (error) {
      console.error("Impossible d'écrire dans le salon de logs :", error);
    }
  }

  private async replyError(interaction: Interaction): Promise<void> {
    if (!interaction.isRepliable()) return;
    const content = "❌ Une erreur est survenue. Réessaie, ou préviens un modérateur si ça persiste.";
    try {
      if (interaction.deferred || interaction.replied) await interaction.editReply({ content, components: [] });
      else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    } catch {
      // L'interaction a expiré : rien d'autre à faire.
    }
  }
}

function describe(interaction: Interaction): string {
  if (interaction.isChatInputCommand()) return `/${interaction.commandName}`;
  if (interaction.isModalSubmit() || interaction.isButton()) return interaction.customId;
  return interaction.type.toString();
}
