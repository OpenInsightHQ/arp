import { logger } from '@librechat/data-schemas';
import {
  Permissions,
  EndpointURLs,
  EModelEndpoint,
  PermissionTypes,
  isAgentsEndpoint,
} from 'librechat-data-provider';
import type { NextFunction, Request as ServerRequest, Response as ServerResponse } from 'express';
import type { IRole, IUser, RolePermissions } from '@librechat/data-schemas';

export function skipAgentCheck(req?: ServerRequest): boolean {
  if (!req || !req?.body?.endpoint) {
    return false;
  }

  if (req.method !== 'POST') {
    return false;
  }

  if (!req.originalUrl?.includes(EndpointURLs[EModelEndpoint.agents])) {
    return false;
  }
  return !isAgentsEndpoint(req.body.endpoint);
}

/**
 * Merge an array of role permission objects using OR semantics.
 * If ANY role grants a permission, the merged result includes it.
 */
const mergePermissions = (permissionsList: RolePermissions[]): RolePermissions => {
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
};

/**
 * Core function to check if a user has one or more required permissions.
 * Supports multi-role: reads `user.roles` array (populated from userroles
 * collection at auth time) and merges permissions with OR semantics.
 * Falls back to `user.role` for backward compatibility.
 *
 * @param user - The user object
 * @param permissionType - The type of permission to check
 * @param permissions - The list of specific permissions to check
 * @param bodyProps - An optional object where keys are permissions and values are arrays of properties to check
 * @param checkObject - The object to check properties against
 * @param skipCheck - An optional function that takes the checkObject and returns true to skip permission checking
 * @returns Whether the user has the required permissions
 */
export const checkAccess = async ({
  req,
  user,
  permissionType,
  permissions,
  getRoleByName,
  bodyProps = {} as Record<Permissions, string[]>,
  checkObject = {},
  skipCheck,
}: {
  user: IUser;
  req?: ServerRequest;
  permissionType: PermissionTypes;
  permissions: Permissions[];
  bodyProps?: Record<Permissions, string[]>;
  checkObject?: object;
  /** If skipCheck function is provided and returns true, skip permission checking */
  skipCheck?: (req?: ServerRequest) => boolean;
  getRoleByName: (roleName: string, fieldsToSelect?: string | string[]) => Promise<IRole | null>;
}): Promise<boolean> => {
  if (skipCheck && skipCheck(req)) {
    return true;
  }

  if (!user || !user.role) {
    return false;
  }

  const roleNames = user.roles ?? [user.role];
  const allRoles = await Promise.all(roleNames.map((name) => getRoleByName(name)));
  const validPermissions = allRoles
    .filter((r): r is IRole => !!r && !!r.permissions)
    .map((r) => r.permissions as RolePermissions);

  if (validPermissions.length === 0) {
    return false;
  }

  const mergedPermissions = mergePermissions(validPermissions);
  const permissionValue = mergedPermissions[permissionType as keyof typeof mergedPermissions];

  if (permissionValue) {
    return permissions.every((permission) => {
      if (permissionValue[permission as keyof typeof permissionValue]) {
        return true;
      }

      if (bodyProps[permission] && checkObject) {
        return bodyProps[permission].every((prop) =>
          Object.prototype.hasOwnProperty.call(checkObject, prop),
        );
      }

      return false;
    });
  }

  return false;
};

/**
 * Middleware to check if a user has one or more required permissions, optionally based on `req.body` properties.
 * @param permissionType - The type of permission to check.
 * @param permissions - The list of specific permissions to check.
 * @param bodyProps - An optional object where keys are permissions and values are arrays of `req.body` properties to check.
 * @param skipCheck - An optional function that takes req.body and returns true to skip permission checking.
 * @param getRoleByName - A function to get the role by name.
 * @returns Express middleware function.
 */
export const generateCheckAccess = ({
  permissionType,
  permissions,
  bodyProps = {} as Record<Permissions, string[]>,
  skipCheck,
  getRoleByName,
}: {
  permissionType: PermissionTypes;
  permissions: Permissions[];
  bodyProps?: Record<Permissions, string[]>;
  skipCheck?: (req?: ServerRequest) => boolean;
  getRoleByName: (roleName: string, fieldsToSelect?: string | string[]) => Promise<IRole | null>;
}): ((req: ServerRequest, res: ServerResponse, next: NextFunction) => Promise<unknown>) => {
  return async (req, res, next) => {
    try {
      const hasAccess = await checkAccess({
        req,
        user: req.user as IUser,
        permissionType,
        permissions,
        bodyProps,
        checkObject: req.body,
        skipCheck,
        getRoleByName,
      });

      if (hasAccess) {
        return next();
      }

      logger.warn(
        `[${permissionType}] Forbidden: "${req.originalUrl}" - Insufficient permissions for User ${(req.user as IUser)?.id}: ${permissions.join(', ')}`,
      );
      return res.status(403).json({ message: 'Forbidden: Insufficient permissions' });
    } catch (error) {
      logger.error(error);
      return res.status(500).json({
        message: `Server error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  };
};
