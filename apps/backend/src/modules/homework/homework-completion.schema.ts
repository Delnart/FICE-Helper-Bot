import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

@Schema({ timestamps: true, collection: 'homework_completions' })
export class HomeworkCompletion {
  @Prop({ type: Types.ObjectId, ref: 'Homework', required: true, index: true })
  homeworkId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ default: false }) done!: boolean;
  @Prop() doneAt?: Date;
}

export type HomeworkCompletionDocument = HydratedDocument<HomeworkCompletion>;
export const HomeworkCompletionSchema = SchemaFactory.createForClass(HomeworkCompletion);
HomeworkCompletionSchema.index({ homeworkId: 1, userId: 1 }, { unique: true });
