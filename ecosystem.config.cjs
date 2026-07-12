module.exports = {
  apps: [{
    name: 'group_special_title_client',
    script: 'src/index.ts',
    interpreter: 'tsx',
    watch: false,
    autorestart: true,
    env: {
      NODE_ENV: 'production',
    },
  }],
};
