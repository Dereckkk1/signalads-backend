module.exports = {
  apps: [{
    name: 'eradios-api',
    script: 'dist/index.js',
    instances: 'max',
    exec_mode: 'cluster',
    max_memory_restart: '512M',
    env_production: {
      NODE_ENV: 'production',
      PORT: 5000,
    },
    // Logs
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    // Graceful reload
    listen_timeout: 10000,
    kill_timeout: 5000,
  }],
};
