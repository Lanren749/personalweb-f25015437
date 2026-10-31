/* Owner workflow: persisted evidence snapshots, no synthetic investment data. */
(function () {
  'use strict';
  const NAV = [
    {key:'overview',title:'总览',icon:'◎'}, {key:'directions',title:'产业方向',icon:'◈'},
    {key:'companies',title:'候选企业',icon:'▤'}, {key:'synergy',title:'高协同潜力',icon:'⇄'},
    {key:'research',title:'深度研究',icon:'⌕'}, {key:'reference',title:'全球技术与威胁雷达',icon:'◇'}
  ];
  const SETTINGS_NAV = {key:'settings',title:'更新设置',icon:'⚙'};
  const WEEKDAYS = [{value:1,label:'周一'},{value:2,label:'周二'},{value:3,label:'周三'},{value:4,label:'周四'},{value:5,label:'周五'},{value:6,label:'周六'},{value:7,label:'周日'}];
  const DEFAULT_UPDATE_SETTINGS = {enabled:true,frequency:'weekly',weekday:1,time:'09:00',lookbackDays:14,timezone:'Asia/Shanghai'};
  function updateSettingsForm(raw) {
    const value = Object.assign({}, DEFAULT_UPDATE_SETTINGS, obj(raw));
    return {enabled:value.enabled,frequency:value.frequency,weekday:Number(value.weekday),time:value.time,lookbackDays:Number(value.lookbackDays),timezone:'Asia/Shanghai'};
  }
  function validUpdateSettings(raw) {
    return raw && typeof raw.enabled==='boolean' && ['daily','weekly'].includes(raw.frequency) && Number.isInteger(raw.weekday) && raw.weekday>=1 && raw.weekday<=7 && /^([01]\d|2[0-3]):[0-5]\d$/.test(raw.time) && Number.isInteger(raw.lookbackDays) && raw.lookbackDays>=1 && raw.lookbackDays<=90 && raw.timezone==='Asia/Shanghai';
  }
  const states = ['继续研究','暂缓','排除','未复核'];
  const list = x => Array.isArray(x) ? x.filter(v => v != null) : [];
  const obj = x => x && typeof x === 'object' && !Array.isArray(x) ? x : {};
  function snapshot(raw) {
    if (!raw || typeof raw !== 'object') return null;
    // Use the provenance badge in the template as the single AI marker. Older
    // snapshots may already include a textual prefix in the model output.
    const mark = (value, source) => source === 'AI 生成' && value ? String(value).replace(/^\s*\[AI\s*生成\]\s*/i, '') : value;
    return Object.assign({}, raw, {
      directions:list(raw.directions).map(d => { const p=obj(d.provenance); return Object.assign({},d,{name:String(d.name || '方向待核实'),summary:mark(d.summary,p.summary),whyNow:mark(d.whyNow,p.whyNow),relation:mark(d.relation,p.relation),evidenceIds:list(d.evidenceIds),risks:list(d.risks).map(x => mark(x,p.risks))}); }),
      companies:list(raw.companies).map(c => { const p=obj(c.provenance), r=obj(c.research), rp=key => p['research'+key] || p.research; return Object.assign({},c,{name:String(c.name || '企业名称待核实'),summary:mark(c.summary,p.summary),synergyReason:mark(c.synergyReason,p.synergyReason),groupEmpowers:mark(c.groupEmpowers,p.groupEmpowers),companyEmpowers:mark(c.companyEmpowers,p.companyEmpowers),evidenceIds:list(c.evidenceIds),pending:list(c.pending),research:Object.assign({},r,{overview:mark(r.overview,rp('Overview')),product:mark(r.product,rp('Product')),businessModel:mark(r.businessModel,rp('BusinessModel')),customerProgress:mark(r.customerProgress,rp('CustomerProgress')),opportunity:mark(r.opportunity,rp('Opportunity')),competition:mark(r.competition,rp('Competition')),growthSignals:mark(r.growthSignals,rp('GrowthSignals')),investmentLogic:mark(r.investmentLogic,rp('InvestmentLogic')),risks:list(r.risks).map(x=>mark(x,rp('Risks'))),questions:list(r.questions).map(x => mark(x,rp('Questions')))})}); }),
      threats:list(raw.threats).map(t => { const p=obj(t.provenance); return Object.assign({},t,{impact:mark(t.impact,p.impact),response:mark(t.response,p.response),evidenceIds:list(t.evidenceIds)}); }),
      signals:list(raw.signals),sourceResults:list(raw.sourceResults),warnings:list(raw.warnings),
      counts:Object.assign({collected:0,eligible:0,companies:0,fundedCompanies:0},obj(raw.counts))
    });
  }
  function safeUrl(value) {
    try { const u = new URL(String(value || '')); return /^https?:$/.test(u.protocol) ? u.href : ''; } catch (_) { return ''; }
  }
  function time(value) {
    if (!value) return '—';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? String(value) : new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(d);
  }
  const app = Vue.createApp({
    components:window.OWNER_COMPONENTS,
    data() { return {
      booted:false,user:null,loginForm:{username:'',password:''},loginErr:'',loginBusy:false,
      view:'overview',sideOpen:false,history:[],selectedId:'',snapshot:null,reviews:{},
      job:{status:'idle'},settings:{aiConfigured:false,schedule:'每周一09:00（北京时间）'},
      updateForm:Object.assign({},DEFAULT_UPDATE_SETTINGS),updateBaseline:JSON.stringify(DEFAULT_UPDATE_SETTINGS),updateLoaded:false,updateLoading:false,updateSaving:false,updateError:'',updateNotice:'',settingsRevision:0,
      loading:false,historyLoading:false,settingsLoaded:false,refreshBusy:false,pollPaused:false,pollTimer:null,pollDeadline:0,pollFailures:0,
      error:'',toast:'',search:'',directionFilter:'',statusFilter:'',researchId:'',directionNotes:{},directionFocus:{},directionActions:{},directionSaving:{},synergySaving:{},directionNoteDrafts:{},focusOnly:false,loadSequence:0,selectionSequence:0,loadedSelection:'',sessionEpoch:0
    }; },
    computed:{
      navItems(){ return (this.isAdmin?NAV.concat(SETTINGS_NAV):NAV).map(n => Object.assign({},n,{count:n.key==='directions'?this.directions.length:n.key==='companies'?this.companies.length:n.key==='synergy'?this.synergyCompanies.length:null})); },
      isAdmin(){return this.user && this.user.role==='admin';},
      weekdays(){return WEEKDAYS;},
      lookbackOptions(){return [...new Set([7,14,30,90,Number(this.updateForm.lookbackDays)])].filter(n=>Number.isInteger(n)&&n>=1&&n<=90).sort((a,b)=>a-b);},
      updateDirty(){return JSON.stringify(updateSettingsForm(this.updateForm))!==this.updateBaseline;},
      nextUpdateText(){return this.settings.enabled===false?'自动更新已关闭':this.settings.nextRunAt?time(this.settings.nextRunAt):'等待读取执行时间';},
      directions(){return this.snapshot?this.snapshot.directions:[];},
      focusedDirections(){return this.directions.filter(d=>this.directionFocused(d));},
      visibleDirections(){return this.focusOnly?this.focusedDirections:this.directions;},
      aiActivity(){return this.snapshot&&this.snapshot.aiActivity||null;},
      coveredDirections(){return this.directions.filter(d=>this.directionCompanyCount(d.id)>0).length;},
      companies(){return this.snapshot?this.snapshot.companies:[];},
      threats(){return this.snapshot?this.snapshot.threats:[];},
      signals(){return this.snapshot?this.snapshot.signals:[];},
      sourceResults(){return this.snapshot?this.snapshot.sourceResults:[];},
      globalSignals(){return this.signals.filter(s=>/美国|英国|海外|国际|global|United States|UK|US|foreign/i.test((s.title||'')+' '+(s.summary||'')));},
      highSynergy(){return this.companies.filter(c=>obj(this.reviews[c.id]).synergyLevel==='高' && !['暂缓','排除'].includes(this.reviewStatus(c.id)));},
      aiSynergyCandidates(){return this.companies.filter(c=>c.aiSynergyLevel==='高' && obj(this.reviews[c.id]).synergyLevel!=='高' && !['暂缓','排除'].includes(this.reviewStatus(c.id)));},
      synergyCompanies(){const ids=new Set();return [...this.highSynergy,...this.aiSynergyCandidates].filter(c=>{const id=String(c.id);if(ids.has(id))return false;ids.add(id);return true;});},
      modeText(){return this.snapshot && this.snapshot.mode==='ai'?(this.aiActivity&&this.aiActivity.partial?'DeepSeek 已完成部分方向分析；请查看未完成记录':'AI 已分析本期信号并推荐方向、企业与协同初判；负责人复核后进入正式清单'):this.aiActivity?'本轮已尝试 AI 检索，分析未全部完成，详见工作记录':'本期未调用 AI；配置 AI 后点击立即更新可启动检索与分析';},
      reviewStatuses(){return states;},
      pendingItems(){return this.companies.flatMap(c=>c.pending.map(p=>c.name+'：'+p));},
      reviewedCount(){return this.companies.filter(c=>this.reviewStatus(c.id)!=='未复核').length;},
      selectedDirection(){return this.directions.find(d=>String(d.id)===String(this.directionFilter)) || null;},
      filteredCompanies(){const q=this.search.toLocaleLowerCase(); return this.companies.filter(c=>(!q || [c.name,c.summary,c.region,this.directionName(c.directionId)].join(' ').toLocaleLowerCase().includes(q)) && (!this.directionFilter || String(c.directionId)===this.directionFilter) && (!this.statusFilter || this.reviewStatus(c.id)===this.statusFilter));},
      researchCompany(){return this.companies.find(c=>String(c.id)===String(this.researchId)) || this.highSynergy[0] || this.companies[0] || null;},
      researchQuestions(){const c=this.researchCompany;const q=c?c.research.questions:[]; return q.length?q:['融资阶段、未上市状态与股权结构能否获得可靠披露？','产品能力能否在集团真实业务场景中验证？','企业客户、收入与竞争格局需要补充哪些一手资料？'];},
      lastCollected(){const values=this.signals.map(s=>s.collectedAt).filter(v=>v && !Number.isNaN(Date.parse(v)));return values.length?time(values.sort((a,b)=>Date.parse(b)-Date.parse(a))[0]):'—';}
    },
    async mounted(){
      this._onHash=()=>this.applyHash();this._onAuth=()=>this.logout(true);
      window.addEventListener('hashchange',this._onHash);window.addEventListener('auth-expired',this._onAuth);
      this.applyHash();
      if(API.token.get()){try{this.user=(await API.get('/api/auth/me')).user;}catch(e){this.loginErr=e.message;}}
      this.booted=true;if(this.user)await this.loadDashboard();
    },
    beforeUnmount(){this.stopPoll();window.removeEventListener('hashchange',this._onHash);window.removeEventListener('auth-expired',this._onAuth);},
    methods:{
      safeUrl,encodeSearch:encodeURIComponent,formatTime:time,formatDate(v){return time(v).split(' ')[0];},
      period(s){return s?String(s.periodStart || '起始待核实').slice(0,10)+' 至 '+String(s.periodEnd || '结束待核实').slice(0,10):'周期待核实';},
      applyHash(){const k=location.hash.replace(/^#\/?/,'');this.view=k==='settings'&&(!this.user||this.isAdmin)?'settings':NAV.some(n=>n.key===k)?k:'overview';if(this.view==='settings'&&this.isAdmin&&!this.updateLoaded)this.loadUpdateSettings();},
      go(k){if(k==='settings'&&!this.isAdmin)return;this.view=k;this.sideOpen=false;location.hash='#/'+k;window.scrollTo({top:0,behavior:'smooth'});if(k==='settings'&&!this.updateLoaded)this.loadUpdateSettings();},
      async login(){this.loginBusy=true;this.loginErr='';try{const d=await API.post('/api/auth/login',this.loginForm);API.token.set(d.token);this.user=d.user;this.sessionEpoch++;this.loginForm.password='';this.go('overview');await this.loadDashboard();}catch(e){this.loginErr=e.message;}finally{this.loginBusy=false;}},
      logout(expired){this.sessionEpoch++;this.selectionSequence++;this.stopPoll();API.token.set('');this.user=null;this.snapshot=null;this.reviews={};this.directionActions={};this.directionNoteDrafts={};this.directionSaving={};this.focusOnly=false;this.history=[];this.selectedId='';this.loadedSelection='';this.error='';this.loading=false;this.historyLoading=false;this.settingsLoaded=false;this.updateLoaded=false;this.updateLoading=false;this.updateSaving=false;this.updateError='';this.updateNotice='';this.updateForm=Object.assign({},DEFAULT_UPDATE_SETTINGS);this.updateBaseline=JSON.stringify(DEFAULT_UPDATE_SETTINGS);this.pollPaused=false;this.loginForm.password='';if(expired)this.loginErr='登录已过期，请重新登录';},
      acceptSettings(raw,resetForm){
        const wasDirty=this.updateDirty;this.settings=Object.assign({},this.settings,obj(raw));this.settingsLoaded=true;
        if(validUpdateSettings(raw)&&(resetForm||(this.updateLoaded&&!wasDirty&&!this.updateSaving))){this.updateForm=updateSettingsForm(raw);this.updateBaseline=JSON.stringify(this.updateForm);}
      },
      async loadUpdateSettings(){
        if(!this.isAdmin||this.updateLoading||this.updateSaving)return;const epoch=this.sessionEpoch;this.updateLoading=true;this.updateError='';
        try{const d=await API.get('/api/intelligence/settings');if(epoch!==this.sessionEpoch||!this.isAdmin)return;if(!d||!validUpdateSettings(d.settings))throw new Error('更新设置返回内容异常，请重新读取');this.acceptSettings(d.settings,true);this.updateLoaded=true;}
        catch(e){if(epoch===this.sessionEpoch)this.updateError=e.message||'无法读取更新设置';}
        finally{if(epoch===this.sessionEpoch)this.updateLoading=false;}
      },
      resetUpdateSettings(){if(this.updateSaving||!this.updateLoaded)return;this.updateForm=updateSettingsForm(this.settings);this.updateBaseline=JSON.stringify(this.updateForm);this.updateError='';this.updateNotice='';},
      clearUpdateFeedback(){this.updateError='';this.updateNotice='';},
      async saveUpdateSettings(){
        if(!this.isAdmin||!this.updateLoaded||this.updateSaving||!this.updateDirty)return;const payload=updateSettingsForm(this.updateForm);
        if(!validUpdateSettings(payload)){this.updateError='请检查更新频率、时间和回看天数后重试';return;}
        const epoch=this.sessionEpoch;this.updateSaving=true;this.updateError='';this.updateNotice='';
        try{const d=await API.put('/api/intelligence/settings',payload);if(epoch!==this.sessionEpoch||!this.isAdmin)return;if(!d||!validUpdateSettings(d.settings))throw new Error('未能确认保存结果，请重新读取设置后核对');this.settingsRevision++;this.acceptSettings(d.settings,true);this.updateNotice=d.settings.enabled?'设置已保存，后续更新按新计划执行。':'设置已保存，自动更新已关闭。';await this.loadDashboard(true);}
        catch(e){if(epoch===this.sessionEpoch)this.updateError=e.message||'保存失败，请重试';}
        finally{if(epoch===this.sessionEpoch)this.updateSaving=false;}
      },
      async loadDashboard(quiet){
        const sequence=++this.loadSequence,epoch=this.sessionEpoch,selection=this.selectionSequence,revision=this.settingsRevision;
        if(!quiet)this.loading=true;this.error='';
        try{const d=await API.get('/api/intelligence/dashboard');if(!d||!Object.prototype.hasOwnProperty.call(d,'snapshot'))throw new Error('工作台返回内容异常，请重试');if(epoch!==this.sessionEpoch||sequence!==this.loadSequence||!this.user)return;
          this.history=list(d.history);this.job=Object.assign({status:'idle'},obj(d.job));if(revision===this.settingsRevision)this.acceptSettings(d.settings);this.user=d.user||this.user;this.acceptDirectionActions(d.directionActions);
          if(this.view==='settings'){if(this.isAdmin){if(!this.updateLoaded)this.loadUpdateSettings();}else this.go('overview');}
          if(!this.selectedId&&selection===this.selectionSequence){if(d.snapshot||this.job.status!=='failed'||!this.snapshot){this.snapshot=snapshot(d.snapshot);this.reviews=obj(d.reviews);}this.loadedSelection='';}
          if(this.job.status==='running'&&!this.pollTimer&&!this.pollPaused)this.startPoll();
          if(this.job.status!=='running'){this.stopPoll();this.pollPaused=false;}
        }catch(e){if(epoch===this.sessionEpoch&&sequence===this.loadSequence&&selection===this.selectionSequence){this.error=e.message || '无法读取工作台，已有快照仍保留。';this.selectedId=this.loadedSelection;}}
        finally{if(sequence===this.loadSequence)this.loading=false;}
      },
      async selectHistory(){
        const selection=++this.selectionSequence;
        if(!this.selectedId){this.historyLoading=false;return this.loadDashboard();}
        const wanted=this.selectedId,epoch=this.sessionEpoch;this.historyLoading=true;this.error='';
        try{const d=await API.get('/api/intelligence/history/'+encodeURIComponent(wanted));if(wanted!==this.selectedId||epoch!==this.sessionEpoch||selection!==this.selectionSequence)return;if(!d||!d.snapshot)throw new Error('历史快照不存在或不可用');this.snapshot=snapshot(d.snapshot);this.reviews=obj(d.reviews);this.researchId='';this.loadedSelection=wanted;}
        catch(e){if(epoch===this.sessionEpoch&&selection===this.selectionSequence){this.selectedId=this.loadedSelection;this.error=(e.message || '无法读取历史快照')+'，保留此前快照。';}}
        finally{if(selection===this.selectionSequence)this.historyLoading=false;}
      },
      showLatest(){this.selectedId='';this.selectHistory();},
      async refresh(){if(!this.isAdmin||this.refreshBusy||this.job.status==='running')return;this.refreshBusy=true;this.error='';try{const d=await API.post('/api/intelligence/refresh',{});this.job=Object.assign({status:'running'},obj(d.job));this.showToast('更新任务已提交，完成前保留现有快照');this.startPoll();}catch(e){this.error=e.message;}finally{this.refreshBusy=false;}},
      stopPoll(){if(this.pollTimer)clearTimeout(this.pollTimer);this.pollTimer=null;},
      startPoll(){this.stopPoll();this.pollPaused=false;this.pollFailures=0;this.pollDeadline=Date.now()+13*60*1000;this.pollTimer=setTimeout(()=>this.pollOnce(),5000);},
      async pollOnce(){
        this.stopPoll();if(!this.user)return;if(Date.now()>this.pollDeadline){this.pollPaused=true;return;}
        const epoch=this.sessionEpoch,selection=this.selectionSequence,revision=this.settingsRevision;
        try{const d=await API.get('/api/intelligence/dashboard');if(!d||!Object.prototype.hasOwnProperty.call(d,'snapshot'))throw new Error('任务状态返回异常');if(epoch!==this.sessionEpoch||!this.user)return;this.pollFailures=0;this.job=Object.assign({status:'idle'},obj(d.job));this.history=list(d.history);this.acceptDirectionActions(d.directionActions);if(revision===this.settingsRevision)this.acceptSettings(d.settings);
          if(this.job.status!=='running'){if(!this.selectedId&&selection===this.selectionSequence){if(d.snapshot||this.job.status!=='failed'||!this.snapshot){this.snapshot=snapshot(d.snapshot);this.reviews=obj(d.reviews);}this.loadedSelection='';}this.pollPaused=false;this.showToast(this.job.status==='failed'?'更新失败，旧快照已保留':this.job.status==='success'?'更新完成，已保存最新快照':'当前没有进行中的更新');return;}
        }catch(e){if(epoch!==this.sessionEpoch)return;this.pollFailures++;if(this.pollFailures>=3){this.pollPaused=true;this.error='暂时无法检查更新状态：'+e.message;return;}}
        this.pollTimer=setTimeout(()=>this.pollOnce(),5000);
      },
      resumePoll(){this.startPoll();this.stopPoll();this.pollOnce();},
      reviewSaved(payload){if(!payload||!payload.review)return;if(!this.snapshot||String(payload.snapshotId)!==String(this.snapshot.id)){this.showToast('复核已保存到原快照');return;}const id=payload.companyId;if(id!=null)this.reviews=Object.assign({},this.reviews,{[id]:payload.review});this.showToast('人工复核已保存');},
      async addToHighSynergy(company){if(!company||!this.snapshot||this.synergySaving[company.id])return;const id=String(company.id),epoch=this.sessionEpoch;this.synergySaving=Object.assign({},this.synergySaving,{[id]:true});try{const d=await API.put('/api/intelligence/reviews/'+encodeURIComponent(company.id),{snapshotId:this.snapshot.id,status:'继续研究',note:(obj(this.reviews[company.id]).note||''),synergyLevel:'高'});if(!d||!d.review)throw new Error('保存返回异常');if(epoch===this.sessionEpoch)this.reviewSaved({snapshotId:this.snapshot.id,companyId:company.id,review:d.review});this.showToast('已加入高协同企业，左侧数量和高协同列表已更新');}catch(e){if(epoch===this.sessionEpoch)this.showToast(e.message||'加入高协同企业失败');}finally{if(epoch===this.sessionEpoch)this.synergySaving=Object.assign({},this.synergySaving,{[id]:false});}},
      viewDirection(id){this.directionFilter=String(id);this.search='';this.statusFilter='';this.go('companies');},
      directionCompanyCount(id){return this.companies.filter(c=>String(c.directionId)===String(id)).length;},
      directionFocused(d){return Boolean(d && obj(this.directionActions[String(d.id)]).focused);},
      directionNote(d){const id=String(d&&d.id||'');return Object.prototype.hasOwnProperty.call(this.directionNoteDrafts,id)?this.directionNoteDrafts[id]:obj(this.directionActions[id]).note||'';},
      acceptDirectionActions(raw){if(!raw)return;this.directionActions=obj(raw);},
      async saveDirectionAction(d,focused,note){
        if(!d||!this.snapshot||this.directionSaving[d.id])return;const id=String(d.id),epoch=this.sessionEpoch;
        this.directionSaving=Object.assign({},this.directionSaving,{[id]:true});
        try{const result=await API.put('/api/intelligence/direction-actions/'+encodeURIComponent(id),{snapshotId:this.snapshot.id,focused,note:String(note||'').slice(0,500)});
          if(epoch!==this.sessionEpoch)return;if(!result||!result.action)throw new Error('未能确认保存结果，请重新读取');
          this.directionActions=Object.assign({},this.directionActions,{[id]:result.action});delete this.directionNoteDrafts[id];
          this.showToast(result.action.focused?'已保存到我的关注，可在“只看我的关注”查看':'人工判断已保存到本机数据库');
        }catch(e){if(epoch===this.sessionEpoch)this.showToast('保存失败：'+e.message);}
        finally{if(epoch===this.sessionEpoch)this.directionSaving=Object.assign({},this.directionSaving,{[id]:false});}
      },
      toggleDirectionFocus(d){return this.saveDirectionAction(d,!this.directionFocused(d),this.directionNote(d));},
      saveDirectionNote(d){return this.saveDirectionAction(d,this.directionFocused(d),this.directionNote(d));},
      openResearch(id){this.researchId=String(id);this.go('research');},
      isGlobalSignal(signal){return /美国|英国|海外|国际|global|United States|UK|US|foreign/i.test((signal&&signal.title||'')+' '+(signal&&signal.summary||''));},
      directionName(id){const d=this.directions.find(x=>String(x.id)===String(id));return d?d.name:'产业方向待核实';},
      reviewStatus(id){return obj(this.reviews[id]).status||'未复核';},
      reviewCount(s){return this.companies.filter(c=>this.reviewStatus(c.id)===s).length;},
      statusClass(s){return s==='继续研究'?'green':s==='排除'?'red':s==='暂缓'?'amber':'';},
      provenanceLabel(value){return value==='AI 生成'?'AI 生成':value==='AI 识别'?'AI 识别':value==='AI 筛选'?'AI 筛选':value==='AI 初判'?'AI 初判':value==='规则识别'?'规则识别':value==='规则筛选'?'规则筛选':value==='规则生成'?'规则生成':value==='公开来源'?'公开来源':value==='人工复核'?'人工复核':'待核实';},
      provenanceClass(value){return ['AI 生成','AI 识别','AI 筛选','AI 初判'].includes(value)?'blue':value==='人工复核'?'green':value==='公开来源'?'amber':'';},
      sourceClass(s){return ['ok','success'].includes(s)?'green':['failed','error'].includes(s)?'red':'amber';},
      sourceLabel(s){return {ok:'已完成',success:'已完成',failed:'失败',error:'失败',partial:'部分完成',empty:'未发现条目',skipped:'未采集'}[s]||String(s||'待核实');},
      download(name,textValue,type){const url=URL.createObjectURL(new Blob([textValue],{type:type||'application/json;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);},
      exportReport(){
        if(!this.snapshot)return;
        const s=this.snapshot,tag=key=>'（'+this.provenanceLabel(key)+'）';
        const rows=['# 东浩兰生智投 · 战略投资机会周报',this.period(s),'生成：'+time(s.generatedAt)+'（北京时间）','模式：'+this.modeText,'','流程说明：AI 阅读本期公开信号，归纳产业方向、识别并排序企业线索、初判协同潜力；系统核验引用来源和可见融资证据，投资负责人确认后才把企业列入正式高协同名单。AI 分析和生成内容均逐项标记，不构成投资建议。','','## 产业方向'];
        this.directions.forEach(d=>rows.push('### '+d.name+' '+tag(d.provenance&&d.provenance.selection),(d.summary||'待核实')+' '+tag(d.provenance&&d.provenance.summary),'关注理由：'+(d.whyNow||'待核实')+' '+tag(d.provenance&&d.provenance.whyNow),'业务关联：'+(d.relation||'待核实')+' '+tag(d.provenance&&d.provenance.relation)));
        rows.push('','## 候选企业');
        this.companies.forEach(c=>{const p=obj(c.provenance),review=obj(this.reviews[c.id]);rows.push('### '+c.name+' '+tag(p.selection||p.identity),(c.summary||'待核实')+' '+tag(p.summary),'候选类型：'+(c.candidateType||'企业线索')+' '+tag(p.candidateType),'融资：'+(c.round||'未披露 / 待核实')+' '+tag(p.funding),'AI 协同初判：'+(c.aiSynergyLevel||'未形成')+' '+tag(p.synergyLevel),'AI 协同说明：'+(c.synergyReason||'待核实')+' '+tag(p.synergyReason),'人工协同判断：'+(review.synergyLevel||'待负责人复核')+(review.synergyLevel?'（人工复核）':''),'复核：'+this.reviewStatus(c.id),'待核实：'+c.pending.join('；'));});
        rows.push('','## 全球技术与威胁');
        this.threats.forEach(t=>rows.push('### '+t.title,'影响：'+(t.impact||'待核实')+' '+tag(t.provenance&&t.provenance.impact),'建议：'+(t.response||'待核实')+' '+tag(t.provenance&&t.provenance.response)));
        rows.push('','## 来源');
        this.signals.forEach(x=>rows.push('- '+(x.title||'来源')+' | '+(x.source||'')+' | 发布 '+time(x.publishedAt)+' | 采集 '+time(x.collectedAt)+' | '+safeUrl(x.url)));
        rows.push('','## 本期说明',...s.warnings,'','公开信息研究草稿，关键事实与业务协同须人工复核，不构成投资建议。');
        this.download('战略投资机会周报_'+String(s.periodEnd||'最新').slice(0,10)+'.md',rows.join('\n\n'),'text/markdown;charset=utf-8');
      },
      exportReviews(){this.download('投资雷达复核结果.json',JSON.stringify({snapshotId:this.snapshot&&this.snapshot.id,exportedAt:new Date().toISOString(),reviews:this.reviews},null,2));},
      printReport(){window.print();},
      showToast(m){this.toast=String(m||'');clearTimeout(this._toast);this._toast=setTimeout(()=>{this.toast='';},3500);}
    }
  });
  app.config.errorHandler=(err,instance)=>{console.error('[workspace]',err);if(instance&&instance.$root)instance.$root.showToast('页面处理异常，请刷新后重试');};
  app.mount('#app');
})();
