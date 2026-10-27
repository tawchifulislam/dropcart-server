import { InferSchemaType, Schema, Types, model } from 'mongoose';

const messageSchema = new Schema({
  role: { type: String, enum: ['user', 'assistant'], required: true },
  text: { type: String, required: true },
  trace: { type: [String], default: [] },
  products: { type: [Schema.Types.Mixed], default: [] },
  actions: { type: [Schema.Types.Mixed], default: [] },
  createdAt: { type: Date, default: Date.now },
});

const chatSessionSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    messages: { type: [messageSchema], default: [] },
    history: { type: [Schema.Types.Mixed], default: [] },
  },
  { timestamps: true },
);

export type ChatSessionRecord = InferSchemaType<typeof chatSessionSchema> & {
  _id: Types.ObjectId;
};
export const ChatSession = model('ChatSession', chatSessionSchema);
