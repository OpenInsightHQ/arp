const express = require('express');
const { MeiliSearch } = require('meilisearch');
const { isEnabled } = require('@librechat/api');
const requireJwtAuth = require('~/server/middleware/requireJwtAuth');

const router = express.Router();

router.use(requireJwtAuth);

router.get('/enable', async function (req, res) {
  if (!isEnabled(process.env.SEARCH)) {
    return res.send(false);
  }

  try {
    const client = new MeiliSearch({
      host: process.env.MEILI_HOST,
      apiKey: process.env.MEILI_MASTER_KEY,
    });

    const { status } = await client.health();
    return res.send(status === 'available');
  } catch (error) {
    return res.send(false);
  }
});

router.get('/vocabulary', async function (req, res) {
  const { q, datasetIds } = req.query;

  if (!q || q.trim().length === 0) {
    return res.json({ hits: [] });
  }

  if (!datasetIds) {
    return res.json({ hits: [] });
  }

  const datasetIdList = (Array.isArray(datasetIds) ? datasetIds : datasetIds.split(','))
    .map((id) => id.trim())
    .filter(Boolean);
  if (datasetIdList.length === 0) {
    return res.json({ hits: [] });
  }

  try {
    const client = new MeiliSearch({
      host: process.env.MEILI_HOST,
      apiKey: process.env.MEILI_MASTER_KEY,
    });

    const indexName = process.env.MEILI_INDEX_VOCALUARY || 'vocabulary_keyword';
    const index = client.index(indexName);

    const searchQuery = q.trim().toLowerCase();

    const datasetIdFilters = datasetIdList.map((id) => `datasetId = "${id}"`).join(' OR ');
    const filter = `(${datasetIdFilters})`;

    const searchResults = await index.search(q, {
      limit: 20,
      filter,
      attributesToRetrieve: [
        'name',
        'tableName',
        'columnName',
        'desc',
        'definition',
        'datasetId',
        'datasetName',
      ],
    });

    const filteredHits = searchResults.hits
      .filter((hit) => {
        const name = hit.name?.toLowerCase() || '';
        return name.includes(searchQuery);
      })
      .map((hit) => ({
        ...hit,
        datasetId: hit.datasetId || '',
        datasetName: hit.datasetName || '数据集',
      }));

    return res.json({ hits: filteredHits });
  } catch (error) {
    console.error('Vocabulary search error:', error);
    return res.status(500).json({ error: 'Search failed' });
  }
});

module.exports = router;
