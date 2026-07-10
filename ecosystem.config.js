module.exports = {
  apps: [
    {
      name: 'capital-flow',
      script: 'server.js',
      watch: false,
      restart_delay: 3000,
      max_restarts: 20,
      min_uptime: '10s',
      error_file: 'logs/err.log',
      out_file: 'logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      env: { NODE_ENV: 'production', PORT: 3001 },
    },
    {
      name: 'db-backup',
      script: 'backup.js',
      cron_restart: '0 * * * *', // every hour
      watch: false,
      autorestart: false,
      error_file: 'logs/backup-err.log',
      out_file: 'logs/backup-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
    {
      name: 'health-monitor',
      script: 'monitor.js',
      cron_restart: '*/5 * * * *', // every 5 minutes
      watch: false,
      autorestart: false,
      error_file: 'logs/monitor-err.log',
      out_file: 'logs/monitor-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
