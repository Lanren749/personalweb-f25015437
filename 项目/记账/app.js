const { showError } = require('./utils/error');

App({
  globalData: { cloudReady: false },

  onLaunch() {
    if (!wx.cloud) {
      showError(new Error('请升级微信或开发者工具基础库'));
      return;
    }
    try {
      // 替换为云开发控制台中的环境 ID，不是环境名称。
      wx.cloud.init({ env: 'YOUR_CLOUD_ENV_ID', traceUser: true });
      this.globalData.cloudReady = true;
    } catch (error) {
      showError(error, '云开发初始化失败，请检查环境配置');
    }
  }
});
