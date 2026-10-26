import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

@Schema({ timestamps: true, collection: 'announcements' })
export class Announcement {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'AcademicGroup', required: true, index: true })
  groupId!: Types.ObjectId;

  @Prop({ required: true }) title!: string;
  @Prop({ required: true }) body!: string;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true })
  createdBy!: Types.ObjectId;

  @Prop({ default: true }) visibleInMiniApp!: boolean;
  @Prop({ default: false }) broadcastedToChat!: boolean;
}

export type AnnouncementDocument = HydratedDocument<Announcement>;
export const AnnouncementSchema = SchemaFactory.createForClass(Announcement);
