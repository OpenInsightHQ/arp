const express = require('express');
const multer = require('multer');
const JSZip = require('jszip');
const { requireJwtAuth } = require('../middleware/');
const { safeHttpStatus } = require('~/server/utils/sanitize');
const {
  getSkillsCatalog,
  createHttpSkill,
  testSkillConnection,
} = require('~/server/controllers/skillsCatalog');

const router = express.Router();

const PI_HOST = process.env.PI_HOST || process.env.PI_AGENT_URL || 'http://localhost:3000';
const PI_API_KEY = process.env.PI_API_KEY || 'testkey';
const SKILL_UPLOAD_LIMIT_MB = parseInt(process.env.SKILL_UPLOAD_LIMIT_MB || '1024', 10);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: SKILL_UPLOAD_LIMIT_MB * 1024 * 1024 },
});

const parseSkillMarkdown = (content = '') => {
  const metadata = {};
  let body = content;
  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (frontmatterMatch) {
    frontmatterMatch[1].split('\n').forEach((line) => {
      const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (match) {
        metadata[match[1]] = match[2].trim();
      }
    });
    body = content.slice(frontmatterMatch[0].length);
  }

  const extractTableAfterHeading = (headingPattern) => {
    const headingMatch = body.match(headingPattern);
    if (!headingMatch || headingMatch.index == null) {
      return [];
    }
    const next = body.slice(headingMatch.index + headingMatch[0].length);
    const lines = next.split('\n');
    const rows = [];
    let inTable = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        if (inTable) {
          break;
        }
        continue;
      }
      if (!trimmed.startsWith('|')) {
        if (inTable) {
          break;
        }
        continue;
      }
      inTable = true;
      rows.push(trimmed);
    }

    if (rows.length < 2) {
      return [];
    }

    const headers = rows[0]
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());

    return rows.slice(2).map((row) => {
      const cells = row
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim().replace(/^`|`$/g, ''));
      return headers.reduce((item, header, index) => {
        item[header] = cells[index] || '';
        return item;
      }, {});
    });
  };

  const extractSectionAfterHeading = (headingPattern) => {
    const headingMatch = body.match(headingPattern);
    if (!headingMatch || headingMatch.index == null) {
      return '';
    }
    const next = body.slice(headingMatch.index + headingMatch[0].length);
    const nextHeadingIndex = next.search(/^#{1,6}\s+/m);
    return (nextHeadingIndex >= 0 ? next.slice(0, nextHeadingIndex) : next).trim();
  };

  const normalizeParameterKey = (key) => {
    const normalized = key
      .trim()
      .replace(/[：:]+$/, '')
      .toLowerCase();
    const map = {
      参数名: '参数',
      name: '参数',
      parameter: '参数',
      参数: '参数',
      类型: '类型',
      type: '类型',
      必需: '必需',
      required: '必需',
      是否必需: '必需',
      说明: '说明',
      描述: '说明',
      description: '说明',
    };
    return map[normalized] || key.trim();
  };

  const extractFieldListParameters = () => {
    const section = extractSectionAfterHeading(/^#{2,6}\s+参数(?:说明|定义)?\s*$/m);
    if (!section) {
      return [];
    }
    if (section.split('\n').some((line) => line.trim().startsWith('|'))) {
      return [];
    }

    const rows = [];
    let current = {};
    const flush = () => {
      if (current['参数']) {
        rows.push(current);
      }
      current = {};
    };

    for (const rawLine of section.split('\n')) {
      const line = rawLine.trim().replace(/^[-*]\s+/, '');
      if (!line) {
        continue;
      }
      const match = line.match(/^([^:：]+)[:：]\s*(.+)$/);
      if (!match) {
        continue;
      }
      const key = normalizeParameterKey(match[1]);
      const value = match[2].trim().replace(/^`|`$/g, '');
      if (key === '参数' && current['参数']) {
        flush();
      }
      current[key] = value;
    }
    flush();
    return rows;
  };

  const parameters =
    extractTableAfterHeading(/^#{2,6}\s+参数说明\s*$/m).length > 0
      ? extractTableAfterHeading(/^#{2,6}\s+参数说明\s*$/m)
      : extractTableAfterHeading(/^#{2,6}\s+参数(?:定义)?\s*$/m).length > 0
        ? extractTableAfterHeading(/^#{2,6}\s+参数(?:定义)?\s*$/m)
        : extractFieldListParameters();

  return {
    metadata,
    markdown: content,
    body,
    parameters,
    outputs: extractTableAfterHeading(/^#{2,6}\s+输出与展示\s*$/m),
  };
};

const buildSkillDetail = async ({ skillName, user }) => {
  const userId = user.id;
  const author = user.name || user.username || user.email || userId;
  const url = `${PI_HOST}/skills/my/${encodeURIComponent(skillName)}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'api-key': PI_API_KEY,
      'X-User-Id': userId,
    },
  });

  if (!response.ok) {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await response.json();
      return { status: safeHttpStatus(response.status), data };
    }
    return {
      status: safeHttpStatus(response.status),
      data: { error: 'Failed to fetch skill package' },
    };
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const zip = await JSZip.loadAsync(buffer);
  const entries = Object.values(zip.files);
  const rootCandidates = entries.map((entry) => entry.name.split('/')[0]).filter(Boolean);
  const rootName =
    rootCandidates.length > 0 && rootCandidates.every((root) => root === rootCandidates[0])
      ? rootCandidates[0]
      : skillName.replace(/\/$/, '');
  const rootPrefix = `${rootName}/`;
  const stripRoot = (name) => (name.startsWith(rootPrefix) ? name.slice(rootPrefix.length) : name);
  const fileEntries = entries
    .filter((entry) => !entry.dir)
    .map((entry) => stripRoot(entry.name))
    .filter(Boolean)
    .sort();
  const directorySet = new Set();

  entries.forEach((entry) => {
    const relative = stripRoot(entry.name).replace(/\/$/, '');
    if (!relative) {
      return;
    }
    const parts = relative.split('/');
    if (entry.dir && parts[0]) {
      directorySet.add(parts[0]);
      return;
    }
    if (parts.length > 1) {
      directorySet.add(parts[0]);
    }
  });

  const skillMdEntry = entries.find((entry) => stripRoot(entry.name) === 'SKILL.md');
  const skillMd = skillMdEntry ? await skillMdEntry.async('string') : '';
  const parsed = parseSkillMarkdown(skillMd);

  return {
    status: 200,
    data: {
      author,
      name: skillName,
      packageName: response.headers.get('content-disposition') || `${skillName}.skill`,
      packageSize: buffer.length,
      metadata: parsed.metadata,
      skillMd: parsed.markdown,
      parameters: parsed.parameters,
      outputs: parsed.outputs,
      files: fileEntries,
      directories: Array.from(directorySet).sort(),
      structure: {
        hasSkillMd: Boolean(skillMdEntry),
        hasScripts: directorySet.has('scripts'),
        hasReferences: directorySet.has('references'),
        hasAssets: directorySet.has('assets'),
        scripts: fileEntries.filter((file) => file.startsWith('scripts/')),
        references: fileEntries.filter((file) => file.startsWith('references/')),
        assets: fileEntries.filter((file) => file.startsWith('assets/')),
      },
    },
  };
};

router.use(requireJwtAuth);

/** GET /api/skills/catalog?type=http|mcp|skill&source=created|authorized|all */
router.get('/catalog', getSkillsCatalog);

/** POST /api/skills/create-http — create a personal http-type skill */
router.post('/create-http', createHttpSkill);

/** POST /api/skills/test-connection — probe http url or MCP handshake */
router.post('/test-connection', testSkillConnection);

router.get('/my', async (req, res) => {
  try {
    const url = `${PI_HOST}/skills/my?userId=${encodeURIComponent(req.user.id)}`;
    console.log('[Skills Route] GET', url);
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'api-key': PI_API_KEY,
        'X-User-Id': req.user.id,
        'Content-Type': 'application/json',
      },
    });

    console.log('[Skills Route] PI response status:', response.status);
    const data = await response.json();
    console.log('[Skills Route] PI response body:', JSON.stringify(data));
    return res.status(safeHttpStatus(response.status)).json(data);
  } catch (error) {
    console.error('[Skills Route] List error:', error.message);
    return res.status(500).json({ error: 'Failed to fetch skills' });
  }
});

router.post('/my/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'file is required' });
    }

    const formData = new FormData();
    formData.append('userId', req.user.id);
    const blob = new Blob([req.file.buffer], { type: req.file.mimetype });
    const utf8Filename = Buffer.from(req.file.originalname, 'latin1').toString('utf-8');
    formData.append('file', blob, utf8Filename);

    const response = await fetch(`${PI_HOST}/skills/my/upload`, {
      method: 'POST',
      headers: {
        'api-key': PI_API_KEY,
        'X-User-Id': req.user.id,
      },
      body: formData,
    });

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await response.json();
      return res.status(safeHttpStatus(response.status)).json(data);
    }

    const buffer = await response.arrayBuffer();
    return res.status(safeHttpStatus(response.status)).send(Buffer.from(buffer));
  } catch (error) {
    console.error('[Skills Route] Upload error:', error.message);
    return res.status(500).json({ error: 'Failed to upload skill' });
  }
});

router.get('/my/:skillName/detail', async (req, res) => {
  try {
    const { skillName } = req.params;
    if (!skillName) {
      return res.status(400).json({ error: 'skillName is required' });
    }

    const result = await buildSkillDetail({ skillName, user: req.user });
    return res.status(result.status).json(result.data);
  } catch (error) {
    console.error('[Skills Route] Detail error:', error.message);
    return res.status(500).json({ error: 'Failed to fetch skill detail' });
  }
});

router.get('/my/:skillName', async (req, res) => {
  try {
    const { skillName } = req.params;
    if (!skillName) {
      return res.status(400).json({ error: 'skillName is required' });
    }

    const url = `${PI_HOST}/skills/my/${encodeURIComponent(skillName)}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'api-key': PI_API_KEY,
        'X-User-Id': req.user.id,
      },
    });

    if (!response.ok) {
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await response.json();
        return res.status(safeHttpStatus(response.status)).json(data);
      }
      return res
        .status(safeHttpStatus(response.status))
        .json({ error: 'Failed to download skill' });
    }

    const contentDisposition = response.headers.get('content-disposition');
    if (contentDisposition) {
      res.setHeader('Content-Disposition', contentDisposition);
    }
    const contentType = response.headers.get('content-type');
    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }

    const buffer = await response.arrayBuffer();
    return res.send(Buffer.from(buffer));
  } catch (error) {
    console.error('[Skills Route] Download error:', error.message);
    return res.status(500).json({ error: 'Failed to download skill' });
  }
});

router.delete('/my/:skillName', async (req, res) => {
  try {
    const { skillName } = req.params;
    if (!skillName) {
      return res.status(400).json({ error: 'skillName is required' });
    }

    const url = `${PI_HOST}/skills/my/${encodeURIComponent(skillName)}`;
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        'api-key': PI_API_KEY,
        'X-User-Id': req.user.id,
      },
    });

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await response.json();
      return res.status(safeHttpStatus(response.status)).json(data);
    }

    return res.status(safeHttpStatus(response.status)).send();
  } catch (error) {
    console.error('[Skills Route] Delete error:', error.message);
    return res.status(500).json({ error: 'Failed to delete skill' });
  }
});

module.exports = router;
