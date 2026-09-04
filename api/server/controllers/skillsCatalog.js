const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const { findAccessibleResourceIds } = require('~/server/services/aclPrincipals');
const { getCredentialStatus } = require('~/models');

/**
 * User-side skills catalog controllers ("我的skill").
 *
 * Lists skills/MCP servers by type (http/mcp/skill) and source (created by
 * me / authorized to me) reading the shared `skills` + `mcpservers`
 * collections directly. Triggers pi's personal-skill sync (skill-creator
 * output → skills collection) before listing, degrading gracefully when
 * pi is unreachable.
 */

const PI_HOST = process.env.PI_HOST || process.env.PI_AGENT_URL || 'http://localhost:3000';
const PI_API_KEY = process.env.PI_API_KEY || 'testkey';
const PI_SYNC_TIMEOUT_MS = 5000;

function getSkillModel() {
  return (
    mongoose.models.Skill ||
    mongoose.model('Skill', new Schema({}, { strict: false, collection: 'skills' }))
  );
}

/** Best-effort personal skill sync on pi (skill-creator output → skills). */
async function syncPiPersonalSkills(userId) {
  try {
    await fetch(`${PI_HOST}/skills/sync`, {
      method: 'POST',
      headers: {
        'api-key': PI_API_KEY,
        'X-User-Id': userId,
        'Content-Type': 'application/json',
      },
      body: '{}',
      signal: AbortSignal.timeout(PI_SYNC_TIMEOUT_MS),
    });
  } catch {
    // Degrade gracefully: stale catalog data is better than a blocked page.
  }
}

function toCatalogItem(doc, resourceType, source, extra) {
  return {
    id: String(doc._id),
    resourceType,
    source,
    name: resourceType === 'skill' ? doc.name : doc.serverName,
    displayName: doc.displayName || undefined,
    description: doc.description || (doc.config && doc.config.description) || undefined,
    category: doc.category || (doc.config && doc.config.category) || undefined,
    skillType: doc.skillType,
    status: doc.status,
    requiresCredentials: doc.requiresCredentials === true,
    userManaged: doc.userManaged === true,
    credentialSchema: doc.credentialSchema || [],
    ...extra,
  };
}

/**
 * GET /api/skills/catalog?type=http|mcp|skill&source=created|authorized|all
 */
async function getSkillsCatalog(req, res) {
  try {
    const userId = req.user.id;
    const type = ['http', 'mcp', 'skill'].includes(req.query.type) ? req.query.type : 'all';
    const source = ['created', 'authorized'].includes(req.query.source) ? req.query.source : 'all';

    await syncPiPersonalSkills(userId);

    const [accessibleSkillIds, registryMcpDocs] = await Promise.all([
      findAccessibleResourceIds(userId, 'skill'),
      // MCP visibility resolves through the unified skills registry (dmp
      // grants MCP-skill ACLs as resourceType "skill", NOT "mcp").
      getSkillModel().find({ skillType: 'mcp' }).select('name _id').lean(),
    ]);
    const registryIdByServerName = new Map(registryMcpDocs.map((d) => [d.name, String(d._id)]));
    const accessibleMcpIds = [];
    for (const [serverName, registryId] of registryIdByServerName.entries()) {
      if (accessibleSkillIds.includes(registryId)) {
        accessibleMcpIds.push(serverName);
      }
    }

    const skillQuery = { status: 1 };
    if (source === 'created') {
      skillQuery.author = userId;
    } else if (source === 'authorized') {
      skillQuery._id = { $in: accessibleSkillIds };
      skillQuery.author = { $ne: userId };
    } else {
      skillQuery.$or = [{ author: userId }, { _id: { $in: accessibleSkillIds } }];
    }
    if (type !== 'all' && type !== 'mcp') {
      skillQuery.skillType = type;
    } else if (type === 'skill') {
      skillQuery.skillType = 'repo';
    }

    const Skill = getSkillModel();
    const skillDocs = await Skill.find(skillQuery).lean();

    const items = [];
    for (const doc of skillDocs) {
      if (type === 'all' && doc.skillType === 'mcp') {
        continue; // mcp-type registry mirrors live in the mcpservers section
      }
      const isCreated = String(doc.author) === String(userId);
      const itemSource = isCreated ? 'created' : 'authorized';
      if (source !== 'all' && itemSource !== source && source === 'authorized') {
        continue;
      }
      let bound;
      let credentialStatus;
      if (doc.requiresCredentials === true && doc.userManaged !== false) {
        credentialStatus = await getCredentialStatus(userId, 'skill', doc.name);
        bound = credentialStatus.configured;
      }
      items.push(
        toCatalogItem(doc, 'skill', itemSource, {
          apiCount: Array.isArray(doc.apiDefinitions) ? doc.apiDefinitions.length : 0,
          baseUrl: doc.config && doc.config.baseUrl,
          bound,
          credentialStatus,
        }),
      );
    }

    if (type === 'all' || type === 'mcp') {
      const mcpQuery = {};
      if (source === 'created') {
        mcpQuery.author = userId;
      } else if (source === 'authorized') {
        mcpQuery.serverName = { $in: accessibleMcpIds };
        mcpQuery.author = { $ne: userId };
      } else {
        mcpQuery.$or = [{ author: userId }, { serverName: { $in: accessibleMcpIds } }];
      }
      const mcpDocs = await mongoose.models.MCPServer.find(mcpQuery).lean();
      for (const doc of mcpDocs) {
        const isCreated = String(doc.author) === String(userId);
        let bound;
        let credentialStatus;
        if (doc.requiresCredentials === true && doc.userManaged !== false) {
          credentialStatus = await getCredentialStatus(userId, 'mcp', doc.serverName);
          bound = credentialStatus.configured;
        }
        items.push(
          toCatalogItem(doc, 'mcp', isCreated ? 'created' : 'authorized', {
            serverUrl: doc.config && doc.config.url,
            bound,
            credentialStatus,
          }),
        );
      }
    }

    return res.json({ items });
  } catch (error) {
    console.error('[SkillsCatalog] list failed:', error.message);
    return res.status(500).json({ error: 'Failed to list skills catalog' });
  }
}

/**
 * POST /api/skills/create-http
 * Creates a personal http-type skill in the shared skills collection
 * (author = current user, no ACL — private until shared).
 */
async function createHttpSkill(req, res) {
  try {
    const {
      name,
      description,
      category,
      baseUrl,
      apis,
      requiresCredentials,
      userManaged,
      credentialSchema,
      credentialBinding,
    } = req.body || {};

    if (!name || typeof name !== 'string' || !/^[a-z0-9][a-z0-9-_]{1,63}$/.test(name)) {
      return res.status(400).json({
        error: 'name is required (lowercase letters/digits/-/_, 2-64 chars)',
      });
    }
    if (!description || typeof description !== 'string') {
      return res.status(400).json({ error: 'description is required' });
    }

    let apiDefinitions;
    if (apis) {
      try {
        apiDefinitions = JSON.parse(apis);
        if (!Array.isArray(apiDefinitions)) {
          throw new Error('not an array');
        }
      } catch {
        return res.status(400).json({ error: 'apis must be a valid JSON array' });
      }
    }

    let credentialSchemaParsed;
    if (credentialSchema) {
      try {
        credentialSchemaParsed = JSON.parse(credentialSchema);
        if (!Array.isArray(credentialSchemaParsed)) {
          throw new Error('not an array');
        }
      } catch {
        return res.status(400).json({ error: 'credentialSchema must be a valid JSON array' });
      }
    }

    let credentialBindingParsed;
    if (credentialBinding) {
      try {
        credentialBindingParsed = JSON.parse(credentialBinding);
        if (typeof credentialBindingParsed !== 'object' || Array.isArray(credentialBindingParsed)) {
          throw new Error('not an object');
        }
      } catch {
        return res.status(400).json({ error: 'credentialBinding must be a valid JSON object' });
      }
    }

    const Skill = getSkillModel();
    const existing = await Skill.findOne({ name }).lean();
    if (existing) {
      return res.status(409).json({ error: 'skill name already exists' });
    }

    const now = new Date();
    const doc = await Skill.create({
      skillType: 'http',
      name,
      displayName: name,
      description,
      category: category || 'general',
      author: new mongoose.Types.ObjectId(req.user.id),
      status: 1,
      userManaged: userManaged !== false,
      requiresCredentials: requiresCredentials === true,
      ...(credentialSchemaParsed ? { credentialSchema: credentialSchemaParsed } : {}),
      ...(credentialBindingParsed ? { credentialBinding: credentialBindingParsed } : {}),
      ...(apiDefinitions ? { apiDefinitions } : {}),
      config: {
        baseUrl: baseUrl || '',
        ...(apis ? { apis } : {}),
      },
      source: 'user',
      createdAt: now,
      updatedAt: now,
      __v: 0,
    });

    return res.json({ success: true, id: String(doc._id), name });
  } catch (error) {
    console.error('[SkillsCatalog] createHttpSkill failed:', error.message);
    return res.status(500).json({ error: 'Failed to create http skill' });
  }
}

/**
 * POST /api/skills/test-connection
 * { type: 'http', url, headers? } → plain HTTP reachability probe
 * { type: 'mcp', url, headers? } → MCP Streamable HTTP initialize handshake
 */
async function testSkillConnection(req, res) {
  try {
    const { type, url, headers } = req.body || {};
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'url is required' });
    }

    if (type === 'mcp') {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          ...(headers || {}),
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'arp-skill-test', version: '1.0.0' },
          },
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        return res.json({ ok: false, message: `HTTP ${response.status} ${response.statusText}` });
      }
      return res.json({ ok: true, message: 'MCP initialize succeeded' });
    }

    // default: http probe
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        ...(headers || {}),
      },
      signal: AbortSignal.timeout(10_000),
    });
    return res.json({
      ok: response.status < 500,
      message: `HTTP ${response.status} ${response.statusText}`,
      status: response.status,
    });
  } catch (error) {
    return res.json({ ok: false, message: error.message || 'connection failed' });
  }
}

module.exports = { getSkillsCatalog, createHttpSkill, testSkillConnection };
