const execa = require('execa');
const { isDockerRunning, silentExit, runCommand } = require('./helpers');

async function validateDockerRunning() {
  if (!isDockerRunning()) {
    console.red(
      'Error: Docker is not running. You will need to start Docker Desktop or if using linux/mac, run `sudo systemctl start docker`',
    );
    silentExit(1);
  }
}

function getCurrentBranch() {
  return execa.sync('git', ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim();
}

const shouldRebase = process.argv.includes('--rebase');

(async () => {
  console.green(
    'Starting deployed update script, this may take a minute or two depending on your system and network.',
  );

  await validateDockerRunning();
  console.purple('Fetching the latest repo...');
  execa.sync('git', ['fetch', 'origin'], { stdio: 'inherit' });

  if (!shouldRebase) {
    execa.sync('git', ['checkout', 'main'], { stdio: 'inherit' });
    console.purple('Pulling the latest code from main...');
    execa.sync('git', ['pull', 'origin', 'main'], { stdio: 'inherit' });
  } else if (shouldRebase) {
    const currentBranch = getCurrentBranch();
    console.purple(`Rebasing ${currentBranch} onto main...`);
    execa.sync('git', ['rebase', 'origin/main'], { stdio: 'inherit' });
  }

  console.purple('Removing previously made Docker container...');
  const composeArgs = ['-f', './deploy-compose.yml'];
  console.orange('sudo docker compose -f ./deploy-compose.yml down');
  runCommand('docker', [...composeArgs, 'down'], { sudo: true });

  console.purple('Removing all tags for LibreChat `deployed` images...');
  const repositories = ['ghcr.io/danny-avila/librechat-dev-api', 'librechat-client'];
  repositories.forEach((repo) => {
    const tags = runCommand('docker', ['images', repo, '-q'], { sudo: true, stdio: 'pipe' })
      .stdout.split('\n')
      .filter(Boolean);
    tags.forEach((tag) => {
      const removeImageDisplay = `sudo docker rmi ${tag}`;
      console.orange(removeImageDisplay);
      runCommand('docker', ['rmi', tag], { sudo: true });
    });
  });

  console.purple('Pulling latest LibreChat images...');
  console.orange('sudo docker compose -f ./deploy-compose.yml pull api');
  runCommand('docker', [...composeArgs, 'pull', 'api'], { sudo: true });

  let startCommand = 'sudo docker compose -f ./deploy-compose.yml up -d';
  console.green('Your LibreChat app is now up to date! Start the app with the following command:');
  console.purple(startCommand);
  console.orange(
    "Note: it's also recommended to clear your browser cookies and localStorage for LibreChat to assure a fully clean installation.",
  );
  console.orange("Also: Don't worry, your data is safe :)");
})();
