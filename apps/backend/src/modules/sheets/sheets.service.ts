import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import { google, sheets_v4 } from 'googleapis';
import { Role } from '@fice/shared';
import { User, UserDocument } from '../users/user.schema';
import { AcademicGroup, AcademicGroupDocument } from '../groups/group.schema';
import { Subject, SubjectDocument } from '../subjects/subject.schema';

export interface SheetGroupHead {
  groupName: string;
  telegramUsername: string;
  fullName: string;
}

export interface SheetTeacher {
  fullName: string;
  phone?: string;
  telegramUsername?: string;
}

export interface SyncResult {
  granted: number;   // head role newly added / confirmed
  revoked: number;   // head role stripped (user removed from sheet)
  skipped: number;   // user or group not found in DB yet
}

@Injectable()
export class SheetsService implements OnModuleInit {
  private readonly logger = new Logger(SheetsService.name);
  private sheets?: sheets_v4.Sheets;
  private sheetId?: string;

  private cacheHeads: SheetGroupHead[] = [];
  private cacheTeachers: SheetTeacher[] = [];
  private cacheLoadedAt = 0;
  private readonly cacheTtlMs = 12 * 60 * 60 * 1000; // 12 h

  constructor(
    private readonly config: ConfigService,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(AcademicGroup.name) private readonly groupModel: Model<AcademicGroupDocument>,
    @InjectModel(Subject.name) private readonly subjectModel: Model<SubjectDocument>,
  ) {}

  async onModuleInit(): Promise<void> {
    const email = this.config.get<string>('GOOGLE_SERVICE_ACCOUNT_EMAIL');
    const key = (this.config.get<string>('GOOGLE_PRIVATE_KEY') ?? '').replace(/\\n/g, '\n');
    const sheetId =
      this.config.get<string>('GOOGLE_SPREADSHEET_ID') ??
      this.config.get<string>('GOOGLE_SHEETS_ID');

    if (!email || !key || !sheetId) {
      this.logger.log('Google Sheets not configured — staff lookups disabled');
      return;
    }
    const auth = new google.auth.JWT({
      email,
      key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    this.sheets = google.sheets({ version: 'v4', auth });
    this.sheetId = sheetId;

    try {
      await this.ensureCache();
      this.logger.log(
        `Sheets loaded at startup: ${this.cacheHeads.length} heads, ${this.cacheTeachers.length} teachers`,
      );
      const r = await this.syncHeads();
      if (r.granted + r.revoked > 0) {
        this.logger.log(
          `Sheets startup sync: +${r.granted} granted, -${r.revoked} revoked, ${r.skipped} skipped`,
        );
      }
      const t = await this.syncTeachers();
      if (t.revoked > 0) {
        this.logger.log(`Sheets startup teacher sync: -${t.revoked} revoked`);
      }
    } catch (err) {
      this.logger.warn(`Sheets startup failed: ${(err as Error).message}`);
    }
  }

  isConfigured(): boolean {
    return !!this.sheets && !!this.sheetId;
  }

  async refresh(): Promise<void> {
    this.cacheLoadedAt = 0;
    await this.ensureCache();
  }

  @Cron('0 0 */12 * * *')
  async cronRefresh(): Promise<void> {
    if (!this.isConfigured()) return;
    try {
      await this.refresh();
      this.logger.log(
        `Sheets cron refresh: ${this.cacheHeads.length} heads, ${this.cacheTeachers.length} teachers`,
      );
      const r = await this.syncHeads();
      if (r.granted + r.revoked > 0) {
        this.logger.log(
          `Sheets cron sync: +${r.granted} granted, -${r.revoked} revoked, ${r.skipped} skipped`,
        );
      }
      const t = await this.syncTeachers();
      if (t.revoked > 0) {
        this.logger.log(`Sheets cron teacher sync: -${t.revoked} revoked`);
      }
    } catch (err) {
      this.logger.warn(`Sheets cron refresh failed: ${(err as Error).message}`);
    }
  }

  async getHeads(): Promise<SheetGroupHead[]> {
    await this.ensureCache();
    return this.cacheHeads;
  }

  async getTeachers(): Promise<SheetTeacher[]> {
    await this.ensureCache();
    return this.cacheTeachers;
  }

  async findHead(telegramUsername: string): Promise<SheetGroupHead | undefined> {
    const all = await this.findHeadsByUsername(telegramUsername);
    return all[0];
  }

  async findHeadsByUsername(telegramUsername: string): Promise<SheetGroupHead[]> {
    const handle = normaliseTgHandle(telegramUsername);
    if (!handle) return [];
    const heads = await this.getHeads();
    return heads.filter((h) => normaliseTgHandle(h.telegramUsername) === handle);
  }

  async findTeacherByName(fullName: string): Promise<SheetTeacher | undefined> {
    const teachers = await this.getTeachers();
    const needle = fullName.trim().toLowerCase();
    return teachers.find((t) => t.fullName.toLowerCase() === needle);
  }

  async findTeacherByUsername(telegramUsername: string): Promise<SheetTeacher | undefined> {
    const handle = normaliseTgHandle(telegramUsername);
    if (!handle) return undefined;
    const teachers = await this.getTeachers();
    return teachers.find(
      (t) => !!t.telegramUsername && normaliseTgHandle(t.telegramUsername) === handle,
    );
  }

  /**
   * Sync DB roles with the current Sheets state:
   *   • Users no longer listed as head for a group → downgraded to student
   *   • Users listed in Sheets whose DB user + group both exist → granted group_head
   *
   * Safe to call repeatedly — fully idempotent.
   */
  async syncHeads(): Promise<SyncResult> {
    if (!this.isConfigured()) return { granted: 0, revoked: 0, skipped: 0 };

    const sheetHeads = await this.getHeads();

    // Build a fast-lookup map:  normGroupName → Set<normHandle>
    const authorisedByGroup = new Map<string, Set<string>>();
    for (const h of sheetHeads) {
      const handle = normaliseTgHandle(h.telegramUsername);
      if (!handle) continue;
      const key = normStr(h.groupName);
      if (!authorisedByGroup.has(key)) authorisedByGroup.set(key, new Set());
      authorisedByGroup.get(key)!.add(handle);
    }

    let granted = 0, revoked = 0, skipped = 0;

    // ── Step 1: revoke heads no longer listed in Sheets ──────────────────────
    const allGroups = await this.groupModel
      .find({ headUserId: { $exists: true, $ne: null } })
      .lean()
      .exec();

    for (const group of allGroups) {
      const headUser = await this.userModel.findById(group.headUserId).lean().exec();
      if (!headUser?.username) { skipped++; continue; }

      // Treat the head as "still in sheet" if ANY of (current username,
      // historical usernames) matches the authorised list. This prevents
      // silent revocation when the head changes their @ in Telegram and the
      // admin hasn't updated the sheet yet.
      const candidates = [
        normaliseTgHandle(headUser.username),
        ...(headUser.usernameHistory ?? [])
          .map((h) => normaliseTgHandle(h))
          .filter(Boolean),
      ].filter(Boolean);
      const authorised = authorisedByGroup.get(normStr(group.academicName));
      const stillAuthorised = candidates.some((h) => authorised?.has(h));

      // Head is still listed → nothing to do
      if (stillAuthorised) continue;

      // No longer listed → downgrade to student and clear headUserId
      await this.userModel.updateOne(
        { _id: group.headUserId, 'memberships.groupId': group._id },
        { $set: { 'memberships.$.role': Role.Student } },
      );
      await this.groupModel.updateOne(
        { _id: group._id },
        { $unset: { headUserId: '' } },
      );
      revoked++;
      this.logger.warn(
        `Sheets sync: revoked group_head from @${headUser.username} ` +
        `for group "${group.academicName}" (not in sheet — ` +
        `also checked previous tags: ${headUser.usernameHistory?.join(', ') ?? 'none'})`,
      );
    }

    // ── Step 2: grant / confirm heads listed in Sheets ────────────────────────
    for (const h of sheetHeads) {
      const handle = normaliseTgHandle(h.telegramUsername);
      if (!handle) { skipped++; continue; }

      // Find user by username (case-insensitive)
      const user = await this.userModel
        .findOne({ username: new RegExp(`^${escapeRegex(handle)}$`, 'i') })
        .lean()
        .exec();
      if (!user) { skipped++; continue; } // user hasn't opened the bot yet

      // Find group by academicName (case-insensitive)
      const group = await this.groupModel
        .findOne({ academicName: new RegExp(`^${escapeRegex(h.groupName.trim())}$`, 'i') })
        .lean()
        .exec();
      if (!group) { skipped++; continue; } // group not bound yet

      // Check current membership
      const membership = (user.memberships ?? []).find(
        (m) => String(m.groupId) === String(group._id),
      );
      if (membership?.role === Role.GroupHead) {
        // Already a head — still enforce teacher-exclusivity in case legacy
        // data lingers (the sheet is authoritative: a person can never be
        // both a head and a teacher simultaneously).
        if (user.campusLecturerId) {
          await this.userModel.updateOne(
            { _id: user._id },
            { $unset: { campusLecturerId: '' } },
          );
          this.logger.log(
            `Sheets sync: cleared stale campusLecturerId from head @${user.username}`,
          );
        }
        const stale = await this.subjectModel
          .updateMany(
            { 'teachers.teacherUserId': user._id },
            { $pull: { teachers: { teacherUserId: user._id } } },
          )
          .exec();
        if (stale.modifiedCount > 0) {
          this.logger.log(
            `Sheets sync: cleared stale teacher refs for head @${user.username} ` +
            `from ${stale.modifiedCount} subject(s)`,
          );
        }
        continue;
      }

      // Upsert membership as group_head
      await this.userModel.updateOne(
        { _id: user._id },
        { $pull: { memberships: { groupId: group._id } } },
      );
      await this.userModel.updateOne(
        { _id: user._id },
        {
          $push: {
            memberships: {
              groupId: new Types.ObjectId(String(group._id)),
              role: Role.GroupHead,
              joinedAt: new Date(),
            },
          },
        },
      );

      // Mutual exclusivity: a head can never simultaneously be a teacher.
      // Strip any leftover teacher data so they get the head UI cleanly.
      await this.userModel.updateOne(
        { _id: user._id },
        { $unset: { campusLecturerId: '' } },
      );
      const teacherCleanup = await this.subjectModel
        .updateMany(
          { 'teachers.teacherUserId': user._id },
          { $pull: { teachers: { teacherUserId: user._id } } },
        )
        .exec();
      if (teacherCleanup.modifiedCount > 0) {
        this.logger.log(
          `Sheets sync: cleared teacher refs for @${user.username} from ` +
          `${teacherCleanup.modifiedCount} subject(s) (head/teacher mutual exclusivity)`,
        );
      }

      // Also pre-fill fullName from sheet if user hasn't set one yet.
      if (!user.fullName && h.fullName) {
        await this.userModel.updateOne(
          { _id: user._id, $or: [{ fullName: { $exists: false } }, { fullName: '' }, { fullName: null }] },
          { $set: { fullName: h.fullName } },
        );
      }

      // Keep group.headUserId in sync
      await this.groupModel.updateOne(
        { _id: group._id },
        { $set: { headUserId: user._id } },
      );
      granted++;
      this.logger.log(
        `Sheets sync: granted group_head to @${user.username} for group "${group.academicName}"`,
      );
    }

    return { granted, revoked, skipped };
  }

  /**
   * Mirror image of `syncHeads` for the «Викладачі» sheet:
   *   • Users no longer listed as teachers → `$unset campusLecturerId`,
   *     remove from every `subjects.teachers` array, drop any teacher-role
   *     memberships.
   *
   * Idempotent. Does NOT grant teacher status — that happens via the
   * `/teachers/identify` flow when the user actually opens the app.
   */
  async syncTeachers(): Promise<{ revoked: number }> {
    if (!this.isConfigured()) return { revoked: 0 };
    const sheetTeachers = await this.getTeachers();

    // Set of normalised handles still listed in the sheet (teacher rows
    // without a Telegram tag aren't candidates for revocation).
    const stillListed = new Set<string>();
    for (const t of sheetTeachers) {
      if (t.telegramUsername) {
        const h = normaliseTgHandle(t.telegramUsername);
        if (h) stillListed.add(h);
      }
    }

    // Find every user we previously marked as a teacher (campusLecturerId
    // set, or referenced in any subjects.teachers array).
    const formerTeachers = await this.userModel
      .find(
        {
          $or: [
            { campusLecturerId: { $exists: true, $ne: null } },
            // Fallback to memberships: anyone with a teacher-role membership.
            { 'memberships.role': Role.Teacher },
          ],
        },
        { _id: 1, username: 1, campusLecturerId: 1, memberships: 1 },
      )
      .lean()
      .exec();

    let revoked = 0;
    for (const u of formerTeachers) {
      if (!u.username) continue;
      // Match against current OR any historical @ — protects renamed users.
      const candidates = [
        normaliseTgHandle(u.username),
        ...(u.usernameHistory ?? [])
          .map((h) => normaliseTgHandle(h))
          .filter(Boolean),
      ].filter(Boolean);
      const stillThere = candidates.some((h) => stillListed.has(h));
      if (stillThere) continue; // still listed → keep

      // Strip teacher artefacts.
      await this.userModel.updateOne(
        { _id: u._id },
        {
          $unset: { campusLecturerId: '' },
          $pull: { memberships: { role: Role.Teacher } },
        },
      );
      await this.subjectModel
        .updateMany(
          { 'teachers.teacherUserId': u._id },
          { $pull: { teachers: { teacherUserId: u._id } } },
        )
        .exec();
      revoked++;
      this.logger.warn(
        `Sheets sync: revoked teacher status from @${u.username} (not in Викладачі sheet)`,
      );
    }
    return { revoked };
  }

  private async ensureCache(): Promise<void> {
    if (!this.isConfigured()) return;
    if (Date.now() - this.cacheLoadedAt < this.cacheTtlMs && this.cacheHeads.length > 0) return;

    try {
      const resp = await this.sheets!.spreadsheets.values.batchGet({
        spreadsheetId: this.sheetId!,
        ranges: ['Старости!A2:C', 'Викладачі!A2:D'],
      });
      const valueRanges = resp.data.valueRanges ?? [];
      const headsRows = valueRanges[0]?.values ?? [];
      const teachersRows = valueRanges[1]?.values ?? [];

      // Sheet "Старости": A = Група, B = ПІБ, C = Тег
      this.cacheHeads = headsRows
        .filter((r) => r[0] && r[2])
        .map((r) => ({
          groupName: String(r[0]),
          fullName: r[1] ? String(r[1]) : '',
          telegramUsername: String(r[2]),
        }));

      // Sheet "Викладачі": A = ПІБ, B = Телефон (opt), C = Тег (opt)
      this.cacheTeachers = teachersRows
        .filter((r) => r[0])
        .map((r) => ({
          fullName: String(r[0]),
          phone: r[1] ? String(r[1]) : undefined,
          telegramUsername: r[2] ? String(r[2]) : undefined,
        }));

      this.cacheLoadedAt = Date.now();
    } catch (err) {
      this.logger.error(`Failed to refresh Sheets cache: ${(err as Error).message}`);
    }
  }
}

/** Lowercase + trim for case-insensitive group name comparison. */
function normStr(s: string): string {
  return s.trim().toLowerCase();
}

/** Escape special regex characters so a username can be used in `new RegExp(...)`. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Lowercase, dash- and dot-stripped Telegram handle. Accepts every common shape:
 *   "@vira_kpi", "vira_kpi",
 *   "t.me/vira_kpi", "https://t.me/vira_kpi",
 *   "https://vira_kpi.t.me", "tg://resolve?domain=vira_kpi".
 * Returns "" for anything we can't parse, which makes the filter robust to
 * blank or junk cells.
 */
export function normaliseTgHandle(input: string): string {
  if (!input) return '';
  const raw = input.trim();
  if (!raw) return '';
  // tg://resolve?domain=NAME
  const tgScheme = raw.match(/^tg:\/\/resolve\?domain=([A-Za-z0-9_]{3,})/i);
  if (tgScheme) return tgScheme[1].toLowerCase();
  // https://NAME.t.me  (or NAME.t.me)
  const subdomain = raw.match(/^(?:https?:\/\/)?([A-Za-z0-9_]{3,})\.t\.me\/?$/i);
  if (subdomain) return subdomain[1].toLowerCase();
  // (https?://)?(t.me|telegram.me)/NAME
  const path = raw.match(/(?:^|\/)(?:t|telegram)\.me\/([A-Za-z0-9_]{3,})/i);
  if (path) return path[1].toLowerCase();
  // Plain "@name" or "name"
  const plain = raw.replace(/^@+/, '').match(/^([A-Za-z0-9_]{3,})$/);
  if (plain) return plain[1].toLowerCase();
  return '';
}
