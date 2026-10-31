import { common } from '@kit.AbilityKit';
import { pasteboard } from '@kit.BasicServicesKit';
import { OFFICIAL_SOURCES } from '../data/OfficialSources';
import { Competition, CompetitionQuery, deadlineLabel, filterCompetitions, isDomesticCompetition, isDueSoon,
  remainingDays, toggleId, validTime } from '../model/Competition';
import { ProjectNote, RadarCache, SourceInfo, SourceReport, emptyCache, formatBeijing,
  isSafeOfficialUrl, shouldRefresh } from '../model/Radar';
import { LocalStore } from '../services/LocalStore';
import { RadarService } from '../services/RadarService';
import { AiRecommendation, AiReport, CareerProfile, publicSearchUrl, readAiReport, readProfile,
  validApiKey } from '../model/Ai';
import { AiKeyStore } from '../services/AiKeyStore';
import { AiService, AI_MODELS } from '../services/AiService';
import { AiReportStore } from '../services/AiReportStore';

@Entry
@Component
struct Index {
  private readonly categories: string[] = ['全部方向', '软件开发', '人工智能', '网络安全', '算法竞赛', '创新创业'];
  private readonly categoryOptions: SelectOption[] = [
    { value: '全部方向' }, { value: '软件开发' }, { value: '人工智能' },
    { value: '网络安全' }, { value: '算法竞赛' }, { value: '创新创业' }
  ];
  private readonly tabs: string[] = ['全部', '近期赛程', '进行中', '官方公告', '已结束'];
  private readonly navItems: string[] = ['发现比赛', '我的收藏', '报名计划', '更新设置', '偏好设置'];
  private readonly sources: SourceInfo[] = OFFICIAL_SOURCES;
  private readonly stages: string[] = ['准备中', '已报名', '进行中', '已提交', '已复盘'];
  private readonly stageOptions: SelectOption[] = [{ value: '准备中' }, { value: '已报名' },
    { value: '进行中' }, { value: '已提交' }, { value: '已复盘' }];
  private cache: RadarCache = emptyCache();
  private radar: RadarService | undefined = undefined;
  private alive: boolean = false;
  private pageVisible: boolean = true;
  private store: LocalStore | undefined = undefined;
  private clockTimer: number = -1;
  private saveQueue: Promise<void> = Promise.resolve();
  private phoneDiscoveryScroller: Scroller = new Scroller();
  private aiScroller: Scroller = new Scroller();
  private aiService: AiService | undefined = undefined;
  private aiReportStore: AiReportStore | undefined = undefined;
  private keyStore: AiKeyStore = new AiKeyStore();
  private readonly modelOptions: SelectOption[] = [{ value: 'deepseek-flash' }, { value: 'deepseek-v4-pro' }];
  @State majorDraft: string = '计算机科学与技术';
  @State goalsDraft: string = '';
  @State interestsDraft: string = '';
  @State profileNotice: string = '';
  @State profileSaving: boolean = false;
  @State keyDraft: string = '';
  @State keySaved: boolean = false;
  @State keyBusy: boolean = false;
  @State keyNotice: string = '尚未配置 Key';
  @State aiModel: string = 'deepseek-flash';
  @State aiBusy: boolean = false;
  @State aiNotice: string = '';
  @State aiReport: AiReport | undefined = undefined;
  @State selectedNav: string = '发现比赛';
  @State selectedFilter: string = '全部';
  @State selectedCategory: string = '全部方向';
  @State keyword: string = '';
  @State favorites: string[] = [];
  @State planned: string[] = [];
  @State preferredCategory: string = '软件开发';
  @State updateTime: string = '08:00';
  @State timeDraft: string = '08:00';
  @State now: number = Date.now();
  @State catalog: Competition[] = [];
  @State visibleItems: Competition[] = [];
  @State windowWidth: number = 360;
  @State showDetail: boolean = false;
  @State detailItem: Competition = { id: '', title: '', organizer: '', category: '', deadline: '',
    tags: [], format: '', description: '', deliverables: [], accent: '#3366FF' };
  @State lastCheck: string = '首次使用请联网更新';
  @State refreshing: boolean = false;
  @State reports: SourceReport[] = [];
  @State noteDraft: string = '';
  @State noteStage: string = '准备中';
  @State noteDirty: boolean = false;
  @State noteSaving: boolean = false;
  @State noteNotice: string = '';
  @State dailyEnabled: boolean = true;
  @StorageLink('radarForeground') @Watch('foregroundChanged') foreground: boolean = true;
  @State storageReady: boolean = false;
  @State storageNotice: string = '';

  aboutToAppear(): void {
    this.alive = true;
    this.pageVisible = true;
    try {
      const context = this.getUIContext().getHostContext();
      if (context === undefined) {
        throw new Error('Host context unavailable');
      }
      this.store = new LocalStore(context);
      // Do not remove user IDs when a feed is unavailable or no longer lists a saved event.
      this.favorites = this.store.readIds('favorites');
      this.planned = this.store.readIds('planned');
      const savedDirection: string = this.store.readText('direction', '软件开发');
      this.preferredCategory = this.categories.includes(savedDirection) ? savedDirection : '软件开发';
      const savedTime: string = this.store.readText('updateTime', '08:00');
      this.updateTime = validTime(savedTime) ? savedTime : '08:00';
      this.timeDraft = this.updateTime;
      this.dailyEnabled = this.store.readText('dailyEnabled', 'true') !== 'false';
      this.storageReady = true;
    } catch (_) {
      this.store = undefined;
      this.storageNotice = '本地存储暂不可用；本次修改仅保留在当前会话。';
    }
    const context = this.getUIContext().getHostContext();
    if (context !== undefined) {
      this.radar = new RadarService(context);
      this.aiReportStore = new AiReportStore(context);
      this.loadCache();
    }
    this.refreshVisible();
    this.loadAiPreferences();
    if (this.clockTimer !== -1) {
      clearInterval(this.clockTimer);
    }
    this.clockTimer = setInterval((): void => {
      if (this.pageVisible) {
        this.refreshVisible();
        this.checkSchedule();
      }
    }, 60000);
    this.checkSchedule();
  }

  onPageShow(): void {
    this.pageVisible = true;
    this.refreshVisible();
    this.checkSchedule();
  }

  onPageHide(): void {
    this.pageVisible = false;
    this.keyDraft = '';
    this.aiService?.cancel();
  }

  private foregroundChanged(): void {
    this.pageVisible = this.foreground;
    if (!this.foreground) {
      this.keyDraft = '';
      this.aiService?.cancel();
    }
    if (this.foreground && this.alive) {
      this.refreshVisible();
      this.checkSchedule();
    }
  }

  aboutToDisappear(): void {
    this.alive = false;
    this.radar?.cancel();
    this.aiService?.cancel();
    this.keyDraft = '';
    if (this.clockTimer !== -1) {
      clearInterval(this.clockTimer);
      this.clockTimer = -1;
    }
  }

  onBackPress(): boolean {
    if (this.showDetail) {
      this.closeDetail();
      return true;
    }
    if (this.selectedNav === 'AI 找比赛') {
      this.navigate('发现比赛');
      return true;
    }
    return false;
  }

  private refreshVisible(): void {
    this.now = Date.now();
    const query: CompetitionQuery = {
      keyword: this.keyword, category: this.selectedCategory, filter: this.selectedFilter,
      view: this.selectedNav, favoriteIds: this.favorites, plannedIds: this.planned, now: this.now
    };
    this.visibleItems = filterCompetitions(this.catalog, query);
  }

  private navigate(nav: string): void {
    if (this.windowWidth < 600 && this.selectedNav !== '更新设置' && this.selectedNav !== '偏好设置' &&
      this.selectedNav !== 'AI 找比赛') {
      this.phoneDiscoveryScroller.scrollEdge(Edge.Top);
    }
    this.selectedNav = nav;
    this.showDetail = false;
    this.resetFilters();
  }

  private loadAiPreferences(): void {
    try {
      const profile: CareerProfile = readProfile(this.store?.readText('careerProfile.v1', '') ?? '');
      this.majorDraft = profile.major;
      this.goalsDraft = profile.goals;
      this.interestsDraft = profile.interests;
      const model: string = this.store?.readText('aiModel.v1', 'deepseek-flash') ?? 'deepseek-flash';
      this.aiModel = AI_MODELS.includes(model) ? model : 'deepseek-flash';
    } catch (_) {
      this.profileNotice = '偏好读取失败，原记录未覆盖；编辑后可重新保存';
    }
    try {
      this.aiReport = this.aiReportStore?.read();
      if (this.aiReport === undefined) {
        // Only migrate a valid legacy value when no report file exists; leave it intact on failure.
        const legacy: AiReport | undefined = readAiReport(this.store?.readText('aiReport.v1', '') ?? '');
        if (legacy !== undefined) {
          this.aiReport = legacy;
          this.aiReportStore?.save(legacy);
        }
      }
    } catch (_) {
      this.aiNotice = '历史 AI 报告读取失败，原记录未覆盖';
    }
    this.checkKeyState();
  }

  private async checkKeyState(): Promise<void> {
    try {
      const saved: boolean = await this.keyStore.exists();
      if (!this.alive) { return; }
      this.keySaved = saved;
      this.keyNotice = saved ? 'Key 已保存在本机安全存储，未显示明文' : '尚未配置 Key';
    } catch (_) {
      if (this.alive) { this.keyNotice = '安全存储暂不可用，请解锁设备后重试'; }
    }
  }

  private careerProfile(): CareerProfile {
    return { version: 1, major: this.majorDraft.trim(), goals: this.goalsDraft.trim(), interests: this.interestsDraft.trim() };
  }

  private async saveProfile(): Promise<void> {
    if (this.profileSaving) { return; }
    const profile: CareerProfile = this.careerProfile();
    if (profile.major.length === 0) { this.profileNotice = '请先填写专业'; return; }
    this.profileSaving = true;
    try {
      if (this.store === undefined) { throw new Error('Storage unavailable'); }
      await this.store.saveText('careerProfile.v1', JSON.stringify(profile));
      this.profileNotice = JSON.stringify(this.careerProfile()) === JSON.stringify(profile) ?
        '已保存到本机；仅在你确认 AI 分析时发送给 DeepSeek' : '先前内容已保存；刚刚的修改尚未保存';
    } catch (_) { this.profileNotice = '未能保存，本次编辑仍保留在页面，请重试'; }
    finally { this.profileSaving = false; }
  }

  private async setAiModel(index: number): Promise<void> {
    if (this.aiBusy || index < 0 || index >= AI_MODELS.length) { return; }
    this.aiModel = AI_MODELS[index];
    try {
      if (this.store === undefined) { throw new Error('Storage unavailable'); }
      await this.store.saveText('aiModel.v1', this.aiModel);
    } catch (_) { this.aiNotice = '模型选择只在本次会话生效，未能保存'; }
  }

  private async saveKey(): Promise<void> {
    if (this.keyBusy || this.aiBusy) { return; }
    const key: string = this.keyDraft.trim();
    if (!validApiKey(key)) { this.keyNotice = '请输入完整的 API Key，勿包含空格'; return; }
    this.keyBusy = true;
    try {
      await this.keyStore.save(key);
      this.keyDraft = '';
      this.keySaved = true;
      this.keyNotice = 'Key 已安全保存；可测试连接，不会自动搜索或扣费';
    } catch (_) { this.keyNotice = '保存失败，请解锁后重试；未使用明文存储'; }
    finally { this.keyBusy = false; }
  }

  private async removeKey(): Promise<void> {
    if (this.keyBusy || this.aiBusy) { return; }
    this.keyBusy = true;
    try {
      const result = await this.getUIContext().getPromptAction().showDialog({ title: '删除本机 DeepSeek Key？',
        message: '只删除此设备的密钥，不影响官网账号、赛事与笔记。',
        buttons: [{ text: '取消', color: '#3366FF' }, { text: '删除', color: '#B42318' }] });
      if (result.index !== 1) { return; }
      await this.keyStore.remove();
      this.keyDraft = '';
      this.keySaved = false;
      this.keyNotice = '已删除本机 Key；需要时可重新配置';
    } catch (_) { this.keyNotice = '未删除 Key，请稍后重试'; }
    finally { this.keyBusy = false; }
  }

  private async testAiConnection(): Promise<void> {
    if (this.aiBusy || this.keyBusy) { return; }
    this.aiBusy = true;
    this.aiService = new AiService();
    this.keyNotice = '正在检查官方模型接口…';
    try {
      const key: string = await this.keyStore.read();
      await this.aiService.testConnection(key, this.aiModel);
      this.keyNotice = '鉴权成功，所选模型可用；搜索权限与余额需在实际搜索时验证';
    } catch (error) {
      this.keyNotice = error instanceof Error ? error.message : '连接测试失败，请重试';
    } finally { this.aiBusy = false; this.aiService = undefined; }
  }

  private async runAi(web: boolean): Promise<void> {
    if (this.aiBusy || this.keyBusy) { return; }
    if (!this.keySaved) { this.aiNotice = '请先到偏好设置保存 DeepSeek API Key'; return; }
    const profile: CareerProfile = this.careerProfile();
    if (profile.major.length === 0) { this.aiNotice = '请先在偏好中填写专业'; return; }
    if (!web && this.catalog.length === 0) { this.aiNotice = '还没有官方赛事，请先联网更新'; return; }
    this.aiBusy = true;
    const service: AiService = new AiService();
    this.aiService = service;
    try {
      const result = await this.getUIContext().getPromptAction().showDialog({
        title: web ? '联网搜索并分析？' : '分析已有比赛？',
        message: '将当前填写的专业、方向和需求，以及公开赛事内容发送到 DeepSeek；不会上传你的笔记、收藏或计划。' +
          (web ? '本次最多 3 次搜索 + 1 次模型分析，按官方规则计费；覆盖不等于全网。' : '本次最多 1 次模型调用，不新增联网搜索，可能计费。') +
          '不自动重试或后台扣费。',
        buttons: [{ text: '取消', color: '#667085' }, { text: '同意并开始', color: '#3366FF' }] });
      if (result.index !== 1 || !this.alive || !this.pageVisible) { return; }
      const key: string = await this.keyStore.read();
      const report: AiReport = await service.research(key, this.aiModel, profile, this.catalog, web,
        (message: string): void => { if (this.alive) { this.aiNotice = message; } });
      if (!this.alive || !this.pageVisible) { return; }
      this.aiReport = report;
      this.aiNotice = report.items.length > 0 ? '完成 · 结果为待核实线索，不代表仍可报名' :
        '本次没有通过国内来源及引用校验的推荐；未用模型记忆补全，可调整偏好重试';
      try {
        if (this.aiReportStore === undefined) { throw new Error('Storage unavailable'); }
        this.aiReportStore.save(report);
      } catch (_) { this.aiNotice += '。本次报告未能保存，退出后可能丢失'; }
    } catch (error) {
      if (this.alive) { this.aiNotice = (error instanceof Error ? error.message : '请求失败，请重试') + '；历史报告保留'; }
    } finally { this.aiBusy = false; this.aiService = undefined; }
  }

  private async openAiSource(value: string): Promise<void> {
    if (!publicSearchUrl(value)) { this.notify('来源链接不安全，未打开'); return; }
    try {
      const result = await this.getUIContext().getPromptAction().showDialog({ title: '打开外部来源？',
        message: value + '\n搜索来源不等于已核实的报名官网，请核实主办方，谨慎登录和付费。',
        buttons: [{ text: '取消', color: '#667085' }, { text: '打开浏览器', color: '#3366FF' }] });
      if (result.index !== 1) { return; }
      const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
      await context.openLink(value);
    } catch (_) { this.notify('未打开链接，请稍后重试'); }
  }

  private resetFilters(): void {
    this.keyword = '';
    this.selectedCategory = '全部方向';
    this.selectedFilter = '全部';
    this.refreshVisible();
  }

  private notify(message: string): void {
    try {
      this.getUIContext().getPromptAction().showToast({ message: message, duration: 2200 });
    } catch (_) {
      this.lastCheck = message;
    }
  }

  private persist(): void {
    const store: LocalStore | undefined = this.store;
    if (store === undefined) {
      this.notify('本地存储不可用，本次修改只在当前会话生效');
      return;
    }
    const favoriteIds: string[] = this.favorites.slice();
    const plannedIds: string[] = this.planned.slice();
    const direction: string = this.preferredCategory;
    const time: string = this.updateTime;
    this.saveQueue = this.saveQueue.then((): Promise<void> => store.save(favoriteIds, plannedIds, direction, time))
      .then((): void => {
        this.storageReady = true;
        this.storageNotice = '';
      }).catch((): void => {
        this.storageReady = false;
        this.storageNotice = '保存失败，当前修改可能在重启后丢失，请稍后重试。';
        this.notify('未能保存到设备');
      });
  }

  private toggleFavorite(item: Competition): void {
    this.favorites = toggleId(this.favorites, item.id);
    this.refreshVisible();
    this.persist();
  }

  private togglePlan(item: Competition): void {
    const days: number | null = remainingDays(item, Date.now());
    if (!this.planned.includes(item.id) && days !== null && days < 0) {
      this.notify('该条目已截止，可收藏并记录复盘');
      return;
    }
    this.planned = toggleId(this.planned, item.id);
    this.refreshVisible();
    this.persist();
  }

  private loadCache(): void {
    try {
      if (this.radar !== undefined) {
        this.cache = this.radar.readCache();
        this.catalog = this.cache.items.filter(isDomesticCompetition);
        this.reports = this.cache.reports;
        this.lastCheck = this.cache.lastAttempt > 0 ? '上次检查 ' + formatBeijing(this.cache.lastAttempt) + '（北京时间）· 缓存可离线查看' : '首次使用正在准备联网更新';
      }
    } catch (_) {
      this.lastCheck = '缓存暂不可读，请联网刷新；收藏和计划不受影响';
    }
  }

  private checkSchedule(): void {
    if (this.alive && this.pageVisible && this.dailyEnabled && !this.refreshing &&
      shouldRefresh(Date.now(), this.cache.lastAttempt, this.cache.lastSuccess, this.updateTime)) {
      this.refreshOnline();
    }
  }

  private async refreshOnline(): Promise<void> {
    const radar: RadarService | undefined = this.radar;
    if (radar === undefined || this.refreshing) {
      return;
    }
    this.refreshing = true;
    let status: string = '';
    try {
      const result: RadarCache = await radar.refresh(this.cache, this.favorites.concat(this.planned));
      if (!this.alive) {
        return;
      }
      // A favorite may be added while the request is in flight. Preserve that snapshot too.
      const keepNow: string[] = this.favorites.concat(this.planned);
      this.catalog.forEach((item: Competition): void => {
        if (keepNow.includes(item.id) && !result.items.some((current: Competition): boolean => current.id === item.id)) {
          result.items.push(item);
        }
      });
      this.cache = result;
      this.catalog = result.items.filter(isDomesticCompetition);
      this.reports = result.reports;
      this.refreshVisible();
      const succeeded: number = result.reports.filter((report: SourceReport): boolean => report.success).length;
      status = formatBeijing(result.lastAttempt) + ' · ' + succeeded + '/' + result.reports.length + ' 个国内来源更新成功' +
        (succeeded < result.reports.length ? '；失败来源保留缓存，可在更新设置重试' : ' · 北京时间');
      try {
        radar.saveCache(result);
      } catch (_) {
        status += '；缓存保存失败，退出后可能丢失本次更新';
      }
    } catch (_) {
      this.cache.lastAttempt = Date.now();
      status = '更新未完成，请检查网络后重试；原有数据已保留';
    } finally {
      this.lastCheck = status;
      this.refreshing = false;
    }
  }

  private sourceStatus(source: SourceInfo): string {
    if (!source.automatic) {
      return '官网手动查看 · 不参与自动抓取';
    }
    const report: SourceReport | undefined = this.reports.find((item: SourceReport): boolean => item.id === source.id);
    return report === undefined ? '尚未读取' : report.message + ' · ' + formatBeijing(report.checkedAt);
  }

  private eventTime(item: Competition): string {
    if (item.startsAt !== undefined) {
      return formatBeijing(item.startsAt) + ' 开赛（北京时间）';
    }
    return item.publishedAt !== undefined ? item.publishedAt + ' 发布 · 截止时间见原文' :
      item.deadline.length > 0 ? item.deadline + ' 截止（北京时间）' : '报名时间及资格请核实官网';
  }

  private async openOfficial(url: string): Promise<void> {
    if (!isSafeOfficialUrl(url)) {
      this.notify('该链接不在已核实的官方来源中，未打开');
      return;
    }
    try {
      const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
      await context.openLink(url);
    } catch (_) {
      this.notify('无法打开浏览器，可复制官方链接后手动访问');
    }
  }

  private async copyText(value: string): Promise<void> {
    try {
      await pasteboard.getSystemPasteboard().setData(pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, value));
      this.notify('已复制到剪贴板');
    } catch (_) {
      this.notify('复制失败，请稍后重试');
    }
  }

  private openDetail(item: Competition): void {
    this.detailItem = item;
    this.noteDraft = '';
    this.noteStage = '准备中';
    this.noteDirty = false;
    let notice: string = '';
    try {
      const raw: string = this.store?.readText('note.' + item.id, '') ?? '';
      if (raw.length > 0) {
        const note: ProjectNote = JSON.parse(raw) as ProjectNote;
        if (note !== null && note.id === item.id && typeof note.text === 'string' && this.stages.includes(note.stage) &&
          Number.isFinite(note.updatedAt)) {
          this.noteDraft = note.text;
          this.noteStage = note.stage;
          notice = '已保存于 ' + formatBeijing(note.updatedAt);
        } else {
          notice = '已有记录格式异常，未自动覆盖';
        }
      }
    } catch (_) {
      notice = '读取记录失败，请稍后重试';
    }
    this.noteNotice = notice;
    this.showDetail = true;
  }

  private async closeDetail(): Promise<void> {
    if (this.noteSaving) {
      return;
    }
    if (this.noteDirty) {
      try {
        const result = await this.getUIContext().getPromptAction().showDialog({
          title: '记录尚未保存', message: '返回继续编辑，或放弃本次未保存的修改。',
          buttons: [{ text: '继续编辑', color: '#3366FF' }, { text: '放弃修改', color: '#B42318' }]
        });
        if (result.index !== 1) {
          return;
        }
      } catch (_) {
        return;
      }
    }
    this.showDetail = false;
    this.noteDirty = false;
  }

  private async saveNote(): Promise<void> {
    const store: LocalStore | undefined = this.store;
    if (store === undefined || this.noteSaving) {
      this.notify('本地存储不可用，暂不能保存记录');
      return;
    }
    const note: ProjectNote = { id: this.detailItem.id, stage: this.noteStage, text: this.noteDraft, updatedAt: Date.now() };
    this.noteSaving = true;
    try {
      await store.saveText('note.' + note.id, JSON.stringify(note));
      if (!this.planned.includes(note.id)) {
        this.planned = this.planned.concat([note.id]);
        this.persist();
      }
      this.noteDirty = false;
      this.noteNotice = '已保存于 ' + formatBeijing(note.updatedAt);
      this.refreshVisible();
      this.notify('参赛记录已保存，并保留在报名计划中');
    } catch (_) {
      this.noteNotice = '保存失败，文本仍保留在编辑框，请重试';
    } finally {
      this.noteSaving = false;
    }
  }

  private async setDailyEnabled(value: boolean): Promise<void> {
    this.dailyEnabled = value;
    try {
      if (this.store === undefined) {
        throw new Error('Storage unavailable');
      }
      await this.store.saveText('dailyEnabled', value ? 'true' : 'false');
      this.checkSchedule();
    } catch (_) {
      this.notify('自动更新开关未保存，请重试');
    }
  }

  private async clearNote(): Promise<void> {
    const store: LocalStore | undefined = this.store;
    if (store === undefined || this.noteSaving) {
      return;
    }
    try {
      const result = await this.getUIContext().getPromptAction().showDialog({
        title: '清除这场比赛的记录？', message: '将删除该条参赛笔记与阶段记录；收藏和报名计划不变。需要保留的内容请先复制。',
        buttons: [{ text: '取消', color: '#3366FF' }, { text: '确认清除', color: '#B42318' }]
      });
      if (result.index !== 1) {
        return;
      }
      this.noteSaving = true;
      await store.removeText('note.' + this.detailItem.id);
      this.noteDraft = '';
      this.noteStage = '准备中';
      this.noteDirty = false;
      this.noteNotice = '记录已清除';
    } catch (_) {
      this.notify('记录未清除，请重试');
    } finally {
      this.noteSaving = false;
    }
  }

  private saveTime(): void {
    const value: string = this.timeDraft.trim();
    if (!validTime(value)) {
      this.notify('请输入 00:00–23:59 之间的时间，例如 08:00');
      return;
    }
    this.updateTime = value;
    this.timeDraft = value;
    this.persist();
    this.notify('已设置每日检查时间；回到应用时会补查');
    this.checkSchedule();
  }

  private dueCount(): number {
    return this.catalog.filter((item: Competition): boolean => isDueSoon(item, this.now)).length;
  }

  private plannedSoon(): Competition[] {
    return this.catalog.filter((item: Competition): boolean =>
      this.planned.includes(item.id) && (isDueSoon(item, this.now) ||
        (item.startsAt !== undefined && item.startsAt >= this.now && item.startsAt <= this.now + 7 * 86400000)));
  }

  private planDisabled(item: Competition): boolean {
    const days: number | null = remainingDays(item, this.now);
    return !this.planned.includes(item.id) && days !== null && days < 0;
  }

  private deadlineColor(item: Competition): string {
    const days: number | null = remainingDays(item, this.now);
    return days === null || days < 0 ? '#667085' : days <= 7 ? '#B54708' : '#067647';
  }

  @Builder
  private Brand() {
    Row({ space: 10 }) {
      Text('C')
        .fontSize(20).fontWeight(FontWeight.Bold).fontColor('#FFFFFF')
        .textAlign(TextAlign.Center).width(34).height(34)
        .backgroundColor('#3366FF').borderRadius(10)
      Column({ space: 2 }) {
        Text('Career Radar').fontSize(17).fontWeight(FontWeight.Bold).fontColor('#101828')
        Text('比赛雷达').fontSize(11).fontColor('#667085')
      }.alignItems(HorizontalAlign.Start)
    }
  }

  @Builder
  private NavButton(label: string) {
    Button({ type: ButtonType.Normal }) {
      Row() {
        Text(label).fontSize(14).fontColor(this.selectedNav === label ? '#2457E7' : '#475467')
        Blank()
        if (label === '我的收藏' || label === '报名计划') {
          Text((label === '我的收藏' ? this.favorites.length : this.planned.length).toString())
            .fontSize(12).fontColor('#667085')
        }
      }.width('100%')
    }
    .width('100%').height(44).padding({ left: 14, right: 14 }).borderRadius(8)
    .backgroundColor(this.selectedNav === label ? '#EDF2FF' : '#FFFFFF')
    .onClick((): void => { this.navigate(label); })
  }

  @Builder
  private Sidebar() {
    Column({ space: 8 }) {
      this.Brand()
      Text('我的工作台').fontSize(11).fontColor('#98A2B3')
        .width('100%').margin({ top: 26, bottom: 6 }).padding({ left: 14 })
      ForEach(this.navItems, (label: string) => {
        this.NavButton(label)
      }, (label: string): string => label)
      Blank()
      Column({ space: 6 }) {
        Text('官方来源 · 本地管理').fontSize(13).fontWeight(FontWeight.Medium).fontColor('#344054')
        Text('2 个国内自动来源 + 3 个官网入口。报名资格请在官网核实。').fontSize(12).fontColor('#667085').lineHeight(19)
        Text(this.storageReady ? '收藏与设置保存在本机' : '本地保存暂不可用')
          .fontSize(11).fontColor(this.storageReady ? '#067647' : '#B54708')
      }.alignItems(HorizontalAlign.Start).width('100%').padding(14)
        .backgroundColor('#F8FAFC').borderRadius(10)
    }
    .width(210).height('100%').padding(16).backgroundColor('#FFFFFF')
    .border({ width: { right: 1 }, color: '#EAECF0' })
  }

  @Builder
  private PhoneHeader() {
    Row({ space: 10 }) {
      Text('C').fontSize(19).fontWeight(FontWeight.Bold).fontColor('#FFFFFF')
        .textAlign(TextAlign.Center).width(34).height(34)
        .backgroundColor('#3366FF').borderRadius(10)
      Column({ space: 1 }) {
        Text('比赛雷达').fontSize(16).fontWeight(FontWeight.Bold).fontColor('#101828')
        Text('发现值得参与的计算机竞赛').fontSize(10).fontColor('#667085')
      }.alignItems(HorizontalAlign.Start).layoutWeight(1)
      Text('仅国内').fontSize(10).fontColor('#067647')
        .padding({ left: 9, right: 9, top: 5, bottom: 5 })
        .backgroundColor('#ECFDF3').borderRadius(12)
    }.width('100%').padding({ left: 16, right: 16, top: 9, bottom: 9 })
      .backgroundColor('#FFFFFF')
  }

  @Builder
  private PhoneNavItem(label: string, title: string) {
    Button({ type: ButtonType.Normal }) {
      Column({ space: 3 }) {
        Text(label).fontSize(12).fontWeight(this.selectedNav === title ? FontWeight.Medium : FontWeight.Regular)
          .fontColor(this.selectedNav === title ? '#2457E7' : '#667085')
        Text(this.selectedNav === title ? '●' : ' ').fontSize(8)
          .fontColor('#3366FF')
      }.justifyContent(FlexAlign.Center).width('100%')
    }.layoutWeight(1).height(50).borderRadius(0).backgroundColor('#FFFFFF')
      .accessibilityText(title).onClick((): void => { this.navigate(title); })
  }

  @Builder
  private PhoneNavigation() {
    Row() {
      this.PhoneNavItem('发现', '发现比赛')
      this.PhoneNavItem('收藏', '我的收藏')
      this.PhoneNavItem('计划', '报名计划')
      this.PhoneNavItem('更新', '更新设置')
      this.PhoneNavItem('偏好', '偏好设置')
    }.width('100%').padding({ left: 8, right: 8, top: 3 })
      .backgroundColor('#FFFFFF').border({ width: { top: 1 }, color: '#EAECF0' })
  }

  @Builder
  private CompactNavigation() {
    Column({ space: 12 }) {
      Row() {
        this.Brand()
        Blank()
        Text('官方赛事雷达').fontSize(12).fontColor('#067647')
      }.width('100%')
      Scroll() {
        Row({ space: 8 }) {
          ForEach(this.navItems, (label: string) => {
            Button(label, { type: ButtonType.Normal })
              .fontSize(12).fontColor(this.selectedNav === label ? '#2457E7' : '#475467')
              .backgroundColor(this.selectedNav === label ? '#EDF2FF' : '#F8FAFC')
              .height(36).padding({ left: 12, right: 12 }).borderRadius(8)
              .onClick((): void => { this.navigate(label); })
          }, (label: string): string => label)
        }
      }.scrollable(ScrollDirection.Horizontal).scrollBar(BarState.Off).align(Alignment.Start).width('100%').height(42)
    }.padding(16).width('100%').backgroundColor('#FFFFFF')
  }

  @Builder
  private StatCard(value: string, label: string, accent: string) {
    Column({ space: 6 }) {
      Text(value).fontSize(this.windowWidth < 600 ? 22 : 28).fontWeight(FontWeight.Bold).fontColor(accent)
      Text(label).fontSize(12).fontColor('#667085')
    }.alignItems(HorizontalAlign.Start).layoutWeight(1).padding(this.windowWidth < 600 ? 10 : 16)
      .backgroundColor('#FFFFFF').borderRadius(10)
      .border({ width: 1, color: '#EAECF0' })
  }

  @Builder
  private PageHeader() {
    Row({ space: 12 }) {
      Column({ space: 5 }) {
        Text(this.selectedNav).fontSize(24).fontWeight(FontWeight.Bold).fontColor('#101828')
        Text(this.windowWidth < 600 ? '国内赛事 · 积累技能与项目经历' : '为简历积累可展示、可验证的项目经历')
          .fontSize(12).fontColor('#667085').maxLines(2)
      }.alignItems(HorizontalAlign.Start).layoutWeight(1)
      if (this.windowWidth > 0) {
        Button(this.refreshing ? '更新中…' : '联网更新', { type: ButtonType.Normal })
          .id('refreshButton').enabled(!this.refreshing)
          .height(36).fontSize(12).fontColor('#2457E7').backgroundColor('#EDF2FF').borderRadius(8)
          .onClick((): void => { this.refreshOnline(); })
      }
    }.width('100%')
  }

  @Builder
  private DataNotice() {
    if (this.windowWidth < 600) {
      Text('国内赛程与公告 · 报名安排以官网为准')
        .fontSize(10).fontColor('#82550B').maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
    } else {
      Text('官网赛程与公告 · 开赛时间 ≠ 报名截止；腾讯 / 华为等入口在「更新设置」。覆盖范围有限，不代表全网全部赛事。')
        .fontSize(12).fontColor('#82550B').lineHeight(18).width('100%')
        .padding(12).backgroundColor('#FFFAEB').borderRadius(8)
    }
    if (this.storageNotice.length > 0) {
      Text(this.storageNotice).fontSize(12).fontColor('#B42318').lineHeight(18)
        .width('100%').padding(10).backgroundColor('#FEF3F2').borderRadius(8)
    }
    if (this.favorites.concat(this.planned).some((id: string): boolean =>
      !this.cache.items.some((item: Competition): boolean => item.id === id))) {
      Text('部分已保存条目不在当前列表中（可能来自旧演示或未加载的来源）；原有标记仍保留，未自动删除。')
        .fontSize(11).fontColor('#667085').lineHeight(18).width('100%')
    }
  }

  @Builder
  private Filters() {
    if (this.windowWidth < 600) {
      Search({ value: this.keyword, placeholder: '搜索比赛、主办方或技能' })
        .id('phoneCompetitionSearch').width('100%').height(40).fontColor('#101828')
        .backgroundColor('#FFFFFF').borderRadius(10)
        .onChange((value: string): void => { this.keyword = value; this.refreshVisible(); })
      Row() {
        Select(this.categoryOptions)
          .selected(this.categories.indexOf(this.selectedCategory)).value(this.selectedCategory)
          .height(34).width(132).font({ size: 12 }).fontColor('#344054').backgroundColor('#FFFFFF')
          .onSelect((index: number): void => {
            if (index >= 0 && index < this.categories.length) {
              this.selectedCategory = this.categories[index];
              this.refreshVisible();
            }
          })
        Blank()
        Text('共 ' + this.visibleItems.length.toString() + ' 项')
          .fontSize(11).fontColor('#667085')
      }.width('100%')
    } else {
      Row({ space: 10 }) {
        Search({ value: this.keyword, placeholder: '搜索比赛、主办方或技能' })
          .id('competitionSearch').layoutWeight(1).height(40).fontColor('#101828')
          .backgroundColor('#FFFFFF').borderRadius(8)
          .onChange((value: string): void => { this.keyword = value; this.refreshVisible(); })
        Select(this.categoryOptions)
          .selected(this.categories.indexOf(this.selectedCategory)).value(this.selectedCategory)
          .height(40).width(126).font({ size: 13 }).fontColor('#344054').backgroundColor('#FFFFFF')
          .onSelect((index: number): void => {
            if (index >= 0 && index < this.categories.length) {
              this.selectedCategory = this.categories[index];
              this.refreshVisible();
            }
          })
      }.width('100%')
    }
    Row() {
      Scroll() {
        Row({ space: 6 }) {
          ForEach(this.tabs, (tab: string) => {
            Button(tab, { type: ButtonType.Normal })
              .fontSize(12).height(34).padding({ left: 10, right: 10 }).borderRadius(6)
              .fontColor(this.selectedFilter === tab ? '#2457E7' : '#667085')
              .backgroundColor(this.selectedFilter === tab ? '#EAF0FF' : '#F8FAFC')
              .onClick((): void => { this.selectedFilter = tab; this.refreshVisible(); })
          }, (tab: string): string => tab)
        }
      }.layoutWeight(1).scrollable(ScrollDirection.Horizontal).scrollBar(BarState.Off).align(Alignment.Start)
      if (this.windowWidth >= 600) {
        Text(this.visibleItems.length.toString() + ' 项').fontSize(12).fontColor('#667085').margin({ left: 8 })
      }
    }.width('100%')
  }

  @Builder
  private CompetitionCard(item: Competition) {
    Column({ space: 12 }) {
      Row({ space: 12 }) {
        Text(item.category.substring(0, 1)).fontSize(18).fontWeight(FontWeight.Bold).fontColor('#FFFFFF')
          .textAlign(TextAlign.Center).width(42).height(42).backgroundColor(item.accent).borderRadius(10)
        Column({ space: 6 }) {
          Text(item.title).fontSize(15).fontWeight(FontWeight.Medium).fontColor('#101828')
            .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
          Text(item.organizer + ' · ' + item.format).fontSize(12).fontColor('#667085').maxLines(2)
        }.alignItems(HorizontalAlign.Start).layoutWeight(1)
        Button(this.favorites.includes(item.id) ? '★' : '☆', { type: ButtonType.Circle })
          .id('favorite-' + item.id).width(40).height(40).fontSize(23)
          .fontColor(this.favorites.includes(item.id) ? '#B87906' : '#667085').backgroundColor('#F8FAFC')
          .accessibilityText(this.favorites.includes(item.id) ? '取消收藏 ' + item.title : '收藏 ' + item.title)
          .onClick((): void => { this.toggleFavorite(item); })
      }.width('100%')
      Flex({ wrap: FlexWrap.Wrap }) {
        ForEach(item.tags, (tag: string) => {
          Text(tag).fontSize(11).fontColor('#475467').padding({ left: 8, right: 8, top: 4, bottom: 4 })
            .backgroundColor('#F2F4F7').borderRadius(5).margin({ right: 6, bottom: 4 })
        }, (tag: string): string => tag)
      }.width('100%')
      Divider().color('#F2F4F7')
      Row({ space: 10 }) {
        Column({ space: 4 }) {
          Text(deadlineLabel(item, this.now)).fontSize(12).fontColor(this.deadlineColor(item))
          Text(this.eventTime(item)).fontSize(11).fontColor('#667085').maxLines(2)
        }.alignItems(HorizontalAlign.Start).layoutWeight(1)
        if (this.planned.includes(item.id)) {
          Text('已计划').fontSize(11).fontColor('#2457E7')
        }
        Button('查看详情', { type: ButtonType.Normal })
          .id('detail-' + item.id).fontSize(12).height(34).fontColor('#2457E7')
          .backgroundColor('#EDF2FF').borderRadius(7)
          .onClick((): void => { this.openDetail(item); })
      }.width('100%')
    }.width('100%').padding(16).backgroundColor('#FFFFFF').borderRadius(12)
      .border({ width: 1, color: '#EAECF0' })
  }

  @Builder
  private EmptyState() {
    Column({ space: 12 }) {
      Text(this.selectedNav === '我的收藏' ? '还没有符合条件的收藏' :
        this.selectedNav === '报名计划' ? '还没有符合条件的计划' : '没有找到匹配的比赛')
        .fontSize(16).fontWeight(FontWeight.Medium).fontColor('#344054')
      Text(this.catalog.length === 0 ? '首次使用请点击联网更新。读取失败时可到更新设置查看原因或直接打开官网。' :
        '可清除筛选，或到发现比赛中查看详情并添加收藏、计划。')
        .fontSize(12).fontColor('#667085').textAlign(TextAlign.Center).lineHeight(20)
      Row({ space: 10 }) {
        Button('清除筛选').fontSize(12).backgroundColor('#EDF2FF').fontColor('#2457E7')
          .onClick((): void => { this.resetFilters(); })
        if (this.selectedNav !== '发现比赛') {
          Button('发现比赛').fontSize(12).backgroundColor('#3366FF')
            .onClick((): void => { this.navigate('发现比赛'); })
        }
      }
    }.width('100%').padding(28).backgroundColor('#FFFFFF').borderRadius(12)
  }

  @Builder
  private DiscoveryPage() {
    if (this.windowWidth < 600) {
      List({ space: 12, scroller: this.phoneDiscoveryScroller }) {
        ListItem() {
          Column({ space: 14 }) {
            this.PageHeader()
            this.DataNotice()
            this.Filters()
            if (this.selectedNav === '发现比赛') {
              this.AiEntry()
            }
            Text(this.refreshing ? '正在读取官方来源，请稍候…' : this.lastCheck)
              .id('phoneUpdateStatus').fontSize(11).fontColor('#667085').lineHeight(17).width('100%')
          }.width('100%').alignItems(HorizontalAlign.Start)
        }
        if (this.visibleItems.length === 0) {
          ListItem() { this.EmptyState() }
        } else {
          ForEach(this.visibleItems, (item: Competition) => {
            ListItem() { this.CompetitionCard(item) }
          }, (item: Competition): string => item.id)
        }
      }.id('phoneDiscoveryList').width('100%').height('100%')
        .padding({ left: 16, right: 16, top: 16, bottom: 16 }).scrollBar(BarState.Auto)
    } else {
    Column({ space: 14 }) {
      this.PageHeader()
      this.DataNotice()
        Row({ space: 8 }) {
          this.StatCard(this.catalog.length.toString(), '赛程与公告', '#101828')
          this.StatCard(this.catalog.filter((item: Competition): boolean => item.startsAt !== undefined &&
            item.startsAt >= this.now && item.startsAt <= this.now + 7 * 86400000).length.toString(), '7 天内开赛', '#B54708')
          this.StatCard(this.favorites.length.toString(), '已收藏', '#2457E7')
          this.StatCard(this.planned.length.toString(), '已计划', '#067647')
        }.width('100%')
      this.Filters()
      if (this.selectedNav === '发现比赛') {
        this.AiEntry()
      }
      List({ space: 12 }) {
        if (this.visibleItems.length === 0) {
          ListItem() { this.EmptyState() }
        } else {
          ForEach(this.visibleItems, (item: Competition) => {
            ListItem() { this.CompetitionCard(item) }
          }, (item: Competition): string => item.id)
        }
      }.id('competitionList').width('100%').layoutWeight(1).scrollBar(BarState.Auto)
      Text(this.refreshing ? '正在读取官方来源，请稍候…' : this.lastCheck).fontSize(11).fontColor('#667085')
        .maxLines(this.windowWidth < 600 ? 1 : 2).textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
    }.height('100%').width('100%').padding(24)
    }
  }

  @Builder
  private AiEntry() {
    Row({ space: 8 }) {
      Text('找更多适合你的国内比赛').fontSize(12).fontColor('#475467').layoutWeight(1)
      Button('AI 找比赛', { type: ButtonType.Normal }).id('aiEntry').height(34).fontSize(12)
        .fontColor('#2457E7').backgroundColor('#EDF2FF').borderRadius(8)
        .onClick((): void => { this.navigate('AI 找比赛'); })
    }.width('100%')
  }

  @Builder
  private CareerProfileForm() {
    Column({ space: 12 }) {
      Text('让比赛适合你').fontSize(19).fontWeight(FontWeight.Bold).fontColor('#101828')
      Text('不必被分类限制。写下真实目标，AI 会据此筛选和建议。')
        .fontSize(12).fontColor('#667085').lineHeight(20)
      Text('你的专业').fontSize(13).fontWeight(FontWeight.Medium).fontColor('#344054')
      TextInput({ text: this.majorDraft, placeholder: '例如：计算机科学与技术' })
        .id('careerMajor').maxLength(80).height(44).fontSize(14).fontColor('#101828')
        .onChange((value: string): void => { this.majorDraft = value; this.profileNotice = '有未保存的修改'; })
      Text('想发展的方向').fontSize(13).fontWeight(FontWeight.Medium).fontColor('#344054')
      TextArea({ text: this.interestsDraft, placeholder: '例如：后端开发、AI 应用、HarmonyOS、网络安全' })
        .id('careerInterests').maxLength(200).height(82).fontSize(14).fontColor('#101828')
        .onChange((value: string): void => { this.interestsDraft = value; this.profileNotice = '有未保存的修改'; })
      Text('你的需求与目前基础').fontSize(13).fontWeight(FontWeight.Medium).fontColor('#344054')
      TextArea({ text: this.goalsDraft, placeholder: '例如：大二，会 Java，希望两个月内做出可展示项目；可每周投入 6 小时，优先个人/线上赛。请勿填写身份证等敏感信息。' })
        .id('careerGoals').maxLength(600).height(126).fontSize(14).fontColor('#101828')
        .onChange((value: string): void => { this.goalsDraft = value; this.profileNotice = '有未保存的修改'; })
      Text('范围固定：中国国内赛事。报名资格、收费与截止时间以主办方官网为准。')
        .fontSize(12).fontColor('#667085').lineHeight(20)
      Button(this.profileSaving ? '保存中…' : '保存我的偏好').id('saveCareerProfile').width('100%').height(42)
        .fontSize(14).backgroundColor('#3366FF').enabled(!this.profileSaving)
        .onClick((): void => { this.saveProfile(); })
      Text(this.profileNotice).id('careerProfileStatus').fontSize(12).fontColor('#667085').lineHeight(19)
    }.alignItems(HorizontalAlign.Start).width('100%').padding(18).backgroundColor('#FFFFFF').borderRadius(12)
  }

  @Builder
  private DeepSeekSettings() {
    Column({ space: 12 }) {
      Text('DeepSeek 连接').fontSize(17).fontWeight(FontWeight.Bold).fontColor('#101828')
      Text('请在这里输入你自己的 Key，不要发到聊天里。仅保存到系统安全存储，不写进源码或普通设置。')
        .fontSize(12).fontColor('#667085').lineHeight(20)
      TextInput({ text: this.keyDraft, placeholder: this.keySaved ? '已保存 · 输入新 Key 可替换' : '粘贴 DeepSeek API Key' })
        .id('deepseekKeyInput').type(InputType.Password).showPasswordIcon(false).maxLength(256).height(44)
        .fontSize(14).enabled(!this.keyBusy && !this.aiBusy)
        .onChange((value: string): void => { this.keyDraft = value; })
      Row({ space: 8 }) {
        Button('安全保存 Key').id('saveDeepseekKey').height(38).fontSize(12).layoutWeight(1)
          .backgroundColor('#3366FF').enabled(!this.keyBusy && !this.aiBusy && this.keyDraft.length > 0)
          .onClick((): void => { this.saveKey(); })
        Button('删除 Key').id('deleteDeepseekKey').height(38).fontSize(12).layoutWeight(1)
          .backgroundColor('#FEF3F2').fontColor('#B42318').enabled(!this.keyBusy && !this.aiBusy && this.keySaved)
          .onClick((): void => { this.removeKey(); })
      }.width('100%')
      Text(this.keyNotice).id('deepseekKeyStatus').fontSize(12).fontColor('#667085').lineHeight(20)
      Text('分析模型').fontSize(13).fontColor('#344054')
      Select(this.modelOptions).id('deepseekModel').selected(AI_MODELS.indexOf(this.aiModel)).value(this.aiModel)
        .width('100%').enabled(!this.aiBusy).font({ size: 13 })
        .onSelect((index: number): void => { this.setAiModel(index); })
      Button(this.aiBusy ? '请求处理中…' : '测试连接（只检查模型接口）').id('testDeepseekConnection')
        .height(40).width('100%').fontSize(12).backgroundColor('#EDF2FF').fontColor('#2457E7')
        .enabled(!this.aiBusy && !this.keyBusy && this.keySaved)
        .onClick((): void => { this.testAiConnection(); })
      Text('固定连接 api.deepseek.com。搜索与模型调用按官方规则计费；测试连接不生成内容，亦不证明搜索权限或余额充足。')
        .fontSize(11).fontColor('#667085').lineHeight(18)
      Button('进入 AI 找比赛').id('openAiFromPreferences').height(42).width('100%').fontSize(14)
        .backgroundColor('#3366FF').onClick((): void => { this.navigate('AI 找比赛'); })
    }.alignItems(HorizontalAlign.Start).width('100%').padding(18).backgroundColor('#FFFFFF').borderRadius(12)
  }

  @Builder
  private AiResultCard(item: AiRecommendation) {
    Column({ space: 10 }) {
      Text('国内候选 · 来源待核实').fontSize(11).fontColor('#82550B')
      Text(item.source.title).fontSize(17).fontWeight(FontWeight.Medium).fontColor('#101828')
      Text(item.source.date.length > 0 ? '来源标注发布：' + item.source.date.slice(0, 10) + '（不是报名截止）' :
        '来源未提供发布日期 · 请核实最新赛程').fontSize(11).fontColor('#667085')
      Text('来源摘要（搜索 / 采集结果）').fontSize(12).fontColor('#667085')
      Text(item.evidence).fontSize(13).fontColor('#344054').lineHeight(21)
      Text('AI 匹配建议 · 非赛事事实').fontSize(12).fontWeight(FontWeight.Medium).fontColor('#2457E7')
      Text(item.reason).fontSize(13).fontColor('#344054').lineHeight(22)
      Text('建议产出与下一步').fontSize(12).fontWeight(FontWeight.Medium).fontColor('#2457E7')
      Text(item.action).fontSize(13).fontColor('#344054').lineHeight(22)
      Text(item.source.url).fontSize(11).fontColor('#667085').maxLines(3)
      Button('查看来源并核实报名').id('aiSource-' + item.source.id).height(38).width('100%').fontSize(13)
        .backgroundColor('#EDF2FF').fontColor('#2457E7')
        .onClick((): void => { this.openAiSource(item.source.url); })
    }.alignItems(HorizontalAlign.Start).width('100%').padding(18).backgroundColor('#FFFFFF').borderRadius(12)
  }

  @Builder
  private AiResearchPage() {
    Scroll(this.aiScroller) {
      Column({ space: 16 }) {
        Row() {
          Text('AI 找比赛').fontSize(24).fontWeight(FontWeight.Bold).fontColor('#101828').layoutWeight(1)
          Button('返回发现').height(34).fontSize(12).backgroundColor('#EDF2FF').fontColor('#2457E7')
            .onClick((): void => { this.navigate('发现比赛'); })
        }.width('100%')
        Text('按你的目标寻找国内赛事线索，再决定值得投入哪一场。')
          .fontSize(13).fontColor('#667085').lineHeight(21)
        Column({ space: 12 }) {
          Text(this.majorDraft || '尚未填写专业').fontSize(16).fontWeight(FontWeight.Medium).fontColor('#101828')
          Text(this.interestsDraft || '方向不限，可在偏好中补充').fontSize(13).fontColor('#475467').lineHeight(20)
          Text(this.goalsDraft || '补充你的需求和基础，会更容易得到适合的建议。')
            .fontSize(12).fontColor('#667085').lineHeight(20)
          Button('调整偏好 / 配置 Key').id('aiConfigure').height(36).fontSize(12)
            .backgroundColor('#EDF2FF').fontColor('#2457E7')
            .onClick((): void => { this.navigate('偏好设置'); })
        }.width('100%').alignItems(HorizontalAlign.Start).padding(18).backgroundColor('#FFFFFF').borderRadius(12)
        Button(this.aiBusy ? '处理中…' : '联网搜索 + AI 推荐').id('startAiWeb').width('100%').height(46)
          .fontSize(15).backgroundColor('#3366FF').enabled(!this.aiBusy && !this.keyBusy)
          .onClick((): void => { this.runAi(true); })
        Button('只分析已有国内比赛').id('startAiCatalog').width('100%').height(40).fontSize(13)
          .backgroundColor('#EDF2FF').fontColor('#2457E7').enabled(!this.aiBusy && !this.keyBusy)
          .onClick((): void => { this.runAi(false); })
        if (this.aiBusy) {
          Button('取消本次请求').id('cancelAiRequest').height(36).fontSize(13).backgroundColor('#F2F4F7').fontColor('#475467')
            .onClick((): void => { this.aiService?.cancel(); })
        }
        Text('仅在你确认后调用，可能计费；不会每天自动调用 AI。搜索不保证覆盖全部赛事；未知归属、国外条目和无有效出处的内容会被排除。')
          .fontSize(12).fontColor('#667085').lineHeight(20)
        Text(this.aiNotice).id('aiRequestStatus').fontSize(13).fontColor('#475467').lineHeight(21)
        if (this.aiReport !== undefined) {
          Text('上次报告 · ' + formatBeijing(this.aiReport.checkedAt) + '（北京时间）')
            .fontSize(14).fontWeight(FontWeight.Medium).fontColor('#101828')
          Text((this.aiReport.mode === 'web' ? '联网检索' : '仅分析已有资料') + ' · ' + this.aiReport.searchedCount +
            ' 条国内候选 · ' + this.aiReport.items.length + ' 项建议').fontSize(12).fontColor('#667085')
          Text('报告使用：' + this.aiReport.profile.major + ' / ' + (this.aiReport.profile.interests || '方向不限') +
            '；修改偏好不会自动更新报告。').fontSize(12).fontColor('#667085').lineHeight(19)
          ForEach(this.aiReport.queries, (query: string) => {
            Text('检索词：' + query).fontSize(11).fontColor('#667085').lineHeight(18)
          }, (query: string): string => query)
          if (this.aiReport.items.length === 0) {
            this.SettingSection('没有足够可靠的匹配线索', '可调整专业方向或稍后重试，也可继续查看固定来源。不会把 AI 凭空生成的赛事放入列表。')
          }
          ForEach(this.aiReport.items, (item: AiRecommendation) => {
            this.AiResultCard(item)
          }, (item: AiRecommendation): string => item.source.url + '-' + (this.aiReport?.checkedAt ?? 0))
        }
      }.alignItems(HorizontalAlign.Start).width('100%').padding(this.windowWidth < 600 ? 16 : 24)
    }.id('aiResearchScroll').height('100%').width('100%').scrollBar(BarState.Auto).align(Alignment.TopStart)
  }

  @Builder
  private SettingSection(title: string, body: string) {
    Column({ space: 8 }) {
      Text(title).fontSize(15).fontWeight(FontWeight.Medium).fontColor('#101828')
      Text(body).fontSize(13).fontColor('#667085').lineHeight(22)
    }.alignItems(HorizontalAlign.Start).width('100%').padding(18)
      .backgroundColor('#FFFFFF').borderRadius(12).border({ width: 1, color: '#EAECF0' })
  }

  @Builder
  private SettingsPage() {
    Scroll() {
      Column({ space: 18 }) {
        this.PageHeader()
        this.DataNotice()
        if (this.selectedNav === '更新设置') {
          this.SettingSection('自动更新与覆盖范围',
            '只展示中国国内赛事。自动读取牛客自办算法赛，以及中国大学生计算机设计大赛公告；腾讯、华为、蓝桥杯为官网快捷入口。公告不代表开放报名，覆盖范围不等于全国全部赛事。')
          Column({ space: 14 }) {
            Row() {
              Text('每日自动检查').fontSize(15).fontWeight(FontWeight.Medium).fontColor('#101828').layoutWeight(1)
              Toggle({ type: ToggleType.Switch, isOn: this.dailyEnabled }).id('dailyToggle')
                .onChange((value: boolean): void => { this.setDailyEnabled(value); })
            }.width('100%')
            Text('北京时间，24 小时制；应用在前台时按分钟检查，错过时在下次打开补查；网络失败最多每 15 分钟重试。').fontSize(12).fontColor('#667085').lineHeight(20)
            Row({ space: 12 }) {
              TextInput({ text: this.timeDraft, placeholder: '08:00' })
                .id('updateTimeInput').height(40).width(110).maxLength(5).fontColor('#101828')
                .onChange((value: string): void => { this.timeDraft = value; })
              Button('保存时间').height(38).fontSize(13).backgroundColor('#3366FF')
                .onClick((): void => { this.saveTime(); })
            }
            Text('每天 ' + this.updateTime + (this.dailyEnabled ? ' · 已启用前台检查 / 打开补查' : ' · 已暂停自动检查'))
              .fontSize(12).fontColor('#067647')
            Text('关闭应用或设备休眠时不保证准点执行；本版本不承诺后台全天候搜索或系统通知。')
              .fontSize(12).fontColor('#B54708').lineHeight(20)
          }.alignItems(HorizontalAlign.Start).width('100%').padding(18)
            .backgroundColor('#FFFFFF').borderRadius(12).border({ width: 1, color: '#EAECF0' })
          Text(this.lastCheck).fontSize(12).fontColor('#475467').lineHeight(20)
          ForEach(this.sources, (source: SourceInfo) => {
            Column({ space: 10 }) {
              Text(source.name).fontSize(15).fontWeight(FontWeight.Medium).fontColor('#101828')
              Text(source.description).fontSize(12).fontColor('#667085').lineHeight(20)
              Text(this.sourceStatus(source)).fontSize(11).fontColor('#475467').lineHeight(18)
              Text(source.url).fontSize(11).fontColor('#667085').maxLines(2)
              Row({ space: 10 }) {
                Button('打开官网').id('source-' + source.id).height(34).fontSize(12)
                  .backgroundColor('#EDF2FF').fontColor('#2457E7')
                  .onClick((): void => { this.openOfficial(source.url); })
                Button('复制链接').height(34).fontSize(12).backgroundColor('#F2F4F7').fontColor('#475467')
                  .onClick((): void => { this.copyText(source.url); })
              }
            }.alignItems(HorizontalAlign.Start).width('100%').padding(18).backgroundColor('#FFFFFF').borderRadius(12)
          }, (source: SourceInfo): string => source.id)
        } else {
          this.CareerProfileForm()
          this.DeepSeekSettings()
          Column({ space: 14 }) {
            Text('已有比赛的快捷分类（可选）').fontSize(15).fontWeight(FontWeight.Medium).fontColor('#101828')
            Text('仅用于列表快捷筛选，不会限制上方自由填写的 AI 偏好。').fontSize(12).fontColor('#667085').lineHeight(20)
            Flex({ wrap: FlexWrap.Wrap }) {
              ForEach(this.categories, (category: string) => {
                Button(category, { type: ButtonType.Normal })
                  .height(38).fontSize(13).borderRadius(8).margin({ right: 8, bottom: 8 })
                  .fontColor(this.preferredCategory === category ? '#FFFFFF' : '#475467')
                  .backgroundColor(this.preferredCategory === category ? '#3366FF' : '#F2F4F7')
                  .onClick((): void => { this.preferredCategory = category; this.persist(); })
              }, (category: string): string => category)
            }.width('100%')
            Button('查看这个方向的比赛').height(40).fontSize(13).backgroundColor('#3366FF')
              .onClick((): void => {
                this.navigate('发现比赛');
                this.selectedCategory = this.preferredCategory;
                this.refreshVisible();
              })
          }.alignItems(HorizontalAlign.Start).width('100%').padding(18).backgroundColor('#FFFFFF').borderRadius(12)
          this.SettingSection('把比赛变成简历经历',
            '优先选择能产出代码、作品或实验报告的任务。记录个人职责、关键技术、验证方法和实际结果；获奖、排名和性能数据以真实材料为准。')
          this.SettingSection('本地数据',
            '收藏、报名计划和笔记只保存在当前设备，不会上传你的笔记。AI 操作会在你确认后将专业、方向、需求及公开赛事资料发送到 DeepSeek；报告保存在本机。Key 使用系统安全存储，仅用于官方接口鉴权。旧版国外条目的收藏标记与笔记仍保留在本机。卸载可能清除本地数据，重要记录请复制备份。')
        }
      }.alignItems(HorizontalAlign.Start).width('100%').padding(this.windowWidth < 600 ? 14 : 24)
    }.id('settingsScroll').height('100%').width('100%').scrollBar(BarState.Auto).align(Alignment.TopStart)
  }

  @Builder
  private Overview() {
    Scroll() {
      Column({ space: 18 }) {
        Text('今日概览').fontSize(17).fontWeight(FontWeight.Bold).fontColor('#101828')
        Column({ space: 12 }) {
          Text('我的关注方向').fontSize(13).fontColor('#667085')
          Text(this.interestsDraft || this.preferredCategory).fontSize(14).fontColor('#2457E7').padding(10)
            .backgroundColor('#EDF2FF').borderRadius(8)
          Button('调整偏好').fontSize(12).height(34).backgroundColor('#F2F4F7').fontColor('#344054')
            .onClick((): void => { this.navigate('偏好设置'); })
        }.alignItems(HorizontalAlign.Start).width('100%')
        Divider().color('#EAECF0')
        Text('计划中的近期安排').fontSize(13).fontWeight(FontWeight.Medium).fontColor('#344054')
        if (this.plannedSoon().length === 0) {
          Text('暂无 7 天内开赛或截止的计划。可从比赛详情添加。')
            .fontSize(12).fontColor('#667085').lineHeight(20)
        } else {
          ForEach(this.plannedSoon(), (item: Competition) => {
            Column({ space: 5 }) {
              Text(item.title).fontSize(12).fontColor('#344054').maxLines(2)
              Text(deadlineLabel(item, this.now)).fontSize(11).fontColor('#B54708')
            }.alignItems(HorizontalAlign.Start)
          }, (item: Competition): string => item.id)
        }
        Text('此处为应用内提示；系统通知尚未接入。').fontSize(11).fontColor('#667085').lineHeight(18)
        Divider().color('#EAECF0')
        Text('每日定点搜索').fontSize(13).fontWeight(FontWeight.Medium).fontColor('#344054')
        Text(this.dailyEnabled ? '每天 ' + this.updateTime + ' · 前台检查，打开补查' : '已暂停自动检查')
          .fontSize(12).fontColor('#067647').lineHeight(20)
        Button('查看更新设置').fontSize(12).height(34).backgroundColor('#EDF2FF').fontColor('#2457E7')
          .onClick((): void => { this.navigate('更新设置'); })
        Divider().color('#EAECF0')
        Text('让经历更有价值').fontSize(13).fontWeight(FontWeight.Medium).fontColor('#344054')
        Text('每场比赛记录一项个人贡献、一份可展示作品和一组有依据的结果。')
          .fontSize(12).fontColor('#667085').lineHeight(21)
      }.width('100%').alignItems(HorizontalAlign.Start).padding(22)
    }.width(256).height('100%').backgroundColor('#FFFFFF').scrollBar(BarState.Auto).align(Alignment.TopStart)
      .border({ width: { left: 1 }, color: '#EAECF0' })
  }

  @Builder
  private DetailOverlay() {
    Stack({ alignContent: Alignment.Center }) {
      Column().width('100%').height('100%').backgroundColor('#66000000')
        .onClick((): void => { this.closeDetail(); })
      Column({ space: 16 }) {
        Row({ space: 12 }) {
          Text('比赛详情').fontSize(20).fontWeight(FontWeight.Bold).fontColor('#101828').layoutWeight(1)
          Button('关闭', { type: ButtonType.Normal }).height(34).fontSize(12)
            .fontColor('#475467').backgroundColor('#F2F4F7').borderRadius(8)
            .onClick((): void => { this.closeDetail(); })
        }.width('100%')
        Scroll() {
          Column({ space: 16 }) {
            Text(this.detailItem.title).fontSize(19).fontWeight(FontWeight.Medium).fontColor('#101828')
            Text(this.detailItem.kind === 'announcement' ? '官方公告 · 请阅读原文确认届次与安排' : '官方赛程 · 报名规则以平台为准')
              .fontSize(12).fontColor('#B54708')
            Text(this.detailItem.organizer + ' · ' + this.detailItem.format).fontSize(13).fontColor('#667085')
            Text(this.eventTime(this.detailItem) + ' · ' + deadlineLabel(this.detailItem, this.now))
              .fontSize(13).fontColor(this.deadlineColor(this.detailItem)).lineHeight(21)
            Text('读取时间：' + formatBeijing(this.detailItem.fetchedAt ?? 0) + '（北京时间）')
              .fontSize(11).fontColor('#667085')
            Text(this.detailItem.sourceUrl ?? '').fontSize(11).fontColor('#667085').maxLines(3)
            Row({ space: 10 }) {
              Button('官方详情 / 报名').id('officialLinkButton').height(36).fontSize(12).backgroundColor('#3366FF')
                .onClick((): void => { this.openOfficial(this.detailItem.sourceUrl ?? ''); })
              Button('复制官方链接').height(36).fontSize(12).backgroundColor('#EDF2FF').fontColor('#2457E7')
                .onClick((): void => { this.copyText(this.detailItem.sourceUrl ?? ''); })
            }
            Text(this.detailItem.description).fontSize(14).fontColor('#475467').lineHeight(24)
            Divider().color('#EAECF0')
            Text('可沉淀的项目材料').fontSize(15).fontWeight(FontWeight.Medium).fontColor('#101828')
            ForEach(this.detailItem.deliverables, (deliverable: string) => {
              Text('• ' + deliverable).fontSize(13).fontColor('#475467').lineHeight(22)
            }, (deliverable: string): string => deliverable)
            Text('我的参赛记录').fontSize(15).fontWeight(FontWeight.Medium).fontColor('#101828')
            Text('阶段为个人记录，不会自动报名；保存后加入计划。').fontSize(12).fontColor('#667085')
            Button('填入记录提纲').id('noteTemplateButton').height(32).fontSize(11)
              .backgroundColor('#F2F4F7').fontColor('#475467').enabled(!this.noteSaving && this.noteDraft.length === 0)
              .onClick((): void => {
                this.noteDraft = '目标与个人职责：\n\n技术方案与实现：\n\n作品 / 代码链接：\n\n验证方法与真实结果：\n\n下一步行动：';
                this.noteDirty = true;
              })
            Select(this.stageOptions).id('projectStage').value(this.noteStage).selected(this.stages.indexOf(this.noteStage))
              .font({ size: 13 }).enabled(!this.noteSaving)
              .onSelect((index: number): void => {
                if (index >= 0 && index < this.stages.length && this.noteStage !== this.stages[index]) {
                  this.noteStage = this.stages[index];
                  this.noteDirty = true;
                }
              })
            TextArea({ text: this.noteDraft, placeholder: '目标与个人职责：\n技术方案与实现：\n作品 / 代码链接：\n验证方法与真实结果：\n下一步行动：' })
              .id('projectNoteInput').height(180).maxLength(2000).fontSize(13).fontColor('#101828')
              .backgroundColor('#F8FAFC').enabled(!this.noteSaving)
              .onChange((value: string): void => {
                if (value !== this.noteDraft) {
                  this.noteDraft = value;
                  this.noteDirty = true;
                }
              })
            Row({ space: 10 }) {
              Button(this.noteSaving ? '保存中…' : '保存记录').id('saveNoteButton').height(36).fontSize(12)
                .backgroundColor('#3366FF').enabled(!this.noteSaving)
                .onClick((): void => { this.saveNote(); })
              Button('复制经历草稿').height(36).fontSize(12).backgroundColor('#EDF2FF').fontColor('#2457E7')
                .enabled(this.noteDraft.trim().length > 0)
                .onClick((): void => {
                  this.copyText(this.detailItem.title + '\n阶段：' + this.noteStage + '\n' + this.noteDraft +
                    '\n官方来源：' + (this.detailItem.sourceUrl ?? ''));
                })
            }
            if (this.noteDirty) {
              Text('有未保存的修改').fontSize(11).fontColor('#B54708')
            }
            Text(this.noteNotice).id('noteStatus').fontSize(11).fontColor('#667085')
            Button('清除这条记录').id('clearNoteButton').height(32).fontSize(11)
              .backgroundColor('#FEF3F2').fontColor('#B42318').enabled(!this.noteSaving)
              .onClick((): void => { this.clearNote(); })
            Text('计划只用于个人管理，不代表报名成功。简历中的排名、获奖和结果必须有真实材料支持。')
              .fontSize(12).fontColor('#667085').lineHeight(20)
          }.alignItems(HorizontalAlign.Start).width('100%')
        }.id('detailScroll').layoutWeight(1).width('100%').scrollBar(BarState.Auto).align(Alignment.TopStart)
        Row({ space: 12 }) {
          Button(this.favorites.includes(this.detailItem.id) ? '取消收藏' : '收藏比赛')
            .fontSize(13).height(40).layoutWeight(1).fontColor('#2457E7').backgroundColor('#EDF2FF')
            .onClick((): void => { this.toggleFavorite(this.detailItem); })
          Button(this.planned.includes(this.detailItem.id) ? '移出计划' : '加入计划')
            .id('planButton').fontSize(13).height(40).layoutWeight(1).backgroundColor('#3366FF')
            .enabled(!this.planDisabled(this.detailItem))
            .onClick((): void => { this.togglePlan(this.detailItem); })
        }.width('100%')
      }.width(this.windowWidth < 680 ? '92%' : 600).height('82%')
        .padding(24).backgroundColor('#FFFFFF').borderRadius(16)
    }.width('100%').height('100%')
  }

  build() {
    Stack() {
      Column() {
        if (this.windowWidth < 600) {
          this.PhoneHeader()
        } else if (this.windowWidth < 900) {
          this.CompactNavigation()
        }
        Row() {
          if (this.windowWidth >= 900) {
            this.Sidebar()
          }
          Column() {
            if (this.selectedNav === 'AI 找比赛') {
              this.AiResearchPage()
            } else if (this.selectedNav === '更新设置' || this.selectedNav === '偏好设置') {
              this.SettingsPage()
            } else {
              this.DiscoveryPage()
            }
          }.layoutWeight(1).height('100%').backgroundColor('#F8FAFC')
          if (this.windowWidth >= 1240) {
            this.Overview()
          }
        }.width('100%').layoutWeight(1)
        if (this.windowWidth < 600) {
          this.PhoneNavigation()
        }
      }.width('100%').height('100%')
      if (this.showDetail) {
        this.DetailOverlay()
      }
    }.width('100%').height('100%').backgroundColor('#F8FAFC')
      .onAreaChange((oldArea: Area, newArea: Area): void => {
        const width: number = Number(newArea.width);
        if (Number.isFinite(width) && width > 0 && this.windowWidth !== width) {
          this.windowWidth = width;
        }
      })
  }
}
