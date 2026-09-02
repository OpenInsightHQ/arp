const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const {
  bindCredential,
  unbindCredential,
  getCredentialValues,
  getCredentialStatus,
  markCredentialStatus,
  isCryptoConfigured,
} = require('~/models');
const { findAccessibleResourceIds } = require('~/server/services/aclPrincipals');

/**
 * User-side credential controllers ("我的凭证").
 *
 * Lists bindable credential resources (skills + MCP servers declaring
 * requiresCredentials/userManaged), bound with the user's own encrypted
 * credentials in the shared `skillcredentials` collection (cipher interop
 * with pi/dmp — see packages/data-schemas/src/methods/skillCredential.ts).
 */

/** Loose model over the shared `skills` collection (written by dmp/pi). */
function getSkillModel() {
  return (
    mongoose.models.Skill ||
    mongoose.model('Skill', new Schema({}, { strict: false, collection: 'skills' }))
  );
}

function toResourceView(doc, resourceType, extra) {
  return {
    resourceType,
    resourceName: resourceType === 'skill' ? doc.name : doc.serverName,
    displayName: doc.displayName || undefined,
    description: doc.description || (doc.config && doc.config.description) || undefined,
    skillType: doc.skillType,
    userManaged: doc.userManaged === true,
    credentialSchema: doc.credentialSchema || [],
    ...extra,
  };
}

/**
 * GET /api/credential/
 * Bindable resources for the user: requiresCredentials=true, userManaged!=false,
 * and visible (own authorship OR ACL VIEW). Includes binding status; never
 * includes cipher material.
 */
async function listCredentialResources(req, res) {
  try {
    const userId = req.user.id;

    const [accessibleSkillIds, accessibleMcpIds] = await Promise.all([
      findAccessibleResourceIds(userId, 'skill'),
      findAccessibleResourceIds(userId, 'mcp'),
    ]);

    const skillDocs = await getSkillModel()
      .find({
        status: 1,
        requiresCredentials: true,
        userManaged: { $ne: false },
        $or: [{ author: userId }, { _id: { $in: accessibleSkillIds } }],
      })
      .lean();

    const mcpDocs = await mongoose.models.MCPServer.find({
      requiresCredentials: true,
      userManaged: { $ne: false },
      $or: [{ author: userId }, { _id: { $in: accessibleMcpIds } }],
    }).lean();

    const resources = [];
    for (const doc of skillDocs) {
      const status = await getCredentialStatus(userId, 'skill', doc.name);
      resources.push(toResourceView(doc, 'skill', { bound: status.configured, status }));
    }
    for (const doc of mcpDocs) {
      const status = await getCredentialStatus(userId, 'mcp', doc.serverName);
      resources.push(toResourceView(doc, 'mcp', { bound: status.configured, status }));
    }

    return res.json({ resources, cryptoConfigured: isCryptoConfigured() });
  } catch (error) {
    console.error('[Credential] list failed:', error.message);
    return res.status(500).json({ error: 'Failed to list credential resources' });
  }
}

function validateResourceType(resourceType) {
  if (resourceType !== 'skill' && resourceType !== 'mcp') {
    return 'resourceType must be "skill" or "mcp"';
  }
  return null;
}

/** PUT /api/credential/:resourceType/:resourceName */
async function bindMyCredential(req, res) {
  try {
    const { resourceType, resourceName } = req.params;
    const invalid = validateResourceType(resourceType);
    if (invalid) {
      return res.status(400).json({ error: invalid });
    }
    const values = req.body && req.body.values;
    if (!values || typeof values !== 'object' || Object.keys(values).length === 0) {
      return res.status(400).json({ error: 'values object is required' });
    }
    await bindCredential(req.user.id, resourceType, resourceName, values);
    const status = await getCredentialStatus(req.user.id, resourceType, resourceName);
    return res.json({ success: true, status });
  } catch (error) {
    console.error('[Credential] bind failed:', error.message);
    return res
      .status(error.message && error.message.includes('PI_CREDENTIAL_MASTER_KEY') ? 503 : 500)
      .json({ error: error.message || 'Failed to bind credential' });
  }
}

/** DELETE /api/credential/:resourceType/:resourceName */
async function unbindMyCredential(req, res) {
  try {
    const { resourceType, resourceName } = req.params;
    const invalid = validateResourceType(resourceType);
    if (invalid) {
      return res.status(400).json({ error: invalid });
    }
    await unbindCredential(req.user.id, resourceType, resourceName);
    return res.json({ success: true });
  } catch (error) {
    console.error('[Credential] unbind failed:', error.message);
    return res.status(500).json({ error: 'Failed to unbind credential' });
  }
}

/** POST /api/credential/:resourceType/:resourceName/verify */
async function verifyMyCredential(req, res) {
  try {
    const { resourceType, resourceName } = req.params;
    const invalid = validateResourceType(resourceType);
    if (invalid) {
      return res.status(400).json({ error: invalid });
    }
    const values = await getCredentialValues(req.user.id, resourceType, resourceName);
    const valid = values != null && Object.keys(values).length > 0;
    if (values != null) {
      await markCredentialStatus(
        req.user.id,
        resourceType,
        resourceName,
        valid ? 'active' : 'invalid',
      );
    }
    return res.json({ valid });
  } catch (error) {
    console.error('[Credential] verify failed:', error.message);
    return res.status(500).json({ error: 'Failed to verify credential' });
  }
}

module.exports = {
  listCredentialResources,
  bindMyCredential,
  unbindMyCredential,
  verifyMyCredential,
};
