// 页面统一在 catch 中调用；数据库层只抛错，避免重复 toast。
function showError(error, fallback = '操作失败，请稍后重试') {
  console.error('[月度预算记账]', error);
  const isLocalError = error instanceof Error && !error.errCode && !error.errMsg;
  wx.showToast({
    title: isLocalError ? error.message : fallback,
    icon: 'none',
    duration: 3000
  });
}

module.exports = { showError };
