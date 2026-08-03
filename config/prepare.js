const execa = require('execa');
const { resolveBin } = require('./helpers');

if (process.env.NODE_ENV !== 'CI') {
  execa(resolveBin('npx'), ['husky', 'install'])
    .then(({ stdout, stderr }) => {
      if (stdout) {
        console.log(stdout);
      }
      if (stderr) {
        console.error(stderr);
      }
    })
    .catch((error) => {
      console.error(`exec error: ${error}`);
    });
}
