const { listAreas, listExpenses, deleteExpense } = require('../../utils/db');
const { getCurrentMonth, getPrevMonth, getNextMonth, isValidMonth } = require('../../utils/date');
const { formatMoney } = require('../../utils/money');
const { showError } = require('../../utils/error');

function makeMonthLabel(month) {
  return `${month.slice(0, 4)}年${month.slice(5, 7)}月`;
}

function compareExpenses(a, b) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return b.createdAt - a.createdAt;
}

Page({
  data: {
    month: '',
    monthLabel: '',
    expenseList: [],
    loading: false,
    loaded: false,
    loadFailed: false,
    deleting: false
  },

  onLoad(options = {}) {
    this._unloaded = false;
    this._loadRequestId = 0;
    this._skipFirstShow = true;
    const month = isValidMonth(options.month) ? options.month : getCurrentMonth();
    this.setData({ month, monthLabel: makeMonthLabel(month) });
    this.loadData();
  },

  onShow() {
    if (this._skipFirstShow) {
      this._skipFirstShow = false;
      return;
    }
    this.loadData();
  },

  onUnload() {
    this._unloaded = true;
    this._loadRequestId += 1;
  },

  async loadData() {
    if (this._unloaded) return false;
    const month = this.data.month || getCurrentMonth();
    const requestId = ++this._loadRequestId;
    this.setData({ loading: true });

    try {
      // listAreas/listExpenses return all pages, including months with over 20 entries.
      const [areas, expenses] = await Promise.all([
        listAreas(month),
        listExpenses(month)
      ]);
      if (requestId !== this._loadRequestId || month !== this.data.month) return false;

      const areaNames = Object.create(null);
      areas.forEach((area) => {
        areaNames[area._id] = area.name;
      });

      const expenseList = expenses.slice().sort(compareExpenses).map((expense) => ({
        _id: expense._id,
        date: expense.date,
        note: expense.note || '',
        areaName: areaNames[expense.areaId] || '未知区域',
        amountText: formatMoney(expense.amountFen)
      }));

      this.setData({ expenseList, loaded: true, loadFailed: false });
      return true;
    } catch (error) {
      if (requestId === this._loadRequestId && month === this.data.month) {
        this.setData({ loadFailed: true });
        showError(error, '本月明细加载失败，请稍后重试');
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
      expenseList: [],
      loaded: false,
      loadFailed: false,
      loading: true
    });
    this.loadData();
  },

  editExpense(event) {
    const id = event.currentTarget.dataset.id;
    if (!id || this.data.deleting) return;
    wx.navigateTo({
      url: `/pages/add/add?id=${encodeURIComponent(id)}`,
      fail: (error) => showError(error, '编辑页面打开失败，请重试')
    });
  },

  deleteExpense(event) {
    const id = event.currentTarget.dataset.id;
    const expense = this.data.expenseList.find((item) => item._id === id);
    if (!id || !expense || this.data.deleting) return;
    this.setData({ deleting: true });
    wx.showModal({
      title: '删除这笔支出？',
      content: '删除后无法恢复。',
      confirmText: '删除',
      confirmColor: '#c23d3d',
      success: async (result) => {
        try {
          if (!result.confirm || this._unloaded) return;
          await deleteExpense(id);
          if (this._unloaded) return;
          wx.showToast({ title: '已删除', icon: 'success', duration: 1200 });
          await this.loadData();
        } catch (error) {
          if (!this._unloaded) showError(error, '删除失败，请稍后重试');
        } finally {
          if (!this._unloaded) this.setData({ deleting: false });
        }
      },
      fail: (error) => {
        if (this._unloaded) return;
        this.setData({ deleting: false });
        showError(error, '删除确认打开失败，请重试');
      }
    });
  }
});
