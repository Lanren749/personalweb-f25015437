const { getExpense, listAreas, addExpense, updateExpense } = require('../../utils/db');
const { getToday, isValidDate } = require('../../utils/date');
const { yuanToFen, fenToYuan } = require('../../utils/money');
const { showError } = require('../../utils/error');

function showToast(title, icon = 'none') {
  wx.showToast({ title, icon, duration: 2000 });
}

Page({
  data: {
    isEdit: false,
    recordLoading: false,
    recordLoadFailed: false,
    areasLoading: false,
    areasLoadFailed: false,
    saving: false,
    date: '',
    amount: '',
    note: '',
    areaId: '',
    areaIndex: 0,
    areaList: [],
    areaNames: [],
    selectedAreaName: ''
  },

  onLoad(options) {
    this._unloaded = false;
    this._returnTimer = null;
    this._recordId = options && typeof options.id === 'string' ? options.id : '';
    this._areaRequestId = 0;
    this._skipFirstShow = true;
    const isEdit = Boolean(this._recordId);
    wx.setNavigationBarTitle({ title: isEdit ? '编辑支出' : '记一笔' });
    this.setData({ isEdit, date: getToday() });
    this.initializeForm();
  },

  onShow() {
    // onLoad 已负责首次初始化；返回本页时刷新日期所属月份的区域列表。
    if (this._skipFirstShow) {
      this._skipFirstShow = false;
      return;
    }
    if (this.data.recordLoading) return;
    if (this.data.recordLoadFailed) {
      this.initializeForm();
    } else {
      this.loadAreas(this.data.date, this.data.areaId);
    }
  },

  onUnload() {
    this._unloaded = true;
    clearTimeout(this._returnTimer);
    this._areaRequestId += 1;
  },

  async initializeForm() {
    if (this._unloaded || this.data.recordLoading || this.data.saving) return;
    this.setData({ recordLoading: true, recordLoadFailed: false });
    try {
      if (this._recordId) {
        const expense = await getExpense(this._recordId);
        if (this._unloaded) return;
        this.setData({
          amount: fenToYuan(expense.amountFen),
          note: typeof expense.note === 'string' ? expense.note : '',
          date: expense.date,
          areaId: expense.areaId
        });
        await this.loadAreas(expense.date, expense.areaId);
      } else {
        await this.loadAreas(this.data.date, '');
      }
    } catch (error) {
      if (this._unloaded) return;
      this.setData({ recordLoadFailed: true });
      showError(error, '支出记录加载失败，请稍后重试');
    } finally {
      if (!this._unloaded) this.setData({ recordLoading: false });
    }
  },

  async loadAreas(date, preferredAreaId) {
    if (this._unloaded) return;
    if (!isValidDate(date)) {
      this.setData({ areaList: [], areaNames: [], areaId: '', selectedAreaName: '' });
      return;
    }

    const requestId = ++this._areaRequestId;
    const month = date.slice(0, 7);
    this.setData({ areasLoading: true, areasLoadFailed: false });
    try {
      const areas = await listAreas(month);
      if (requestId !== this._areaRequestId || this.data.date.slice(0, 7) !== month) return;

      const selectedIndex = areas.findIndex((area) => area._id === preferredAreaId);
      const selectedArea = selectedIndex >= 0 ? areas[selectedIndex] : null;
      this.setData({
        areaList: areas,
        areaNames: areas.map((area) => area.name),
        areaId: selectedArea ? selectedArea._id : '',
        areaIndex: selectedIndex >= 0 ? selectedIndex : 0,
        selectedAreaName: selectedArea ? selectedArea.name : ''
      });
    } catch (error) {
      if (requestId !== this._areaRequestId) return;
      this.setData({ areaList: [], areaNames: [], areaId: '', selectedAreaName: '', areasLoadFailed: true });
      showError(error, '区域列表加载失败，请稍后重试');
    } finally {
      if (requestId === this._areaRequestId) this.setData({ areasLoading: false });
    }
  },

  retryAreas() {
    if (this.data.recordLoading || this.data.recordLoadFailed || this.data.areasLoading || this.data.saving) return;
    this.loadAreas(this.data.date, this.data.areaId);
  },

  onAmountInput(event) {
    this.setData({ amount: event.detail.value });
  },

  onNoteInput(event) {
    this.setData({ note: event.detail.value });
  },

  onDateChange(event) {
    const date = event.detail.value;
    if (!isValidDate(date)) {
      showToast('请选择有效日期');
      return;
    }

    const oldMonth = this.data.date.slice(0, 7);
    const newMonth = date.slice(0, 7);
    this.setData({ date });
    if (oldMonth !== newMonth) {
      // 区域按月份归属；换月后必须重新选择该月的区域。
      this.setData({ areaId: '', areaIndex: 0, areaList: [], areaNames: [], selectedAreaName: '' });
      this.loadAreas(date, '');
    }
  },

  onAreaChange(event) {
    const index = Number(event.detail.value);
    const area = this.data.areaList[index];
    if (!area) {
      showToast('请选择区域');
      return;
    }
    this.setData({
      areaIndex: index,
      areaId: area._id,
      selectedAreaName: area.name
    });
  },

  async saveExpense() {
    if (this._unloaded || this.data.saving || this.data.recordLoading || this.data.areasLoading || this.data.recordLoadFailed || this.data.areasLoadFailed) return;

    let amountFen;
    try {
      amountFen = yuanToFen(this.data.amount);
    } catch (error) {
      showError(error, '请输入有效支出金额');
      return;
    }
    if (amountFen <= 0) {
      showToast('支出金额须大于0');
      return;
    }
    if (!this.data.areaId) {
      showToast(this.data.areaList.length ? '请选择所属区域' : '请先设置本月预算区域');
      return;
    }
    if (!isValidDate(this.data.date)) {
      showToast('请选择有效日期');
      return;
    }

    const input = {
      amountFen,
      note: this.data.note,
      areaId: this.data.areaId,
      date: this.data.date
    };

    this.setData({ saving: true });
    try {
      if (this._recordId) {
        await updateExpense(this._recordId, input);
      } else {
        await addExpense(input);
      }
      if (this._unloaded) return;
      wx.showToast({ title: '保存成功', icon: 'success', duration: 1200 });
      this._returnTimer = setTimeout(() => {
        if (this._unloaded) return;
        wx.navigateBack({
          delta: 1,
          fail: (error) => {
            // 数据已保存，回到首页后再由 onShow 刷新；避免重复提交。
            showError(error, '保存成功，返回失败，正在打开首页');
            wx.reLaunch({
              url: '/pages/index/index',
              fail: (navigationError) => showError(navigationError, '数据已保存，请退出页面后重新进入')
            });
          }
        });
      }, 350);
    } catch (error) {
      if (this._unloaded) return;
      showError(error, '保存失败，请稍后重试');
      this.setData({ saving: false });
    }
  }
});
