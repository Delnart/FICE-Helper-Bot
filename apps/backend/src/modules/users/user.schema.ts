import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { Role } from '@fice/shared';

@Schema({ _id: false })
export class MembershipSub {
  @Prop({ type: Types.ObjectId, ref: 'AcademicGroup', required: true })
  groupId!: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(Role), required: true })
  role!: Role;

  @Prop({ type: Date, default: () => new Date() })
  joinedAt!: Date;
}
const MembershipSubSchema = SchemaFactory.createForClass(MembershipSub);

@Schema({ timestamps: true, collection: 'users' })
export class User {
  @Prop({ required: true, unique: true, index: true })
  telegramId!: number;

  @Prop() username?: string;
  /**
   * Past Telegram tags this account used (most recent first, capped to 5).
   * Used by sheet sync so a head/teacher who changes their @username doesn't
   * silently lose access — sheet matches against ANY of (username, …history).
   */
  @Prop({ type: [String], default: [], index: true })
  usernameHistory!: string[];
  @Prop({ required: true }) firstName!: string;
  @Prop() lastName?: string;
  @Prop() fullName?: string;
  @Prop() avatarUrl?: string;
  @Prop() birthday?: Date;
  @Prop() campusLecturerId?: string;

  @Prop({ type: [MembershipSubSchema], default: [] })
  memberships!: MembershipSub[];

  @Prop({ default: false }) isBanned!: boolean;
  @Prop() lastSeenAt?: Date;

  /** Last time we cross-checked memberships against Telegram via getChatMember. */
  @Prop() membershipsValidatedAt?: Date;
}

export type UserDocument = HydratedDocument<User>;
export const UserSchema = SchemaFactory.createForClass(User);
UserSchema.index({ 'memberships.groupId': 1, 'memberships.role': 1 });
