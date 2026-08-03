// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
const fs = require('fs');
const path = require('path');

const { deleteNodeModules, runCommand } = require('./helpers');

// Set the directories
const rootDir = path.resolve(__dirname, '..');
const directories = [
  rootDir,
  path.resolve(rootDir, 'packages', 'data-provider'),
  path.resolve(rootDir, 'packages', 'data-schemas'),
  path.resolve(rootDir, 'packages', 'api'),
  path.resolve(rootDir, 'client'),
  path.resolve(rootDir, 'api'),
];

// Delete package-lock.json if it exists
const packageLockPath = path.resolve(rootDir, 'package-lock.json');

(async () => {
  if (!packageLockPath.startsWith(rootDir + path.sep)) {
    throw new Error(`Refusing to operate on path outside rootDir: ${packageLockPath}`);
  }

  let exists = false;
  try {
    await fs.promises.access(packageLockPath);
    exists = true;
  } catch {
    // file does not exist, nothing to do
  }

  if (exists) {
    console.purple('Deleting package-lock.json...');
    try {
      await fs.promises.unlink(packageLockPath);
    } catch (err) {
      console.red(`Failed to delete package-lock.json: ${err.message}`);
    }
  }

  // Delete all node_modules
  directories.forEach(deleteNodeModules);

  // Run npm cache clean --force
  console.purple('Cleaning npm cache...');
  runCommand('npm', ['cache', 'clean', '--force']);

  // Install dependencies
  console.purple('Installing dependencies...');
  runCommand('npm', ['install']);
})();
