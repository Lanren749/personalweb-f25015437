import { defaultProfile, validProfile } from '../dist/shared/model/Ai.js';
import { isDomesticCompetition } from '../dist/shared/model/Competition.js';
export function emptyPersonal() { return { version: 1, revision: 0, profile: defaultProfile(), favorites: [], planned: [], notes: {}, savedItems: [] }; }
const idOK = id => typeof id === 'string' && /^(nc|4c)-\d{1,20}$/.test(id);
export function validPersonal(value) {
  if (!value || value.version !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0 || !validProfile(value.profile)) return false;
  if (!['favorites', 'planned'].every(key => Array.isArray(value[key]) && value[key].length <= 500 && value[key].every(idOK) && new Set(value[key]).size === value[key].length)) return false;
  if (!value.notes || Array.isArray(value.notes) || typeof value.notes !== 'object' || Object.keys(value.notes).length > 500) return false;
  return Object.entries(value.notes).every(([id, note]) => idOK(id) && note && typeof note.text === 'string' && note.text.length <= 10000 &&
    ['想参加', '准备中', '已提交', '已完成'].includes(note.stage) && Number.isFinite(note.updatedAt));
}
export class Personal {
  constructor(store) { this.store = store; this.value = emptyPersonal(); this.queue = Promise.resolve(); }
  async init() {
    this.value = await this.store.read('personal', emptyPersonal());
    if (!validPersonal(this.value) || !Array.isArray(this.value.savedItems) || !this.value.savedItems.every(isDomesticCompetition)) throw new Error('个人数据异常，未覆盖原文件');
  }
  update(input, catalog) {
    const task = this.queue.then(async () => {
      if (!validPersonal(input)) { const error = new Error('个人数据格式无效'); error.status = 400; throw error; }
      if (input.revision !== this.value.revision) { const error = new Error('另一台设备已更新数据，请刷新后再保存'); error.status = 409; throw error; }
      const keep = new Set([...input.favorites, ...input.planned, ...Object.keys(input.notes)]);
      const candidates = [...catalog, ...this.value.savedItems];
      const savedItems = candidates.filter((item, index) => keep.has(item.id) && candidates.findIndex(c => c.id === item.id) === index);
      if ([...keep].some(id => !savedItems.some(item => item.id === id))) { const error = new Error('赛事条目已变化，请刷新后再试'); error.status = 400; throw error; }
      const next = { version: 1, revision: this.value.revision + 1, profile: { version: 1, major: input.profile.major, interests: input.profile.interests, goals: input.profile.goals },
        favorites: input.favorites, planned: input.planned, notes: input.notes, savedItems };
      await this.store.write('personal', next); this.value = next; return next;
    });
    this.queue = task.catch(() => {}); return task;
  }
}
