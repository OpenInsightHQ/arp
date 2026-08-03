import { Schema } from 'mongoose';
import type { IUserRole } from '~/types';

const userRoleSchema = new Schema<IUserRole>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    roleNames: {
      type: [String],
      default: [],
    },
  },
  { timestamps: true },
);

export default userRoleSchema;
