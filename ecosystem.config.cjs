const { resolve } = require("node:path");

const root = __dirname;

module.exports = {
  apps: [
    {
      name: "embedify",
      cwd: root,
      script: "dist/index.js",
      interpreter: "node",
      node_args: "--disable-warning=ExperimentalWarning",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_restarts: 15,
      min_uptime: "8s",
      restart_delay: 2000,
      exp_backoff_restart_delay: 200,
      max_memory_restart: "256M",
      kill_timeout: 10000,
      wait_ready: true,
      listen_timeout: 120000,
      shutdown_with_message: true,
      env: {
        NODE_ENV: "production",
      },
      error_file: resolve(root, "logs/error.log"),
      out_file: resolve(root, "logs/out.log"),
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,
      time: true,
    },
  ],
};
