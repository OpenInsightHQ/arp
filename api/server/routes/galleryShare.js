const express = require('express');
const { logger } = require('@librechat/data-schemas');
const {
  createGalleryArtifactShare,
  getGalleryArtifactShareContent,
  updateGalleryArtifactShare,
  deleteGalleryArtifactShare,
  getUserGalleryArtifactShares,
} = require('~/models/GalleryArtifactShare');
const { GalleryArtifact } = require('~/models/GalleryArtifact');
const requireJwtAuth = require('~/server/middleware/requireJwtAuth');

const router = express.Router();

router.get('/share/:shareId', async (req, res) => {
  try {
    const { shareId } = req.params;
    const share = await getGalleryArtifactShareContent(shareId);
    
    if (!share) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Share not found or is not public',
      });
    }
    
    res.json(share);
  } catch (error) {
    logger.error('[GET /api/gallery/share/:shareId] Error:', error.message);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message,
    });
  }
});

router.get('/share/:shareId/raw', async (req, res) => {
  try {
    const { shareId } = req.params;
    const share = await getGalleryArtifactShareContent(shareId);
    
    if (!share) {
      return res.status(404).send('Share not found');
    }
    
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.send(share.content);
  } catch (error) {
    logger.error('[GET /api/gallery/share/:shareId/raw] Error:', error.message);
    res.status(500).send('Internal server error');
  }
});

router.get('/:id/share', requireJwtAuth, async (req, res) => {
  try {
    const { id: galleryArtifactId } = req.params;
    const userId = req.user.id;
    
    const shares = await getUserGalleryArtifactShares(userId, galleryArtifactId);
    
    res.json({
      success: true,
      shares: shares.map(s => ({
        shareId: s.shareId,
        version: s.version,
        title: s.title,
        type: s.type,
        viewCount: s.viewCount,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      })),
    });
  } catch (error) {
    logger.error('[GET /api/gallery/:id/share] Error:', error.message);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message,
    });
  }
});

router.post('/:id/share', requireJwtAuth, async (req, res) => {
  try {
    const { id: galleryArtifactId } = req.params;
    const userId = req.user.id;
    
    const artifact = await GalleryArtifact.findOne({ galleryArtifactId, userId }).lean();
    
    if (!artifact) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Gallery artifact not found',
      });
    }
    
    const result = await createGalleryArtifactShare(userId, galleryArtifactId, artifact);
    
    res.json({
      success: true,
      shareId: result.shareId,
      galleryArtifactId: result.galleryArtifactId,
      version: result.version,
    });
  } catch (error) {
    logger.error('[POST /api/gallery/:id/share] Error:', error.message);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message,
    });
  }
});

router.delete('/:id/share', requireJwtAuth, async (req, res) => {
  try {
    const { id: galleryArtifactId } = req.params;
    const userId = req.user.id;
    
    const result = await deleteGalleryArtifactShare(userId, galleryArtifactId);
    
    res.json({
      success: result.success,
    });
  } catch (error) {
    logger.error('[DELETE /api/gallery/:id/share] Error:', error.message);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message,
    });
  }
});

module.exports = router;
