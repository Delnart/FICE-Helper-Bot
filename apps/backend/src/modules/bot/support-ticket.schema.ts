import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

@Schema({ timestamps: true, collection: 'support_tickets' })
export class SupportTicket {
  /** Telegram user ID of the person who submitted the message. */
  @Prop({ required: true, index: true })
  userTelegramId!: number;

  /** The message ID of the user's original message in the private chat. */
  @Prop({ required: true })
  userMessageId!: number;

  /**
   * All admin-group message IDs that belong to this ticket thread.
   * Starts with the initial forwarded message; grows with every admin reply.
   * Querying `{ adminMessageIds: X }` matches tickets whose array contains X.
   */
  @Prop({ type: [Number], default: [], index: true })
  adminMessageIds!: number[];
}

export type SupportTicketDocument = HydratedDocument<SupportTicket>;
export const SupportTicketSchema = SchemaFactory.createForClass(SupportTicket);
