// Partie Discord : commandes, formulaires (modals), boutons, menus et événements.
//
// L'accès est décidé par le rôle « vérifié » : un admin peut vérifier quelqu'un à la main
// en lui donnant ce rôle. La base sert uniquement à l'unicité des adresses et au transfert.

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  DiscordAPIError,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  InteractionContextType,
  MessageFlags,
  ModalBuilder,
  Partials,
  PermissionFlagsBits,
  RESTJSONErrorCodes,
  SlashCommandBuilder,
  SnowflakeUtil,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type Guild,
  type GuildMember,
  type Interaction,
  type ModalSubmitInteraction,
  type PartialGuildMember,
  type StringSelectMenuInteraction,
} from "discord.js";
import type { Config } from "./config.js";
import type { Hasher } from "./crypto.js";
import { managedRoleIds, selectionChanges, type RoleGroup } from "./roles.js";
import type { SettingsStore } from "./store.js";
import type { VerificationService } from "./verification.js";

const ID = {
  emailModal: "verify:email-modal",
  emailInput: "verify:email",
  codeButton: "verify:code-button",
  codeModal: "verify:code-modal",
  codeInput: "verify:code",
  unlinkConfirm: "unlink:confirm",
  rolesOpen: "roles:open",
  rolesGroupPrefix: "roles:group:",
} as const;

// Emplacement du message de choix des rôles, au format `idSalon:idMessage`.
const PANEL_SETTING = "roles_panel";

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
  new SlashCommandBuilder()
    .setName("setup-roles")
    .setDescription("[Admin] Publier ici le message de choix des rôles (remplace l'ancien)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild),
  new SlashCommandBuilder()
    .setName("roles-config")
    .setDescription("[Admin] Afficher la configuration des rôles au choix et ses problèmes")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild),
].map((command) => command.toJSON());

export class VerificationBot {
  // Partials.GuildMember : reçoit aussi les départs de membres absents du cache.
  readonly client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
    partials: [Partials.GuildMember],
  });

  // Rôles au choix gérés par le bot (niveau, domaines…), réservés aux membres vérifiés.
  private readonly managedIds: ReadonlySet<string>;

  constructor(
    private readonly config: Config,
    private readonly service: VerificationService,
    private readonly hasher: Hasher,
    private readonly roleGroups: readonly RoleGroup[],
    private readonly settings: SettingsStore,
  ) {
    this.managedIds = new Set(managedRoleIds(roleGroups));
    if (this.managedIds.has(config.verifiedRoleId)) {
      throw new Error("roles.json ne doit pas contenir le rôle vérifié (VERIFIED_ROLE_ID).");
    }
    this.client.once(Events.ClientReady, () => void this.onReady().catch((error) => this.fatal(error)));
    this.client.on(Events.InteractionCreate, (interaction) => void this.onInteraction(interaction));
    this.client.on(Events.GuildMemberRemove, (member) => void this.onMemberRemove(member));
    this.client.on(Events.GuildMemberUpdate, (_old, member) => void this.onMemberUpdate(member));
  }

  start(): Promise<string> {
    return this.client.login(this.config.discordToken);
  }

  // --- Démarrage ---------------------------------------------------------

  private async onReady(): Promise<void> {
    const guild = await this.guild().catch((error: unknown) => {
      if (error instanceof DiscordAPIError && error.code === RESTJSONErrorCodes.UnknownGuild) {
        throw new Error(
          `Serveur ${this.config.guildId} introuvable : soit le bot n'y a pas été invité, ` +
            "soit GUILD_ID n'est pas l'identifiant du serveur (clic droit sur l'icône du serveur > Copier l'identifiant du serveur).",
        );
      }
      throw error;
    });
    await guild.commands.set(commands);

    const role = await guild.roles.fetch(this.config.verifiedRoleId).catch(() => null);
    if (!role) {
      throw new Error(
        `Rôle ${this.config.verifiedRoleId} introuvable sur « ${guild.name} » : vérifie VERIFIED_ROLE_ID ` +
          "(Paramètres du serveur > Rôles > clic droit sur le rôle > Copier l'identifiant du rôle).",
      );
    }
    const me = await guild.members.fetchMe();
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      console.warn("⚠️  Le bot n'a pas la permission « Gérer les rôles ».");
    }
    if (me.roles.highest.comparePositionTo(role) <= 0) {
      console.warn(`⚠️  Le rôle du bot doit être placé AU-DESSUS du rôle « ${role.name} » dans les paramètres du serveur.`);
    }

    console.log(`Connecté en tant que ${this.client.user?.tag} sur « ${guild.name} ».`);

    console.log(`Rôles au choix : ${this.roleGroups.length} groupe(s), ${this.managedIds.size} rôle(s).`);
    for (const problem of await this.roleProblems(guild)) console.warn(`⚠️  roles.json : ${problem}`);
    await this.refreshPanel();
    await this.sweepManagedRoles(guild);

    if (this.config.logChannelId) {
      const prune = () => void this.pruneLogs().catch((error) => console.error("Échec du nettoyage du salon de logs :", error));
      prune();
      setInterval(prune, 24 * 3600_000).unref();
    }
  }

  private fatal(error: unknown): void {
    console.error("Erreur au démarrage :", error instanceof DiscordAPIError ? error : String(error));
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
        if (interaction.commandName === "setup-roles") return await this.onSetupRolesCommand(interaction);
        if (interaction.commandName === "roles-config") return await this.onRolesConfigCommand(interaction);
      } else if (interaction.isModalSubmit()) {
        if (interaction.customId === ID.emailModal) return await this.onEmailSubmitted(interaction);
        if (interaction.customId === ID.codeModal) return await this.onCodeSubmitted(interaction);
      } else if (interaction.isButton()) {
        if (interaction.customId === ID.codeButton) return await this.onCodeButton(interaction);
        if (interaction.customId === ID.unlinkConfirm) return await this.onUnlinkConfirm(interaction);
        if (interaction.customId === ID.rolesOpen) return await this.onRolesOpen(interaction);
      } else if (interaction.isStringSelectMenu()) {
        if (interaction.customId.startsWith(ID.rolesGroupPrefix)) return await this.onRolesSelected(interaction);
      }
    } catch (error) {
      console.error(`Erreur pendant l'interaction ${describe(interaction)} :`, error);
      await this.replyError(interaction);
    }
  }

  // --- /verify -----------------------------------------------------------

  private async onVerifyCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const member = await this.member(interaction.user.id);
    if (member && this.isVerified(member)) {
      await interaction.reply({
        content: "✅ Tu es déjà vérifié.",
        components: this.rolesButtonRow(),
        flags: MessageFlags.Ephemeral,
      });
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
    await interaction.editReply({
      content:
        "🎉 Vérification réussie, ton rôle t'a été attribué !" +
        (this.roleGroups.length > 0 ? "\nChoisis maintenant ton niveau et tes domaines pour accéder à leurs salons." : ""),
      components: this.rolesButtonRow(),
    });

    if (result.previousMemberHash) {
      const previous = await this.findMemberByHash(result.previousMemberHash);
      if (previous) await this.revokeAccess(previous);
      await this.log(
        `🔁 <@${interaction.user.id}> vérifié avec une adresse déjà utilisée : ` +
          (previous ? `rôles retirés à l'ancien compte <@${previous.id}>.` : "l'ancien compte n'est plus sur le serveur."),
      );
    } else {
      await this.log(`✅ <@${interaction.user.id}> vérifié.`);
    }
  }

  // --- /unlink -----------------------------------------------------------

  private async onUnlinkCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const member = await this.member(interaction.user.id);
    if (!(member && this.isVerified(member)) && !this.service.isLinked(interaction.user.id)) {
      await interaction.reply({ content: "Tu n'es pas vérifié, il n'y a rien à supprimer.", flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.reply({
      content:
        "⚠️ Ta vérification va être supprimée : tu perdras le rôle vérifié et tes rôles de niveau et de domaine, " +
        "et ton adresse sera libérée.\nIgnore ce message pour annuler.",
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
    const hadRoles = await this.revokeAccess(interaction.user.id);
    await interaction.update({
      content: removed || hadRoles ? "🗑️ Ta vérification a été supprimée." : "Tu n'étais déjà plus vérifié.",
      components: [],
    });
    if (removed || hadRoles) await this.log(`🗑️ <@${interaction.user.id}> a supprimé sa vérification (/unlink).`);
  }

  // --- /forget (admin) ---------------------------------------------------

  private async onForgetCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const target = interaction.options.getUser("membre", true);
    const removed = this.service.forget(target.id);
    await this.revokeAccess(target.id);
    await interaction.reply({
      content: removed
        ? `🗑️ Vérification de <@${target.id}> supprimée, son adresse est libérée.`
        : `<@${target.id}> n'avait pas d'adresse enregistrée (rôles retirés s'il en avait).`,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
    await this.log(`🛠️ <@${interaction.user.id}> a supprimé la vérification de <@${target.id}> (/forget).`);
  }

  // --- Rôles au choix ----------------------------------------------------

  private async onSetupRolesCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (this.roleGroups.length === 0) {
      await interaction.reply({ content: "❌ Aucun rôle configuré dans `roles.json`.", flags: MessageFlags.Ephemeral });
      return;
    }
    const channel = interaction.channel;
    let message;
    try {
      if (!channel?.isSendable()) throw new Error("salon non accessible");
      message = await channel.send(this.panelMessage());
    } catch {
      await interaction.reply({
        content: "❌ Je ne peux pas publier ici : il me faut **Voir le salon**, **Envoyer des messages** et **Intégrer des liens**.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const previous = this.panelLocation();
    this.settings.setSetting(PANEL_SETTING, `${message.channelId}:${message.id}`);
    let replaced = false;
    if (previous && previous.messageId !== message.id) {
      replaced = await this.client.channels
        .fetch(previous.channelId)
        .then(async (old) => {
          if (!old?.isTextBased() || old.isDMBased()) return false;
          await old.messages.delete(previous.messageId);
          return true;
        })
        .catch(() => false);
    }
    await interaction.reply({
      content: `✅ Message de choix des rôles publié.${replaced ? " L'ancien message a été supprimé." : ""}`,
      flags: MessageFlags.Ephemeral,
    });
  }

  private async onRolesConfigCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const guild = await this.guild();
    const groups = this.roleGroups.map(
      (group) =>
        `**${group.label}** (${group.max === 1 ? "1 choix" : `jusqu'à ${group.max} choix`})\n` +
        group.roles.map((role) => `<@&${role.id}>`).join(" · "),
    );
    const problems = await this.roleProblems(guild);
    const panel = this.panelLocation();
    await interaction.editReply({
      content: [
        groups.length > 0 ? groups.join("\n\n") : "Aucun rôle configuré dans `roles.json`.",
        "",
        panel
          ? `Message de choix : https://discord.com/channels/${guild.id}/${panel.channelId}/${panel.messageId}`
          : "Message de choix : pas encore publié (`/setup-roles`).",
        problems.length > 0 ? `\n⚠️ **Problèmes**\n${problems.map((p) => `- ${p}`).join("\n")}` : "\n✅ Aucun problème détecté.",
      ].join("\n"),
      allowedMentions: { parse: [] },
    });
  }

  private async onRolesOpen(interaction: ButtonInteraction): Promise<void> {
    const member = await this.member(interaction.user.id);
    if (!member || !this.isVerified(member)) {
      await interaction.reply({ content: "🔒 Vérifie-toi d'abord avec `/verify`.", flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.reply({ ...this.rolesMenu(member), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  }

  private async onRolesSelected(interaction: StringSelectMenuInteraction): Promise<void> {
    const group = this.roleGroups[Number(interaction.customId.slice(ID.rolesGroupPrefix.length))];
    await interaction.deferUpdate();
    let member = await this.member(interaction.user.id);
    if (!group || !member || !this.isVerified(member)) {
      await interaction.editReply({
        content: group ? "🔒 Vérifie-toi d'abord avec `/verify`." : "Ce menu n'est plus à jour : rouvre-le avec le bouton.",
        components: [],
      });
      return;
    }

    const { add, remove } = selectionChanges(group, new Set(member.roles.cache.keys()), interaction.values);
    if (remove.length > 0) member = await member.roles.remove(remove, "Choix des rôles");
    if (add.length > 0) member = await member.roles.add(add, "Choix des rôles");
    await interaction.editReply({ ...this.rolesMenu(member), allowedMentions: { parse: [] } });
  }

  // Message visible seulement par le membre : un menu par groupe, ses rôles actuels présélectionnés.
  private rolesMenu(member: GuildMember) {
    const rows: ActionRowBuilder<StringSelectMenuBuilder>[] = [];
    const summary: string[] = [];

    this.roleGroups.forEach((group, index) => {
      // Discord refuse plus d'options présélectionnées que le maximum du menu
      // (ex. : deux niveaux donnés à la main par un admin).
      let preselected = 0;
      const options = group.roles.flatMap((entry) => {
        const role = member.guild.roles.cache.get(entry.id);
        if (!role) return [];
        const isDefault = member.roles.cache.has(role.id) && preselected < group.max;
        if (isDefault) preselected += 1;
        const option = new StringSelectMenuOptionBuilder()
          .setLabel(role.name.slice(0, 100))
          .setValue(role.id)
          .setDefault(isDefault);
        if (entry.description) option.setDescription(entry.description);
        return [option];
      });
      if (options.length === 0) return;

      const chosen = group.roles.filter((role) => member.roles.cache.has(role.id)).map((role) => `<@&${role.id}>`);
      summary.push(`**${group.label}** : ${chosen.length > 0 ? chosen.join(" ") : "—"}`);
      rows.push(
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`${ID.rolesGroupPrefix}${index}`)
            .setPlaceholder(group.label.slice(0, 150))
            .setMinValues(0)
            .setMaxValues(Math.min(group.max, options.length))
            .addOptions(options),
        ),
      );
    });

    return {
      content:
        rows.length > 0
          ? `${summary.join("\n")}\n\n-# Chaque changement s'applique tout de suite. Ce message n'est visible que par toi.`
          : "Aucun rôle à choisir pour le moment.",
      components: rows,
    };
  }

  private rolesButtonRow(): ActionRowBuilder<ButtonBuilder>[] {
    if (this.roleGroups.length === 0) return [];
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(ID.rolesOpen).setLabel("Choisir mes rôles").setStyle(ButtonStyle.Primary),
      ),
    ];
  }

  private panelMessage() {
    return {
      embeds: [
        new EmbedBuilder()
          .setTitle("Choix des rôles")
          .setDescription(
            "Choisis ton niveau, tes domaines d'études et les salons qui t'intéressent.\n" +
              "Clique sur le bouton : le menu ne sera visible que par toi, et tu peux revenir le modifier quand tu veux.",
          ),
      ],
      components: this.rolesButtonRow(),
    };
  }

  private panelLocation(): { channelId: string; messageId: string } | null {
    const [channelId, messageId] = this.settings.getSetting(PANEL_SETTING)?.split(":") ?? [];
    return channelId && messageId ? { channelId, messageId } : null;
  }

  // Remet à jour le message de choix (texte, bouton) à chaque démarrage.
  private async refreshPanel(): Promise<void> {
    const panel = this.panelLocation();
    if (!panel) return;
    try {
      const channel = await this.client.channels.fetch(panel.channelId);
      if (!channel?.isTextBased() || channel.isDMBased()) throw new Error("salon introuvable");
      await channel.messages.edit(panel.messageId, this.panelMessage());
    } catch {
      console.warn("⚠️  Message de choix des rôles introuvable (supprimé ?) : relance /setup-roles dans le salon voulu.");
    }
  }

  private async roleProblems(guild: Guild): Promise<string[]> {
    const me = await guild.members.fetchMe();
    const roles = await guild.roles.fetch();
    const problems: string[] = [];
    for (const id of this.managedIds) {
      const role = roles.get(id);
      if (!role) problems.push(`le rôle ${id} n'existe pas sur le serveur (supprimé, ou mauvais identifiant)`);
      else if (role.managed) problems.push(`« ${role.name} » appartient à une intégration et ne peut pas être attribué`);
      else if (me.roles.highest.comparePositionTo(role) <= 0) {
        problems.push(`« ${role.name} » doit être placé SOUS le rôle du bot dans les paramètres du serveur`);
      }
    }
    return problems;
  }

  // --- Garde-fou : rôles au choix réservés aux membres vérifiés -----------

  private async onMemberUpdate(member: GuildMember): Promise<void> {
    if (member.guild.id !== this.config.guildId || this.isVerified(member)) return;
    try {
      const removed = await this.stripManagedRoles(member);
      if (removed > 0) await this.log(`🧹 ${removed} rôle(s) au choix retiré(s) à <@${member.id}> (non vérifié).`);
    } catch (error) {
      console.error("Erreur lors du retrait des rôles au choix :", error);
    }
  }

  // Au démarrage : rattrape ce qui a pu se passer pendant que le bot était éteint.
  private async sweepManagedRoles(guild: Guild): Promise<void> {
    if (this.managedIds.size === 0) return;
    const members = await guild.members.fetch();
    let count = 0;
    for (const member of members.values()) {
      if (this.isVerified(member)) continue;
      try {
        if ((await this.stripManagedRoles(member)) > 0) count += 1;
      } catch (error) {
        console.error(`Impossible de retirer les rôles au choix d'un membre :`, error);
      }
    }
    if (count > 0) {
      console.log(`Rôles au choix retirés à ${count} membre(s) non vérifié(s).`);
      await this.log(`🧹 Démarrage : rôles au choix retirés à ${count} membre(s) non vérifié(s).`);
    }
  }

  private async stripManagedRoles(member: GuildMember): Promise<number> {
    const held = member.roles.cache.filter((role) => this.managedIds.has(role.id));
    if (held.size > 0) await member.roles.remove([...held.keys()], "Rôles au choix réservés aux membres vérifiés");
    return held.size;
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

  private isVerified(member: GuildMember): boolean {
    return member.roles.cache.has(this.config.verifiedRoleId);
  }

  private async member(memberId: string): Promise<GuildMember | null> {
    const guild = await this.guild();
    return guild.members.fetch(memberId).catch(() => null);
  }

  private async addRole(memberId: string): Promise<void> {
    const member = await this.member(memberId);
    if (member && !this.isVerified(member)) {
      await member.roles.add(this.config.verifiedRoleId, "Vérification étudiante");
    }
  }

  // Retire le rôle vérifié et tous les rôles au choix. Renvoie true si le membre en avait.
  private async revokeAccess(memberOrId: GuildMember | string): Promise<boolean> {
    const member = typeof memberOrId === "string" ? await this.member(memberOrId) : memberOrId;
    if (!member) return false;
    const held = member.roles.cache
      .filter((role) => role.id === this.config.verifiedRoleId || this.managedIds.has(role.id))
      .map((role) => role.id);
    if (held.length > 0) await member.roles.remove(held, "Vérification supprimée");
    return held.length > 0;
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

  // Supprime les messages du bot plus anciens que LOG_RETENTION_DAYS dans le salon de logs.
  // Les autres messages (ceux des modérateurs) ne sont pas touchés.
  private async pruneLogs(): Promise<void> {
    const channel = await this.client.channels.fetch(this.config.logChannelId!);
    if (!channel?.isTextBased() || channel.isDMBased()) return;

    const botId = this.client.user!.id;
    // Ne parcourt que les messages antérieurs à la limite de conservation.
    let before = SnowflakeUtil.generate({ timestamp: Date.now() - this.config.logRetentionMs }).toString();
    let deleted = 0;
    for (;;) {
      const batch = await channel.messages.fetch({ limit: 100, before });
      if (batch.size === 0) break;
      for (const message of batch.values()) {
        if (message.author.id === botId) {
          await message.delete();
          deleted += 1;
        }
      }
      before = batch.lastKey()!;
    }
    if (deleted > 0) console.log(`Salon de logs : ${deleted} ancien(s) message(s) supprimé(s).`);
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
  if (interaction.isModalSubmit() || interaction.isMessageComponent()) return interaction.customId;
  return interaction.type.toString();
}
