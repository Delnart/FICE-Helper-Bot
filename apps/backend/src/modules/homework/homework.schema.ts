import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

@Schema({ timestamps: true, collection: 'homework' })
export class Homework {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Subject', required: true, index: true })
  subjectId!: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'AcademicGroup', required: true, index: true })
  groupId!: Types.ObjectId;

  @Prop({ required: true }) title!: string;
  @Prop() description?: string;
  @Prop() deadline?: Date;
  @Prop({ min: 0 }) points?: number;
  @Prop({ default: 1, min: 0 }) teamSize!: number;

  @Prop({ type: [{ label: String, url: String }], default: [] })
  attachments!: Array<{ label: string; url: string }>;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true })
  createdBy!: Types.ObjectId;
}

export type HomeworkDocument = HydratedDocument<Homework>;
export const HomeworkSchema = SchemaFactory.createForClass(Homework);
