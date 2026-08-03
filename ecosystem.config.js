// PM2 process definition. Adjust paths/interpreter to match your deployment.
// Keep secrets (PI_API_KEY, PI_HOST, etc.) in your .env file rather than here.
module.exports = {
  apps: [
    {
      name: 'gallery-scheduler',
      script: 'api/schedulers/galleryScheduler.js',
      cwd: __dirname,
      interpreter: 'node',
      env_file: '.env',
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
    },
    {
      name: 'librechat',
      script: 'npm',
      args: 'run backend',
      cwd: __dirname,
      interpreter: 'node',
      env: {
        NODE_ENV: 'production',
      },
      env_file: '.env',
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
    },
  ],
};
