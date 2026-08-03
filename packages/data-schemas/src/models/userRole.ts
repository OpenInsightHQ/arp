import userRoleSchema from '~/schema/userRole';
import type { IUserRole } from '~/types';

export function createUserRoleModel(mongoose: typeof import('mongoose')) {
  return mongoose.models.UserRole || mongoose.model<IUserRole>('UserRole', userRoleSchema);
}
