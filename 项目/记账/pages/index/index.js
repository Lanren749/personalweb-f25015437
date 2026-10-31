const { listAreas, listExpenses } = require('../../utils/db');
const { getCurrentMonth, getPrevMonth, getNextMonth } = require('../../utils/date');
const { formatMoney, fenToYuan } = require('../../utils/money');
const { showError } = require('../../utils/error');

function makeMonthLabel(month) {
  return `${month.slice(0, 4)}年${month.slice(5, 7)}月`;
}

function sumFen(current, amountFen, label) {
  if (!Number.isSafeInteger(amountFen) || amountFen < 0) {
    throw new Error(`${label}金额数据无效`);
  }
  const sum = current + amountFen;
  if (!Number.isSafeInteger(sum)) throw new Error(`${label}金额超出安全范围`);
  return sum;
}

function makeOverview(areas, expenses) {
  const spentByArea = Object.create(null);
  let totalBudgetFen = 0;
  let totalSpentFen = 0;

  areas.forEach((area) => {
    if (!Number.isSafeInteger(area.budgetFen) || area.budgetFen < 0) {
      throw new Error('预算金额数据无效');
    }
    totalBudgetFen = sumFen(totalBudgetFen, area.budgetFen, '预算');
  });

  expenses.forEach((expense) => {
    totalSpentFen = sumFen(totalSpentFen, expense.amountFen, '支出');
    const previous = spentByArea[expense.areaId] || 0;
    spentByArea[expense.areaId] = sumFen(previous, expense.amountFen, '区域支出');
  });

  const areaList = areas.map((area) => {
    const spentFen = spentByArea[area._id] || 0;
    const remainingFen = area.budgetFen - spentFen;
    if (!Number.isSafeInteger(remainingFen)) throw new Error('区域剩余金额超出安全范围');
    return Object.assign({}, area, {
      budgetText: formatMoney(area.budgetFen),
      spentText: formatMoney(spentFen),
      remainingFen,
      remainingText: formatMoney(remainingFen),
      overspent: remainingFen < 0,
      overspentText: fenToYuan(Math.abs(remainingFen))
    });
  });

  const totalRemainingFen = totalBudgetFen - totalSpentFen;
  if (!Number.isSafeInteger(totalRemainingFen)) throw new Error('总剩余金额超出安全范围');

  return {
    areaList,
    totalBudgetFen,
    totalSpentFen,
    totalRemainingFen,
    totalBudgetText: formatMoney(totalBudgetFen),
    totalSpentText: formatMoney(totalSpentFen),
    totalRemainingText: formatMoney(totalRemainingFen),
    totalOverspent: totalRemainingFen < 0,
    totalOverspentText: fenToYuan(Math.abs(totalRemainingFen))
  };
}

Page({
  data: {
    month: '',
    monthLabel: '',
    areaList: [],
    totalBudgetText: '¥0.00',
    totalSpentText: '¥0.00',
    totalRemainingText: '¥0.00',
    totalOverspent: false,
    totalOverspentText: '¥0.00',
    loading: false,
    loaded: false,
    loadFailed: false
  },

  onLoad() {
    this._initialized = false;
    this._loadRequestId = 0;
  },

  onShow() {
    if (!this._initialized) {
      this._initialized = true;
      const month = getCurrentMonth();
      this.setData({ month, monthLabel: makeMonthLabel(month) });
    }
    this.loadData();
  },

  onPullDownRefresh() {
    this.loadData().finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  onUnload() {
    this._loadRequestId += 1;
  },

  async loadData() {
    const month = this.data.month || getCurrentMonth();
    const requestId = ++this._loadRequestId;
    this.setData({ loading: true });

    try {
      // db.listAreas/listExpenses use fetchAll pagination, so totals include every record.
      const [areas, expenses] = await Promise.all([
        listAreas(month),
        listExpenses(month)
      ]);
      if (requestId !== this._loadRequestId || month !== this.data.month) return false;

      const overview = makeOverview(areas, expenses);
      this.setData(Object.assign({}, overview, { loaded: true, loadFailed: false }));
      return true;
    } catch (error) {
      if (requestId === this._loadRequestId && month === this.data.month) {
        this.setData({ loadFailed: true });
        showError(error, '本月数据加载失败，请稍后重试');
      }
      return false;
    } finally {
      if (requestId === this._loadRequestId) this.setData({ loading: false });
    }
  },

  changeMonth(event) {
    const delta = Number(event.currentTarget.dataset.delta);
    if (delta !== -1 && delta !== 1) return;

    let month;
    try {
      month = delta < 0 ? getPrevMonth(this.data.month) : getNextMonth(this.data.month);
    } catch (error) {
      showError(error, '月份超出支持范围');
      return;
    }

    this._loadRequestId += 1;
    this.setData({
      month,
      monthLabel: makeMonthLabel(month),
      areaList: [],
      totalBudgetText: '¥0.00',
      totalSpentText: '¥0.00',
      totalRemainingText: '¥0.00',
      totalOverspent: false,
      totalOverspentText: '¥0.00',
      loading: true,
      loaded: false,
      loadFailed: false
    });
    this.loadData();
  },

  goToAreas() {
    wx.navigateTo({
      url: `/pages/areas/areas?month=${encodeURIComponent(this.data.month)}`,
      fail: (error) => showError(error, '区域设置打开失败，请重试')
    });
  },

  goToAdd() {
    wx.navigateTo({
      url: '/pages/add/add',
      fail: (error) => showError(error, '记账页面打开失败，请重试')
    });
  },

  goToDetail() {
    wx.navigateTo({
      url: `/pages/detail/detail?month=${encodeURIComponent(this.data.month)}`,
      fail: (error) => showError(error, '月度明细打开失败，请重试')
    });
  }
});
