/* 视图注册：知识资产、异常与边界、验收看板、系统管理 */

/* ================= 知识资产 ================= */
regView('knowledge', {
  template: `
  <div>
    <div class="page-head">
      <h1>投资知识资产</h1>
      <div class="desc">沉淀产业研究、历史项目复盘与方法论，形成可复用的投资知识资产 —— 这是知识大脑持续进化的养料。</div>
    </div>
    <div class="toolbar">
      <select class="input" v-model="type" @change="load" style="width:150px">
        <option value="">全部类型</option><option>产业研究</option><option>历史项目</option><option>方法论</option>
      </select>
      <span class="cnt">{{ list.length }} 篇</span>
      <button class="btn pri" style="margin-left:auto" @click="open()">+ 沉淀知识</button>
    </div>
    <div class="grid2">
      <div class="card" style="margin:0" v-for="k in list" :key="k.id">
        <div class="card-head">
          <h2 style="font-size:14.5px">{{ k.title }}</h2>
          <span class="tag" :class="k.type==='产业研究' ? 'cy' : (k.type==='历史项目' ? 'am' : 'gr')">{{ k.type }}</span>
          <span class="end muted">{{ k.created_by }} · {{ $fd(k.created_at) }}</span>
        </div>
        <p class="muted" style="white-space:pre-wrap">{{ k.content }}</p>
        <div class="chips mt8"><span class="tag pu" v-for="t in k.tags" :key="t">{{ t }}</span></div>
        <div class="flex mt8"><span style="margin-left:auto"></span><button class="btn sm" @click="open(k)">编辑</button><button class="btn sm danger" @click="del(k)">删除</button></div>
      </div>
    </div>
    <div class="empty" v-if="!list.length"><span class="ico">◌</span>暂无知识条目</div>

    <div class="modal-mask" v-if="modal" @click.self="modal=false">
      <div class="modal" style="width:min(680px,94vw)">
        <h3>{{ f.id ? '编辑知识' : '沉淀知识' }}</h3>
        <div class="grid2">
          <div><label class="fl">类型</label><select class="input" v-model="f.type"><option>产业研究</option><option>历史项目</option><option>方法论</option></select></div>
          <div><label class="fl">标签（逗号分隔）</label><input class="input" v-model.trim="f.tagsText"></div>
        </div>
        <label class="fl">标题 <b>*</b></label><input class="input" v-model.trim="f.title">
        <label class="fl">内容</label><textarea class="input" v-model="f.content" style="min-height:140px"></textarea>
        <div class="modal-foot">
          <button class="btn" @click="modal=false">取消</button>
          <button class="btn pri" @click="save">保存</button>
        </div>
      </div>
    </div>
  </div>
  `,
  data() { return { list: [], type: '', modal: false, f: {} }; },
  async mounted() { this.load(); },
  methods: {
    async load() { this.list = await this.$api.get('/api/misc/knowledge' + (this.type ? '?type=' + encodeURIComponent(this.type) : '')); },
    open(k) { this.f = k ? { ...k, tagsText: (k.tags || []).join(',') } : { type: '产业研究', title: '', content: '', tagsText: '' }; this.modal = true; },
    async save() {
      if (!this.f.title) return this.$toast('请填写标题');
      const body = { type: this.f.type, title: this.f.title, content: this.f.content, tags: this.f.tagsText.split(',').map(x => x.trim()).filter(Boolean) };
      try {
        if (this.f.id) await this.$api.put('/api/misc/knowledge/' + this.f.id, body);
        else await this.$api.post('/api/misc/knowledge', body);
        this.modal = false; this.$toast('已保存'); this.load();
      } catch (e) { this.$toast(e.message); }
    },
    async del(k) { if (!confirm('删除「' + k.title + '」？')) return; await this.$api.del('/api/misc/knowledge/' + k.id); this.load(); }
  }
});

/* ================= 异常与边界 ================= */
regView('exceptions', {
  template: `
  <div>
    <div class="page-head">
      <h1>异常处理与本期边界</h1>
      <div class="desc">以异常样本验证系统处置正确性：待核实 / 降级 / 排除 / 转入参考。红线原则：AI 不自动决策、不自动联系企业、不生成确定性投资结论。</div>
    </div>
    <div class="notice rd mb14" v-if="redline"><b>红线校验：</b>自动作出正式投资决策 <b>0</b> 次 · 自动联系企业 <b>0</b> 次 · 自动生成确定性投资结论 <b>0</b> 次</div>
    <div class="card">
      <div class="card-head"><h2>异常处理样本</h2><span class="sub">{{ done }}/{{ items.length }} 已验证通过</span></div>
      <table class="table">
        <thead><tr><th style="width:120px">异常类型</th><th>假设情形</th><th>正确处理</th><th>系统实际处理</th><th>示例</th><th style="width:90px">结果</th></tr></thead>
        <tbody>
          <tr v-for="e in items" :key="e.id">
            <td><span class="tag am">{{ e.type }}</span></td>
            <td class="muted">{{ e.scenario }}</td>
            <td class="muted">{{ e.correct_action }}</td>
            <td>{{ e.actual_action }}</td>
            <td class="muted" style="font-size:12px">{{ e.example }}</td>
            <td><span class="tag" :class="e.result==='通过' ? 'gr' : 'rd'">{{ e.result }}</span>
              <button class="btn sm" style="margin-top:4px" @click="flip(e)">{{ e.result==='通过' ? '撤销' : '标通过' }}</button></td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="grid2">
      <div class="card">
        <div class="card-head"><h2>输入什么</h2></div>
        <ol class="steps">
          <li>公开政策文件与监管动态（政府官网）</li>
          <li>公开融资披露与行业媒体信息</li>
          <li>技术公开资料、论文、专利公开数据</li>
          <li>招聘平台公开岗位数据</li>
          <li>企业官方公开信息（官网 / 公告）</li>
        </ol>
        <div class="notice mt14">首期不接入公司内部敏感项目材料、未公开尽调资料或其他未经授权的非公开信息。</div>
      </div>
      <div class="card">
        <div class="card-head"><h2>本期范围 / 不做范围</h2></div>
        <div class="notice gr mb14"><b>本期做：</b>弱信号识别与情报周报；产业链缺口反向寻源；候选企业协同评分与四问逻辑；人工复核工作流与留痕。</div>
        <div class="notice"><b>本期不做：</b>不自动作出投资决策；不自动联系任何企业；不接入非公开信息；不输出确定性投资结论；不做交易执行。</div>
      </div>
    </div>
  </div>
  `,
  data() { return { items: [], redline: null }; },
  computed: { done() { return this.items.filter(x => x.result === '通过').length; } },
  async mounted() { const d = await this.$api.get('/api/misc/exceptions'); this.items = d.items; this.redline = d.redline; },
  methods: { async flip(e) { await this.$api.put('/api/misc/exceptions/' + e.id, { result: e.result === '通过' ? '待验证' : '通过' }); const d = await this.$api.get('/api/misc/exceptions'); this.items = d.items; } }
});

/* ================= 验收看板 ================= */
regView('acceptance', {
  template: `
  <div>
    <div class="page-head">
      <h1>验收看板</h1>
      <div class="desc">连续 4 周真实周度扫描结果验收。首期重点不是证明 AI 能替代投资经理，而是验证其能否稳定发现更早、更相关、更值得进一步研究的一级市场机会。</div>
    </div>
    <div class="card">
      <div class="card-head"><h2>4 周交付进度</h2><span class="sub">周报状态：草稿 → 已生成 → 已复核</span></div>
      <div class="com-grid" style="grid-template-columns:repeat(4,1fr)">
        <div v-for="(r,i) in reports" :key="r.id" class="unit-card">
          <h3>{{ r.week_label }}</h3>
          <p class="muted mt8 mono">{{ r.period_start }} ~ {{ r.period_end }}</p>
          <p class="mt8"><span class="tag" :class="r.status==='已复核' ? 'gr' : (r.status==='已生成' ? 'cy' : 'am')">{{ r.status }}</span></p>
          <p class="muted mt8 mono">扫描 {{ r.scanned }} 条</p>
          <div class="progress mt8"><i :class="r.status==='已复核' ? 'gr' : ''" :style="{width: r.status==='已复核' ? '100%' : (r.status==='已生成' ? '66%' : '33%')}"></i></div>
        </div>
        <div v-for="i in Math.max(0, 4 - reports.length)" :key="'e'+i" class="unit-card" style="opacity:.45">
          <h3>第 {{ reports.length + i }} 周</h3>
          <div class="empty" style="padding:22px 0"><span class="ico">◌</span>待交付</div>
        </div>
      </div>
    </div>
    <div class="kpi-grid" style="grid-template-columns:repeat(6,1fr)">
      <div class="kpi" v-for="m in metrics" :key="m.name" style="--k:#2563eb">
        <div class="k-v">{{ m.value }}<small>{{ m.unit }}</small></div>
        <div class="k-n">{{ m.name }}</div>
      </div>
    </div>
    <div class="card">
      <div class="card-head"><h2>负责人分工</h2></div>
      <table class="table">
        <tbody><tr v-for="o in owners" :key="o.name"><td style="width:260px"><b>{{ o.name }}</b></td><td class="muted">{{ o.duty }}</td></tr></tbody>
      </table>
    </div>
    <div class="notice rd"><b>验收红线：</b>{{ redline }}</div>
  </div>
  `,
  data() { return { reports: [], metrics: [], owners: [], redline: '' }; },
  async mounted() { const d = await this.$api.get('/api/misc/acceptance'); this.reports = d.reports; this.metrics = d.metrics; this.owners = d.owners; this.redline = d.redline; }
});

/* ================= 系统管理 ================= */
regView('admin', {
  template: `
  <div>
    <div class="page-head">
      <h1>系统管理</h1>
      <div class="desc">用户与权限管理。角色：管理员（可管理系统配置与用户）、投资人员（业务操作与复核）。</div>
    </div>
    <div class="card">
      <div class="card-head"><h2>用户</h2><button class="btn pri sm end" @click="open()">+ 新增用户</button></div>
      <table class="table">
        <thead><tr><th>用户名</th><th>姓名</th><th>角色</th><th>创建时间</th><th style="width:150px">操作</th></tr></thead>
        <tbody>
          <tr v-for="u in list" :key="u.id">
            <td class="mono">{{ u.username }}</td>
            <td>{{ u.display_name }}</td>
            <td><span class="tag" :class="u.role==='admin' ? 'pu' : 'cy'">{{ u.role==='admin' ? '管理员' : '投资人员' }}</span></td>
            <td class="muted mono">{{ $fd(u.created_at) }}</td>
            <td>
              <button class="btn sm" @click="open(u)">编辑</button>
              <button class="btn sm danger" @click="del(u)" v-if="u.id !== $root.user.id">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="card">
      <div class="card-head"><h2>操作日志</h2><span class="sub">最近 100 条系统留痕</span></div>
      <div class="cap-row" v-for="a in acts" :key="a.id">
        <span class="muted mono" style="width:150px;flex:none">{{ $ft(a.created_at) }}</span>
        <span class="tag cy" style="flex:none">{{ a.module }}</span>
        <span class="ds" style="color:var(--tx2)">{{ a.display_name || '系统' }} · {{ a.action }} — {{ a.detail }}</span>
      </div>
    </div>

    <div class="modal-mask" v-if="modal" @click.self="modal=false">
      <div class="modal">
        <h3>{{ f.id ? '编辑用户' : '新增用户' }}</h3>
        <label class="fl">用户名 <b>*</b></label><input class="input" v-model.trim="f.username" :disabled="!!f.id">
        <label class="fl">姓名 <b>*</b></label><input class="input" v-model.trim="f.display_name">
        <label class="fl">角色</label>
        <select class="input" v-model="f.role"><option value="investor">投资人员</option><option value="admin">管理员</option></select>
        <label class="fl">{{ f.id ? '重置密码（留空则不修改）' : '密码' }}</label><input class="input" type="password" v-model.trim="f.password">
        <div class="modal-foot">
          <button class="btn" @click="modal=false">取消</button>
          <button class="btn pri" @click="save">保存</button>
        </div>
      </div>
    </div>
  </div>
  `,
  data() { return { list: [], acts: [], modal: false, f: {} }; },
  async mounted() { this.load(); },
  methods: {
    async load() {
      this.list = await this.$api.get('/api/auth/users');
      this.acts = await this.$api.get('/api/misc/activities');
    },
    open(u) { this.f = u ? { id: u.id, username: u.username, display_name: u.display_name, role: u.role, password: '' } : { username: '', display_name: '', role: 'investor', password: '' }; this.modal = true; },
    async save() {
      if (!this.f.username || !this.f.display_name) return this.$toast('用户名与姓名必填');
      if (!this.f.id && !this.f.password) return this.$toast('请设置密码');
      try {
        if (this.f.id) await this.$api.put('/api/auth/users/' + this.f.id, this.f);
        else await this.$api.post('/api/auth/users', this.f);
        this.modal = false; this.$toast('已保存'); this.load();
      } catch (e) { this.$toast(e.message); }
    },
    async del(u) { if (!confirm('删除用户「' + u.display_name + '」？')) return; await this.$api.del('/api/auth/users/' + u.id); this.load(); }
  }
});
