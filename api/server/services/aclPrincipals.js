const mongoose = require('mongoose');
const Schema = mongoose.Schema;

/**
 * Shared ACL principal resolution over the `aclentries` collection
 * (same shape as pi's ACL — user + roles + public principals, VIEW bit).
 */

const VIEW_BIT = 1;

/** Loose model over the shared `aclentries` collection. */
function getAclEntryModel() {
  return (
    mongoose.models.AclEntry ||
    mongoose.model('AclEntryLoose', new Schema({}, { strict: false, collection: 'aclentries' }))
  );
}

function getRoleModel() {
  return (
    mongoose.models.Role ||
    mongoose.model('RoleLoose', new Schema({}, { strict: false, collection: 'roles' }))
  );
}

function getUserRoleModel() {
  return (
    mongoose.models.UserRole ||
    mongoose.model('UserRoleLoose', new Schema({}, { strict: false, collection: 'userroles' }))
  );
}

/**
 * Resolves user → principals [USER, ROLE..., PUBLIC] mirroring pi's ACL
 * resolution (aclentries collection, same shape).
 */
async function resolvePrincipals(userId) {
  const principals = [{ principalType: 'user', principalId: userId }];
  try {
    const userRole = await getUserRoleModel().findOne({ userId }).lean();
    const roleNames = (userRole && userRole.roleNames) || [];
    if (roleNames.length > 0) {
      const roleDocs = await getRoleModel()
        .find({ name: { $in: roleNames } })
        .select('_id')
        .lean();
      for (const role of roleDocs) {
        principals.push({ principalType: 'role', principalId: role._id });
      }
    }
  } catch (error) {
    console.error('[AclPrincipals] resolvePrincipals failed:', error.message);
  }
  principals.push({ principalType: 'public' });
  return principals;
}

/** Resource ids of the given type the user has VIEW permission on. */
async function findAccessibleResourceIds(userId, resourceType) {
  const principals = await resolvePrincipals(userId);
  const or = principals.map((p) =>
    p.principalType === 'public'
      ? { principalType: 'public' }
      : { principalType: p.principalType, principalId: p.principalId },
  );
  const entries = await getAclEntryModel()
    .find({ resourceType, permBits: { $bitsAllSet: VIEW_BIT }, $or: or })
    .select('resourceId')
    .lean();
  return entries.map((e) => String(e.resourceId));
}

module.exports = { resolvePrincipals, findAccessibleResourceIds, VIEW_BIT };
