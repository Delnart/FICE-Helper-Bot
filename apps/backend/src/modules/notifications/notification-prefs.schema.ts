import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

/** Opt-out flags send unless switched off; opt-in ones (digest, lesson reminder) only when switched on. */
export const PREF_DEFAULTS = {
  dmQueueOpen: true,
  dmNextInQueue: true,
  dmDeadlineTomorrow: true,
  dmSwapRequests: true,
  dmMorningDigest: false,
  dmLessonReminder: false,
};
export type PrefKey = keyof typeof PREF_DEFAULTS;
export const PREF_KEYS = Object.keys(PREF_DEFAULTS) as PrefKey[];

/** One group's own choices; a missing key falls back to the user-wide value. */
@Schema({ _id: false })
export class GroupPrefs {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'AcademicGroup', required: true })
  groupId!: Types.ObjectId;

  @Prop() dmQueueOpen?: boolean;
  @Prop() dmNextInQueue?: boolean;
  @Prop() dmDeadlineTomorrow?: boolean;
  @Prop() dmSwapRequests?: boolean;
  @Prop() dmMorningDigest?: boolean;
  @Prop() dmLessonReminder?: boolean;
}
const GroupPrefsSchema = SchemaFactory.createForClass(GroupPrefs);

@Schema({ timestamps: true, collection: 'notification_prefs' })
export class NotificationPrefs {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true, unique: true, index: true })
  userId!: Types.ObjectId;

  // User-wide values: what every group without its own entry gets (all data before per-group prefs).
  @Prop({ default: PREF_DEFAULTS.dmQueueOpen }) dmQueueOpen!: boolean;
  @Prop({ default: PREF_DEFAULTS.dmNextInQueue }) dmNextInQueue!: boolean;
  @Prop({ default: PREF_DEFAULTS.dmDeadlineTomorrow }) dmDeadlineTomorrow!: boolean;
  @Prop({ default: PREF_DEFAULTS.dmSwapRequests }) dmSwapRequests!: boolean;
  // Opt-in (unlike the above): only `true` in the DB sends, a missing field never does.
  @Prop({ default: PREF_DEFAULTS.dmMorningDigest }) dmMorningDigest!: boolean;
  @Prop({ default: PREF_DEFAULTS.dmLessonReminder }) dmLessonReminder!: boolean;

  /** Per-group overrides, at most one entry per group (kept in this doc so userId stays unique). */
  @Prop({ type: [GroupPrefsSchema], default: [] })
  groups!: GroupPrefs[];
}

export type NotificationPrefsDocument = HydratedDocument<NotificationPrefs>;
export const NotificationPrefsSchema = SchemaFactory.createForClass(NotificationPrefs);

type PrefValues = Partial<Record<PrefKey, boolean | null>>;
/** A prefs row as any reader gets it: hydrated, lean, raw driver doc, or none at all. */
export type PrefsLike = PrefValues & { groups?: Array<PrefValues & { groupId: unknown }> | null };

/**
 * The one rule for "does this DM go out": the group's own value, else the
 * user-wide one, else the default. `groupId` null → the user-wide value.
 */
export function effectivePref(prefs: PrefsLike | null | undefined, groupId: unknown, key: PrefKey): boolean {
  const own = groupId == null ? undefined : prefs?.groups?.find((g) => String(g.groupId) === String(groupId));
  return own?.[key] ?? prefs?.[key] ?? PREF_DEFAULTS[key];
}

export function effectivePrefs(prefs: PrefsLike | null | undefined, groupId?: unknown): Record<PrefKey, boolean> {
  return Object.fromEntries(PREF_KEYS.map((k) => [k, effectivePref(prefs, groupId, k)])) as Record<PrefKey, boolean>;
}

/** Rows that may want an opt-in DM somewhere — narrow per group with effectivePref. */
export function optedInSomewhere(key: PrefKey): Record<string, unknown> {
  return { $or: [{ [key]: true }, { [`groups.${key}`]: true }] };
}
