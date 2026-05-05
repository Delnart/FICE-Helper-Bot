import { forwardRef, Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Bot, Context, GrammyError, InlineKeyboard, Keyboard } from 'grammy';
import { GroupsService } from '../groups/groups.service';
import { UsersService } from '../users/users.service';
import { CampusService } from '../campus/campus.service';
import { SheetsService, SheetGroupHead } from '../sheets/sheets.service';
import { ScheduleService } from '../schedule/schedule.service';
import { User, UserDocument } from '../users/user.schema';
import { SupportTicket, SupportTicketDocument } from './support-ticket.schema';
import { Role, ROLE_LEVEL } from '@fice/shared';

@Injectable()
export class BotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BotService.name);
  private bot?: Bot;

  constructor(
    private readonly config: ConfigService,
    private readonly groups: GroupsService,
    @Inject(forwardRef(() => UsersService))
    private readonly users: UsersService,
    private readonly campus: CampusService,
    private readonly sheets: SheetsService,
    private readonly schedule: ScheduleService,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(SupportTicket.name) private readonly tickets: Model<SupportTicketDocument>,
  ) {}

  /** Telegram chat ID of the admin group (from ADMIN_CHAT_ID env var). */
  private get adminChatId(): number | undefined {
    const raw = this.config.get<string>('ADMIN_CHAT_ID');
    return raw ? Number(raw) : undefined;
  }

  private isAdminChat(ctx: Context): boolean {
    return !!this.adminChatId && ctx.chat?.id === this.adminChatId;
  }

  /**
   * Persistent reply keyboard for private chats — shown after every command so
   * the "📨 Підтримка" button stays visible until the user explicitly hides it.
   */
  private get supportKeyboard(): Keyboard {
    return new Keyboard().text('📨 Підтримка').resized().persistent();
  }

  /**
   * Build extra options for a private-chat command response that should keep
   * the persistent support keyboard visible. Merges any caller-provided fields.
   */
  private privateExtra(extra?: Record<string, unknown>): Record<string, unknown> {
    return { reply_markup: this.supportKeyboard, ...(extra ?? {}) };
  }

  async onModuleInit(): Promise<void> {
    const token = this.config.get<string>('TELEGRAM_BOT_TOKEN');
    if (!token) {
      this.logger.warn('TELEGRAM_BOT_TOKEN not set — bot disabled');
      return;
    }

    this.bot = new Bot(token);
    this.registerHandlers(this.bot);
    await this.cleanupLegacySupportTicketIndexes();

    this.bot.catch((err) => {
      this.logger.error(`Bot error: ${err.error instanceof Error ? err.error.message : err.error}`);
    });

    this.bot.start({ drop_pending_updates: true }).catch((err: unknown) => {
      this.logger.error(`Bot polling error: ${(err as Error).message}`);
    });
    this.logger.log('Telegram bot started');
  }

  async onModuleDestroy(): Promise<void> {
    await this.bot?.stop();
  }

  getBot(): Bot | undefined {
    return this.bot;
  }

  async sendMessage(chatId: number, text: string, extra?: Record<string, unknown>): Promise<void> {
    if (!this.bot) return;
    try {
      await this.bot.api.sendMessage(chatId, text, { parse_mode: 'HTML', ...extra });
    } catch (err) {
      if (err instanceof GrammyError) {
        this.logger.warn(`sendMessage failed for ${chatId}: ${err.description}`);
      } else {
        this.logger.error(`sendMessage failed: ${(err as Error).message}`);
      }
    }
  }

  private async cleanupLegacySupportTicketIndexes(): Promise<void> {
    try {
      const indexes = await this.tickets.collection.indexes();
      if (indexes.some((index) => index.name === 'adminMessageId_1')) {
        await this.tickets.collection.dropIndex('adminMessageId_1');
        this.logger.log('Dropped legacy support ticket index adminMessageId_1');
      }
    } catch (err) {
      this.logger.warn(
        `support ticket index cleanup skipped: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Send a message to a group's bound chat, using its message thread if configured.
   * No-op if the group has no chat.
   */
  async sendToGroup(groupId: string, text: string, extra?: Record<string, unknown>): Promise<void> {
    const group = await this.groups.findById(groupId).catch(() => null);
    if (!group?.telegramChatId) return;
    const opts: Record<string, unknown> = { ...extra };
    if (group.messageThreadId) opts.message_thread_id = group.messageThreadId;
    await this.sendMessage(group.telegramChatId, text, opts);
  }

  private async notifyAdminChat(text: string): Promise<void> {
    if (!this.adminChatId) return;
    await this.sendMessage(this.adminChatId, text);
  }

  private registerHandlers(bot: Bot): void {
    bot.command('start', async (ctx) => {
      if (ctx.chat?.type === 'private') {
        await this.handlePrivateStart(ctx);
      } else {
        await this.handleGroupStart(ctx);
      }
    });

    // /verify — primary command (group chat only)
    bot.command('verify', async (ctx) => {
      if (!isGroupChat(ctx)) {
        await ctx.reply('Команду /verify треба надсилати в груповому чаті, де є бот.');
        return;
      }
      await this.handleVerify(ctx);
    });
    // /bind — historic alias
    bot.command('bind', async (ctx) => {
      if (!isGroupChat(ctx)) {
        await ctx.reply('Команду треба надсилати в груповому чаті, де є бот.');
        return;
      }
      await this.handleVerify(ctx);
    });

    bot.command('migrate', async (ctx) => {
      if (!isGroupChat(ctx)) {
        await ctx.reply('Команду /migrate треба надсилати в новому/поточному груповому чаті.');
        return;
      }
      await this.handleMigrate(ctx);
    });

    bot.callbackQuery(/^bind:(.+)$/, async (ctx) => {
      const groupName = ctx.match[1];
      if (!isGroupChat(ctx)) {
        await ctx.answerCallbackQuery({ text: 'Лише в груповому чаті', show_alert: true });
        return;
      }
      await this.bindExact(ctx, groupName);
      await ctx.answerCallbackQuery();
    });
    bot.callbackQuery(/^migrate:(.+)$/, async (ctx) => {
      const groupName = ctx.match[1];
      if (!isGroupChat(ctx)) {
        await ctx.answerCallbackQuery({ text: 'Лише в груповому чаті', show_alert: true });
        return;
      }
      await this.migrateExact(ctx, groupName);
      await ctx.answerCallbackQuery();
    });

    bot.command('now', async (ctx) => {
      await this.handleNowOrLeft(ctx, 'now');
    });
    bot.command('left', async (ctx) => {
      await this.handleNowOrLeft(ctx, 'left');
    });

    bot.command('refresh_heads', async (ctx) => {
      if (!this.isAdminChat(ctx)) {
        await ctx.reply('Команда /refresh_heads доступна лише в групі адмінів.');
        return;
      }
      await this.sheets.refresh();
      const r = await this.sheets.syncHeads();
      const t = await this.sheets.syncTeachers();
      const heads = await this.sheets.getHeads();
      const teachers = await this.sheets.getTeachers();
      await ctx.reply(
        `Таблицю оновлено. Старост: ${heads.length}, викладачів: ${teachers.length}.\n` +
        `Старости: +${r.granted} нових, -${r.revoked} скасовано, ${r.skipped} пропущено.\n` +
        `Викладачі: -${t.revoked} скасовано (не в таблиці).`,
        { reply_markup: this.supportKeyboard },
      );
    });

    bot.command('help', async (ctx) => {
      const text = await this.buildHelpText(ctx);
      if (ctx.chat?.type === 'private') {
        await ctx.reply(text, { reply_markup: this.supportKeyboard });
      } else {
        await ctx.reply(text);
      }
    });

    // /support — open a support thread by typing the next message.
    bot.command('support', async (ctx) => {
      if (ctx.chat?.type !== 'private') {
        await ctx.reply('Команду /support потрібно надсилати в особистих повідомленнях.');
        return;
      }
      if (!this.adminChatId) {
        await ctx.reply(
          'Підтримка тимчасово недоступна — адміністратор не налаштував чат для звернень.',
          { reply_markup: this.supportKeyboard },
        );
        return;
      }
      await ctx.reply(
        'Напишіть нижче своє повідомлення — я перешлю його адміністраторам, і вони відповідуть прямо тут.',
        { reply_markup: this.supportKeyboard },
      );
    });

    // Auto-bind when bot is added to a group by a verified head; deactivate
    // when bot is removed (kicked / left / chat deleted).
    bot.on('my_chat_member', async (ctx) => {
      const update = ctx.myChatMember;
      if (!update) return;
      if (!isGroupChatType(update.chat.type)) return;
      const status = update.new_chat_member.status;

      // ── Bot kicked / left → deactivate group + revoke memberships ────────
      if (['left', 'kicked'].includes(status)) {
        try {
          await this.deactivateGroupForChat(update.chat.id);
        } catch (err) {
          this.logger.warn(`deactivate group failed: ${(err as Error).message}`);
        }
        return;
      }

      const adder = update.from;
      if (!adder || adder.is_bot) return;
      if (!this.sheets.isConfigured() || !adder.username) return;
      const heads = await this.sheets
        .findHeadsByUsername(adder.username)
        .catch(() => [] as SheetGroupHead[]);
      if (heads.length === 0) return; // adder isn't a head — let them /verify themselves later

      if (heads.length === 1) {
        try {
          await this.bindByHead(update.chat.id, heads[0], adder);
          await this.harvestChatAdmins(update.chat.id);
          await this.sendMessage(
            update.chat.id,
            `Цей чат привʼязано до групи <b>${escapeHtml(heads[0].groupName)}</b>.`,
          );
        } catch (err) {
          this.logger.warn(`auto-bind failed: ${(err as Error).message}`);
        }
        return;
      }

      // Multiple heads' groups → ask them to choose with /verify
      const keyboard = new InlineKeyboard();
      for (const h of heads) keyboard.text(h.groupName, `bind:${h.groupName}`).row();
      await this.sendMessage(
        update.chat.id,
        `Вітаю, ${escapeHtml(adder.first_name)}. Ви староста кількох груп — оберіть, до якої привʼязати цей чат:`,
        { reply_markup: keyboard },
      );
    });

    // chat_member fires on join/leave only when the bot has admin "Restrict
    // members" permission, which most groups don't grant. We rely instead on
    // the message handler below — which fires every time a user posts in the
    // bound chat — and ensure they have a group membership in our DB.
    bot.on('chat_member', async (ctx) => {
      const update = ctx.chatMember;
      if (!update) return;
      const user = update.new_chat_member.user;
      if (user.is_bot) return;
      const group = await this.groups.findByChat(ctx.chat.id);
      if (!group) return;
      if (['member', 'administrator', 'creator'].includes(update.new_chat_member.status)) {
        await this.ensureMember(group, user);
      } else if (['left', 'kicked'].includes(update.new_chat_member.status)) {
        await this.removeMember(group, user);
      }
    });

    // Single consolidated message handler. Grammy stops the middleware chain
    // when a handler returns without calling `await next()` — so registering
    // separate `bot.on('message')` middlewares for each concern means only the
    // first one ever fires. We branch on chat type inline instead.
    //
    // Order matters: admin-chat check goes first because admin chats are
    // supergroups too — if we fell through to the generic group branch first,
    // it would `return` before we ever route the reply back to the user.
    bot.on('message', async (ctx) => {
      try {
        const chatType = ctx.chat?.type;

        // ── Admin chat: relay replies back to ticket authors ────────────────
        if (this.adminChatId && ctx.chat?.id === this.adminChatId) {
          const replyTo = ctx.message?.reply_to_message;
          if (!replyTo || ctx.from?.is_bot) return;
          await this.handleAdminReply(ctx, replyTo.message_id);
          return;
        }

        // ── Group chat: auto-onboarding ─────────────────────────────────────
        if (chatType && isGroupChatType(chatType)) {
          const from = ctx.from;
          if (!from || from.is_bot) return;
          const group = await this.groups.findByChat(ctx.chat!.id);
          if (!group) return;
          await this.ensureMember(group, from);
          return;
        }

        // ── Private chat: support flow ──────────────────────────────────────
        if (chatType === 'private') {
          const text = ctx.message?.text;
          // Tap on the persistent "📨 Підтримка" reply-keyboard button —
          // treat like /support (prompt user, don't bounce the tap to admins).
          if (text && text.trim() === '📨 Підтримка') {
            if (!this.adminChatId) {
              await ctx.reply(
                'Підтримка тимчасово недоступна — адміністратор не налаштував чат для звернень.',
                { reply_markup: this.supportKeyboard },
              );
              return;
            }
            await ctx.reply(
              'Напишіть нижче своє повідомлення — я перешлю його адміністраторам, і вони відповідуть прямо тут.',
              { reply_markup: this.supportKeyboard },
            );
            return;
          }
          // Skip slash-commands (handled by command handlers).
          if (text && text.startsWith('/')) return;
          // Any other content (text / photo / document / sticker / voice) →
          // confirmation prompt → copyMessage to admins.
          if (!this.adminChatId) return;
          if (!ctx.message) return;
          await this.handlePrivateSupportMessage(ctx);
          return;
        }
      } catch (err) {
        this.logger.warn(`message handler failed: ${(err as Error).message}`);
      }
    });

    // Inline-button: user confirmed "send to admin".
    bot.callbackQuery(/^support:send:(\d+)$/, async (ctx) => {
      const userMessageId = Number(ctx.match[1]);
      await ctx.answerCallbackQuery();
      await this.handleSupportSend(ctx, userMessageId);
    });

    // Inline-button: user cancelled.
    bot.callbackQuery(/^support:cancel$/, async (ctx) => {
      await ctx.answerCallbackQuery();
      try {
        await ctx.deleteMessage();
      } catch { /* already gone */ }
    });
  }

  /**
   * Bot was kicked / left / chat deleted — freeze the group:
   *   • mark group `status='inactive'`
   *   • strip every user's membership for that group, plus head/deputy refs
   *
   * Idempotent: safe to call repeatedly. Doesn't delete the group record so
   * support staff can audit history.
   */
  private async deactivateGroupForChat(chatId: number): Promise<void> {
    const group = await this.groups.findByChat(chatId);
    if (!group) return;
    const groupId = String(group._id);
    await this.groups.markInactive(groupId);
    // Wipe memberships for this group from every user (idempotent $pull).
    const result = await this.userModel
      .updateMany(
        { 'memberships.groupId': group._id },
        { $pull: { memberships: { groupId: group._id } } },
      )
      .exec();
    this.logger.warn(
      `Group "${group.academicName}" deactivated (bot removed from chat ${chatId}); ` +
      `stripped membership from ${result.modifiedCount} user(s)`,
    );
  }

  /**
   * Upsert the User by telegramId and add them to the group as a Student if
   * they don't already have a membership there. Idempotent and safe to call
   * on every incoming message.
   *
   * If the user's @username is in the «Викладачі» sheet → grant Role.Teacher
   * instead of Role.Student so they get teacher-level permissions automatically
   * the moment the head adds them to the chat (no manual identify step needed).
   */
  private async ensureMember(
    group: { _id: unknown },
    tgUser: { id: number; first_name: string; last_name?: string; username?: string },
  ): Promise<void> {
    const user = await this.users.upsertFromTelegram({
      telegramId: tgUser.id,
      firstName: tgUser.first_name,
      lastName: tgUser.last_name,
      username: tgUser.username,
    });

    // Decide membership role: verified teacher → Teacher; everyone else → Student.
    let role: Role = Role.Student;
    if (tgUser.username && this.sheets.isConfigured()) {
      const isTeacher = await this.sheets
        .findTeacherByUsername(tgUser.username)
        .then((t) => !!t)
        .catch(() => false);
      if (isTeacher) role = Role.Teacher;
    }

    await this.users.ensureMembership(String(user._id), String(group._id), role);
  }

  /**
   * Remove a user from the group when Telegram fires a `left`/`kicked` status.
   * Delegates to UsersService so that headUserId / deputyUserIds are also cleaned up.
   */
  private async removeMember(
    group: { _id: unknown },
    tgUser: { id: number; username?: string },
  ): Promise<void> {
    try {
      await this.users.removeMemberFromGroup(tgUser.id, String(group._id));
    } catch (err) {
      this.logger.warn(`removeMember failed for tg=${tgUser.id}: ${(err as Error).message}`);
    }
  }

  // ---------- /start ----------

  private async handlePrivateStart(ctx: Context): Promise<void> {
    const from = ctx.from;
    if (!from) return;
    const webApp =
      this.config.get<string>('PUBLIC_MINI_APP_URL') ??
      this.config.get<string>('PUBLIC_WEB_APP_URL');
    const appKb = webApp ? new InlineKeyboard().webApp('Відкрити FICE Helper', webApp) : undefined;

    // Already a known user with at least one membership? → just send welcome + open app
    const dbUser = await this.users.findByTelegramId(from.id);
    const startNotice = await this.buildPrivateStartNotice(from, dbUser);
    if (startNotice) void this.notifyAdminChat(startNotice);
    if (dbUser && (dbUser.memberships?.length ?? 0) > 0) {
      await ctx.reply(
        `Вітаю, ${escapeHtml(dbUser.firstName ?? from.first_name)}.\n` +
          'Відкривайте застосунок — там розклад, ДЗ, журнал і черги вашої групи.',
        this.privateExtra(appKb ? { reply_markup: appKb } : {}),
      );
      // Send a follow-up so the persistent keyboard appears (inline + reply
      // keyboards can't co-exist in one message).
      await ctx.reply('Якщо щось не працює — натисніть «📨 Підтримка».', {
        reply_markup: this.supportKeyboard,
      });
      return;
    }

    if (from.username && this.sheets.isConfigured()) {
      // Head detection
      const heads = await this.sheets
        .findHeadsByUsername(from.username)
        .catch(() => [] as SheetGroupHead[]);
      if (heads.length > 0) {
        // Persist sheet's fullName so the app pre-fills it everywhere (profile, journal).
        await this.persistSheetFullName(from.id, from.first_name, from.last_name, from.username, heads[0].fullName);

        const list = heads.map((h) => `• ${escapeHtml(h.groupName)}`).join('\n');
        const plural = heads.length === 1 ? 'старостою групи' : 'старостою груп';
        await ctx.reply(
          [
            `Вітаю, ${escapeHtml(heads[0].fullName)}.`,
            '',
            `Вас верифіковано як ${plural}:`,
            list,
            '',
            'Як активувати бота для вашої групи:',
            '1. Додайте мене у груповий чат (без прав адміна можна).',
            '2. Якщо я вже там — надішліть у чаті команду /verify.',
            heads.length > 1
              ? '3. Якщо ви староста кількох груп — у чаті я запропоную вибір.'
              : '',
          ]
            .filter(Boolean)
            .join('\n'),
          { parse_mode: 'HTML', ...(appKb ? { reply_markup: appKb } : {}) },
        );
        await ctx.reply(
          'Питання? Натисніть «📨 Підтримка» — адміни на звʼязку.',
          { reply_markup: this.supportKeyboard },
        );
        return;
      }

      // Teacher detection
      const teacher = await this.sheets
        .findTeacherByUsername(from.username)
        .catch(() => undefined);
      if (teacher) {
        // Persist sheet's fullName so identifyTeacher in the app works without typing it.
        await this.persistSheetFullName(from.id, from.first_name, from.last_name, from.username, teacher.fullName);

        await ctx.reply(
          [
            `Вітаю, ${escapeHtml(teacher.fullName)}.`,
            '',
            'Вас верифіковано як викладача КПІ.',
            '',
            'Відкрийте FICE Helper — система знайде ваші предмети у розкладі Кампус КПІ',
            'і надасть доступ до черг і журналів автоматично.',
          ].join('\n'),
          { parse_mode: 'HTML', ...(appKb ? { reply_markup: appKb } : {}) },
        );
        await ctx.reply(
          'Питання? Натисніть «📨 Підтримка» — адміни на звʼязку.',
          { reply_markup: this.supportKeyboard },
        );
        return;
      }
    }

    // Not a head, not a teacher, not yet a member — nudge them to ask the head
    // and tell them about /support so they can reach the admins.
    await ctx.reply(
      [
        'Вітаю. Я FICE Helper — помічник академічних груп КПІ.',
        '',
        'Щоб користуватись — попросіть старосту вашої групи додати мене у груповий чат.',
        'Після цього ви зможете відкривати застосунок і користуватись усіма функціями.',
        '',
        'Якщо ви впевнені, що мали б отримати доступ — натисніть «📨 Підтримка»',
        'і опишіть ситуацію, адміністратори допоможуть.',
      ].join('\n'),
      this.privateExtra(appKb ? { reply_markup: appKb } : {}),
    );
    await ctx.reply('📨 Підтримка завжди доступна знизу.', {
      reply_markup: this.supportKeyboard,
    });
  }

  /**
   * Idempotently set `user.fullName` to the value found in the staff sheet,
   * but never overwrite a value the user has already saved themselves.
   * Also keeps Telegram first/last/username fresh.
   */
  private async persistSheetFullName(
    telegramId: number,
    firstName: string,
    lastName: string | undefined,
    username: string | undefined,
    sheetFullName: string,
  ): Promise<void> {
    const dbUser = await this.users.upsertFromTelegram({
      telegramId,
      firstName,
      lastName,
      username,
    });
    if (!dbUser.fullName && sheetFullName) {
      await this.userModel
        .updateOne(
          {
            _id: dbUser._id,
            $or: [{ fullName: { $exists: false } }, { fullName: '' }, { fullName: null }],
          },
          { $set: { fullName: sheetFullName } },
        )
        .catch((err: Error) =>
          this.logger.warn(`persistSheetFullName failed: ${err.message}`),
        );
    }
  }

  private async handleGroupStart(ctx: Context): Promise<void> {
    const existing = ctx.chat ? await this.groups.findByChat(ctx.chat.id) : null;
    if (existing) {
      await ctx.reply(
        `Цей чат привʼязано до групи <b>${escapeHtml(existing.academicName)}</b>.`,
        { parse_mode: 'HTML' },
      );
      return;
    }
    await ctx.reply(
      'Щоб привʼязати цей чат до академічної групи, староста має надіслати /verify.',
    );
  }

  // ---------- /now /left ----------

  private async handleNowOrLeft(ctx: Context, kind: 'now' | 'left'): Promise<void> {
    // ── Group chat ────────────────────────────────────────────────────────────
    if (isGroupChat(ctx)) {
      const group = ctx.chat ? await this.groups.findByChat(ctx.chat.id) : null;
      if (!group) {
        await ctx.reply(
          'Цей чат ще не привʼязано до академгрупи. Надішліть /verify щоб привʼязати.',
        );
        return;
      }

      let text: string;
      try {
        const result = await this.schedule.nowForGroup(String(group._id));
        const current = result.current as LessonSlim | null;
        const next = result.next as LessonSlim | null;
        text =
          kind === 'now'
            ? formatNow(group.academicName, current, next, result.weekType)
            : formatLeft(group.academicName, current, next);
      } catch {
        text = 'Розклад ще не імпортовано для цієї групи.';
      }
      await ctx.reply(text, { parse_mode: 'HTML' });
      return;
    }

    // ── Private chat ──────────────────────────────────────────────────────────
    const from = ctx.from;
    if (!from) return;
    const dbUser = await this.users.findByTelegramId(from.id);
    if (!dbUser || !dbUser.memberships?.length) {
      await ctx.reply(
        'Щоб користуватись цією командою, ви маєте бути учасником якоїсь групи. ' +
          'Попросіть старосту додати бота у ваш груповий чат.',
        { reply_markup: this.supportKeyboard },
      );
      return;
    }

    const m = dbUser.memberships[0];
    const groupId = String(m.groupId);
    const userId = String(dbUser._id);
    const group = await this.groups.findById(groupId).catch(() => null);
    const groupName = group?.academicName ?? '—';

    let text: string;
    try {
      const result = await this.schedule.nowFor(groupId, userId);
      const current = result.current as LessonSlim | null;
      const next = result.next as LessonSlim | null;
      text =
        kind === 'now'
          ? formatNow(groupName, current, next, result.weekType)
          : formatLeft(groupName, current, next);
    } catch {
      text = 'Розклад ще не імпортовано для вашої групи.';
    }
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: this.supportKeyboard });
  }

  // ---------- /verify ----------

  private async handleVerify(ctx: Context): Promise<void> {
    const from = ctx.from;
    if (!from?.username) {
      await ctx.reply('Для верифікації у старости має бути @username у Telegram.');
      return;
    }
    if (!ctx.chat) return;

    const existing = await this.groups.findByChat(ctx.chat.id);
    if (existing) {
      await ctx.reply(
        `Цей чат уже привʼязано до групи <b>${escapeHtml(existing.academicName)}</b>. ` +
          'Якщо потрібно перепривʼязати — використайте /migrate з нового чату.',
        { parse_mode: 'HTML' },
      );
      return;
    }

    // Explicit-name override: `/verify ІП-55`. Available always so dev/test groups
    // can be bound even without a Sheets table; restricted to chat admins/creators.
    const args = typeof ctx.match === 'string' ? ctx.match.trim() : '';
    if (args) {
      const isAdmin = await this.isChatAdmin(ctx, from.id);
      if (!isAdmin) {
        await ctx.reply(
          'Привʼязати чат із прямою назвою групи може тільки адміністратор чату. ' +
            'Або зверніться до старости, щоб виконав /verify без аргументів.',
        );
        return;
      }
      await this.bindExact(ctx, args, { skipAuthCheck: true });
      return;
    }

    if (!this.sheets.isConfigured()) {
      await ctx.reply(
        'База старост ще не налаштована. Староста може тимчасово привʼязати чат прямо: ' +
          '/verify <НазваГрупи> — наприклад, /verify ІП-55.',
      );
      return;
    }

    const heads = await this.sheets
      .findHeadsByUsername(from.username)
      .catch(() => [] as SheetGroupHead[]);
    if (heads.length === 0) {
      await ctx.reply(
        'Ваш Telegram-тег не знайдено серед старост у таблиці. ' +
          'Якщо ви маєте бути старостою — зверніться до адміністратора. ' +
          'Або, якщо ви — адмін чату, можете зразу привʼязати назвою: /verify <НазваГрупи>.',
      );
      return;
    }

    if (heads.length === 1) {
      await this.bindExact(ctx, heads[0].groupName);
      return;
    }

    const keyboard = new InlineKeyboard();
    for (const h of heads) keyboard.text(h.groupName, `bind:${h.groupName}`).row();
    await ctx.reply(
      'Ви староста кількох груп. Оберіть, до якої групи привʼязати цей чат:',
      { reply_markup: keyboard },
    );
  }

  /**
   * Build the /help text using only commands available to the user in the
   * current chat context. Heads/deputies see /verify and /migrate; regular
   * students see only /now /left /help; private chat skips group-only ones.
   */
  private async buildHelpText(ctx: Context): Promise<string> {
    const isPrivate = ctx.chat?.type === 'private';
    const isGroup = ctx.chat ? isGroupChatType(ctx.chat.type) : false;
    const lines: string[] = ['Команди:', '/start — початок роботи та відкриття міні-застосунку'];
    const isAdminChat = this.isAdminChat(ctx);

    let canManage = false;
    let isHead = false;
    if (ctx.from) {
      // Head detection — by Sheets and/or by being head of any group in DB.
      const myGroups = await this.groups.findByHeadTelegramId(ctx.from.id).catch(() => []);
      isHead = myGroups.length > 0;
      if (!isHead && this.sheets.isConfigured() && ctx.from.username) {
        const heads = await this.sheets
          .findHeadsByUsername(ctx.from.username)
          .catch(() => [] as SheetGroupHead[]);
        isHead = heads.length > 0;
      }
      canManage = isHead;
      // For group chats, also let the chat admin run /verify.
      if (!canManage && !isPrivate) {
        canManage = await this.isChatAdmin(ctx, ctx.from.id);
      }
    }

    if (!isPrivate && canManage) {
      lines.push('/verify — привʼязати цей чат до академгрупи');
      lines.push('/verify <Назва> — привʼязати вручну (для адмінів чату або без бази старост)');
      lines.push('/migrate — перенести привʼязку у новий чат або гілку');
    }
    lines.push('/now — яка зараз пара');
    lines.push('/left — скільки хвилин до кінця пари');
    if (isPrivate) {
      lines.push('/support — написати адміністраторам');
    }
    if (isAdminChat) {
      lines.push('/refresh_heads — оновити базу старост зі Sheets');
    }
    lines.push('/help — ця довідка');
    return lines.join('\n');
  }

  /** True if the user is `administrator` or `creator` of the chat where ctx originates. */
  private async isChatAdmin(ctx: Context, userId: number): Promise<boolean> {
    if (!ctx.chat) return false;
    try {
      const member = await ctx.api.getChatMember(ctx.chat.id, userId);
      return member.status === 'administrator' || member.status === 'creator';
    } catch (err) {
      this.logger.warn(`getChatMember failed: ${(err as Error).message}`);
      return false;
    }
  }

  private async bindExact(
    ctx: Context,
    groupName: string,
    opts: { skipAuthCheck?: boolean } = {},
  ): Promise<void> {
    const from = ctx.from;
    if (!from || !ctx.chat) return;

    try {
      const campusMatches = await this.campus.findGroupByName(groupName).catch(() => []);
      const campusGroupId = campusMatches[0]?.id;
      const group = await this.groups.bindTelegramChat({
        telegramChatId: ctx.chat.id,
        academicName: groupName,
        campusGroupId,
        headTelegramId: from.id,
        headTelegramUsername: from.username ?? '',
        headFirstName: from.first_name,
        headLastName: from.last_name,
        skipAuthCheck: opts.skipAuthCheck,
      });
      const campusNote = campusGroupId
        ? 'Групу знайдено у Кампусі — розклад буде імпортовано.'
        : 'Групу у Кампусі не знайдено — розклад можна буде додати вручну у застосунку.';
      await ctx.reply(
        `Групу <b>${escapeHtml(group.academicName)}</b> привʼязано.\n${campusNote}`,
        { parse_mode: 'HTML' },
      );
      await this.notifyAdminChat(
        `🔗 Чат <b>${escapeHtml(group.academicName)}</b> верифіковано і привʼязано.\n` +
          `Староста: <b>${escapeHtml(from.first_name)}${from.last_name ? ` ${escapeHtml(from.last_name)}` : ''}</b>` +
          (from.username ? ` (@${escapeHtml(from.username.replace(/^@+/, ''))})` : ''),
      );
      // Best-effort: pull chat admins as members so they're visible in the journal
      // without having to write a message first.
      if (ctx.chat) await this.harvestChatAdmins(ctx.chat.id);
    } catch (err) {
      await ctx.reply(`Не вдалося привʼязати: ${(err as Error).message}`);
    }
  }

  /**
   * After a chat is bound, pull its administrators (head / deputies / etc.) and
   * register them as group members so they appear in the journal even before
   * they post anything. Telegram Bot API can't enumerate regular members — those
   * still get auto-onboarded when they message in the chat.
   */
  private async harvestChatAdmins(chatId: number): Promise<void> {
    if (!this.bot) return;
    const group = await this.groups.findByChat(chatId);
    if (!group) return;
    try {
      const admins = await this.bot.api.getChatAdministrators(chatId);
      for (const a of admins) {
        const u = a.user;
        if (u.is_bot) continue;
        await this.ensureMember(group, u);
      }
      this.logger.log(
        `Harvested ${admins.length} admins for group ${group.academicName} (${chatId})`,
      );
    } catch (err) {
      this.logger.warn(`getChatAdministrators failed for ${chatId}: ${(err as Error).message}`);
    }
  }

  private async bindByHead(
    chatId: number,
    head: SheetGroupHead,
    adder: { id: number; first_name: string; last_name?: string; username?: string },
  ): Promise<void> {
    const campusMatches = await this.campus.findGroupByName(head.groupName).catch(() => []);
    const campusGroupId = campusMatches[0]?.id;
    await this.groups.bindTelegramChat({
      telegramChatId: chatId,
      academicName: head.groupName,
      campusGroupId,
      headTelegramId: adder.id,
      headTelegramUsername: adder.username ?? head.telegramUsername,
      headFirstName: adder.first_name,
      headLastName: adder.last_name,
    });
    await this.notifyAdminChat(
      `🔗 Чат <b>${escapeHtml(head.groupName)}</b> привʼязано до бота.\n` +
        `Староста: <b>${escapeHtml(adder.first_name)}${adder.last_name ? ` ${escapeHtml(adder.last_name)}` : ''}</b>` +
        (adder.username ? ` (@${escapeHtml(adder.username.replace(/^@+/, ''))})` : ''),
    );
  }

  private async buildPrivateStartNotice(
    from: { first_name: string; last_name?: string; username?: string },
    dbUser: UserDocument | null,
  ): Promise<string | null> {
    const displayName =
      dbUser?.fullName?.trim() ||
      [dbUser?.firstName, dbUser?.lastName].filter(Boolean).join(' ').trim() ||
      from.first_name;
    const username = (from.username ?? dbUser?.username ?? '').replace(/^@+/, '').trim();

    const hasHeadMembership = (dbUser?.memberships ?? []).some(
      (m) => m.role === Role.GroupHead || m.role === Role.DeputyHead,
    );
    if (hasHeadMembership) {
      return `👤 Староста запустив бота: <b>${escapeHtml(displayName)}</b>${username ? ` (@${escapeHtml(username)})` : ''}`;
    }

    const hasTeacherMembership = (dbUser?.memberships ?? []).some((m) => m.role === Role.Teacher);
    if (hasTeacherMembership) {
      return `👤 Викладач запустив бота: <b>${escapeHtml(displayName)}</b>${username ? ` (@${escapeHtml(username)})` : ''}`;
    }

    if (username && this.sheets.isConfigured()) {
      const heads = await this.sheets.findHeadsByUsername(username).catch(() => [] as SheetGroupHead[]);
      if (heads.length > 0) {
        return `👤 Староста запустив бота: <b>${escapeHtml(displayName)}</b>${username ? ` (@${escapeHtml(username)})` : ''}`;
      }
      const teacher = await this.sheets.findTeacherByUsername(username).catch(() => undefined);
      if (teacher) {
        return `👤 Викладач запустив бота: <b>${escapeHtml(displayName)}</b>${username ? ` (@${escapeHtml(username)})` : ''}`;
      }
    }

    return null;
  }

  // ---------- /migrate ----------

  private async handleMigrate(ctx: Context): Promise<void> {
    const from = ctx.from;
    if (!from?.username) {
      await ctx.reply('Для /migrate у старости має бути @username у Telegram.');
      return;
    }
    if (!ctx.chat) return;
    const threadId = ctx.message?.message_thread_id;

    // What groups does this head already own in our DB?
    const myGroups = await this.groups.findByHeadTelegramId(from.id);
    if (myGroups.length === 0) {
      await ctx.reply(
        'Не знайшов жодної вашої групи у системі. Спочатку запустіть /verify, ' +
          'щоб привʼязати першу групу.',
      );
      return;
    }

    if (myGroups.length === 1) {
      await this.migrateExact(ctx, myGroups[0].academicName, threadId);
      return;
    }

    const keyboard = new InlineKeyboard();
    for (const g of myGroups) keyboard.text(g.academicName, `migrate:${g.academicName}`).row();
    await ctx.reply(
      'Оберіть, яку з ваших груп перенести у цей чат:',
      { reply_markup: keyboard },
    );
  }

  private async migrateExact(
    ctx: Context,
    academicName: string,
    explicitThreadId?: number,
  ): Promise<void> {
    const from = ctx.from;
    if (!from || !ctx.chat) return;
    const threadId = explicitThreadId ?? ctx.message?.message_thread_id;
    try {
      const group = await this.groups.migrateGroupChat({
        headTelegramId: from.id,
        academicName,
        newTelegramChatId: ctx.chat.id,
        messageThreadId: threadId,
      });
      const note = threadId
        ? `Повідомлення тепер надсилатимуться у цю гілку (id ${threadId}).`
        : 'Чат успішно перенесено.';
      await ctx.reply(
        `Групу <b>${escapeHtml(group.academicName)}</b> перепривʼязано до цього чату.\n${note}`,
        { parse_mode: 'HTML' },
      );
    } catch (err) {
      await ctx.reply(`Не вдалося перенести: ${(err as Error).message}`);
    }
  }

  // ---------- support / admin tickets ----------

  /**
   * User sent a non-command text in private chat. Show a confirmation prompt
   * with "Надіслати" / "Скасувати" buttons.
   */
  private async handlePrivateSupportMessage(ctx: Context): Promise<void> {
    if (!ctx.message?.message_id || !ctx.from) return;
    const preview = (ctx.message.text ?? '').slice(0, 100);
    const kb = new InlineKeyboard()
      .text('📨 Надіслати адміністратору', `support:send:${ctx.message.message_id}`)
      .text('✕ Скасувати', 'support:cancel');
    await ctx.reply(
      `Надіслати це повідомлення адміністраторам?\n\n<i>${escapeHtml(preview)}</i>`,
      { parse_mode: 'HTML', reply_markup: kb },
    );
  }

  /**
   * User pressed "Надіслати". Delete the prompt, react on their message,
   * copy the content to the admin chat (we use copyMessage instead of
   * forwardMessage so users with "restrict forwarding" privacy settings
   * still get their message delivered — admins see a normal-looking message
   * preceded by a header card with the sender's name + a tg-link).
   */
  private async handleSupportSend(ctx: Context, userMessageId: number): Promise<void> {
    if (!ctx.from || !ctx.chat || !this.bot) return;
    const adminChatId = this.adminChatId;
    if (!adminChatId) return;

    // 1. Delete the bot's confirmation message.
    try { await ctx.deleteMessage(); } catch { /* already gone */ }

    // 2. React on the user's original message to confirm receipt.
    try {
      await ctx.api.setMessageReaction(ctx.chat.id, userMessageId, [
        { type: 'emoji', emoji: '👌' },
      ]);
    } catch { /* reaction not critical — old clients may not support it */ }

    // 3. Copy the user's message into the admin chat.
    let adminMsg: { message_id: number } | undefined;
    try {
      // Prepend a small "from" header so admins know who wrote it. Also serves
      // as the message admins should "Reply" to — the routing finds the ticket
      // by either the header or the copied content message id.
      const fromName =
        [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ') ||
        ctx.from.username ||
        String(ctx.from.id);
      const header =
        `👤 <b>${escapeHtml(fromName)}</b>` +
        (ctx.from.username ? ` (@${ctx.from.username})` : '') +
        ` — <a href="tg://user?id=${ctx.from.id}">написати</a>` +
        `\n<i>Натисніть «Відповісти» на будь-яке з повідомлень нижче, щоб написати у відповідь.</i>`;
      const headerMsg = await this.bot.api.sendMessage(adminChatId, header, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
      });
      // copyMessage works even when the user has "Forward restricted" set in
      // privacy settings (forwardMessage would fail with 400 in that case).
      adminMsg = await this.bot.api.copyMessage(
        adminChatId,
        ctx.chat.id,
        userMessageId,
      );
      // Track BOTH the header and the content message — admins can reply to
      // either one, so we need to route both back to the same ticket.
      await this.tickets.create({
        userTelegramId: ctx.from.id,
        userMessageId,
        adminMessageIds: [headerMsg.message_id, adminMsg.message_id],
      });
    } catch (err) {
      const msg = (err as Error).message;
      // Distinguish between configuration errors (bad ADMIN_CHAT_ID) and
      // transient ones (Telegram API hiccup) so we can give a useful log line
      // and a user-facing message that doesn't pretend the issue is on their end.
      if (/chat not found/i.test(msg)) {
        this.logger.error(
          `ADMIN_CHAT_ID=${adminChatId} is unreachable (chat not found). ` +
          `Either the bot was removed from that chat or the env var is wrong — ` +
          `for supergroups use the "-100xxxxxxxxxx" form, for legacy groups "-xxxxxxxxx".`,
        );
      } else {
        this.logger.warn(`failed to deliver to admin chat: ${msg}`);
      }
      await this.sendMessage(
        ctx.chat.id,
        'На жаль, чат підтримки тимчасово недоступний — повідомлення не було доставлено. ' +
          'Адміністратори вже знають про проблему, спробуйте трохи пізніше.',
      );
      return;
    }
  }

  /**
   * Admin replied to a message in the admin group.
   *
   * We look up a ticket whose `adminMessageIds` array contains the message that
   * was replied to. If found we:
   *  1. Copy the reply to the original user (no "Forwarded from" header).
   *  2. Add the admin's new message ID to the ticket's array so the next reply
   *     in this chain is also routed correctly (multi-turn support).
   */
  private async handleAdminReply(ctx: Context, repliedToMessageId: number): Promise<void> {
    if (!ctx.message || !this.adminChatId || !this.bot) return;

    // `{ adminMessageIds: X }` finds documents where the array contains X.
    const ticket = await this.tickets
      .findOne({ adminMessageIds: repliedToMessageId })
      .exec();
    if (!ticket) return;

    // Copy the admin's reply to the user (no "forwarded from" header).
    try {
      await this.sendMessage(ticket.userTelegramId, '<b>Це відповідь на ваш запит у підтримці.</b>');
      await this.bot.api.copyMessage(ticket.userTelegramId, this.adminChatId, ctx.message.message_id);
    } catch (err) {
      this.logger.warn(
        `failed to send admin reply to user ${ticket.userTelegramId}: ${(err as Error).message}`,
      );
      return;
    }

    try {
      await ctx.api.setMessageReaction(this.adminChatId, ctx.message.message_id, [
        { type: 'emoji', emoji: '👍' },
      ]);
    } catch {
      /* reaction not critical */
    }

    // Grow the chain so the admin can reply to their own reply next time.
    await this.tickets.updateOne(
      { _id: ticket._id },
      { $addToSet: { adminMessageIds: ctx.message.message_id } },
    );
  }

  // ---------- membership revalidation ----------

  /**
   * Cross-check a user's memberships against Telegram. If they're no longer in
   * a chat (status `left`/`kicked`), drop that membership. Updates
   * `membershipsValidatedAt` even if nothing changed so callers can use it as a
   * cache key. Safe to call concurrently — Mongo upserts are idempotent.
   */
  async revalidateUserMemberships(userId: string): Promise<{ removed: number }> {
    if (!this.bot) return { removed: 0 };
    const user = await this.userModel.findById(userId).exec();
    if (!user) return { removed: 0 };
    if (!user.memberships?.length) {
      user.membershipsValidatedAt = new Date();
      await user.save();
      return { removed: 0 };
    }

    const stale: string[] = [];
    for (const m of user.memberships) {
      const group = await this.groups.findById(String(m.groupId)).catch(() => null);
      if (!group?.telegramChatId) continue;
      try {
        const status = await this.bot.api.getChatMember(group.telegramChatId, user.telegramId);
        if (status.status === 'left' || status.status === 'kicked') {
          stale.push(String(m.groupId));
        }
      } catch (err) {
        // 400 "user not found" / "chat not found" → also treat as gone.
        const msg = (err as Error).message ?? '';
        if (/user not found|member.*not found/i.test(msg)) {
          stale.push(String(m.groupId));
        } else {
          this.logger.warn(
            `getChatMember failed for u=${user.telegramId} g=${group.telegramChatId}: ${msg}`,
          );
        }
      }
    }

    if (stale.length) {
      user.memberships = user.memberships.filter(
        (m) => !stale.includes(String(m.groupId)),
      );
    }
    user.membershipsValidatedAt = new Date();
    await user.save();
    if (stale.length) {
      this.logger.log(
        `Revalidated u=${user.telegramId}: removed ${stale.length} stale membership(s)`,
      );
    }
    return { removed: stale.length };
  }

  /** 12-hour bulk revalidation of every user that has at least one membership. */
  @Cron('0 0 */12 * * *')
  async revalidateAllMemberships(): Promise<void> {
    if (!this.bot) return;
    try {
      const users = await this.userModel
        .find({ 'memberships.0': { $exists: true } }, { _id: 1 })
        .lean()
        .exec();
      let totalRemoved = 0;
      for (const u of users) {
        const r = await this.revalidateUserMemberships(String(u._id)).catch(() => ({ removed: 0 }));
        totalRemoved += r.removed;
      }
      this.logger.log(
        `Membership cron: scanned ${users.length} users, removed ${totalRemoved} stale memberships`,
      );
    } catch (err) {
      this.logger.warn(`revalidateAllMemberships failed: ${(err as Error).message}`);
    }
  }
}

function isGroupChat(ctx: Context): boolean {
  return !!ctx.chat && isGroupChatType(ctx.chat.type);
}

function isGroupChatType(t: string): boolean {
  return t === 'group' || t === 'supergroup';
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Schedule formatting ───────────────────────────────────────────────────────

interface LessonSlim {
  subjectName: string;
  startTime: string;
  endTime: string;
  room?: string;
  meetingUrl?: string;
}

function formatNow(
  groupName: string,
  current: LessonSlim | null,
  next: LessonSlim | null,
  weekType: 1 | 2,
): string {
  const week = weekType === 1 ? 'I тиждень' : 'II тиждень';
  const lines: string[] = [`<b>${escapeHtml(groupName)}</b> · ${week}`];

  if (current) {
    lines.push(
      `\n🟢 <b>Зараз:</b> ${escapeHtml(current.subjectName)}` +
        `\n    ${current.startTime} — ${current.endTime}` +
        (current.room ? ` · ${escapeHtml(current.room)}` : '') +
        (current.meetingUrl ? `\n    🔗 <a href="${current.meetingUrl}">Перейти до зустрічі</a>` : ''),
    );
  }

  if (next) {
    lines.push(
      `\n⏳ <b>Наступна:</b> ${escapeHtml(next.subjectName)}` +
        `\n    ${next.startTime} — ${next.endTime}` +
        (next.room ? ` · ${escapeHtml(next.room)}` : ''),
    );
  }

  if (!current && !next) {
    lines.push('\nСьогодні пар більше немає 🎉');
  }

  return lines.join('');
}

function formatLeft(
  groupName: string,
  current: LessonSlim | null,
  next: LessonSlim | null,
): string {
  if (!current) {
    if (!next) {
      return `<b>${escapeHtml(groupName)}</b>\nСьогодні пар більше немає 🎉`;
    }
    const [h, m] = next.startTime.split(':').map(Number);
    const now = new Date();
    const diff = h * 60 + m - (now.getHours() * 60 + now.getMinutes());
    return (
      `<b>${escapeHtml(groupName)}</b>\n` +
      `Зараз пари немає.\n` +
      `⏳ Наступна: <b>${escapeHtml(next.subjectName)}</b> — через ${diff} хв (о ${next.startTime})`
    );
  }

  const [eH, eM] = current.endTime.split(':').map(Number);
  const now = new Date();
  const left = eH * 60 + eM - (now.getHours() * 60 + now.getMinutes());
  return (
    `<b>${escapeHtml(groupName)}</b>\n` +
    `🟢 <b>${escapeHtml(current.subjectName)}</b>\n` +
    `До кінця: <b>${left} хв</b> (до ${current.endTime})`
  );
}
