const { isValidMonth, isValidDate } = require('./date');

const PAGE_SIZE = 20;
let database;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function collection(name) {
  assert(name === 'areas' || name === 'expenses', '数据集合无效');
  if (!database) {
    assert(typeof wx !== 'undefined' && wx.cloud, '云开发不可用，请检查配置');
    database = wx.cloud.database();
  }
  return database.collection(name);
}

function checkId(id) {
  assert(typeof id === 'string' && id.trim().length > 0, '记录 ID 无效');
}

function checkMonth(month) {
  assert(isValidMonth(month), '月份格式应为 YYYY-MM');
}

// 每页重建查询；按唯一 ID 稳定排序，避免同值记录的顺序不确定。
// 列表必须取全后再计算和排序；读取失败直接抛错，不返回不完整数据。
async function fetchAll(name, where = {}) {
  const records = [];
  let offset = 0;
  while (true) {
    const result = await collection(name).where(where)
      .orderBy('_id', 'asc').skip(offset).limit(PAGE_SIZE).get();
    assert(Array.isArray(result.data), '读取数据失败，请重试');
    records.push(...result.data);
    if (result.data.length < PAGE_SIZE) return records;
    offset += PAGE_SIZE;
  }
}

async function getRecord(name, id) {
  checkId(id);
  const result = await collection(name).doc(id).get();
  assert(result.data && result.data._id, '记录不存在或无权访问');
  return result.data;
}

async function updateRecord(name, id, data) {
  checkId(id);
  const result = await collection(name).doc(id).update({ data });
  assert(result.stats && result.stats.updated === 1, '记录不存在或无权修改');
  return id;
}

async function removeRecord(name, id) {
  checkId(id);
  const result = await collection(name).doc(id).remove();
  assert(result.stats && result.stats.removed === 1, '记录不存在或无权删除');
  return id;
}

function compareId(a, b) {
  return a._id < b._id ? -1 : a._id > b._id ? 1 : 0;
}

async function listAreas(month) {
  checkMonth(month);
  const records = await fetchAll('areas', { month });
  return records.sort((a, b) => a.sort - b.sort || a.createdAt - b.createdAt || compareId(a, b));
}

async function getArea(id) {
  return getRecord('areas', id);
}

function areaFields(input) {
  assert(input && typeof input === 'object', '区域数据无效');
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const sort = input.sort === undefined ? 0 : input.sort;
  assert(name.length > 0, '请输入区域名称');
  checkMonth(input.month);
  assert(Number.isSafeInteger(input.budgetFen) && input.budgetFen >= 0, '预算须为非负整数分');
  assert(Number.isSafeInteger(sort), '排序须为整数');
  return { name, month: input.month, budgetFen: input.budgetFen, sort };
}

async function addArea(input) {
  const data = areaFields(input);
  const now = Date.now();
  const result = await collection('areas').add({
    data: Object.assign({}, data, { createdAt: now, updatedAt: now })
  });
  return result._id;
}

async function updateArea(id, input) {
  assert(input && typeof input === 'object', '区域数据无效');
  const original = await getArea(id);
  const data = areaFields(Object.assign({}, original, input, { month: original.month }));
  // 区域月份固定；更新不传 createdAt、_id 或 _openid。
  return updateRecord('areas', id, {
    name: data.name, budgetFen: data.budgetFen, sort: data.sort, updatedAt: Date.now()
  });
}

async function deleteArea(id) {
  const area = await getArea(id);
  // 此处仅检查是否存在，最多一条即可，不用于统计或展示列表。
  const result = await collection('expenses')
    .where({ month: area.month, areaId: id }).limit(1).get();
  assert(Array.isArray(result.data), '读取支出失败，请重试');
  assert(result.data.length === 0, '该区域已有支出，不能删除');
  return removeRecord('areas', id);
}

async function listExpenses(month) {
  checkMonth(month);
  const records = await fetchAll('expenses', { month });
  return records.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return b.createdAt - a.createdAt || compareId(a, b);
  });
}

async function getExpense(id) {
  return getRecord('expenses', id);
}

async function expenseFields(input) {
  assert(input && typeof input === 'object', '支出数据无效');
  assert(Number.isSafeInteger(input.amountFen) && input.amountFen > 0, '支出金额须大于0且为整数分');
  assert(isValidDate(input.date), '请选择有效日期');
  checkId(input.areaId);
  const month = input.date.slice(0, 7);
  const area = await getArea(input.areaId);
  assert(area.month === month, '请选择支出日期所在月份的区域');
  const note = input.note === undefined ? '' : input.note;
  assert(typeof note === 'string', '备注须为文字');
  return { areaId: input.areaId, amountFen: input.amountFen, note, date: input.date, month };
}

async function addExpense(input) {
  const data = await expenseFields(input);
  const now = Date.now();
  const result = await collection('expenses').add({
    data: Object.assign({}, data, { createdAt: now, updatedAt: now })
  });
  return result._id;
}

async function updateExpense(id, input) {
  assert(input && typeof input === 'object', '支出数据无效');
  const original = await getExpense(id);
  const data = await expenseFields(Object.assign({}, original, input));
  // 只更新可编辑字段，保留数据库内原始 createdAt。
  return updateRecord('expenses', id, Object.assign({}, data, { updatedAt: Date.now() }));
}

async function deleteExpense(id) {
  return removeRecord('expenses', id);
}

module.exports = {
  fetchAll,
  listAreas, getArea, addArea, updateArea, deleteArea,
  listExpenses, getExpense, addExpense, updateExpense, deleteExpense
};
