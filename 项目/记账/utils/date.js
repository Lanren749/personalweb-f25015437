function pad2(value) {
  return String(value).padStart(2, '0');
}

function isValidMonth(value) {
  return typeof value === 'string' && /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  if (!isValidMonth(value.slice(0, 7))) return false;

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const leapYear = year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0);
  const days = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= days[month - 1];
}

// 使用本地日期，避免 UTC 转换导致日期偏移。
function formatDate(date = new Date()) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new Error('日期无效');
  }
  const year = date.getFullYear();
  if (year < 1 || year > 9999) throw new Error('日期年份超出支持范围');
  return `${String(year).padStart(4, '0')}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function getToday() {
  return formatDate(new Date());
}

function getCurrentMonth() {
  return getToday().slice(0, 7);
}

function shiftMonth(month, offset) {
  if (!isValidMonth(month)) throw new Error('月份格式应为 YYYY-MM');
  const monthIndex = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + offset;
  const year = Math.floor(monthIndex / 12);
  if (year < 1 || year > 9999) throw new Error('月份超出支持范围');
  return `${String(year).padStart(4, '0')}-${pad2(monthIndex % 12 + 1)}`;
}

function getPrevMonth(month) {
  return shiftMonth(month, -1);
}

function getNextMonth(month) {
  return shiftMonth(month, 1);
}

module.exports = {
  getCurrentMonth,
  formatDate,
  getToday,
  getPrevMonth,
  getNextMonth,
  isValidDate,
  isValidMonth
};
