/* 视图注册：总览 + 知识大脑 */
window.VIEWS = {};
window.regView = (name, comp) => window.VIEWS[name] = comp;

/* ================= 总览看板 ================= */
regView('overview', {
  template: `
  <div>
    <div class="page-head">
      <h1>战略投资指挥中心</h1>
      <div class="desc">「1 个战略知识大脑 + 多维产业雷达 + 智能寻源与决策 Agent」全景工作台。AI 仅承担机会发现、寻源与初步分析，所有判断由投资人员人工复核。</div>
    </div>
    <div class="kpi-grid" v-if="kpi">
      <div class="kpi" style="--k:#2563eb"><div class="k-v">{{kpi.directions}}<small>个</small></div><div class="k-n">跟踪产业方向</div></div>
      <div class="kpi" style="--k:#0891b2"><div class="k-v">{{kpi.signals_week}}<small>条</small></div><div class="k-n">近 7 日有效信号</div></div>
      <div class="kpi" style="--k:#10b981"><div class="k-v">{{kpi.snr}}<small>%</small></div><div class="k-n">信号信噪比</div></div>
      <div class="kpi" style="--k:#f59e0b"><div class="k-v">{{kpi.companies_candidate}}<small>家</small></div><div class="k-n">候选池待复核</div></div>
      <div class="kpi" style="--k:#8b5cf6"><div class="k-v">{{kpi.companies_continue}}<small>家</small></div><div class="k-n">继续研究（进入尽调）</div></div>
      <div class="kpi" style="--k:#ec4899"><div class="k-v">{{kpi.gaps_open}}<small>个</small></div><div class="k-n">开放产业链缺口</div></div>
    </div>

    <div class="grid2">
      <div class="card" style="margin-bottom:16px">
        <div class="card-head"><h2>情报雷达</h2><span class="sub">{{ latest ? latest.week_label + ' · ' + latest.status : '暂无周报' }}</span></div>
        <div class="radar-wrap">
          <div class="radar-disc"><div class="radar-sweep"></div>
            <span class="radar-blip" style="left:22%;top:30%"></span>
            <span class="radar-blip cy" style="left:64%;top:24%"></span>
            <span class="radar-blip gr" style="left:70%;top:62%"></span>
            <span class="radar-blip" style="left:38%;top:70%"></span>
            <span class="radar-blip cy" style="left:47%;top:44%"></span>
          </div>
          <div class="radar-center"><div>
            <b class="mono">{{ kpi ? kpi.scanned_total.toLocaleString() : '—' }}</b>
            <div><span>累计扫描公开信息</span></div>
          </div></div>
        </div>
        <div class="flex mt14" style="justify-content:center">
          <button class="btn sm" @click="$go('reports')">查看情报周报</button>
          <button class="btn sm" @click="$go('radar')">进入弱信号流</button>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h2>热门产业方向</h2><button class="btn sm end" @click="$go('radar')">管理方向 →</button></div>
        <div v-for="d in topDirs" :key="d.id" class="cap-row">
          <span class="nm">{{ d.name }}</span>
          <span class="ds">{{ d.sub }}</span>
          <div class="heat" style="margin-left:auto"><div class="progress flame"><i :style="{width: d.heat + '%'}"></i></div><b class="mono" style="font-size:13px">{{ d.heat }}</b></div>
        </div>
        <div class="empty" v-if="!topDirs.length">暂无跟踪方向</div>
        <div class="card-head mt14"><h2>高协同潜力企业</h2><button class="btn sm end" @click="$go('sourcing')">查看 →</button></div>
        <div v-for="c in highSyn" :key="c.id" class="cap-row">
          <span class="nm">{{ c.name }}</span>
          <span class="ds">{{ c.track }} · {{ c.round }}</span>
          <span class="tag cy" style="margin-left:auto">协同高</span>
        </div>
        <div class="empty" v-if="!highSyn.length">暂无高协同企业</div>
      </div>
    </div>

    <div class="grid2">
      <div class="card">
        <div class="card-head"><h2>系统动态</h2><span class="sub">全流程操作留痕</span></div>
        <div v-for="a in acts" :key="a.id" class="cap-row">
          <span class="tag cy" style="flex:none">{{ a.module }}</span>
          <span class="ds" style="color:var(--tx2)">{{ a.display_name || '系统' }} · {{ a.action }} — {{ a.detail }}</span>
          <span class="muted" style="flex:none">{{ $fd(a.created_at) }}</span>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h2>本期边界（红线）</h2></div>
        <div class="notice rd mb14"><b>红线校验：</b>自动作出正式投资决策 <b>0</b> 次 · 自动联系企业 <b>0</b> 次 · 自动生成确定性投资结论 <b>0</b> 次。系统不替代投资人员专业判断与国资投资决策流程。</div>
        <ol class="steps">
          <li>多源公开信息采集（政策 / 融资 / 技术 / 招聘 / 专利 / 资本）</li>
          <li>弱信号识别：去重、强度与置信度打分，低置信自动转参考</li>
          <li>方向沉淀：Why Now / 与集团关联 / 风险提示</li>
          <li>周报生成：每周《战略投资机会雷达》</li>
          <li>围绕产业链缺口反向寻源，生成候选企业池</li>
          <li>战略协同评分（六维加权）+ 四问投资逻辑生成</li>
          <li>投资人员复核：继续研究 / 暂缓 / 排除，全程留痕</li>
          <li>知识资产沉淀：研究、复盘与方法论入库</li>
        </ol>
      </div>
    </div>
  </div>
  `,
  data() { return { kpi: null, latest: null, topDirs: [], highSyn: [], acts: [] }; },
  async mounted() {
    const d = await this.$api.get('/api/misc/dashboard');
    this.kpi = d.kpi; this.latest = d.latest_report;
    this.topDirs = d.top_directions; this.highSyn = d.high_synergy; this.acts = d.activities;
  }
});

/* ================= 知识大脑 ================= */
regView('brain', {
  template: `
  <div>
    <div class="page-head">
      <h1>战略知识大脑</h1>
      <div class="desc">将集团主业布局与资源要素结构化为能力图谱，定义投资边界与战略协同评分维度 —— 这是产业雷达与寻源评分的「底座」。</div>
    </div>
    <div class="tabs">
      <button :class="{on: tab==='graph'}" @click="tab='graph'">能力图谱</button>
      <button :class="{on: tab==='boundary'}" @click="tab='boundary'">投资边界</button>
      <button :class="{on: tab==='dims'}" @click="tab='dims'">评分维度</button>
    </div>

    <div v-if="tab==='graph'">
      <div class="toolbar">
        <span class="muted">业务板块与能力要素，星级表示能力强度（1—5）。图谱用于战略协同评分的依据。</span>
        <button v-if="isAdmin" class="btn pri sm" style="margin-left:auto" @click="openUnit()">+ 新增板块</button>
      </div>
      <div class="grid2">
        <div class="unit-card" v-for="u in units" :key="u.id">
          <h3>{{ u.name }} <span class="tag" :class="u.type==='主业板块' ? 'cy' : 'pu'">{{ u.type }}</span>
            <span class="end" v-if="isAdmin">
              <button class="btn sm" @click="openUnit(u)">编辑</button>
              <button class="btn sm" @click="openCap(u)">+ 能力</button>
              <button class="btn sm danger" @click="delUnit(u)">删除</button>
            </span>
          </h3>
          <p class="muted mt8">{{ u.description }}</p>
          <div class="mt8">
            <div class="cap-row" v-for="c in u.caps" :key="c.id">
              <span class="nm">{{ c.name }}</span>
              <span class="ds" :title="c.description">{{ c.category }} · {{ c.description }}</span>
              <span class="stars"><span v-for="i in 5" :key="i" :class="{off: i > c.strength}">★</span></span>
              <span v-if="isAdmin"><button class="btn sm" @click="openCap(u, c)">改</button><button class="btn sm danger" @click="delCap(c)">删</button></span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="tab==='boundary'" class="card">
      <div class="toolbar">
        <span class="muted">规则化的筛选边界，AI 寻源时严格执行。</span>
        <button v-if="isAdmin" class="btn pri sm" style="margin-left:auto" @click="openBnd()">+ 新增边界</button>
      </div>
      <table class="table">
        <thead><tr><th style="width:110px">类型</th><th>内容</th><th v-if="isAdmin" style="width:120px">操作</th></tr></thead>
        <tbody>
          <tr v-for="b in bounds" :key="b.id">
            <td><span class="tag am">{{ b.rule_type }}</span></td>
            <td>{{ b.content }}</td>
            <td v-if="isAdmin"><button class="btn sm" @click="openBnd(b)">编辑</button> <button class="btn sm danger" @click="delBnd(b)">删除</button></td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="tab==='dims'" class="card">
      <div class="toolbar">
        <span class="muted">战略协同评分维度与权重（当前合计 <b class="mono" :style="wSum===100 ? 'color:var(--gr)' : 'color:var(--rd)'">{{ wSum }}</b> 分，建议恒为 100）。</span>
        <button v-if="isAdmin" class="btn pri sm" style="margin-left:auto" @click="openDim()">+ 新增维度</button>
      </div>
      <table class="table">
        <thead><tr><th>维度</th><th>说明</th><th style="width:110px">权重</th><th style="width:80px">启用</th><th v-if="isAdmin" style="width:120px">操作</th></tr></thead>
        <tbody>
          <tr v-for="d in dims" :key="d.id">
            <td><b>{{ d.name }}</b></td>
            <td class="muted">{{ d.description }}</td>
            <td class="mono">{{ d.weight }}</td>
            <td><span class="tag" :class="d.enabled ? 'gr' : 'rd'">{{ d.enabled ? '启用' : '停用' }}</span></td>
            <td v-if="isAdmin"><button class="btn sm" @click="openDim(d)">编辑</button> <button class="btn sm danger" @click="delDim(d)">删除</button></td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 板块/能力 模态 -->
    <div class="modal-mask" v-if="modal" @click.self="modal=null">
      <div class="modal">
        <h3>{{ modal.title }}</h3>
        <template v-if="modal.kind==='unit'">
          <label class="fl">板块名称 <b>*</b></label><input class="input" v-model.trim="modal.f.name">
          <label class="fl">类型</label>
          <select class="input" v-model="modal.f.type"><option>主业板块</option><option>资源要素</option></select>
          <label class="fl">描述</label><textarea class="input" v-model="modal.f.description"></textarea>
        </template>
        <template v-if="modal.kind==='cap'">
          <label class="fl">能力名称 <b>*</b></label><input class="input" v-model.trim="modal.f.name">
          <label class="fl">类别</label><input class="input" v-model.trim="modal.f.category" placeholder="如：交付网络 / 数据资产 / 渠道">
          <label class="fl">描述</label><textarea class="input" v-model="modal.f.description"></textarea>
          <label class="fl">能力强度：{{ modal.f.strength }} 星</label>
          <input type="range" min="1" max="5" v-model.number="modal.f.strength" style="width:100%">
        </template>
        <template v-if="modal.kind==='bnd'">
          <label class="fl">规则类型</label>
          <select class="input" v-model="modal.f.rule_type"><option>轮次</option><option>地域</option><option>赛道偏好</option><option>负面清单</option></select>
          <label class="fl">内容 <b>*</b></label><textarea class="input" v-model="modal.f.content"></textarea>
        </template>
        <template v-if="modal.kind==='dim'">
          <label class="fl">维度名称 <b>*</b></label><input class="input" v-model.trim="modal.f.name">
          <label class="fl">说明</label><input class="input" v-model="modal.f.description">
          <label class="fl">权重（0—100）</label><input class="input" type="number" v-model.number="modal.f.weight">
          <label class="fl" v-if="modal.f.id">启用</label>
          <select class="input" v-if="modal.f.id" v-model="modal.f.enabled"><option :value="1">启用</option><option :value="0">停用</option></select>
        </template>
        <div class="modal-foot">
          <button class="btn" @click="modal=null">取消</button>
          <button class="btn pri" @click="saveModal" :disabled="saving">保存</button>
        </div>
      </div>
    </div>
  </div>
  `,
  data() { return { tab: 'graph', units: [], bounds: [], dims: [], modal: null, saving: false }; },
  computed: {
    isAdmin() { return this.$root.user && this.$root.user.role === 'admin'; },
    wSum() { return this.dims.filter(d => d.enabled).reduce((s, d) => s + Number(d.weight), 0); }
  },
  async mounted() { await this.load(); },
  methods: {
    async load() {
      this.units = await this.$api.get('/api/brain/units');
      this.bounds = await this.$api.get('/api/brain/boundaries');
      this.dims = await this.$api.get('/api/brain/dimensions');
    },
    openUnit(u) { this.modal = { kind: 'unit', title: u ? '编辑板块' : '新增板块', f: u ? { id: u.id, name: u.name, type: u.type, description: u.description } : { name: '', type: '主业板块', description: '' } }; },
    openCap(u, c) { this.modal = { kind: 'cap', title: c ? '编辑能力' : '新增能力 · ' + u.name, unit: u, f: c ? { id: c.id, name: c.name, category: c.category, description: c.description, strength: c.strength } : { name: '', category: '', description: '', strength: 3 } }; },
    openBnd(b) { this.modal = { kind: 'bnd', title: b ? '编辑边界' : '新增边界', f: b ? { id: b.id, rule_type: b.rule_type, content: b.content } : { rule_type: '轮次', content: '' } }; },
    openDim(d) { this.modal = { kind: 'dim', title: d ? '编辑维度' : '新增维度', f: d ? { id: d.id, name: d.name, description: d.description, weight: Number(d.weight), enabled: d.enabled } : { name: '', description: '', weight: 10 } }; },
    async saveModal() {
      const m = this.modal; if (!m) return;
      if ((m.kind === 'unit' || m.kind === 'cap' || m.kind === 'dim') && !m.f.name) return this.$toast('请填写名称');
      if (m.kind === 'bnd' && !m.f.content) return this.$toast('请填写内容');
      this.saving = true;
      try {
        if (m.kind === 'unit') m.f.id ? await this.$api.put('/api/brain/units/' + m.f.id, m.f) : await this.$api.post('/api/brain/units', m.f);
        if (m.kind === 'cap') m.f.id ? await this.$api.put('/api/brain/caps/' + m.f.id, m.f) : await this.$api.post('/api/brain/caps', { ...m.f, unit_id: m.unit.id });
        if (m.kind === 'bnd') m.f.id ? await this.$api.put('/api/brain/boundaries/' + m.f.id, m.f) : await this.$api.post('/api/brain/boundaries', m.f);
        if (m.kind === 'dim') m.f.id ? await this.$api.put('/api/brain/dimensions/' + m.f.id, m.f) : await this.$api.post('/api/brain/dimensions', m.f);
        this.$toast('已保存'); this.modal = null; await this.load();
      } catch (e) { this.$toast(e.message); } finally { this.saving = false; }
    },
    async delUnit(u) { if (!confirm('删除板块「' + u.name + '」及其全部能力要素？')) return; await this.$api.del('/api/brain/units/' + u.id); this.$toast('已删除'); this.load(); },
    async delCap(c) { if (!confirm('删除能力「' + c.name + '」？')) return; await this.$api.del('/api/brain/caps/' + c.id); this.load(); },
    async delBnd(b) { if (!confirm('删除该边界规则？')) return; await this.$api.del('/api/brain/boundaries/' + b.id); this.load(); },
    async delDim(d) { if (!confirm('删除维度「' + d.name + '」？企业历史评分将失去该维度。')) return; await this.$api.del('/api/brain/dimensions/' + d.id); this.load(); }
  }
});
