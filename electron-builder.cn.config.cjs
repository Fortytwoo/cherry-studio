const { CHINA_EDITION } = require('./scripts/release/edition')

module.exports = async function createChinaEditionConfig() {
  return {
    extends: './electron-builder.yml',
    appId: 'local.yoyoking.studio.cn',
    extraMetadata: {
      cherryEdition: CHINA_EDITION
    },
    publish: null
  }
}
