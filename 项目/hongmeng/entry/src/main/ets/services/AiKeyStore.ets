import { asset } from '@kit.AssetStoreKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { util } from '@kit.ArkTS';
import { validApiKey } from '../model/Ai';

// Never fall back to Preferences/files if secure storage is unavailable.
export class AiKeyStore {
  private alias(): Uint8Array {
    return new util.TextEncoder().encodeInto('career-radar.deepseek.v1');
  }

  async exists(): Promise<boolean> {
    const query: asset.AssetMap = new Map();
    query.set(asset.Tag.ALIAS, this.alias());
    query.set(asset.Tag.RETURN_TYPE, asset.ReturnType.ATTRIBUTES);
    try { return (await asset.query(query)).length > 0; } catch (error) {
      if ((error as BusinessError).code === 24000002) { return false; }
      throw new Error('安全存储暂不可用，请解锁设备后重试');
    }
  }

  async read(): Promise<string> {
    const query: asset.AssetMap = new Map();
    query.set(asset.Tag.ALIAS, this.alias());
    query.set(asset.Tag.RETURN_TYPE, asset.ReturnType.ALL);
    try {
      const rows: asset.AssetMap[] = await asset.query(query);
      if (rows.length === 0) { return ''; }
      const secret: Uint8Array = rows[0].get(asset.Tag.SECRET) as Uint8Array;
      return new util.TextDecoder().decodeToString(secret);
    } catch (error) {
      if ((error as BusinessError).code === 24000002) { return ''; }
      throw new Error('安全存储暂不可用，请解锁设备后重试；不会改用明文保存');
    }
  }

  async save(key: string): Promise<void> {
    if (!validApiKey(key)) { throw new Error('Key 格式无效，请完整粘贴，勿包含空格'); }
    const values: asset.AssetMap = new Map();
    values.set(asset.Tag.ALIAS, this.alias());
    values.set(asset.Tag.SECRET, new util.TextEncoder().encodeInto(key));
    values.set(asset.Tag.ACCESSIBILITY, asset.Accessibility.DEVICE_UNLOCKED);
    values.set(asset.Tag.SYNC_TYPE, asset.SyncType.THIS_DEVICE);
    values.set(asset.Tag.CONFLICT_RESOLUTION, asset.ConflictResolution.OVERWRITE);
    try {
      await asset.add(values);
    } catch (_) {
      throw new Error('Key 未保存，请解锁设备后重试；不会改用明文保存');
    }
  }

  async remove(): Promise<void> {
    const query: asset.AssetMap = new Map();
    query.set(asset.Tag.ALIAS, this.alias());
    try { await asset.remove(query); } catch (error) {
      if ((error as BusinessError).code !== 24000002) { throw new Error('Key 未删除，请稍后重试'); }
    }
  }
}
