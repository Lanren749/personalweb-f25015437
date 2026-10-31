'use strict';

const TIMEZONE = 'Asia/Shanghai';
const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  frequency: 'weekly',
  weekday: 1,
  time: '09:00',
  lookbackDays: 14,
  timezone: TIMEZONE
});
const EDITABLE_KEYS = ['enabled', 'frequency', 'weekday', 'time', 'lookbackDays', 'timezone'];

function invalid(message) {
  const error = new Error(message);
  error.code = 'INVALID_INTELLIGENCE_SETTINGS';
  return error;
}

function validateSettings(input, previous = DEFAULT_SETTINGS) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid('更新设置必须为对象');
  if (Object.keys(input).some(key => !EDITABLE_KEYS.includes(key))) throw invalid('包含不支持或只读的更新设置');
  const value = { ...DEFAULT_SETTINGS, ...previous, ...input };
  if (typeof value.enabled !== 'boolean') throw invalid('自动更新开关必须为布尔值');
  if (!['weekly', 'daily'].includes(value.frequency)) throw invalid('更新频率必须为每天或每周');
  if (!Number.isInteger(value.weekday) || value.weekday < 1 || value.weekday > 7) throw invalid('更新星期必须为 1 至 7');
  if (typeof value.time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.time)) throw invalid('更新时间必须为 HH:mm 格式');
  if (!Number.isInteger(value.lookbackDays) || value.lookbackDays < 1 || value.lookbackDays > 90) throw invalid('回溯天数必须为 1 至 90 的整数');
  if (value.timezone !== TIMEZONE) throw invalid('更新时区固定为 Asia/Shanghai');
  return Object.fromEntries(EDITABLE_KEYS.map(key => [key, value[key]]));
}

// Only trusted persistence code supplies scheduleAfter. It survives restarts
// and prevents changing settings from immediately catching up an old slot.
function normalizeSettings(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  let editable;
  try { editable = validateSettings(Object.fromEntries(EDITABLE_KEYS.filter(key => source[key] !== undefined).map(key => [key, source[key]]))); }
  catch (_) { editable = { ...DEFAULT_SETTINGS }; }
  const savedAt = source.scheduleAfter ? new Date(source.scheduleAfter) : null;
  return { ...editable, scheduleAfter: savedAt && !Number.isNaN(savedAt.getTime()) ? savedAt.toISOString() : null };
}

module.exports = { DEFAULT_SETTINGS, TIMEZONE, EDITABLE_KEYS, validateSettings, normalizeSettings };
