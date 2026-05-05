import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { QueueStatus } from '@fice/shared';

@Schema({ _id: false })
export class QueueEntrySub {
  @Prop({ required: true }) slotIndex!: number;
  @Prop({ type: Types.ObjectId, ref: 'User', required: true }) userId!: Types.ObjectId;
  @Prop({ required: true, min: 0 }) labNumber!: number;
  @Prop({ type: String, enum: Object.values(QueueStatus), default: QueueStatus.Default })
  status!: QueueStatus;
  @Prop({ type: Date, default: () => new Date() }) enrolledAt!: Date;
}
const QueueEntrySubSchema = SchemaFactory.createForClass(QueueEntrySub);

@Schema({ _id: false })
export class QueueRulesSub {
  @Prop({ default: false }) allowMultipleEntriesPerUser!: boolean;
  @Prop({ default: false }) allowGroupSubmission!: boolean;
  @Prop({ default: true }) isOpen!: boolean;
  @Prop() autoOpenAt?: Date;
  @Prop() autoCloseAt?: Date;
}
const QueueRulesSubSchema = SchemaFactory.createForClass(QueueRulesSub);

@Schema({ timestamps: true, collection: 'queues' })
export class Queue {
  @Prop({ type: Types.ObjectId, ref: 'Subject', required: true, index: true })
  subjectId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'AcademicGroup', required: true, index: true })
  groupId!: Types.ObjectId;

  @Prop({ required: true }) title!: string;

  @Prop({ required: true, min: 1, max: 50 }) slotsCount!: number;

  @Prop({ type: QueueRulesSubSchema, default: () => ({}) })
  rules!: QueueRulesSub;

  @Prop({ type: [QueueEntrySubSchema], default: [] })
  entries!: QueueEntrySub[];

  @Prop({ type: Types.ObjectId, ref: 'User', required: true }) createdBy!: Types.ObjectId;
}

export type QueueDocument = HydratedDocument<Queue>;
export const QueueSchema = SchemaFactory.createForClass(Queue);
