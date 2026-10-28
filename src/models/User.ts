import { Schema, model } from 'mongoose';

export const ROLES = ['shopper', 'admin', 'superadmin'] as const;
export type Role = (typeof ROLES)[number];

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: [...ROLES], default: 'shopper' },
  },
  { timestamps: true },
);

export const User = model('User', userSchema);
