import type { Document, Types } from 'mongoose';

export interface IUserRole extends Document {
  userId: Types.ObjectId;
  roleNames: string[];
  createdAt?: Date;
  updatedAt?: Date;
}
