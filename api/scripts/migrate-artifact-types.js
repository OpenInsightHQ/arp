/**
 * 数据迁移脚本：修复 GalleryArtifact 中的中文 type 值
 *
 * 问题：早期发布的 artifact 使用了中文 type ('报告', '报表')
 * 解决：统一迁移到英文枚举值 ('HTML', 'SKILL')
 */

const mongoose = require('mongoose');
const { logger } = require('@librechat/data-schemas');

// 连接数据库
const MONGODB_URI = process.env.MONGO_URI || 'mongodb://localhost:27018/LibreChat';

const migrateArtifactTypes = async () => {
  try {
    await mongoose.connect(MONGODB_URI);
    logger.info('[Migration] Connected to MongoDB');

    const db = mongoose.connection.db;
    const collection = db.collection('galleryartifacts');

    // 1. 查找所有包含中文 type 的记录
    const chineseTypes = ['报告', '报表', '图表', '其他'];
    const invalidArtifacts = await collection.find({
      type: { $in: chineseTypes }
    }).toArray();

    logger.info(`[Migration] Found ${invalidArtifacts.length} artifacts with Chinese types`);

    if (invalidArtifacts.length === 0) {
      logger.info('[Migration] No migration needed');
      return;
    }

    // 2. 显示将要迁移的数据
    invalidArtifacts.forEach(artifact => {
      logger.info(`[Migration] Artifact: ${artifact.title}, Type: ${artifact.type}`);
    });

    // 3. 执行迁移
    const result = await collection.updateMany(
      { type: { $in: chineseTypes } },
      { $set: { type: 'HTML' } }  // 所有中文类型统一迁移到 HTML
    );

    logger.info(`[Migration] Updated ${result.modifiedCount} artifacts`);
    logger.info('[Migration] ✅ Migration completed successfully');

  } catch (error) {
    logger.error('[Migration] Error:', error);
    throw error;
  } finally {
    await mongoose.disconnect();
  }
};

// 导出函数以便其他模块使用
module.exports = { migrateArtifactTypes };

// 如果直接运行此脚本
if (require.main === module) {
  migrateArtifactTypes()
    .then(() => {
      logger.info('[Migration] Script completed');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('[Migration] Script failed:', error);
      process.exit(1);
    });
}
