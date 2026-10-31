const { listAreas, addArea, updateArea, deleteArea, listExpenses } = require('../../utils/db');
const { getCurrentMonth, getPrevMonth, isValidMonth } = require('../../utils/date');
const { yuanToFen, fenToYuan, formatMoney } = require('../../utils/money');
const { showError } = require('../../utils/error');

function monthLabel(month) {
  return `${month.slice(0, 4)}年${month.slice(5, 7)}月`;
}

function makeAreaRows(areas, expenses) {
  const spentByArea = Object.create(null);
  expenses.forEach((expense) => {
    if (!Number.isSafeInteger(expense.amountFen) || expense.amountFen < 0) {
      throw new Error('支出金额数据无效');
    }
    const current = spentByArea[expense.areaId] || 0;
    const next = current + expense.amountFen;
    if (!Number.isSafeInteger(next)) throw new Error('支出金额超出安全范围');
    spentByArea[expense.areaId] = next;
  });

  return areas.map((area) => {
    if (!Number.isSafeInteger(area.budgetFen) || area.budgetFen < 0) {
      throw new Error('预算金额数据无效');
    }
    const spentFen = spentByArea[area._id] || 0;
    const remainingFen = area.budgetFen - spentFen;
    if (!Number.isSafeInteger(remainingFen)) throw new Error('剩余金额超出安全范围');
    return Object.assign({}, area, {
      budgetText: formatMoney(area.budgetFen),
      spentFen,
      spentText: formatMoney(spentFen),
      remainingFen,
      remainingText: formatMoney(remainingFen),
      overspent: remainingFen < 0,
      overspentText: fenToYuan(Math.abs(remainingFen))
    });
  });
}

function showToast(title) {
  wx.showToast({ title, icon: 'none', duration: 2000 });
}

function confirm(title, content, confirmText) {
  return new Promise((resolve, reject) => {
    wx.showModal({
      title,
      content,
      confirmText: confirmText || '确定',
      cancelText: '取消',
      success: resolve,
      fail: reject
    });
  });
}

Page({
  data: {
    month: '',
    monthLabel: '',
    areaList: [],
    loading: false,
    loaded: false,
    loadFailed: false,
    editorVisible: false,
    editingId: '',
    editorTitle: '新增区域',
    formName: '',
    formBudget: '',
    formSort: '',
    saving: false,
    copying: false,
    deletingId: ''
  },

  onLoad(options = {}) {
    this._loadRequestId = 0;
    const month = isValidMonth(options.month) ? options.month : getCurrentMonth();
    this.setData({ month, monthLabel: monthLabel(month) });
  },

  onShow() {
    this.loadData();
  },

  onUnload() {
    this._loadRequestId += 1;
  },

  async loadData(options = {}) {
    const showFailure = options.showFailure !== false;
    const month = this.data.month || getCurrentMonth();
    const requestId = ++this._loadRequestId;
    this.setData({ loading: true });
    try {
      const [areas, expenses] = await Promise.all([
        listAreas(month),
        listExpenses(month)
      ]);
      if (requestId !== this._loadRequestId || month !== this.data.month) return false;
      this.setData({ areaList: makeAreaRows(areas, expenses), loaded: true, loadFailed: false });
      return true;
    } catch (error) {
      if (requestId === this._loadRequestId && month === this.data.month) {
        this.setData({ loadFailed: true });
        if (showFailure) showError(error, '区域数据加载失败，请稍后重试');
      }
      return false;
    } finally {
      if (requestId === this._loadRequestId) this.setData({ loading: false });
    }
  },

  openAddEditor() {
    if (this.data.loading || this.data.saving || this.data.copying || this.data.deletingId) return;
    this.setData({
      editorVisible: true,
      editingId: '',
      editorTitle: '新增区域',
      formName: '',
      formBudget: '0',
      formSort: ''
    });
  },

  openEditEditor(event) {
    if (this.data.loading || this.data.saving || this.data.copying || this.data.deletingId) return;
    const id = event.currentTarget.dataset.id;
    const area = this.data.areaList.find((item) => item._id === id);
    if (!area) {
      showToast('区域不存在，请刷新后重试');
      return;
    }
    this.setData({
      editorVisible: true,
      editingId: area._id,
      editorTitle: '编辑区域',
      formName: area.name,
      formBudget: fenToYuan(area.budgetFen),
      formSort: Number.isSafeInteger(area.sort) ? String(area.sort) : ''
    });
  },

  onNameInput(event) {
    this.setData({ formName: event.detail.value });
  },

  onBudgetInput(event) {
    this.setData({ formBudget: event.detail.value });
  },

  onSortInput(event) {
    this.setData({ formSort: event.detail.value });
  },

  closeEditor() {
    if (this.data.saving) return;
    this.setData({ editorVisible: false });
  },

  async saveArea() {
    if (this.data.loading || this.data.saving || this.data.copying || this.data.deletingId) return;
    const name = this.data.formName.trim();
    if (!name) {
      showToast('请输入区域名称');
      return;
    }

    let budgetFen;
    try {
      budgetFen = yuanToFen(this.data.formBudget);
    } catch (error) {
      showError(error, '请输入有效预算金额');
      return;
    }

    const editing = this.data.editingId
      ? this.data.areaList.find((item) => item._id === this.data.editingId)
      : null;
    if (this.data.editingId && !editing) {
      this.setData({ editorVisible: false, editingId: '' });
      showToast('区域不存在，请刷新后重试');
      return;
    }
    let sort;
    const sortText = this.data.formSort.trim();
    if (!sortText && editing) {
      sort = editing.sort;
    } else if (!sortText) {
      const highest = this.data.areaList.reduce((value, area) => {
        return Number.isSafeInteger(area.sort) ? Math.max(value, area.sort) : value;
      }, -1);
      sort = highest + 1;
    } else if (/^-?\d+$/.test(sortText) && Number.isSafeInteger(Number(sortText))) {
      sort = Number(sortText);
    } else {
      showToast('排序请输入整数，或留空使用默认顺序');
      return;
    }

    this.setData({ saving: true });
    try {
      const input = { name, month: this.data.month, budgetFen, sort };
      if (editing) {
        await updateArea(editing._id, input);
      } else {
        await addArea(input);
      }
      this.setData({ editorVisible: false });
      showToast(editing ? '区域已更新' : '区域已添加');
      await this.loadData();
    } catch (error) {
      showError(error);
    } finally {
      this.setData({ saving: false });
    }
  },

  async removeArea(event) {
    if (this.data.loading || this.data.saving || this.data.copying || this.data.deletingId) return;
    const id = event.currentTarget.dataset.id;
    const area = this.data.areaList.find((item) => item._id === id);
    if (!area) {
      showToast('区域不存在，请刷新后重试');
      return;
    }
    if (area.spentFen > 0) {
      showToast('该区域已有支出，不能删除');
      return;
    }

    this.setData({ deletingId: id });
    try {
      const result = await confirm('删除区域', `确定删除“${area.name}”吗？`, '删除');
      if (!result.confirm) return;
      await deleteArea(id);
      if (this.data.editingId === id) {
        this.setData({ editorVisible: false, editingId: '' });
      }
      showToast('区域已删除');
      await this.loadData();
    } catch (error) {
      showError(error);
      await this.loadData({ showFailure: false });
    } finally {
      this.setData({ deletingId: '' });
    }
  },

  async copyPreviousMonth() {
    if (this.data.loading || this.data.saving || this.data.copying || this.data.deletingId) return;
    const month = this.data.month;
    this.setData({ copying: true });
    try {
      const result = await confirm(
        '复制上月预算',
        `将上月区域预算复制到${this.data.monthLabel}；本月已存在的同名区域会跳过。`,
        '复制'
      );
      if (!result.confirm) return;

      const previousMonth = getPrevMonth(month);
      // 以数据库当前结果去重；上次刷新失败也不会重复复制同名区域。
      const [previousAreas, currentAreas] = await Promise.all([
        listAreas(previousMonth),
        listAreas(month)
      ]);
      if (previousAreas.length === 0) {
        showToast('上月没有预算区域');
        return;
      }

      const existingNames = new Set(currentAreas.map((area) => area.name.trim()));
      let nextSort = currentAreas.reduce((value, area) => {
        return Number.isSafeInteger(area.sort) ? Math.max(value, area.sort + 1) : value;
      }, 0);
      let copiedCount = 0;

      for (const area of previousAreas) {
        const name = area.name.trim();
        if (!name || existingNames.has(name)) continue;
        await addArea({
          name,
          month,
          budgetFen: area.budgetFen,
          sort: nextSort
        });
        existingNames.add(name);
        nextSort += 1;
        copiedCount += 1;
      }

      if (copiedCount === 0) {
        showToast('没有可复制的区域，上月区域已存在');
      } else {
        showToast(`已复制 ${copiedCount} 个区域`);
      }
      await this.loadData();
    } catch (error) {
      showError(error, '复制上月预算失败，请稍后重试');
      await this.loadData({ showFailure: false });
    } finally {
      this.setData({ copying: false });
    }
  }
});
