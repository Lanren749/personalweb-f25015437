/* 视图注册：弱信号流 + 产业方向、情报周报、Watchlist */
const SIG_TYPES = { '政策': { c: 'cy', i: '政' }, '融资': { c: 'am', i: '融' }, '技术': { c: 'pu', i: '技' }, '资本': { c: 'gr', i: '资' }, '招聘': { c: 'cy', i: '招' }, '专利': { c: 'am', i: '专' } };
const SIG_ST = { '正常': 'gr', '待核实': 'am', '降级': 'pu', '排除': 'rd', '转参考': 'cy' };
window.SIG_TYPES = SIG_TYPES; window.SIG_ST = SIG_ST;

/* ================= 产业雷达（信号 + 方向） ================= */
regView('radar', {
  template: `
  <div>
    <div class="page-head">
      <h1>全球产业趋势雷达</h1>
      <div class="desc">持续监测政策、融资、技术、资本、招聘、专利六类动态，识别弱信号并按强度 / 置信度处置。低置信信号自动转入参考，不计入方向判断。</div>
    </div>
    <div class="tabs">
      <button :class="{on: tab==='signals'}" @click="tab='signals'">弱信号流</button>
      <button :class="{on: tab==='dirs'}" @click="tab='dirs'">产业方向</button>
    </div>

    <div v-if="tab==='signals'">
      <div class="toolbar">
        <input class="input" v-model.trim="q.kw" placeholder="搜索信号标题 / 内容" @keyup.enter="load">
        <select class="input" v-model="q.type" @change="load"><option value="">全部类型</option><option v-for="(v,k) in sigT" :key="k" :value="k">{{ k }}</option></select>
        <select class="input" v-model="q.status" @change="load"><option value="">全部状态</option><option v-for="(v,k) in stT" :key="k" :value="k">{{ k }}</option></select>
        <select class="input" v-model="q.direction_id" @change="load"><option value="">全部方向</option><option v-for="d in dirs" :key="d.id" :value="d.id">{{ d.name }}</option></select>
        <button class="btn" @click="load">筛选</button>
        <button class="btn pri" @click="openAdd">+ 录入信号</button>
        <span class="cnt">{{ list.length }} 条</span>
      </div>
      <div class="card">
        <div class="sig-item" v-for="s in list" :key="s.id">
          <div class="sig-ico" :class="'tag-' + sigT[s.type].c" :style="{background:'var(--' + (sigT[s.type].c==='cy'?'cy':sigT[s.type].c) + '-dim)', color:'var(--'+sigT[s.type].c+')'}">{{ sigT[s.type].i }}</div>
          <div class="sig-body">
            <div class="sig-title">{{ s.title }} <span class="dir" v-if="s.direction_name">{{ s.direction_name }}</span></div>
            <div class="sig-cont">{{ s.content }}</div>
            <div class="sig-meta">
              <span class="tag" :class="stT[s.status]">{{ s.status }}</span>
              <span>{{ s.occurred_at }}</span>
              <span class="meter">强度<div class="bar"><i :style="{width:s.strength+'%', background:'var(--cy)'}"></i></div>{{ s.strength }}</span>
              <span class="meter">置信<div class="bar"><i :style="{width:s.confidence+'%', background:'var(--am)'}"></i></div>{{ s.confidence }}</span>
              <span v-if="s.source_name">来源：{{ s.source_name }}</span>
              <a v-if="s.source_url" :href="s.source_url" target="_blank" rel="noopener">原文 ↗</a>
              <span v-if="s.verify_note" class="tag am">备注：{{ s.verify_note }}</span>
              <span style="margin-left:auto"></span>
              <button class="btn sm" @click="interpret(s)" :disabled="aiBusyId===s.id">{{ aiBusyId===s.id ? 'AI 解读中…' : 'AI 解读' }}</button>
              <button class="btn sm" @click="openEdit(s)">编辑</button>
              <select class="input" style="width:auto;padding:3px 8px;font-size:12px" :value="s.status" @change="handle($event, s)">
                <option v-for="(v,k) in stT" :key="k" :value="k">{{ k }}</option>
              </select>
            </div>
            <div class="sig-ai" v-if="s.ai_note">{{ s.ai_note }}</div>
          </div>
        </div>
        <div class="empty" v-if="!list.length"><span class="ico">◎</span>暂无符合条件的信号</div>
      </div>
    </div>

    <div v-if="tab==='dirs'">
      <div class="toolbar">
        <span class="muted">方向由信号沉淀而来：触发信号 → Why Now → 与集团关联 → 风险。</span>
        <button class="btn pri" style="margin-left:auto" @click="openDir()">+ 新增方向</button>
      </div>
      <div class="dir-card" v-for="d in dirs" :key="d.id">
        <div class="dir-top">
          <h3>{{ d.name }}</h3><span class="tag pu">{{ d.category }}</span><span class="muted">{{ d.sub }}</span>
          <span class="tag" :class="d.status==='跟踪中' ? 'gr' : (d.status==='观察' ? 'am' : 'rd')">{{ d.status }}</span>
          <span class="tag cy">{{ d.signal_count }} 条有效信号</span>
          <div class="heat"><span class="muted">热度</span><div class="progress flame"><i :style="{width:d.heat+'%'}"></i></div><b class="mono">{{ d.heat }}</b></div>
          <button class="btn sm" @click="openDir(d)">编辑</button>
        </div>
        <div class="dir-sec"><div class="lb">Why Now</div><p>{{ d.why_now }}</p></div>
        <div class="dir-sec"><div class="lb">与东浩兰生的关联</div><p>{{ d.relation }}</p></div>
        <div class="dir-sec"><div class="lb">主要风险</div><ul><li v-for="r in d.risks" :key="r">{{ r }}</li></ul></div>
        <div class="chips mt8"><span class="tag" v-for="t in d.tags" :key="t">{{ t }}</span></div>
      </div>
    </div>

    <div class="modal-mask" v-if="modal" @click.self="modal=null">
      <div class="modal">
        <h3>{{ modal.title }}</h3>
        <template v-if="modal.kind==='sig'">
          <label class="fl">信号类型</label>
          <select class="input" v-model="m.type"><option v-for="(v,k) in sigT" :key="k">{{ k }}</option></select>
          <label class="fl">所属方向</label>
          <select class="input" v-model="m.direction_id"><option :value="null">未关联</option><option v-for="d in dirs" :key="d.id" :value="d.id">{{ d.name }}</option></select>
          <label class="fl">标题 <b>*</b></label><input class="input" v-model.trim="m.title">
          <label class="fl">内容摘要</label><textarea class="input" v-model="m.content"></textarea>
          <div class="grid2">
            <div><label class="fl">发生日期 <b>*</b></label><input class="input" type="date" v-model="m.occurred_at"></div>
            <div><label class="fl">来源名称</label><input class="input" v-model.trim="m.source_name"></div>
          </div>
          <label class="fl">来源 URL</label><input class="input" v-model.trim="m.source_url">
          <div class="grid2">
            <div><label class="fl">强度（1—100）</label><input class="input" type="number" v-model.number="m.strength"></div>
            <div><label class="fl">置信度（≤40 自动转参考）</label><input class="input" type="number" v-model.number="m.confidence"></div>
          </div>
        </template>
        <template v-if="modal.kind==='dir'">
          <label class="fl">方向名称 <b>*</b></label><input class="input" v-model.trim="m.name">
          <div class="grid2">
            <div><label class="fl">副题</label><input class="input" v-model.trim="m.sub"></div>
            <div><label class="fl">分类</label><input class="input" v-model.trim="m.category"></div>
          </div>
          <div class="grid2">
            <div><label class="fl">状态</label><select class="input" v-model="m.status"><option>跟踪中</option><option>观察</option><option>暂停</option></select></div>
            <div><label class="fl">热度（1—100）</label><input class="input" type="number" v-model.number="m.heat"></div>
          </div>
          <label class="fl">Why Now</label><textarea class="input" v-model="m.why_now"></textarea>
          <label class="fl">与东浩兰生的关联</label><textarea class="input" v-model="m.relation"></textarea>
          <label class="fl">主要风险（每行一条）</label><textarea class="input" v-model="m.risksText"></textarea>
          <label class="fl">标签（逗号分隔）</label><input class="input" v-model.trim="m.tagsText">
        </template>
        <div class="modal-foot">
          <button class="btn" @click="modal=null">取消</button>
          <button class="btn pri" @click="save" :disabled="saving">保存</button>
        </div>
      </div>
    </div>
  </div>
  `,
  data() {
    return {
      tab: 'signals', list: [], dirs: [], q: { kw: '', type: '', status: '', direction_id: '' },
      modal: null, saving: false, aiBusyId: null,
      sigT: SIG_TYPES, stT: SIG_ST, today: new Date().toISOString().slice(0, 10)
    };
  },
  async mounted() {
    /* 支持从「产业方向」看板跳转：携带方向筛选 */
    try {
      const f = JSON.parse(localStorage.getItem('radarFilter') || 'null');
      if (f && f.direction_id) this.q.direction_id = f.direction_id;
    } catch (e) {}
    localStorage.removeItem('radarFilter');
    await Promise.all([this.load(), this.loadDirs()]);
  },
  methods: {
    async load() {
      const p = new URLSearchParams();
      if (this.q.kw) p.set('kw', this.q.kw);
      if (this.q.type) p.set('type', this.q.type);
      if (this.q.status) p.set('status', this.q.status);
      if (this.q.direction_id) p.set('direction_id', this.q.direction_id);
      this.list = await this.$api.get('/api/radar/signals?' + p.toString());
    },
    async loadDirs() { this.dirs = await this.$api.get('/api/radar/directions'); },
    openAdd() { this.modal = { kind: 'sig', title: '录入弱信号', f: true, m: { type: '政策', direction_id: null, title: '', content: '', occurred_at: this.today, source_name: '', source_url: '', strength: 60, confidence: 70 } }; },
    openEdit(s) { this.modal = { kind: 'sig', title: '编辑信号 #' + s.id, f: true, m: { ...s } }; },
    async handle(e, s) {
      const st = e.target.value;
      const note = st === '正常' ? '' : (prompt('处置说明（将留痕显示为备注）：', s.verify_note || '') ?? '');
      if (note === null) { e.target.value = s.status; return; }
      try {
        await this.$api.put('/api/radar/signals/' + s.id, { status: st, verify_note: note });
        this.$toast('已处置为「' + st + '」'); this.load();
      } catch (err) { this.$toast(err.message); }
    },
    async interpret(s) {
      this.aiBusyId = s.id;
      try {
        const r = await this.$api.post('/api/radar/signals/' + s.id + '/interpret', {});
        s.ai_note = r.ai_note;
        this.$toast('AI 解读完成');
      } catch (e) { this.$toast(e.message); } finally { this.aiBusyId = null; }
    },
    openDir(d) {
      this.modal = {
        kind: 'dir', title: d ? '编辑方向' : '新增方向', f: true,
        m: d ? { ...d, risksText: (d.risks || []).join('\n'), tagsText: (d.tags || []).join(',') } : { name: '', sub: '', category: '', status: '跟踪中', heat: 60, why_now: '', relation: '', risksText: '', tagsText: '' }
      };
    },
    async save() {
      const { kind, m } = this.modal;
      this.saving = true;
      try {
        if (kind === 'sig') {
          if (!m.title || !m.occurred_at) throw new Error('标题与日期为必填');
          if (m.id) await this.$api.put('/api/radar/signals/' + m.id, m);
          else {
            const ret = await this.$api.post('/api/radar/signals', m);
            this.$toast(ret.status === '转参考' ? '已录入：置信度过低，自动转入参考' : '信号已录入');
          }
          this.load();
        } else {
          if (!m.name) throw new Error('请填写方向名称');
          const body = { ...m, risks: m.risksText.split('\n').map(x => x.trim()).filter(Boolean), tags: m.tagsText.split(',').map(x => x.trim()).filter(Boolean) };
          if (m.id) await this.$api.put('/api/radar/directions/' + m.id, body);
          else await this.$api.post('/api/radar/directions', body);
          this.loadDirs();
        }
        this.modal = null; this.$toast('已保存');
      } catch (e) { this.$toast(e.message); } finally { this.saving = false; }
    }
  }
});

/* ================= 情报周报 ================= */
regView('reports', {
  template: `
  <div>
    <div class="page-head">
      <h1>每周《战略投资机会雷达》</h1>
      <div class="desc">每周自动汇总当期信号、方向与新增候选企业，生成产业情报简报，由投资人员评估信息价值与信噪比后复核发布。</div>
    </div>

    <div v-if="!cur">
      <div class="toolbar">
        <span class="muted">周报列表（点击查看详情）</span>
        <button class="btn pri" style="margin-left:auto" @click="openNew">+ 创建周报</button>
      </div>
      <div class="card">
        <div class="rep-item" v-for="r in list" :key="r.id" @click="openRep(r)">
          <span class="wk">{{ r.week_label }}</span>
          <span class="per mono">{{ r.period_start }} ~ {{ r.period_end }}</span>
          <span class="tag" :class="r.status==='已复核' ? 'gr' : (r.status==='已生成' ? 'cy' : 'am')">{{ r.status }}</span>
          <span class="sum">{{ r.summary }}</span>
          <span class="muted mono">{{ r.scanned }} 条扫描</span>
        </div>
        <div class="empty" v-if="!list.length"><span class="ico">◌</span>暂无周报，点击右上角创建第一期</div>
      </div>
    </div>

    <div v-else class="report-doc card">
      <div class="flex"><button class="btn sm" @click="cur=null">← 返回列表</button></div>
      <h1 class="mt14">{{ rep.week_label }}《战略投资机会雷达》</h1>
      <div class="meta">
        <span>数据周期：{{ rep.period_start }} ~ {{ rep.period_end }}</span>
        <span>状态：{{ rep.status }}</span>
        <span>扫描公开信息：{{ rep.scanned }} 条</span>
        <span v-if="rep.published_at">发布：{{ rep.published_at }}</span>
        <span>生成：{{ rep.created_by }}</span>
      </div>

      <div class="flex mb14" v-if="editable">
        <button class="btn pri sm" @click="setStatus('已生成')" v-if="rep.status==='草稿'">标记为已生成</button>
        <button class="btn gr sm" @click="setStatus('已复核')" v-if="rep.status!=='已复核'">人工复核通过</button>
        <button class="btn sm" @click="aiSummary" :disabled="aiBusy">{{ aiBusy ? 'AI 综述生成中…（约 1 分钟）' : '✦ AI 生成综述' }}</button>
        <button class="btn sm" @click="editSummary">编辑本期摘要</button>
      </div>

      <div class="notice mb14"><b>本期摘要：</b>{{ rep.summary }}<div class="muted mt8" v-if="rep.note">{{ rep.note }}</div></div>

      <h2>一、本周产业方向速览</h2>
      <table class="table">
        <thead><tr><th>方向</th><th>热度</th><th>Why Now</th><th>风险</th></tr></thead>
        <tbody><tr v-for="d in dirs" :key="d.id">
          <td><b>{{ d.name }}</b><div class="muted">{{ d.sub }}</div></td>
          <td class="mono">{{ d.heat }}</td>
          <td class="muted">{{ d.why_now }}</td>
          <td class="muted">{{ (d.risks||[])[0] || '—' }}</td>
        </tr></tbody>
      </table>

      <h2>二、本期关键信号（按强度排序）</h2>
      <div class="sig-item" v-for="s in signals" :key="s.id">
        <div class="sig-ico" :style="{background:'var(--' + (sigT[s.type].c) + '-dim)', color:'var(--'+sigT[s.type].c+')'}">{{ sigT[s.type].i }}</div>
        <div class="sig-body">
          <div class="sig-title">{{ s.title }} <span class="dir">{{ s.direction_name || '未关联方向' }}</span></div>
          <div class="sig-meta">
            <span class="tag" :class="stT[s.status]">{{ s.status }}</span><span>{{ s.occurred_at }}</span><span>强度 {{ s.strength }} · 置信 {{ s.confidence }}</span>
            <span v-if="s.source_name">来源：{{ s.source_name }}</span>
            <a v-if="s.source_url" :href="s.source_url" target="_blank" rel="noopener">原文 ↗</a>
          </div>
        </div>
      </div>

      <h2>三、本期新增候选企业</h2>
      <table class="table" v-if="coms.length">
        <thead><tr><th>企业</th><th>赛道</th><th>轮次</th><th>协同</th><th>状态</th></tr></thead>
        <tbody><tr v-for="c in coms" :key="c.id">
          <td><b>{{ c.name }}</b><div class="muted">{{ c.region }}</div></td>
          <td>{{ c.track }}</td><td class="mono">{{ c.round }}</td>
          <td><span class="tag" :class="c.synergy_level==='高' ? 'gr' : (c.synergy_level==='中' ? 'am' : '')">{{ c.synergy_level }}</span></td>
          <td>{{ c.status }}</td>
        </tr></tbody>
      </table>
      <p v-else class="muted">本期无新增候选企业（高质量标的不足时不凑数）。</p>

      <div class="notice gr mt14"><b>复核说明：</b>周报由 AI 汇总生成，信息价值与信噪比由投资人员评估；本系统不自动作出投资决策。</div>
    </div>

    <div class="modal-mask" v-if="modal" @click.self="modal=null">
      <div class="modal">
        <h3>创建情报周报</h3>
        <label class="fl">周次名称 <b>*</b></label><input class="input" v-model.trim="f.week_label" placeholder="如：第 4 周">
        <div class="grid2">
          <div><label class="fl">开始日期 <b>*</b></label><input class="input" type="date" v-model="f.period_start"></div>
          <div><label class="fl">结束日期 <b>*</b></label><input class="input" type="date" v-model="f.period_end"></div>
        </div>
        <label class="fl">本期摘要</label><textarea class="input" v-model="f.summary"></textarea>
        <label class="fl">备注</label><input class="input" v-model="f.note">
        <div class="modal-foot">
          <button class="btn" @click="modal=null">取消</button>
          <button class="btn pri" @click="create" :disabled="saving">创建（自动汇总当期信号数）</button>
        </div>
      </div>
    </div>
  </div>
  `,
  data() { return { list: [], cur: null, rep: null, signals: [], dirs: [], coms: [], modal: null, saving: false, aiBusy: false, f: {}, sigT: SIG_TYPES, stT: SIG_ST }; },
  computed: { editable() { return this.$root.user; } },
  async mounted() { this.list = await this.$api.get('/api/radar/reports'); },
  methods: {
    openNew() { this.f = { week_label: '', period_start: '', period_end: '', summary: '', note: '' }; this.modal = true; },
    async create() {
      if (!this.f.week_label || !this.f.period_start || !this.f.period_end) return this.$toast('周次与起止日期为必填');
      this.saving = true;
      try { await this.$api.post('/api/radar/reports', this.f); this.modal = null; this.$toast('周报已创建'); this.list = await this.$api.get('/api/radar/reports'); }
      catch (e) { this.$toast(e.message); } finally { this.saving = false; }
    },
    async openRep(r) {
      const d = await this.$api.get('/api/radar/reports/' + r.id + '/detail');
      this.rep = d.report; this.signals = d.signals; this.dirs = d.directions; this.coms = d.companies; this.cur = r.id;
    },
    async setStatus(st) {
      if (st === '已复核' && !confirm('确认人工复核通过？确认后周报进入已复核状态。')) return;
      await this.$api.put('/api/radar/reports/' + this.rep.id, { status: st });
      this.rep.status = st; this.$toast('已更新为「' + st + '」'); this.list = await this.$api.get('/api/radar/reports');
    },
    async editSummary() {
      const v = prompt('编辑本期摘要：', this.rep.summary);
      if (v === null) return;
      await this.$api.put('/api/radar/reports/' + this.rep.id, { summary: v });
      this.rep.summary = v; this.$toast('摘要已更新');
    },
    async aiSummary() {
      this.aiBusy = true;
      try {
        const r = await this.$api.post('/api/radar/reports/' + this.rep.id + '/ai-summary', {});
        this.rep.summary = r.summary;
        this.$toast('AI 综述已写入本期摘要');
      } catch (e) { this.$toast(e.message); } finally { this.aiBusy = false; }
    }
  }
});

/* ================= Watchlist ================= */
regView('watchlist', {
  template: `
  <div>
    <div class="page-head">
      <h1>目标企业 Watchlist</h1>
      <div class="desc">对重点企业、关键词与赛道建立动态监测，持续跟踪其融资、订单、技术与人事变化。</div>
    </div>
    <div class="toolbar">
      <span class="muted">共 {{ list.length }} 项监测，其中监测中 {{ list.filter(x=>x.status==='监测中').length }} 项</span>
      <button class="btn pri" style="margin-left:auto" @click="modal=true; f={target_type:'企业',name:'',direction_id:null,note:''}">+ 新增监测</button>
    </div>
    <div class="card">
      <table class="table">
        <thead><tr><th style="width:90px">类型</th><th>监测对象</th><th>所属方向</th><th>监测要点</th><th style="width:90px">状态</th><th style="width:150px">操作</th></tr></thead>
        <tbody>
          <tr v-for="w in list" :key="w.id">
            <td><span class="tag" :class="w.target_type==='企业' ? 'cy' : (w.target_type==='赛道' ? 'pu' : 'am')">{{ w.target_type }}</span></td>
            <td><b>{{ w.name }}</b></td>
            <td class="muted">{{ w.direction_name || '—' }}</td>
            <td class="muted">{{ w.note }}</td>
            <td><span class="tag" :class="w.status==='监测中' ? 'gr' : ''">{{ w.status }}</span></td>
            <td>
              <button class="btn sm" @click="toggle(w)">{{ w.status==='监测中' ? '暂停' : '恢复' }}</button>
              <button class="btn sm danger" @click="del(w)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
      <div class="empty" v-if="!list.length"><span class="ico">◌</span>暂无监测对象</div>
    </div>
    <div class="modal-mask" v-if="modal" @click.self="modal=false">
      <div class="modal">
        <h3>新增监测</h3>
        <label class="fl">类型</label>
        <select class="input" v-model="f.target_type"><option>企业</option><option>关键词</option><option>赛道</option></select>
        <label class="fl">名称 <b>*</b></label><input class="input" v-model.trim="f.name">
        <label class="fl">关联方向</label>
        <select class="input" v-model="f.direction_id"><option :value="null">未关联</option><option v-for="d in dirs" :key="d.id" :value="d.id">{{ d.name }}</option></select>
        <label class="fl">监测要点</label><textarea class="input" v-model="f.note" placeholder="如：跟踪其大客户签约与续约情况"></textarea>
        <div class="modal-foot">
          <button class="btn" @click="modal=false">取消</button>
          <button class="btn pri" @click="add">添加</button>
        </div>
      </div>
    </div>
  </div>
  `,
  data() { return { list: [], dirs: [], modal: false, f: {} }; },
  async mounted() { this.load(); this.dirs = await this.$api.get('/api/radar/directions'); },
  methods: {
    async load() { this.list = await this.$api.get('/api/radar/watchlist'); },
    async add() {
      if (!this.f.name) return this.$toast('请填写名称');
      try { await this.$api.post('/api/radar/watchlist', this.f); this.modal = false; this.$toast('已加入监测'); this.load(); }
      catch (e) { this.$toast(e.message); }
    },
    async toggle(w) { await this.$api.put('/api/radar/watchlist/' + w.id, { status: w.status === '监测中' ? '已暂停' : '监测中' }); this.load(); },
    async del(w) { if (!confirm('删除监测「' + w.name + '」？')) return; await this.$api.del('/api/radar/watchlist/' + w.id); this.load(); }
  }
});

/* ================= 产业方向看板（每次自动采集后 AI 整理汇总） ================= */
regView('digest', {
  template: `
  <div>
    <div class="page-head">
      <h1>产业方向看板</h1>
      <div class="desc">每次自动采集入库后，AI 基于近 7 天信号自动整理各产业方向的热度、Why Now、集团关联与主要风险；出现现有方向无法覆盖的新主题时，以「观察」状态沉淀为新方向，人工复核后转为跟踪中。</div>
    </div>
    <div class="toolbar">
      <span class="muted" v-if="meta.last_digest_at">上次 AI 整理：{{ fmtTime(meta.last_digest_at) }}<template v-if="meta.last_digest_detail"> · {{ meta.last_digest_detail }}</template></span>
      <span class="muted" v-else>尚未进行过 AI 方向整理，将在下一次自动采集入库后生成</span>
      <span style="margin-left:auto"></span>
      <span class="cnt">跟踪中 {{ dirs.filter(d=>d.status==='跟踪中').length }} · 观察 {{ dirs.filter(d=>d.status==='观察').length }}</span>
      <button class="btn" @click="load">刷新</button>
    </div>
    <div class="dir-card" v-for="d in dirs" :key="d.id">
      <div class="dir-top">
        <h3>{{ d.name }}</h3><span class="tag pu">{{ d.category }}</span><span class="muted">{{ d.sub }}</span>
        <span class="tag" :class="d.status==='跟踪中' ? 'gr' : (d.status==='观察' ? 'am' : 'rd')">{{ d.status }}</span>
        <span class="tag am" v-if="d.status==='观察'">待人工复核</span>
        <span class="tag cy">近 7 天 {{ d.recent_count }} 条信号</span>
        <div class="heat"><span class="muted">热度</span><div class="progress flame"><i :style="{width:d.heat+'%'}"></i></div><b class="mono">{{ d.heat }}</b></div>
        <button class="btn sm" @click="goRadar(d)">查看信号流</button>
      </div>
      <div class="dir-sec"><div class="lb">Why Now</div><p>{{ d.why_now || '—' }}</p></div>
      <div class="dir-sec"><div class="lb">与东浩兰生的关联</div><p>{{ d.relation || '—' }}</p></div>
      <div class="dir-sec"><div class="lb">主要风险</div><ul><li v-for="r in d.risks" :key="r">{{ r }}</li></ul></div>
      <div class="dir-sec" v-if="d.recent.length">
        <div class="lb">近 7 天触发信号（点击进入信号流）</div>
        <div class="sig-item" v-for="s in d.recent" :key="s.id" style="cursor:pointer" @click="goRadar(d)">
          <div class="sig-ico" :class="'tag-' + sigT[s.type].c" :style="{background:'var(--' + sigT[s.type].c + '-dim)', color:'var(--' + sigT[s.type].c + ')'}">{{ sigT[s.type].i }}</div>
          <div class="sig-body">
            <div class="sig-title">{{ s.title }}</div>
            <div class="sig-meta">
              <span class="tag" :class="stT[s.status]">{{ s.status }}</span>
              <span>{{ s.occurred_at }}</span>
              <span>强度 {{ s.strength }} · 置信 {{ s.confidence }}</span>
              <span v-if="s.source_name">来源：{{ s.source_name }}</span>
              <a v-if="s.source_url" :href="s.source_url" target="_blank" rel="noopener" @click.stop>原文 ↗</a>
            </div>
          </div>
        </div>
      </div>
      <div class="chips mt8"><span class="tag" v-for="t in d.tags" :key="t">{{ t }}</span></div>
    </div>
    <div class="card"><div class="empty" v-if="loaded && !dirs.length"><span class="ico">◌</span>暂无方向数据，等待首次 AI 整理</div></div>
  </div>
  `,
  data() { return { dirs: [], meta: {}, loaded: false, sigT: SIG_TYPES, stT: SIG_ST }; },
  async mounted() { await this.load(); },
  methods: {
    async load() {
      const r = await this.$api.get('/api/radar/digest/board');
      this.dirs = r.directions || [];
      this.meta = r; this.loaded = true;
    },
    fmtTime(t) { return String(t || '').replace('T', ' ').slice(0, 16); },
    goRadar(d) {
      try { localStorage.setItem('radarFilter', JSON.stringify({ direction_id: d.id })); } catch (e) {}
      this.$go('radar');
    }
  }
});
