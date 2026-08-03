const mongoose = require('mongoose');
const { nanoid } = require('nanoid');
const { logger } = require('@librechat/data-schemas');

/**
 * GalleryArtifactShare Schema
 */
const galleryArtifactShareSchema = new mongoose.Schema(
  {
    shareId: {
      type: String,
      required: true,
      unique: true,
      default: () => nanoid(),
    },
    galleryArtifactId: {
      type: String,
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    version: {
      type: Number,
      default: 1,
    },
    versionHistory: {
      type: [{
        version: Number,
        contentSnapshot: String,
        title: String,
        createdAt: { type: Date, default: Date.now },
      }],
      default: [],
    },
    isPublic: {
      type: Boolean,
      default: true,
      index: true,
    },
    viewCount: {
      type: Number,
      default: 0,
    },
    lastViewedAt: {
      type: Date,
    },
    title: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: ['HTML', 'SKILL'],
      default: 'HTML',
    },
  },
  {
    timestamps: true,
    collection: 'galleryartifactshares',
  },
);

galleryArtifactShareSchema.index({ galleryArtifactId: 1, userId: 1 });

const MAX_VERSIONS = 10;

galleryArtifactShareSchema.methods.addVersion = async function(content, title) {
  const newVersion = {
    version: this.version + 1,
    contentSnapshot: content,
    title: title || this.title,
    createdAt: new Date(),
  };
  
  this.versionHistory.push(newVersion);
  
  if (this.versionHistory.length > MAX_VERSIONS) {
    this.versionHistory = this.versionHistory.slice(-MAX_VERSIONS);
  }
  
  this.version = newVersion.version;
  this.title = newVersion.title;
  
  await this.save();
  return newVersion;
};

const GalleryArtifactShare = mongoose.models.GalleryArtifactShare || 
  mongoose.model('GalleryArtifactShare', galleryArtifactShareSchema);

const createGalleryArtifactShare = async (userId, galleryArtifactId, artifact) => {
  try {
    const existingShare = await GalleryArtifactShare.findOne({
      galleryArtifactId,
      userId,
      isPublic: true,
    });
    
    if (existingShare) {
      return {
        shareId: existingShare.shareId,
        galleryArtifactId,
        version: existingShare.version,
      };
    }
    
    const shareId = nanoid();
    const share = await GalleryArtifactShare.create({
      shareId,
      galleryArtifactId,
      userId,
      title: artifact.title,
      type: artifact.type,
      version: 1,
      isPublic: true,  // 显式设置为公开，确保分享链接可访问
      versionHistory: [{
        version: 1,
        contentSnapshot: artifact.content,
        title: artifact.title,
        createdAt: new Date(),
      }],
    });
    
    return {
      shareId,
      galleryArtifactId,
      version: 1,
    };
  } catch (error) {
    logger.error('[createGalleryArtifactShare] Error:', error.message);
    throw error;
  }
};

const getGalleryArtifactShareContent = async (shareId) => {
  try {
    const share = await GalleryArtifactShare.findOne({ shareId, isPublic: true }).lean();
    
    if (!share) {
      return null;
    }
    
    const latestVersion = share.versionHistory[share.versionHistory.length - 1];
    
    await GalleryArtifactShare.updateOne(
      { shareId },
      {
        $inc: { viewCount: 1 },
        lastViewedAt: new Date(),
      }
    );
    
    return {
      shareId: share.shareId,
      title: share.title,
      type: share.type,
      version: share.version,
      content: latestVersion?.contentSnapshot || '',
      createdAt: share.createdAt,
      updatedAt: share.updatedAt,
    };
  } catch (error) {
    logger.error('[getGalleryArtifactShareContent] Error:', error.message);
    throw error;
  }
};

const updateGalleryArtifactShare = async (galleryArtifactId, artifact) => {
  try {
    const share = await GalleryArtifactShare.findOne({ galleryArtifactId, isPublic: true });
    
    if (!share) {
      return null;
    }
    
    await share.addVersion(artifact.content, artifact.title);
    
    return share;
  } catch (error) {
    logger.error('[updateGalleryArtifactShare] Error:', error.message);
    throw error;
  }
};

const deleteGalleryArtifactShare = async (userId, galleryArtifactId) => {
  try {
    const result = await GalleryArtifactShare.deleteOne({
      galleryArtifactId,
      userId,
    });
    
    return { success: result.deletedCount > 0 };
  } catch (error) {
    logger.error('[deleteGalleryArtifactShare] Error:', error.message);
    throw error;
  }
};

const getUserGalleryArtifactShares = async (userId, galleryArtifactId) => {
  try {
    const query = { userId };
    if (galleryArtifactId) {
      query.galleryArtifactId = galleryArtifactId;
    }
    
    const shares = await GalleryArtifactShare.find(query)
      .sort({ createdAt: -1 })
      .select('-versionHistory.contentSnapshot')
      .lean();
    
    return shares;
  } catch (error) {
    logger.error('[getUserGalleryArtifactShares] Error:', error.message);
    throw error;
  }
};

module.exports = {
  GalleryArtifactShare,
  createGalleryArtifactShare,
  getGalleryArtifactShareContent,
  updateGalleryArtifactShare,
  deleteGalleryArtifactShare,
  getUserGalleryArtifactShares,
};
