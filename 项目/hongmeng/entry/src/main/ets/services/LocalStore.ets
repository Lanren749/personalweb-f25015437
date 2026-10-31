import { common } from '@kit.AbilityKit';
import { preferences } from '@kit.ArkData';

export class LocalStore {
  private data: preferences.Preferences;

  constructor(context: common.Context) {
    this.data = preferences.getPreferencesSync(context, { name: 'career_radar_v1' });
  }

  readIds(key: string): string[] {
    try {
      const value: preferences.ValueType = this.data.getSync(key, []);
      return Array.isArray(value) ? (value as string[]).filter((id: string): boolean => typeof id === 'string') : [];
    } catch (_) {
      throw new Error('读取本地列表失败');
    }
  }

  readText(key: string, fallback: string): string {
    try {
      const value: preferences.ValueType = this.data.getSync(key, fallback);
      return typeof value === 'string' ? value : fallback;
    } catch (_) {
      throw new Error('读取本地偏好失败');
    }
  }

  async save(favorites: string[], planned: string[], direction: string, time: string): Promise<void> {
    try {
      this.data.putSync('favorites', favorites);
      this.data.putSync('planned', planned);
      this.data.putSync('direction', direction);
      this.data.putSync('updateTime', time);
      await this.data.flush();
    } catch (_) {
      throw new Error('本地数据持久化失败');
    }
  }

  async saveText(key: string, value: string): Promise<void> {
    try {
      this.data.putSync(key, value);
      await this.data.flush();
    } catch (_) {
      throw new Error('本地记录保存失败');
    }
  }

  async removeText(key: string): Promise<void> {
    try {
      this.data.deleteSync(key);
      await this.data.flush();
    } catch (_) {
      throw new Error('清除本地记录失败');
    }
  }
}
