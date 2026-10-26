import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { QueueStatus } from '@fice/shared';

@Schema({ _id: false })
export class QueueEntrySub {
  @Prop({ required: true }) slotIndex!: number;
  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true }) userId!: Types.ObjectId;
  @Prop({ required: true, min: 0 }) labNumber!: number;
  @Prop({ type: String, enum: Object.values(QueueStatus), default: QueueStatus.Default })
  status!: QueueStatus;
  @Prop({ type: Date, default: () => new Date() }) enrolledAt!: Date;
  /** When this entry last became `passing` / reached passed·missed·failed (QueuesService.setEntryStatus). */
  @Prop() startedAt?: Date;
  @Prop() finishedAt?: Date;
}
const QueueEntrySubSchema = SchemaFactory.createForClass(QueueEntrySub);

@Schema({ _id: false })
export class QueueRulesSub {
  @Prop({ default: false }) allowMultipleEntriesPerUser!: boolean;
  @Prop({ default: false }) allowGroupSubmission!: boolean;
  @Prop({ default: true }) isOpen!: boolean;
  @Prop() autoOpenAt?: Date;
  @Prop() autoCloseAt?: Date;
  /** Spreadsheet mode: an entry marked `passed` is removed and everyone below moves up. */
  @Prop({ default: false }) autoCompact!: boolean;
}
const QueueRulesSubSchema = SchemaFactory.createForClass(QueueRulesSub);

// optimisticConcurrency: every save() is a compare-and-swap on __v, so
// concurrent load-check-save writers (QueuesService.mutateQueue) can't
// silently overwrite each other.
@Schema({ timestamps: true, collection: 'queues', optimisticConcurrency: true })
export class Queue {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Subject', required: true, index: true })
  subjectId!: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'AcademicGroup', required: true, index: true })
  groupId!: Types.ObjectId;

  @Prop({ required: true }) title!: string;

  @Prop({ required: true, min: 1, max: 50 }) slotsCount!: number;

  @Prop({ type: QueueRulesSubSchema, default: () => ({}) })
  rules!: QueueRulesSub;

  @Prop({ type: [QueueEntrySubSchema], default: [] })
  entries!: QueueEntrySub[];

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true }) createdBy!: Types.ObjectId;

  /** Running total of timed passes (passing → passed/failed) — feeds the "орієнтовно через N хв" ETA. */
  @Prop({ default: 0 }) passedCount!: number;
  @Prop({ default: 0 }) passedMsTotal!: number;
}

export type QueueDocument = HydratedDocument<Queue>;
export const QueueSchema = SchemaFactory.createForClass(Queue);
// Scheduler polls 'rules.autoOpenAt' every minute; most queues never set it.
QueueSchema.index({ 'rules.autoOpenAt': 1 }, { sparse: true });
// One queue per subject: closes findOrCreateForSubject's find-then-create race.
// Existing duplicates must be removed first (the migration script dedupes them),
// otherwise the index build fails on startup.
QueueSchema.index({ subjectId: 1, groupId: 1 }, { unique: true });
