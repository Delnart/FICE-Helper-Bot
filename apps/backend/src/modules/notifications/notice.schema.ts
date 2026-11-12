import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/**
 * A message from the developer to everyone who uses the Mini App: it comes up there once, when the app is
 * opened, and stays under «Сповіщення». Written with /notice in the admins' chat (BotService).
 */
@Schema({ timestamps: true, collection: 'notices' })
export class Notice {
  @Prop({ required: true }) title!: string;
  @Prop({ default: '' }) body!: string;
}

export type NoticeDocument = HydratedDocument<Notice>;
export const NoticeSchema = SchemaFactory.createForClass(Notice);
