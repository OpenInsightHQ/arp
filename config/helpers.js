/**
 * Helper functions
 * This allows us to give the console some colour when running in a terminal
 */
const execa = require('execa');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const IS_WIN = process.platform === 'win32';

/** Resolve a bin name to its Windows .cmd variant so execa.sync runs without a shell. */
function resolveBin(name) {
  if (!IS_WIN) {
    return name;
  }
  const needsCmd =
    name === 'npm' || name === 'npx' || name === 'bun' || name === 'pnpm' || name === 'yarn';
  return needsCmd ? `${name}.cmd` : name;
}

/**
 * Execute a command without spawning a shell, eliminating command-injection risk.
 * @param {string} command - Executable to run.
 * @param {string[]} [args] - Arguments passed directly (never shell-interpreted).
 * @param {{ sudo?: boolean } & import('execa').SyncOptions} [options] - Options;
 *   set `sudo: true` to prefix the command with `sudo`.
 */
function runCommand(command, args = [], options = {}) {
  const { sudo, ...rest } = options;
  const executable = sudo ? 'sudo' : resolveBin(command);
  const finalArgs = sudo ? [command, ...args] : args;
  return execa.sync(executable, finalArgs, {
    stdio: 'inherit',
    windowsHide: true,
    ...rest,
  });
}

const askQuestion = (query) => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) =>
    rl.question('\x1b[36m' + query + '\n> ' + '\x1b[0m', (ans) => {
      rl.close();
      resolve(ans);
    }),
  );
};

const askMultiLineQuestion = (query) => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.cyan(query);

  return new Promise((resolve) => {
    let lines = [];
    rl.on('line', (line) => {
      if (line.trim() === '.') {
        rl.close();
        resolve(lines.join('\n'));
      } else {
        lines.push(line);
      }
    });
  });
};

function isDockerRunning() {
  try {
    execa.sync('docker', ['info'], { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}

function deleteNodeModules(dir) {
  const nodeModulesPath = path.join(dir, 'node_modules');
  if (fs.existsSync(nodeModulesPath)) {
    console.purple(`Deleting node_modules in ${dir}`);
    fs.rmSync(nodeModulesPath, { recursive: true });
  }
}

const silentExit = (code = 0) => {
  console.log = () => {};
  process.exit(code);
};

// Set the console colours
console.orange = (msg) => console.log('\x1b[33m%s\x1b[0m', msg);
console.green = (msg) => console.log('\x1b[32m%s\x1b[0m', msg);
console.red = (msg) => console.log('\x1b[31m%s\x1b[0m', msg);
console.blue = (msg) => console.log('\x1b[34m%s\x1b[0m', msg);
console.purple = (msg) => console.log('\x1b[35m%s\x1b[0m', msg);
console.cyan = (msg) => console.log('\x1b[36m%s\x1b[0m', msg);
console.yellow = (msg) => console.log('\x1b[33m%s\x1b[0m', msg);
console.white = (msg) => console.log('\x1b[37m%s\x1b[0m', msg);
console.gray = (msg) => console.log('\x1b[90m%s\x1b[0m', msg);

module.exports = {
  askQuestion,
  askMultiLineQuestion,
  silentExit,
  isDockerRunning,
  deleteNodeModules,
  resolveBin,
  runCommand,
};
