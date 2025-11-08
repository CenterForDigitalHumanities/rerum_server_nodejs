module.exports = {
  apps: [{
    name: 'rerum-api',
    script: './bin/rerum_v1.js',
    instances: 4,
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'development',
      PORT: 3001
    }
  }]
}
