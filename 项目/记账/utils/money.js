// 按十进制字符串转换，不使用浮点金额乘以 100。
function yuanToFen(value) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error('请输入有效金额');
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error('请输入有效金额');
  }

  const text = String(value).trim();
  if (!/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(text)) {
    throw new Error('金额须为非负数字，最多保留两位小数');
  }

  const parts = text.split('.');
  const yuan = parts[0] || '0';
  const jiaoFen = (parts[1] || '').padEnd(2, '0');
  const fen = Number(`${yuan}${jiaoFen}`);
  if (!Number.isSafeInteger(fen)) throw new Error('金额超出安全范围');
  return fen;
}

// 返回两位小数的元字符串；允许负分以展示超支。
function fenToYuan(fen) {
  if (!Number.isSafeInteger(fen)) throw new Error('金额必须为安全整数分');
  const digits = String(Math.abs(fen)).padStart(3, '0');
  return `${fen < 0 ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

// 正数：¥12.34；负数：-¥12.34。
function formatMoney(fen) {
  const yuan = fenToYuan(fen);
  return fen < 0 ? `-¥${yuan.slice(1)}` : `¥${yuan}`;
}

module.exports = { yuanToFen, fenToYuan, formatMoney };
