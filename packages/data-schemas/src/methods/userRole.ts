import { Types } from 'mongoose';
import type { Model, ClientSession } from 'mongoose';
import type { IUser, IUserRole, RolePermissions } from '~/types';

export function createUserRoleMethods(mongoose: typeof import('mongoose')) {
  /**
   * Get all role names for a user: the primary role from `user.role`
   * plus any additional roles from the `userroles` collection.
   *
   * **Central entry point for data permission resolution.**
   * When department-based authorization is added, this function will be
   * the single place that also collects department-assigned roles.
   *
   * @param userId - The user ID
   * @param session - Optional MongoDB session
   * @returns Deduplicated array of role names
   */
  async function getUserRoleNames(
    userId: string | Types.ObjectId,
    session?: ClientSession,
  ): Promise<string[]> {
    const User = mongoose.models.User as Model<IUser>;
    const UserRole = mongoose.models.UserRole as Model<IUserRole>;

    const query = User.findById(userId).select('role');
    if (session) {
      query.session(session);
    }
    const user = await query.lean();

    if (!user) {
      return [];
    }

    const urQuery = UserRole.findOne({ userId }).select('roleNames');
    if (session) {
      urQuery.session(session);
    }
    const userRole = await urQuery.lean();

    const extraRoles = userRole?.roleNames ?? [];
    const roleNames = [user.role, ...extraRoles].filter(
      (r): r is string => !!r && r.trim().length > 0,
    );

    return [...new Set(roleNames)];
  }

  /**
   * Assign an additional role to a user using `$addToSet`.
   *
   * @param userId - The user ID
   * @param roleName - The role name to assign
   * @param session - Optional MongoDB session
   * @returns The updated UserRole document
   */
  async function assignRoleToUser(
    userId: string | Types.ObjectId,
    roleName: string,
    session?: ClientSession,
  ): Promise<IUserRole | null> {
    const UserRole = mongoose.models.UserRole as Model<IUserRole>;
    const options = { upsert: true, new: true, ...(session ? { session } : {}) };
    return await UserRole.findOneAndUpdate(
      { userId },
      { $addToSet: { roleNames: roleName } },
      options,
    ).lean();
  }

  /**
   * Remove an additional role from a user using `$pull`.
   * Does NOT affect the primary `user.role` field.
   *
   * @param userId - The user ID
   * @param roleName - The role name to remove
   * @param session - Optional MongoDB session
   * @returns The updated UserRole document or null
   */
  async function removeRoleFromUser(
    userId: string | Types.ObjectId,
    roleName: string,
    session?: ClientSession,
  ): Promise<IUserRole | null> {
    const UserRole = mongoose.models.UserRole as Model<IUserRole>;
    const options = { new: true, ...(session ? { session } : {}) };
    return await UserRole.findOneAndUpdate(
      { userId },
      { $pull: { roleNames: roleName } },
      options,
    ).lean();
  }

  /**
   * Get the UserRole document for a user.
   *
   * @param userId - The user ID
   * @param session - Optional MongoDB session
   * @returns The UserRole document or null
   */
  async function getUserRoles(
    userId: string | Types.ObjectId,
    session?: ClientSession,
  ): Promise<IUserRole | null> {
    const UserRole = mongoose.models.UserRole as Model<IUserRole>;
    const query = UserRole.findOne({ userId });
    if (session) {
      query.session(session);
    }
    return await query.lean();
  }

  /**
   * Remove all additional role assignments for a user.
   * Called when a user is deleted to clean up dangling references.
   *
   * @param userId - The user ID
   * @param session - Optional MongoDB session
   * @returns The number of deleted documents
   */
  async function removeAllUserRoles(
    userId: string | Types.ObjectId,
    session?: ClientSession,
  ): Promise<number> {
    const UserRole = mongoose.models.UserRole as Model<IUserRole>;
    const query = UserRole.deleteOne({ userId });
    if (session) {
      query.session(session);
    }
    const result = await query.exec();
    return result.deletedCount;
  }

  /**
   * Merge multiple role permission objects using OR semantics.
   * If ANY role grants a permission, the merged result includes it.
   *
   * @param permissionsList - Array of role permission objects
   * @returns Merged permission object
   */
  function mergeRolePermissions(permissionsList: RolePermissions[]): RolePermissions {
    const merged: Record<string, Record<string, boolean>> = {};
    for (const perms of permissionsList) {
      if (!perms) {
        continue;
      }
      for (const [permType, permValue] of Object.entries(perms)) {
        if (!permValue || typeof permValue !== 'object') {
          continue;
        }
        if (!merged[permType]) {
          merged[permType] = {};
        }
        for (const [perm, value] of Object.entries(permValue)) {
          if (value === true) {
            merged[permType][perm] = true;
          }
        }
      }
    }
    return merged as unknown as RolePermissions;
  }

  return {
    getUserRoleNames,
    assignRoleToUser,
    removeRoleFromUser,
    getUserRoles,
    removeAllUserRoles,
    mergeRolePermissions,
  };
}

export type UserRoleMethods = ReturnType<typeof createUserRoleMethods>;
