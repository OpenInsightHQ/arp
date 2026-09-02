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

/** All-zero ObjectId sentinel marking admin-managed (shared) bindings — same value as pi/dmp. */
const ADMIN_CREDENTIAL_USER_ID = '000000000000000000000000';

/**
 * User-side credential controllers ("我的凭证").
 *
 * Lists bindable credential resources (skills + MCP servers declaring
 * requiresCredentials/userManaged), bound with the user's own encrypted
 * credentials in the shared `credentials` collection (cipher interop
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
    const referencedRefs = new Set();
    for (const doc of skillDocs) {
      const status = await getCredentialStatus(userId, 'skill', doc.name);
      resources.push(toResourceView(doc, 'skill', { bound: status.configured, status }));
      if (doc.credentialRef) {
        referencedRefs.add(doc.credentialRef);
      }
    }
    for (const doc of mcpDocs) {
      const status = await getCredentialStatus(userId, 'mcp', doc.serverName);
      resources.push(toResourceView(doc, 'mcp', { bound: status.configured, status }));
      if (doc.credentialRef) {
        referencedRefs.add(doc.credentialRef);
      }
    }

    // Referenced credentials that are declaration-only (admin declared the
    // fields but did not configure values): users bind their own values on
    // the credential itself — resolution is either/or, admin values win.
    if (referencedRefs.size > 0) {
      const CredentialModel = mongoose.models.Credential;
      if (CredentialModel) {
        const declarationDocs = await CredentialModel.find({
          userId: new mongoose.Types.ObjectId(ADMIN_CREDENTIAL_USER_ID),
          resourceType: 'credential',
          resourceName: { $in: [...referencedRefs] },
          data: null,
        }).lean();
        const seenCreds = new Set(
          resources.filter((r) => r.resourceType === 'credential').map((r) => r.resourceName),
        );
        for (const doc of declarationDocs) {
          if (seenCreds.has(doc.resourceName)) {
            continue;
          }
          seenCreds.add(doc.resourceName);
          let schema = [];
          if (doc.schemaJson) {
            try {
              schema = JSON.parse(doc.schemaJson);
            } catch {
              schema = [];
            }
          }
          const status = await getCredentialStatus(userId, 'credential', doc.resourceName);
          resources.push({
            resourceType: 'credential',
            resourceName: doc.resourceName,
            displayName: doc.resourceName,
            description: 'Referenced by skills — bind your own values',
            userManaged: true,
            credentialSchema: schema,
            bound: status.configured,
            status,
          });
        }
      }
    }

    return res.json({ resources, cryptoConfigured: isCryptoConfigured() });
  } catch (error) {
    console.error('[Credential] list failed:', error.message);
    return res.status(500).json({ error: 'Failed to list credential resources' });
  }
}

function validateResourceType(resourceType) {
  if (resourceType !== 'skill' && resourceType !== 'mcp' && resourceType !== 'credential') {
    return 'resourceType must be "skill", "mcp" or "credential"';
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
