/* 视图注册：寻源与决策（缺口 + 候选企业池 + 详情抽屉 + 四问） */
const SYN_T = { '高': 'gr', '中': 'am', '弱/待验证': '' };
const COM_ST = { '候选': 'cy', '继续研究': 'gr', '暂缓': 'am', '排除': 'rd' };

regView('sourcing', {
  template: `
  <div>
    <div class="page-head">
      <h1>智能寻源与决策支持</h1>
      <div class="desc">AI 寻源 Agent 在每次自动采集后从产业方向中寻找匹配的早期企业，逐家联网验证后入库；六维加权战略协同评分 + 四问投资逻辑（Why Now / Why Sector / Why Company / Why DLG）；所有推进动作由投资人员复核并留痕。</div>
    </div>
    <div class="tabs">
      <button :class="{on: tab==='gaps'}" @click="tab='gaps'">产业链缺口</button>
      <button :class="{on: tab==='pool'}" @click="tab='pool'">候选企业池</button>
    </div>

    <div v-if="tab==='gaps'" class="card">
      <div class="toolbar">
        <span class="muted">缺口是反向寻源的起点：先定义「集团缺什么」，再找「谁能补齐」。</span>
        <button class="btn pri" style="margin-left:auto" @click="openGap()">+ 登记缺口</button>
      </div>
      <div class="dir-card" v-for="g in gaps" :key="g.id">
        <div class="dir-top">
          <h3 style="font-size:14.5px">{{ g.segment }}</h3>
          <span class="tag pu">{{ g.direction_name }}</span>
          <span class="tag" :class="g.severity==='高' ? 'rd' : (g.severity==='中' ? 'am' : '')">缺口严重度：{{ g.severity }}</span>
          <span class="tag" :class="g.status==='开放' ? 'cy' : 'gr'">{{ g.status }}</span>
          <span class="tag">已寻源 {{ g.company_count }} 家</span>
          <span style="margin-left:auto"></span>
          <button class="btn sm" @click="goPool(g)">寻源企业 →</button>
          <button class="btn sm" @click="openGap(g)">编辑</button>
        </div>
        <p class="muted mt8">{{ g.description }}</p>
      </div>
    </div>

    <div v-if="tab==='pool'">
      <div class="card" style="padding:12px 16px;margin-bottom:12px">
        <div style="font-size:13px;font-weight:600">AI 寻源 Agent</div>
        <div class="muted mt8" style="font-size:12px;line-height:1.7">Agent 在每次自动采集与方向整理后自动运行：从采集信号中提取企业线索 → 结合行业知识提出早期企业假设 → 逐家联网验证真实性（两轮验证 + 反思迭代）→ 查有实证才入库，每家至少附 1 条可点击证据来源。准入口径：中国境内未上市，原则上 Pre-A / A / B 轮，特别优质可放宽至 C 轮；高质量标的不足时不凑数。</div>
        <div class="chips mt8" v-if="agentInfo && agentLogs.length">
          <span class="tag cy">AI 已寻源 {{ agentInfo.ai_companies }} 家</span>
          <span class="tag" v-for="l in agentLogs" :key="l.created_at + l.action">{{ l.action }}：{{ l.detail }}（{{ $fd(l.created_at) }}）</span>
        </div>
      </div>
      <div class="toolbar">
        <input class="input" v-model.trim="q.kw" placeholder="搜索企业名称 / 赛道 / 地区" @keyup.enter="load">
        <select class="input" v-model="q.status" @change="load"><option value="">全部状态</option><option v-for="(v,k) in stT" :key="k" :value="k">{{ k }}</option></select>
        <select class="input" v-model="q.synergy" @change="load"><option value="">全部协同性</option><option>高</option><option>中</option><option>弱/待验证</option></select>
        <select class="input" v-model="q.direction_id" @change="load"><option value="">全部方向</option><option v-for="d in dirs" :key="d.id" :value="d.id">{{ d.name }}</option></select>
        <select class="input" v-model="q.found_by" @change="load"><option value="">全部来源</option><option value="AI">AI 寻源</option><option value="人工">人工录入</option></select>
        <button class="btn" @click="load">筛选</button>
        <button class="btn" v-if="isAdmin" @click="runAgent" :disabled="agentRunning">{{ agentRunning ? 'Agent 寻源中…' : '⚡ 立即寻源' }}</button>
        <button class="btn pri" @click="openAdd">+ 录入候选企业</button>
        <span class="cnt">{{ list.length }} 家</span>
      </div>
      <div class="com-grid">
        <div class="com-card" v-for="c in list" :key="c.id" @click="openCom(c)">
          <div class="row1">
            <b>{{ c.name }}</b>
            <span class="tag pu" v-if="c.found_by==='AI'">AI 寻源</span>
            <span class="tag" :class="COM_ST[c.status]">{{ c.status }}</span>
            <span class="tag" :class="SYN_T[c.synergy_level]">协同{{ c.synergy_level }}</span>
            <span class="score" :style="{color: scoreColor(c.total_score)}">{{ c.total_score ?? '—' }}<small> /100</small></span>
          </div>
          <div class="desc">{{ c.description }}</div>
          <div class="meta">
            <span class="tag">{{ c.track }}</span><span class="tag">{{ c.region }}</span><span class="tag am">{{ c.round }}</span>
            <span class="tag" v-if="c.direction_name" style="color:#4338ca;border-color:#c7d2fe">{{ c.direction_name }}</span>
            <span class="tag" v-if="c.gap_segment">缺口：{{ c.gap_segment }}</span>
            <span class="muted" v-if="c.week_label">{{ c.week_label }}进入候选池</span>
          </div>
          <div class="meta" v-if="evOf(c).length">
            <a class="tag cy" :href="evOf(c)[0].url" target="_blank" rel="noopener" @click.stop style="text-decoration:none">证据：{{ evOf(c)[0].title || '来源链接' }} ↗</a>
            <span class="muted" v-if="evOf(c).length > 1">等 {{ evOf(c).length }} 条证据</span>
          </div>
        </div>
      </div>
      <div class="empty" v-if="!list.length"><span class="ico">▤</span>暂无候选企业，等待 AI 寻源或人工录入</div>
    </div>

    <!-- 缺口模态 -->
    <div class="modal-mask" v-if="modal" @click.self="modal=null">
      <div class="modal">
        <h3>{{ modal.title }}</h3>
        <template v-if="modal.kind==='gap'">
          <label class="fl">所属方向 <b>*</b></label>
          <select class="input" v-model="m.direction_id"><option v-for="d in dirs" :key="d.id" :value="d.id">{{ d.name }}</option></select>
          <label class="fl">缺口环节 <b>*</b></label><input class="input" v-model.trim="m.segment">
          <label class="fl">缺口描述（集团缺什么 / 为什么需要外部补齐）</label><textarea class="input" v-model="m.description"></textarea>
          <div class="grid2">
            <div><label class="fl">严重度</label><select class="input" v-model="m.severity"><option>高</option><option>中</option><option>低</option></select></div>
            <div><label class="fl">状态</label><select class="input" v-model="m.status"><option>开放</option><option>已覆盖</option></select></div>
          </div>
        </template>
        <template v-if="modal.kind==='com'">
          <label class="fl">企业名称 <b>*</b></label><input class="input" v-model.trim="m.name">
          <label class="fl">工商全称</label><input class="input" v-model.trim="m.full_name">
          <div class="grid2">
            <div><label class="fl">赛道</label><input class="input" v-model.trim="m.track"></div>
            <div><label class="fl">地区</label><input class="input" v-model.trim="m.region"></div>
          </div>
          <div class="grid2">
            <div><label class="fl">融资轮次</label><select class="input" v-model="m.round"><option>Pre-A</option><option>A轮</option><option>B轮</option><option>C轮</option><option>待核实</option></select></div>
            <div><label class="fl">成立年份</label><input class="input" type="number" v-model.number="m.founded_year"></div>
          </div>
          <label class="fl">对应产业链缺口</label>
          <select class="input" v-model="m.gap_id"><option :value="null">无</option><option v-for="g in gaps" :key="g.id" :value="g.id">{{ g.segment }}（{{ g.direction_name }}）</option></select>
          <div class="grid2">
            <div><label class="fl">战略协同评级</label><select class="input" v-model="m.synergy_level"><option>高</option><option>中</option><option>弱/待验证</option></select></div>
            <div><label class="fl">进入候选池周次</label><input class="input" v-model.trim="m.week_label" placeholder="如：第 3 周"></div>
          </div>
          <label class="fl">企业简介</label><textarea class="input" v-model="m.description"></textarea>
          <div class="grid2">
            <div><label class="fl">官网</label><input class="input" v-model.trim="m.website"></div>
            <div><label class="fl">信息来源</label><input class="input" v-model.trim="m.source"></div>
          </div>
        </template>
        <div class="modal-foot">
          <button class="btn" @click="modal=null">取消</button>
          <button class="btn pri" @click="save" :disabled="saving">保存</button>
        </div>
      </div>
    </div>

    <!-- 企业详情抽屉 -->
    <template v-if="com">
      <div class="drawer-mask" @click="com=null"></div>
      <aside class="drawer">
        <div class="drawer-h">
          <div>
            <h2>{{ com.name }} <span class="tag" :class="COM_ST[com.status]" style="vertical-align:2px">{{ com.status }}</span></h2>
            <div class="sub">{{ com.full_name }} · {{ com.track }} · {{ com.region }} · {{ com.round }}<span v-if="com.founded_year"> · {{ com.founded_year }} 年成立</span></div>
          </div>
          <button class="drawer-x" @click="com=null">✕</button>
        </div>
        <div class="drawer-b">
          <div class="card">
            <div class="card-head"><h2>企业概况</h2><span class="sub" v-if="com.direction_name">所属方向：{{ com.direction_name }}</span></div>
            <p class="muted">{{ com.description }}</p>
            <div class="chips mt8">
              <span class="tag pu" v-if="com.found_by==='AI'">AI 寻源入库</span>
              <span class="tag" v-if="com.gap_segment">对应缺口：{{ com.gap_segment }}</span>
              <span class="tag">协同评级：{{ com.synergy_level }}</span>
              <span class="tag" v-if="com.website">官网：<a :href="com.website" target="_blank" rel="noopener">{{ com.website }}</a></span>
              <span class="tag" v-if="com.source">来源：{{ com.source }}</span>
            </div>
            <div class="chips mt8" v-if="comEvidence.length">
              <a class="tag cy" v-for="(e,i) in comEvidence" :key="i" :href="e.url" target="_blank" rel="noopener" style="text-decoration:none">证据：{{ e.title || e.url }} ↗</a>
            </div>
            <div class="flex mt14">
              <button class="btn gr sm" @click="review('继续研究')">✓ 继续研究</button>
              <button class="btn sm" @click="review('暂缓')">暂 缓</button>
              <button class="btn danger sm" @click="review('排除')">✕ 排除</button>
              <button class="btn sm" @click="review('重置为候选')">重置为候选</button>
            </div>
          </div>

          <div class="grid2">
            <div class="card">
                <div class="card-head"><h2>战略协同评分</h2><span class="end score" style="font-size:22px;font-weight:800" :style="{color: scoreColor(detail.company.total_score)}">{{ detail.company.total_score ?? '—' }}<small style="font-size:11px;color:var(--tx3)"> /100 加权</small></span></div>
                <div id="fqRadar" v-if="detail.dimensions && detail.dimensions.length" class="chart-box" style="height:240px"></div>
                <div v-else class="muted" style="padding:12px 0;font-size:12px">暂无评分维度配置，请联系管理员在后台恢复六维评分体系。</div>
            </div>
            <div class="card">
              <div class="card-head"><h2>维度评分</h2><button class="btn sm end" @click="editScores">调整评分</button></div>
              <div class="cap-row" v-for="d in detail.dimensions" :key="d.id">
                <span class="nm dim-tip">{{ d.name }} <span class="muted">{{ d.weight }}%</span><i class="tip-ico">ⓘ</i>
                  <span class="tip-bubble">{{ sd(d.id).rationale || '暂无评分依据' }}</span>
                </span>
                <b class="mono" style="width:34px;text-align:right" :style="{color: scoreColor(sd(d.id).score)}">{{ sd(d.id).score ?? '—' }}</b>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-head">
              <h2>四问投资逻辑</h2>
              <span class="tag" v-if="detail.four_questions" :class="detail.four_questions.status==='AI生成+人工确认' ? 'gr' : 'am'">{{ detail.four_questions.status }}</span>
              <span class="end">
                <button class="btn sm" @click="genFQ" :disabled="genning">{{ genning ? 'AI 生成中…' : '⟳ AI 生成 / 重生成' }}</button>
                <button class="btn sm pri" @click="editFQ" v-if="detail.four_questions">人工编辑确认</button>
              </span>
            </div>
            <p class="muted mb14" style="font-size:12px">四问框架：Why Now（为什么是现在）· Why Sector（为什么是这个赛道）· Why Company（为什么是这家公司）· Why DLG（为什么是东浩兰生来投）。AI 基于信号、方向与评分自动合成，人工确认后进入决策支持。</p>
            <template v-if="detail.four_questions">
              <div class="fq-block"><div class="q"><span class="qn">WHY NOW</span>为什么是现在</div><p>{{ detail.four_questions.why_now }}</p></div>
              <div class="fq-block"><div class="q"><span class="qn">WHY SECTOR</span>为什么是这个赛道</div><p>{{ detail.four_questions.why_sector }}</p></div>
              <div class="fq-block"><div class="q"><span class="qn">WHY COMPANY</span>为什么是这家公司</div><p>{{ detail.four_questions.why_company }}</p></div>
              <div class="fq-block"><div class="q"><span class="qn">WHY DLG</span>为什么是东浩兰生来投</div><p>{{ detail.four_questions.why_dlg }}</p></div>
              <div class="chips" v-if="fqSources.length"><a class="tag cy" v-for="(s,i) in fqSources" :key="i" :href="s.url" target="_blank" rel="noopener" style="text-decoration:none">来源：{{ s.title || s.url }} ↗</a></div>
            </template>
            <div class="empty" v-else><span class="ico">◌</span>尚未生成四问逻辑，点击右上角「AI 生成」</div>
          </div>

          <div class="card">
            <div class="card-head"><h2>复核留痕</h2><button class="btn sm end" @click="review('备注')">+ 添加备注</button></div>
            <div class="cap-row" v-for="l in detail.logs" :key="l.id">
              <span class="tag" :class="l.action.indexOf('继续') > -1 ? 'gr' : (l.action.indexOf('排除') > -1 ? 'rd' : 'am')" style="flex:none;width:110px;justify-content:center">{{ l.action }}</span>
              <span class="ds" style="color:var(--tx2);white-space:normal">{{ l.note || '—' }}</span>
              <span class="muted" style="flex:none">{{ l.display_name }} · {{ $fd(l.created_at) }}</span>
            </div>
            <div class="empty" v-if="!detail.logs.length">暂无复核记录</div>
          </div>
        </div>
      </aside>
    </template>

    <!-- 评分编辑模态 -->
    <div class="modal-mask" v-if="scoreModal" @click.self="scoreModal=false">
      <div class="modal" style="width:min(680px,94vw)">
        <h3>调整「{{ com.name }}」六维评分</h3>
        <div v-for="d in scoreForm" :key="d.dimension_id" style="margin-bottom:10px">
          <label class="fl" style="margin-top:4px">{{ d.name }}（权重 {{ d.weight }}%）· 当前 <b class="mono">{{ d.score }}</b> 分</label>
          <input class="input" type="number" min="0" max="100" v-model.number="d.score" style="width:110px;display:inline-block">
          <input class="input" v-model="d.rationale" placeholder="评分依据（将作为四问与复盘依据）" style="display:inline-block;width:calc(100% - 125px);margin-left:10px">
        </div>
        <div class="modal-foot">
          <button class="btn" @click="scoreModal=false">取消</button>
          <button class="btn pri" @click="saveScores">保存评分</button>
        </div>
      </div>
    </div>

    <!-- 四问编辑模态 -->
    <div class="modal-mask" v-if="fqModal" @click.self="fqModal=false">
      <div class="modal" style="width:min(760px,94vw)">
        <h3>人工编辑四问投资逻辑（保存后标记为「AI生成+人工确认」）</h3>
        <label class="fl">Why Now · 为什么是现在</label><textarea class="input" v-model="fqForm.why_now" style="min-height:90px"></textarea>
        <label class="fl">Why Sector · 为什么是这个赛道</label><textarea class="input" v-model="fqForm.why_sector" style="min-height:90px"></textarea>
        <label class="fl">Why Company · 为什么是这家公司</label><textarea class="input" v-model="fqForm.why_company" style="min-height:90px"></textarea>
        <label class="fl">Why DLG · 为什么是东浩兰生来投</label><textarea class="input" v-model="fqForm.why_dlg" style="min-height:90px"></textarea>
        <label class="fl">信息来源（逗号分隔，用于可追溯）</label><input class="input" v-model="fqForm.sourcesText">
        <div class="modal-foot">
          <button class="btn" @click="fqModal=false">取消</button>
          <button class="btn pri" @click="saveFQ">确认保存</button>
        </div>
      </div>
    </div>
  </div>
  `,
  data() { return { tab: 'gaps', gaps: [], dirs: [], list: [], q: { kw: '', status: '', synergy: '', gap_id: '', direction_id: '', found_by: '' }, agentInfo: null, agentRunning: false, modal: null, m: {}, saving: false, com: null, detail: { company: {}, logs: [], dimensions: [], four_questions: null }, genning: false, scoreModal: false, scoreForm: [], fqModal: false, fqForm: {}, SYN_T, COM_ST, stT: COM_ST }; },
  computed: {
    fqSources() {
      const s = this.detail.four_questions && this.detail.four_questions.sources;
      if (!s) return [];
      let arr = Array.isArray(s) ? s : (() => { try { return JSON.parse(s) || []; } catch (e) { return []; } })();
      /* 归一化为 {title,url}：兼容历史纯字符串 URL 与 Agent 写入的对象 */
      return (arr || []).map(x => (x && typeof x === 'object') ? { title: x.title || '', url: x.url || '' } : { title: String(x), url: String(x) });
    },
    comEvidence() { const e = this.com && this.com.evidence; return Array.isArray(e) ? e : []; },
    agentLogs() { return ((this.agentInfo || {}).logs || []).slice(0, 3); },
    isAdmin() { return this.$root.user && this.$root.user.role === 'admin'; }
  },
  async mounted() { await this.loadGaps(); this.load(); this.loadAgent(); },
  methods: {
    scoreColor(v) { return v == null ? 'var(--tx3)' : v >= 80 ? 'var(--gr)' : v >= 65 ? 'var(--am)' : 'var(--rd)'; },
    sd(dimId) { return (this.detail.company.score_detail || {})[dimId] || {}; },
    evOf(c) { return Array.isArray(c.evidence) ? c.evidence : []; },
    async loadGaps() {
      this.gaps = await this.$api.get('/api/sourcing/gaps');
      this.dirs = await this.$api.get('/api/radar/directions');
    },
    async loadAgent() { try { this.agentInfo = await this.$api.get('/api/sourcing/agent/last'); } catch (e) { /* 静默 */ } },
    async runAgent() {
      if (!confirm('启动 AI 寻源 Agent？将在后台为热度最高的产业方向寻源（两轮验证，约需几分钟），完成后自动入库。')) return;
      this.agentRunning = true;
      try {
        await this.$api.post('/api/sourcing/agent/run');
        this.$toast('Agent 已在后台启动寻源，几分钟后刷新本页查看结果');
        setTimeout(() => { this.agentRunning = false; this.loadAgent(); this.load(); }, 90000);
      } catch (e) { this.agentRunning = false; this.$toast(e.message); }
    },
    async load() {
      const p = new URLSearchParams();
      for (const k of ['kw', 'status', 'synergy', 'gap_id', 'direction_id', 'found_by']) if (this.q[k]) p.set(k, this.q[k]);
      this.list = await this.$api.get('/api/sourcing/companies?' + p.toString());
    },
    goPool(g) { this.tab = 'pool'; this.q.gap_id = g.id; this.load(); },
    openGap(g) { this.modal = { kind: 'gap', title: g ? '编辑缺口' : '登记产业链缺口', m: g ? { ...g } : { direction_id: (this.dirs[0] || {}).id, segment: '', description: '', severity: '中', status: '开放' } }; },
    openAdd() { this.modal = { kind: 'com', title: '录入候选企业', m: { name: '', full_name: '', track: '', region: '上海', round: 'A轮', founded_year: 2023, gap_id: null, synergy_level: '弱/待验证', week_label: '', description: '', website: '', source: '' } }; },
    async save() {
      const { kind, m } = this.modal;
      this.saving = true;
      try {
        if (kind === 'gap') {
          if (!m.segment) throw new Error('请填写缺口环节');
          if (m.id) await this.$api.put('/api/sourcing/gaps/' + m.id, m); else await this.$api.post('/api/sourcing/gaps', m);
          await this.loadGaps();
        } else {
          if (!m.name) throw new Error('请填写企业名称');
          if (m.id) await this.$api.put('/api/sourcing/companies/' + m.id, m); else await this.$api.post('/api/sourcing/companies', m);
          await this.load();
        }
        this.modal = null; this.$toast('已保存');
      } catch (e) { this.$toast(e.message); } finally { this.saving = false; }
    },
    async openCom(c) {
      try {
        this.detail = await this.$api.get('/api/sourcing/companies/' + c.id);
        this.com = this.detail.company;
        this.$nextTick(() => this.drawRadar());
      } catch (e) { this.$toast('打开企业详情失败：' + e.message); }
    },
    drawRadar() {
      const el = document.getElementById('fqRadar');
      if (!el || !window.echarts) return;
      const dims = this.detail.dimensions || [];
      if (!dims.length) return;
      if (this._chart) this._chart.dispose();
      this._chart = echarts.init(el);
      this._chart.setOption({
        backgroundColor: 'transparent',
        radar: {
          indicator: dims.map(d => ({ name: d.name + ' ' + d.weight + '%', max: 100 })),
          radius: '68%',
          splitArea: { areaStyle: { color: ['rgba(37,99,235,.03)', 'rgba(37,99,235,.06)'] } },
          axisLine: { lineStyle: { color: '#e2e8f0' } },
          splitLine: { lineStyle: { color: '#e8edf5' } },
          axisName: { color: '#64748b', fontSize: 10 }
        },
        series: [{
          type: 'radar',
          data: [{
            value: dims.map(d => (this.detail.company.score_detail || {})[d.id]?.score ?? 0),
            name: this.com.name,
            areaStyle: { color: 'rgba(37,99,235,.18)' },
            lineStyle: { color: '#2563eb', width: 2 },
            itemStyle: { color: '#2563eb' }
          }],
          symbolSize: 4
        }]
      });
    },
    async review(action) {
      const needNote = action !== '重置为候选';
      let note = '';
      if (needNote) { note = prompt((action === '备注' ? '复核备注' : '将企业标记为「' + action + '」') + '，请填写说明（留痕）：', '') ?? ''; if (note === '' && action !== '备注') return this.$toast('请填写标记说明以留痕'); }
      try {
        await this.$api.post('/api/sourcing/companies/' + this.com.id + '/review', { action, note });
        this.$toast('已记录'); this.com = null; await this.load();
      } catch (e) { this.$toast(e.message); }
    },
    editScores() {
      const det = this.detail.company.score_detail || {};
      this.scoreForm = this.detail.dimensions.map(d => ({ dimension_id: d.id, name: d.name, weight: d.weight, score: det[d.id]?.score ?? 60, rationale: det[d.id]?.rationale || '' }));
      this.scoreModal = true;
    },
    async saveScores() {
      try {
        await this.$api.put('/api/sourcing/companies/' + this.com.id + '/scores', { scores: this.scoreForm.map(x => ({ dimension_id: x.dimension_id, score: x.score, rationale: x.rationale })) });
        this.scoreModal = false; this.$toast('评分已更新');
        const c = this.com; this.com = null; this.openCom(c); this.load();
      } catch (e) { this.$toast(e.message); }
    },
    async genFQ() {
      this.genning = true;
      try {
        this.detail.four_questions = await this.$api.post('/api/sourcing/four-questions/' + this.com.id + '/generate');
        this.$toast('AI 已生成四问逻辑初稿，请人工确认');
      } catch (e) { this.$toast(e.message); } finally { this.genning = false; }
    },
    editFQ() {
      const fq = this.detail.four_questions || {};
      this.fqForm = {
        why_now: fq.why_now || '', why_sector: fq.why_sector || '', why_company: fq.why_company || '', why_dlg: fq.why_dlg || '',
        sourcesText: (this.fqSources || []).map(x => x.url).join(',')
      };
      this.fqModal = true;
    },
    async saveFQ() {
      try {
        await this.$api.put('/api/sourcing/four-questions/' + this.com.id, { ...this.fqForm, sources: this.fqForm.sourcesText.split(',').map(x => x.trim()).filter(Boolean) });
        this.fqModal = false; this.$toast('已确认，状态更新为「AI生成+人工确认」');
        const c = this.com; this.com = null; this.openCom(c);
      } catch (e) { this.$toast(e.message); }
    }
  }
});
