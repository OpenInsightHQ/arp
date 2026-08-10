const mongoose = require('mongoose');
const { createMethods } = require('@librechat/data-schemas');
const methods = createMethods(mongoose);
const { comparePassword } = require('./userMethods');
const { GalleryVersion } = require('./GalleryVersion');
const { GallerySqlQuery } = require('./GallerySqlQuery');
const {
  getMessage,
  getMessages,
  saveMessage,
  recordMessage,
  updateMessage,
  deleteMessagesSince,
  deleteMessages,
} = require('./Message');
const { getConvoTitle, getConvo, saveConvo, deleteConvos } = require('./Conversation');
const { getPreset, getPresets, savePreset, deletePresets } = require('./Preset');
const { File } = require('~/db/models');
const { initializeSystemPromptService } = require('@librechat/api');

const seedDatabase = async () => {
  await methods.initializeRoles();
  await methods.seedDefaultRoles();
  await methods.ensureDefaultCategories();
  initializeSystemPromptService(mongoose);
};

module.exports = {
  ...methods,
  seedDatabase,
  comparePassword,

  getMessage,
  getMessages,
  saveMessage,
  recordMessage,
  updateMessage,
  deleteMessagesSince,
  deleteMessages,

  getConvoTitle,
  getConvo,
  saveConvo,
  deleteConvos,

  getPreset,
  getPresets,
  savePreset,
  deletePresets,

  Files: File,

  // Gallery Models
  GalleryVersion,
  GallerySqlQuery,
};