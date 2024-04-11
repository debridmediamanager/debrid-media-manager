module.exports = {
  apps : [{
    name: 'dmm',
    script: '.next/standalone/server.js',
    instances: 'max',
    exec_mode: 'cluster',
  }],
};
