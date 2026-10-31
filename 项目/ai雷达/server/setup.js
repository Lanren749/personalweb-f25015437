/* ============================================================
 * radar_hub 建库脚本：建表 + 全景演示数据
 * 用法：在项目目录配置专用 .env 后运行 npm run setup
 * 演示数据中企业、融资、来源均为虚构，不构成投资建议
 * ============================================================ */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const { hashPassword } = require('./auth');

const SCHEMA = `
DROP TABLE IF EXISTS activity_logs, review_logs, company_scores, four_questions, knowledge_entries, exceptions,
  watchlist, reports, signals, companies, chain_gaps, directions,
  score_dimensions, invest_boundaries, capabilities, business_units, users;

CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  salt VARCHAR(32) NOT NULL,
  password_hash CHAR(64) NOT NULL,
  display_name VARCHAR(50) NOT NULL,
  role ENUM('admin','investor') NOT NULL DEFAULT 'investor',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE business_units (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  type ENUM('主业板块','资源要素') NOT NULL DEFAULT '主业板块',
  description VARCHAR(500) DEFAULT '',
  sort INT DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE capabilities (
  id INT AUTO_INCREMENT PRIMARY KEY,
  unit_id INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  category VARCHAR(50) DEFAULT '',
  description VARCHAR(500) DEFAULT '',
  strength TINYINT NOT NULL DEFAULT 3,
  sort INT DEFAULT 0,
  INDEX idx_unit (unit_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE invest_boundaries (
  id INT AUTO_INCREMENT PRIMARY KEY,
  rule_type ENUM('轮次','地域','赛道偏好','负面清单') NOT NULL,
  content VARCHAR(500) NOT NULL,
  sort INT DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE score_dimensions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  description VARCHAR(300) DEFAULT '',
  weight DECIMAL(5,2) NOT NULL DEFAULT 0,
  enabled TINYINT NOT NULL DEFAULT 1,
  sort INT DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE directions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  sub VARCHAR(120) DEFAULT '',
  category VARCHAR(50) DEFAULT '',
  status ENUM('跟踪中','观察','暂停') NOT NULL DEFAULT '跟踪中',
  heat TINYINT DEFAULT 50,
  why_now TEXT,
  relation TEXT,
  risks JSON,
  tags JSON,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE signals (
  id INT AUTO_INCREMENT PRIMARY KEY,
  direction_id INT NULL,
  type ENUM('政策','融资','技术','资本','招聘','专利') NOT NULL,
  title VARCHAR(200) NOT NULL,
  content VARCHAR(800) DEFAULT '',
  source_name VARCHAR(120) DEFAULT '',
  source_url VARCHAR(500) DEFAULT '',
  confidence TINYINT DEFAULT 60,
  strength TINYINT DEFAULT 50,
  occurred_at DATE NOT NULL,
  status ENUM('正常','待核实','降级','排除','转参考') NOT NULL DEFAULT '正常',
  verify_note VARCHAR(300) DEFAULT '',
  ai_note TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_dir (direction_id), INDEX idx_date (occurred_at), INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE reports (
  id INT AUTO_INCREMENT PRIMARY KEY,
  week_label VARCHAR(20) NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status ENUM('草稿','已生成','已复核') NOT NULL DEFAULT '草稿',
  summary TEXT,
  note VARCHAR(500) DEFAULT '',
  scanned INT DEFAULT 0,
  published_at DATETIME NULL,
  created_by VARCHAR(50) DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE watchlist (
  id INT AUTO_INCREMENT PRIMARY KEY,
  target_type ENUM('企业','关键词','赛道') NOT NULL DEFAULT '企业',
  name VARCHAR(120) NOT NULL,
  direction_id INT NULL,
  note VARCHAR(500) DEFAULT '',
  status ENUM('监测中','已暂停') NOT NULL DEFAULT '监测中',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE chain_gaps (
  id INT AUTO_INCREMENT PRIMARY KEY,
  direction_id INT NOT NULL,
  segment VARCHAR(120) NOT NULL,
  description VARCHAR(600) DEFAULT '',
  severity ENUM('高','中','低') NOT NULL DEFAULT '中',
  status ENUM('开放','已覆盖') NOT NULL DEFAULT '开放',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE companies (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  full_name VARCHAR(200) DEFAULT '',
  track VARCHAR(100) DEFAULT '',
  region VARCHAR(50) DEFAULT '',
  round VARCHAR(20) DEFAULT 'A轮',
  founded_year INT NULL,
  description VARCHAR(800) DEFAULT '',
  website VARCHAR(200) DEFAULT '',
  source VARCHAR(300) DEFAULT '',
  gap_id INT NULL,
  direction_id INT NULL,
  evidence JSON NULL,
  found_by VARCHAR(20) NOT NULL DEFAULT 'AI',
  synergy_level ENUM('高','中','弱/待验证') NOT NULL DEFAULT '弱/待验证',
  status ENUM('候选','继续研究','暂缓','排除') NOT NULL DEFAULT '候选',
  week_label VARCHAR(20) DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_status (status), INDEX idx_gap (gap_id), INDEX idx_dir (direction_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE company_scores (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id INT NOT NULL,
  dimension_id INT NOT NULL,
  score TINYINT NOT NULL DEFAULT 0,
  rationale VARCHAR(500) DEFAULT '',
  UNIQUE KEY uk_cs (company_id, dimension_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE review_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id INT NOT NULL,
  user_id INT NOT NULL,
  action VARCHAR(30) NOT NULL,
  note VARCHAR(500) DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_com (company_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE four_questions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id INT NOT NULL UNIQUE,
  why_now TEXT,
  why_sector TEXT,
  why_company TEXT,
  why_dlg TEXT,
  sources JSON,
  status ENUM('AI生成','AI生成+人工确认') NOT NULL DEFAULT 'AI生成',
  updated_by VARCHAR(50) DEFAULT '',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE knowledge_entries (
  id INT AUTO_INCREMENT PRIMARY KEY,
  type ENUM('产业研究','历史项目','方法论') NOT NULL,
  title VARCHAR(200) NOT NULL,
  content TEXT,
  tags JSON,
  created_by VARCHAR(50) DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE exceptions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  type VARCHAR(60) NOT NULL,
  scenario VARCHAR(400) NOT NULL,
  correct_action VARCHAR(400) NOT NULL,
  actual_action VARCHAR(400) NOT NULL,
  example VARCHAR(300) DEFAULT '',
  result ENUM('通过','待验证') NOT NULL DEFAULT '待验证'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE activity_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL,
  module VARCHAR(50) DEFAULT '',
  action VARCHAR(200) DEFAULT '',
  detail VARCHAR(500) DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

async function main() {
  if (!process.argv.includes('--reset-demo-database') || process.env.DB_NAME !== 'radar_demo') {
    throw new Error('初始化会删除目标库数据；仅支持 DB_NAME=radar_demo 且显式使用 --reset-demo-database');
  }
  if (!process.env.DEMO_ADMIN_PASSWORD || process.env.DEMO_ADMIN_PASSWORD.length < 12 ||
      !process.env.DEMO_INVESTOR_PASSWORD || process.env.DEMO_INVESTOR_PASSWORD.length < 12 ||
      process.env.DEMO_ADMIN_PASSWORD === process.env.DEMO_INVESTOR_PASSWORD) {
    throw new Error('请在本地 .env 设置不同且至少 12 位的 DEMO_ADMIN_PASSWORD 和 DEMO_INVESTOR_PASSWORD');
  }
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: +(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    multipleStatements: true,
    charset: 'utf8mb4'
  });
  console.log('→ 建表…');
  await conn.query(SCHEMA);

  console.log('→ 写入演示数据…');

  /* ---------- 用户 ---------- */
  const users = [
    ['admin', process.env.DEMO_ADMIN_PASSWORD, '演示管理员', 'admin'],
    ['invest01', process.env.DEMO_INVESTOR_PASSWORD, '演示投资经理一', 'investor'],
    ['invest02', process.env.DEMO_INVESTOR_PASSWORD, '演示投资经理二', 'investor']
  ];
  for (const [u, p, n, r] of users) {
    const { salt, hash } = hashPassword(p);
    await conn.query('INSERT INTO users (username, salt, password_hash, display_name, role) VALUES (?,?,?,?,?)', [u, salt, hash, n, r]);
  }

  /* ---------- 知识大脑：业务板块 + 能力要素 ---------- */
  const units = [
    ['人力资源服务', '主业板块', '上海外服为核心：人事管理、人才派遣、薪酬福利、招聘与灵活用工，服务全国数千家企业客户', 1],
    ['会展与赛事运营', '主业板块', '大型展会主办、场馆运营与头部赛事 IP（马拉松等）商业化运营', 2],
    ['国际贸易与服务贸易', '主业板块', '跨境贸易服务链、供应链与关务服务、海外渠道伙伴网络', 3],
    ['教育与培训', '主业板块', '职业技能培训体系、产教融合合作网络、认证与课程研发', 4],
    ['园区与楼宇经济', '资源要素', '产业园区载体与企业客户聚集，具备招商网络与政企对接通道', 5],
    ['数据与技术服务', '资源要素', '人力资源数字化平台与行业数据处理经验，数据合规能力强', 6]
  ];
  for (const [n, t, d, s] of units) await conn.query('INSERT INTO business_units (name, type, description, sort) VALUES (?,?,?,?)', [n, t, d, s]);

  const caps = [
    [1, '全国人力资源服务网络', '交付网络', '覆盖全国的直营网点与服务团队，可承接 B 端批量交付', 5, 1],
    [1, '岗位与人才数据资产', '数据资产', '长期积累的岗位库、简历库与人才测评数据（合规脱敏）', 5, 2],
    [1, '大客户直采渠道', '渠道', '大型企业 HR 采购决策链路的直接触达能力', 4, 3],
    [1, '薪酬福利外包能力', '交付能力', '薪酬核算、福利采购与个税申报的规模化处理能力', 4, 4],
    [1, '跨境人力资源服务', '国际化', '海外雇佣与跨境用工服务经验', 3, 5],
    [2, '大型展会主办与场馆运营', '交付能力', '展会全流程主办能力与自有场馆资源', 4, 1],
    [2, '国际展会资源网络', '国际化', '国际展览业协会资源与海外招展渠道', 4, 2],
    [2, '头部赛事 IP 运营', 'IP 资产', '马拉松等头部赛事 IP 的运营与商业化能力', 5, 3],
    [2, '观众与商户流量运营', '流量', '展会观众、参展商与赛事人群的数字化触达', 3, 4],
    [3, '跨境贸易服务链', '交付能力', '贸易代理、物流协同与结算服务一体化', 4, 1],
    [3, '供应链与关务服务', '交付能力', '进出口关务、保税与供应链金融服务经验', 4, 2],
    [3, '海外渠道与伙伴网络', '国际化', '主要贸易目的地的合作伙伴网络', 3, 3],
    [4, '职业技能培训体系', '交付能力', '覆盖多工种的课程体系与实训交付能力', 4, 1],
    [4, '产教融合合作网络', '渠道', '与院校、行业协会的产教融合合作资源', 3, 2],
    [4, '认证与课程研发', '研发', '职业技能等级认定资质与课程开发能力', 3, 3],
    [5, '产业园区载体', '资产', '市区两级产业园区与楼宇载体资源', 3, 1],
    [5, '企业客户聚集与招商网络', '渠道', '园区内企业客户密度高，招商与政策对接通道成熟', 4, 2],
    [6, '人力资源数字化平台', '技术平台', '面向 B 端与 C 端的人力资源数字化产品与运营经验', 4, 1],
    [6, '行业数据合规处理经验', '合规', '个人信息保护与数据出境合规的体系化实践', 3, 2]
  ];
  for (const c of caps) await conn.query('INSERT INTO capabilities (unit_id, name, category, description, strength, sort) VALUES (?,?,?,?,?,?)', c);

  /* ---------- 投资边界 ---------- */
  const bounds = [
    ['轮次', '中国境内未上市企业，原则上 Pre-A / A / B 轮；特别优质标的可放宽至 C 轮', 1],
    ['地域', '境内注册与实际运营，优先长三角区域', 2],
    ['赛道偏好', '与集团主业存在战略协同：人力资源、会展赛事、贸易服务、教育培训及相关科技方向', 3],
    ['负面清单', '不投与主业无协同的纯财务性标的；不投数据合规高风险且无法整改的领域；单一标的投资额度按投委会规定执行', 4]
  ];
  for (const b of bounds) await conn.query('INSERT INTO invest_boundaries (rule_type, content, sort) VALUES (?,?,?)', b);

  /* ---------- 评分维度 ---------- */
  const dims = [
    ['行业前景', '赛道增速、市场天花板与政策环境', 25, 1],
    ['战略协同', '与集团业务双向赋能的深度与可落地路径', 25, 2],
    ['能力稀缺性', '技术、数据或资源壁垒是否难以复制', 15, 3],
    ['团队质量', '创始团队背景、执行力与组织成熟度', 15, 4],
    ['阶段与估值合理性', '轮次阶段、估值水平与退出路径匹配度', 10, 5],
    ['数据合规与风控', '个人信息与数据安全风险及可整改性', 10, 6]
  ];
  for (const d of dims) await conn.query('INSERT INTO score_dimensions (name, description, weight, sort) VALUES (?,?,?,?)', d);

  /* ---------- 产业方向 ---------- */
  const dirs = [
    ['AI+人力资源科技', 'HR Tech × 垂直大模型', '人工智能', '跟踪中', 92,
      '大模型推理成本快速下降，简历解析、岗位匹配与面试初筛的单位成本进入可规模化商用区间；行业从「关系型交付」转向「算法型交付」，先发者将依托岗位库与人才库形成数据飞轮。',
      '集团人力资源服务板块拥有岗位库、人才库与数千家企业客户，可作为 AI 招聘产品的首批真实场景、数据来源与分销渠道；数字化平台能力可承接产品共研。',
      ['垂类模型效果需显著优于通用大模型直接调用', '客户付费意愿受招聘预算周期影响', '求职者个人信息合规与算法备案要求高'],
      ['人力资源服务', '垂类大模型', '订阅制']],
    ['银发经济与康养服务', '智慧康养 × 照护服务', '大健康', '跟踪中', 84,
      '人口结构变化推动养老从「事业」转「产业」，支付方由家庭向「长护险+企业福利」扩展；照护人力缺口倒逼智慧化设备与 SaaS 渗透，行业进入放量前夜。',
      '集团灵活用工与技能培训能力可输送并培训照护人力；园区载体可落地康养样板点；员工福利采购渠道可导入康养服务产品。',
      ['支付能力依赖长护险扩面进度', '服务标准化程度低，跨区域复制难', '重资产模式回收周期长'],
      ['银发经济', '照护 SaaS', '人力密集']],
    ['机器人与智能装备服务化', '具身智能 × 租赁运营', '智能制造', '跟踪中', 80,
      '整机成本下降与场景数据积累推动机器人从「卖设备」转向「卖服务」，租赁、运维与按需用工模式兴起，与人力资源行业「设备替人+人机协同」逻辑天然衔接。',
      '集团灵活用工网络可扩展为「人机混合用工」调度平台；培训体系可延伸至机器人运维技能认证，形成新职业培训产品。',
      ['技术成熟度分化大，场景选择决定成败', '重资产租赁对资金与运维体系要求高', '头部整机厂商可能自营服务'],
      ['具身智能', '租赁运营', '人机协同']],
    ['绿色低碳服务贸易', '碳管理 × 绿色供应链', '双碳', '跟踪中', 76,
      '出口供应链碳足迹核算与 ESG 披露从自愿走向强制，跨境贸易服务集团面临上下游合规传导，催生碳数据服务刚需。',
      '集团国际贸易服务链天然连接大量外贸企业客户，可联合碳管理 SaaS 为客户 bundled 交付；园区可提供零碳园区试点场景。',
      ['核算标准尚未统一，工具同质化', '客户付费动力受政策节奏影响', '国际互认机制存在不确定性'],
      ['碳管理', '绿色供应链', '服务贸易']],
    ['数字医疗与健康服务', 'AI 医疗 × 健康管理', '大健康', '观察', 72,
      'AI 辅助诊断与健康管理的支付闭环逐步打通，企业健康管理福利预算上升。',
      '集团员工福利与企业服务渠道可分发健康管理产品；暂无深度产业协同，保持观察。',
      ['医疗资质壁垒高', '与主业协同弱，需验证渠道价值'],
      ['健康管理', '企业福利']]
  ];
  for (const d of dirs) {
    await conn.query('INSERT INTO directions (name, sub, category, status, heat, why_now, relation, risks, tags) VALUES (?,?,?,?,?,?,?,?,?)',
      [d[0], d[1], d[2], d[3], d[4], d[5], d[6], JSON.stringify(d[7]), JSON.stringify(d[8])]);
  }

  /* ---------- 弱信号 ---------- */
  const sigs = [
    // 第1周 2026-09-21 ~ 09-27
    [1, '政策', '多部门发文促进人力资源服务业数字化升级，鼓励 AI 匹配产品采购', '人社部门年度工作要点明确支持机构数字化改造，多地配套补贴目录将智能匹配系统纳入', '人力资源社会保障部官网', 'https://www.mohrss.gov.cn/example-1', 90, 88, '2026-09-22', '正常', ''],
    [1, '融资', 'AI 面试赛道单周 3 起融资，均集中在 A 轮前后', '包括 2 起 A 轮、1 起 Pre-A；投资方以产业资本为主', '投中网（虚构示例）', 'https://www.chinaventure.com.cn/example-2', 75, 82, '2026-09-23', '正常', ''],
    [1, '技术', '主流大模型简历解析准确率公开测评首次突破 95%', '第三方测评显示垂类微调模型在复杂简历场景超越通用模型 7 个百分点', '学术会议公开资料（虚构示例）', 'https://arxiv.org/example-3', 70, 78, '2026-09-24', '正常', ''],
    [2, '政策', '长护险试点扩围城市新增 11 个，照护服务支付能力提升', '扩围名单公布，支付端扩容直接利好照护服务与设备采购', '国家医保局公告', 'https://www.nhsa.gov.cn/example-4', 92, 85, '2026-09-22', '正常', ''],
    [2, '融资', '智慧养老 SaaS 完成亿元级 A 轮融资', '由地方产业基金领投，资金用于照护机构数字化系统研发', '36 氪（虚构示例）', 'https://36kr.com/example-5', 75, 80, '2026-09-25', '正常', ''],
    [3, '融资', '具身智能租赁运营商获 Pre-A 轮融资，聚焦工厂场景', '以「机器人即服务」模式向中小工厂提供分拣机器人租赁', '机器之心（虚构示例）', 'https://www.jiqizhixin.com/example-6', 70, 74, '2026-09-26', '正常', ''],
    [3, '招聘', '头部制造企业批量招聘「机器人运维技术员」，岗位缺口明显', '多家招聘平台单周新增相关岗位超 2000 个，薪酬高于普工 40%', '招聘平台公开数据（虚构示例）', 'https://example.com/job-7', 65, 72, '2026-09-27', '正常', ''],
    [4, '政策', '欧盟碳边境调节机制过渡期报告要求收紧，外贸企业核查压力上升', '第三批纳管行业清单征求意见，涉及纺织与轻工品类', '欧盟委员会官网', 'https://ec.europa.eu/example-8', 88, 80, '2026-09-23', '正常', ''],
    // 第2周 2026-09-28 ~ 10-04
    [1, '资本', '头部人力资源集团半年报披露 AI 投入加大，均提及智能匹配', '两家上市公司资本开支中 AI 相关占比提升至 8%', '上市公司公告', 'https://www.cninfo.com.cn/example-9', 85, 76, '2026-09-29', '正常', ''],
    [1, '招聘', '上海地区「AI 产品经理（HR 方向）」岗位环比增长 35%', '招聘需求侧印证企业智能化预算落地', '招聘平台公开数据（虚构示例）', 'https://example.com/job-10', 60, 65, '2026-09-30', '正常', ''],
    [1, '技术', '多模态面试官 Agent 开源框架发布，商用部署门槛进一步降低', '支持视频面试与实时评估，社区活跃度高', 'GitHub（虚构示例）', 'https://github.com/example-11', 68, 70, '2026-10-02', '正常', ''],
    [2, '融资', '老年教育平台完成数千万元 Pre-A 轮融资', '主打线上兴趣课程与线下康养基地结合', '亿欧（虚构示例）', 'https://www.iyiou.com/example-12', 72, 68, '2026-09-30', '正常', ''],
    [2, '政策', '智慧健康养老应用试点示范申报启动', '通知明确支持智慧照护、健康监测等场景', '工信部官网', 'https://www.miit.gov.cn/example-13', 90, 78, '2026-10-01', '正常', ''],
    [3, '专利', '人形机器人灵巧手专利公开量同比翻倍', '国内申请人占比首次超过一半，整机之外零部件创新活跃', '专利数据库统计（虚构示例）', 'https://example.com/patent-14', 65, 72, '2026-10-03', '正常', ''],
    [3, '融资', '商用清洁机器人运营商 B 轮融资，估值创新高', '规模化验证「设备+运营」模式，单点盈利模型跑通', '界面新闻（虚构示例）', 'https://www.jiemian.com/example-15', 78, 82, '2026-10-04', '正常', ''],
    [4, '技术', '产品碳足迹数据库国标发布，核算工具面临改造', '新国标统一排放因子口径，存量工具需数据源切换', '国家标准全文公开系统', 'https://openstd.samr.gov.cn/example-16', 85, 75, '2026-09-29', '正常', ''],
    [1, '融资', '某 AI 招聘企业被传完成 3 亿元 C 轮，金额待确认', '仅见于社交平台爆料，无工商与官方信息佐证', '社交媒体传闻', 'https://example.com/rumor-17', 30, 60, '2026-09-28', '待核实', '多源交叉验证中，暂不纳入统计'],
    [5, '融资', 'AI 心理健康平台获大额融资', '海外类似模式已验证，国内尚早', '海外科技媒体', 'https://example.com/news-18', 55, 55, '2026-10-02', '转参考', '与主业协同弱，转入全球参考栏目'],
    // 第3周 2026-10-05 ~ 10-11
    [1, '技术', '某头部模型厂商发布 HR 行业解决方案，联合多家服务商', '模型厂商下场做行业方案，渠道竞争加剧', '厂商发布会实录', 'https://example.com/launch-19', 80, 76, '2026-10-07', '正常', ''],
    [2, '招聘', '长三角养老机构集中采购智慧照护系统，招标金额环比上升', '政府采购网单周 6 条相关中标公告', '政府采购网', 'https://www.ccgp.gov.cn/example-20', 85, 74, '2026-10-08', '正常', ''],
    [3, '资本', '地方国资设立具身智能专项基金，首期规模 20 亿元', '基金明确投向整机、零部件与场景运营三类标的', '证券时报（虚构示例）', 'https://www.stcn.com/example-21', 82, 78, '2026-10-09', '正常', ''],
    [4, '政策', '多省发布绿色供应链推广目录，纳入碳数据服务商', '目录内企业可获得政府采购与金融支持倾斜', '省发改委官网', 'https://example.com/policy-22', 82, 70, '2026-10-10', '正常', ''],
    [1, '政策', '网传「AI 招聘算法备案新规本周出台」', '未在官方渠道检索到对应文件', '微信群传文', '', 20, 55, '2026-10-06', '排除', '检索不到官方出处，判定为不实信息'],
    [3, '技术', '某融资稿件称「人形机器人已实现全场景商用」', '与多方实测信息矛盾，属营销夸大', '企业软文', 'https://example.com/pr-23', 25, 58, '2026-10-09', '降级', '表述夸大，仅作情绪参考不计入判断依据']
  ];
  for (const s of sigs) {
    await conn.query('INSERT INTO signals (direction_id, type, title, content, source_name, source_url, confidence, strength, occurred_at, status, verify_note) VALUES (?,?,?,?,?,?,?,?,?,?,?)', s);
  }

  /* ---------- 周报 ---------- */
  const reports = [
    ['第 1 周', '2026-09-21', '2026-09-27', '已复核', '本周重点：AI+人力资源科技方向政策与融资双共振，建议作为首攻方向；银发经济支付端扩围属高置信政策信号，建议启动 Watchlist。共扫描公开信息 1,856 条，进入候选池 19 家，按边界与评分推荐 4 家。', '投资团队已完成复核，2 家标记「继续研究」。', 1856, '2026-09-27 18:00', 'fuyifan'],
    ['第 2 周', '2026-09-28', '2026-10-04', '已生成', '本周重点：具身智能服务化模式获资本验证（清洁机器人运营商盈利模型跑通），建议纳入下一轮寻源；AI+HR 出现模型厂商下场信号，渠道卡位时间窗收窄。共扫描 2,102 条，新增候选 4 家。', '1 条融资传闻待核实，1 条海外信号转入全球参考。', 2102, '2026-10-04 18:00', 'fuyifan'],
    ['第 3 周', '2026-10-05', '2026-10-11', '草稿', '本周重点：地方国资设立具身智能专项基金，产业链缺口寻源窗口打开；养老机构智慧化采购放量，验证银发方向 B 端付费能力。共扫描 1,978 条，新增候选 2 家。', '本期为草稿，待投资团队复核后发布。', 1978, null, 'fuyifan']
  ];
  for (const r of reports) await conn.query('INSERT INTO reports (week_label, period_start, period_end, status, summary, note, scanned, published_at, created_by) VALUES (?,?,?,?,?,?,?,?,?)', r);

  /* ---------- Watchlist ---------- */
  const wl = [
    ['企业', '岗直聘智能科技', 1, 'A 轮完成后 3 个月内跟踪其大客户签约与续约情况', '监测中'],
    ['企业', '颐年智护（虚构）', 2, '跟踪长护险扩围城市的订单落地节奏', '监测中'],
    ['关键词', '具身智能 租赁', 3, '监测新成立租赁运营商与融资事件', '监测中'],
    ['赛道', 'AI+人力资源科技', 1, '每周固定汇总该赛道融资与技术信号', '监测中'],
    ['企业', '碳迹云（虚构）', 4, '关注国标切换对其产品的改造能力与客户留存', '监测中']
  ];
  for (const w of wl) await conn.query('INSERT INTO watchlist (target_type, name, direction_id, note, status) VALUES (?,?,?,?,?)', w);

  /* ---------- 产业链缺口 ---------- */
  const gaps = [
    [1, '垂直大模型匹配引擎', '集团岗位库数据的规模化利用缺少专用模型层，通用大模型直接调用效果与成本均不理想，需要垂类引擎伙伴补齐', '高', '开放'],
    [2, '会展观众数据资产化工具', '观众行为数据尚未形成可复用的资产，缺少采集、脱敏与洞察分析一体化工具', '高', '开放'],
    [3, '照护服务调度与培训 SaaS', '照护人力排班、培训认证与质量追溯缺少一体化系统，服务交付效率存在瓶颈', '中', '开放'],
    [4, '供应链碳足迹核算服务', '外贸客户碳核查需求快速上升，集团贸易服务链缺少碳数据服务能力', '中', '开放']
  ];
  for (const g of gaps) await conn.query('INSERT INTO chain_gaps (direction_id, segment, description, severity, status) VALUES (?,?,?,?,?)', g);

  /* ---------- 候选企业 ---------- */
  const comps = [
    ['岗直聘智能科技', '上海岗直聘智能科技有限公司', 'AI 招聘 / 垂直大模型', '上海', 'A轮', 2022,
      '面向中大型企业的 AI 招聘匹配引擎，基于自研垂类模型提供岗位-人才双向匹配与面试初筛，已服务 60 余家企业客户，ARR 约 1,800 万元（虚构）。',
      'https://example.com/gangzhipin', '融资披露 + 行业调研', 1, '高', '继续研究', '第 1 周'],
    ['衡才云', '杭州衡才云网络科技有限公司', '人才测评大模型', '杭州', 'Pre-A', 2023,
      '将心理测量学与 LLM 结合的人才测评 SaaS，服务校招与蓝领批量招聘场景，与多家培训机构合作（虚构）。',
      'https://example.com/hengcaiyun', '行业数据库', 1, '中', '候选', '第 1 周'],
    ['展视数智', '上海展视数智科技有限公司', '会展 AI 数字人', '上海', 'A轮', 2022,
      '为大型展会提供 AI 数字人导览、多语种翻译与观众洞察分析，已服务 8 个头部展会（虚构）。',
      'https://example.com/zhanshi', '展会实地调研 + 融资披露', 2, '高', '继续研究', '第 1 周'],
    ['云枢会展科技', '深圳云枢会展科技有限公司', '展会数据资产平台', '深圳', 'B轮', 2021,
      '展会主办方 SaaS，提供展商-观众匹配与数据资产化管理，华南市场占有率高（虚构）。',
      'https://example.com/yunshu', '融资披露', 2, '中', '候选', '第 2 周'],
    ['颐年智护', '上海颐年智护科技有限公司', '智慧养老照护', '上海', 'A轮', 2021,
      '智慧照护 SaaS + 智能监测硬件，服务养老机构与居家照护场景，覆盖 200 余家机构（虚构）。',
      'https://example.com/yinian', '政府采购公告 + 融资披露', 3, '高', '候选', '第 2 周'],
    ['银龄伴学', '成都银龄伴学教育科技有限公司', '老年教育', '成都', 'Pre-A', 2023,
      '线上老年兴趣课程与线下康养基地结合，单城市模型已验证（虚构）。',
      'https://example.com/yinling', '融资披露', null, '中', '暂缓', '第 2 周'],
    ['灵动机器人运营', '苏州灵动机器人运营有限公司', '具身智能租赁运营', '苏州', 'A轮', 2022,
      '面向中小工厂的搬运与分拣机器人租赁及运维服务，按台月费收费，在管设备超 1,200 台（虚构）。',
      'https://example.com/lingdong', '产业调研', null, '中', '候选', '第 3 周'],
    ['碳迹云', '上海碳迹云数据科技有限公司', '供应链碳足迹核算', '上海', 'Pre-A', 2023,
      '面向外贸企业的产品碳足迹核算与 ESG 数据服务，已接入 3 家头部认证机构（虚构）。',
      'https://example.com/tanji', '行业数据库 + 政策研究', 4, '中', '候选', '第 3 周'],
    ['康诺云诊', '北京康诺云诊科技有限公司', 'AI 慢病管理', '北京', 'B轮', 2020,
      'AI 慢病随访与用药管理平台，主要面向医院与药企（虚构）。',
      'https://example.com/kangnuo', '融资披露', null, '弱/待验证', '候选', '第 2 周'],
    ['职通湾', '上海职通湾科技发展有限公司', '跨境职业资格互认', '上海', 'A轮', 2022,
      '大湾区与长三角跨境职业资格培训与互认服务，连接海外认证机构（虚构）。',
      'https://example.com/zhitongwan', '行业调研', null, '中', '候选', '第 1 周']
  ];
  for (const c of comps) {
    await conn.query('INSERT INTO companies (name, full_name, track, region, round, founded_year, description, website, source, gap_id, synergy_level, status, week_label) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', c);
  }

  /* ---------- 评分（6 维度） ---------- */
  // 维度 id: 1行业前景 2战略协同 3能力稀缺性 4团队质量 5阶段与估值 6数据合规
  const scores = [
    [1, 1, 90, 'AI+HR 赛道增速高，政策明确鼓励'], [1, 2, 95, '与集团岗位库/客户渠道双向赋能清晰'], [1, 3, 82, '垂类模型微调数据存在壁垒'], [1, 4, 78, '创始团队出身头部人力资源科技企业'], [1, 5, 75, 'A 轮估值与同赛道可比基本持平'], [1, 6, 70, '涉简历个人信息，合规体系初步建立'],
    [2, 1, 80, '测评赛道稳定增长，蓝领场景空间大'], [2, 2, 70, '可与培训业务打包，协同路径中等'], [2, 3, 68, '测评常模数据有积累但可复制'], [2, 4, 72, '学术背景强，商业化经验待验证'], [2, 5, 80, 'Pre-A 阶段估值合理'], [2, 6, 75, '测评数据合规风险中等'],
    [3, 1, 85, '展会数字化需求确定性高'], [3, 2, 92, '直接服务集团会展主业，协同最深'], [3, 3, 78, '多语种数字人技术与场景Know-how结合'], [3, 4, 76, '团队有大型展会运营背景'], [3, 5, 72, 'A 轮估值偏高，需谈判'], [3, 6, 80, '观众数据脱敏方案完善'],
    [4, 1, 70, '展会 SaaS 竞争激烈，区域壁垒为主'], [4, 2, 55, '与集团主业区域重叠度低'], [4, 3, 60, '产品可被通用工具部分替代'], [4, 4, 70, '团队成熟，B 轮后扩张较快'], [4, 5, 55, 'B 轮估值偏高'], [4, 6, 72, '数据合规体系较完善'],
    [5, 1, 88, '长护险扩围驱动机构数字化采购'], [5, 2, 85, '照护人力供给与培训体系可协同'], [5, 3, 80, '硬件+SaaS 一体化有一定壁垒'], [5, 4, 74, '团队兼具养老运营与 SaaS 背景'], [5, 5, 76, '估值合理，退出路径清晰'], [5, 6, 72, '健康数据合规要求高，已等保三级'],
    [6, 1, 72, '老年教育需求真实但付费分散'], [6, 2, 58, '与主业协同有限'], [6, 3, 55, '内容同质化程度较高'], [6, 4, 65, '创始团队执行力尚可'], [6, 5, 70, 'Pre-A 估值合理'], [6, 6, 75, '合规风险低'],
    [7, 1, 82, '租赁运营模式资本验证中'], [7, 2, 68, '可纳入人机混合用工调度探索'], [7, 3, 66, '运维网络具备一定壁垒'], [7, 4, 70, '团队来自头部设备厂商'], [7, 5, 68, '重资产模式需关注现金流'], [7, 6, 78, '合规风险低'],
    [8, 1, 78, '碳核算政策驱动明确'], [8, 2, 72, '可与贸易服务链捆绑交付'], [8, 3, 64, '工具同质化，依赖认证机构资源'], [8, 4, 68, '团队背景互补'], [8, 5, 78, 'Pre-A 估值合理'], [8, 6, 82, '数据处理合规要求高，体系较完善'],
    [9, 1, 75, 'AI 医疗景气度高'], [9, 2, 40, '与主业协同弱，暂无落地路径'], [9, 3, 70, '医疗数据与算法有壁垒'], [9, 4, 72, '团队医疗资源深厚'], [9, 5, 60, 'B 轮体量偏大'], [9, 6, 65, '医疗数据合规要求极高'],
    [10, 1, 70, '跨境资格互认处于早期'], [10, 2, 66, '与培训及跨境服务存在协同想象'], [10, 3, 62, '认证资源合作有一定独占性'], [10, 4, 66, '团队国际化背景好'], [10, 5, 74, '估值合理'], [10, 6, 72, '合规风险中等']
  ];
  for (const s of scores) {
    await conn.query('INSERT INTO company_scores (company_id, dimension_id, score, rationale) VALUES (?,?,?,?)', s);
  }

  /* ---------- 复核留痕 ---------- */
  const logs = [
    [1, 2, '标记：继续研究', '垂类引擎与集团数据资产契合度高，进入人工尽调，已约管理层访谈。'],
    [1, 2, '评分确认', '六维度加权总分 85.3，战略协同维度由 AI 建议值 95 复核确认为 95。'],
    [3, 2, '标记：继续研究', '与会展主业协同最深，优先安排展会现场验证。'],
    [6, 2, '标记：暂缓', '付费分散、与主业协同有限，持续观察不投入尽调资源。']
  ];
  for (const l of logs) await conn.query('INSERT INTO review_logs (company_id, user_id, action, note) VALUES (?,?,?,?)', l);

  /* ---------- 四问逻辑 ---------- */
  const fq = [
    [1,
      '大模型推理成本下降使智能匹配进入规模化商用区间；政策端多地将其纳入数字化改造补贴目录；赛道单周 3 起 A 轮前后融资，产业资本加速卡位，领先窗口预计 12—18 个月。',
      '招聘行业从「关系型交付」转向「算法型交付」，岗位库与人才库构成数据飞轮；垂类模型在复杂简历场景已显著超越通用模型，专用引擎将成为行业基础设施。',
      '自研垂类匹配引擎经 60 余家企业客户验证（虚构），ARR 增速与续约率健康；创始团队出身头部人力资源科技企业，兼具算法与交付能力。',
      '集团岗位库与人才库可显著加速其模型迭代（数据协同）；数千家企业客户是其理想分销渠道（渠道协同）；反过来其匹配引擎可提升集团招聘交付效率并沉淀 AI 能力（能力反哺）。投资协同评分 95/100。',
      ['人社部门年度工作要点（官网）', '投中网融资统计（虚构示例）', '第三方模型测评报告（虚构示例）', '企业访谈与融资披露']],
    [3,
      '下半年大型展会与赛事排期密集，主办方从「卖展位」转向「卖效果」，数字化工具预算刚性增长；同赛道 2 起 A 轮融资落地，验证资本判断。',
      '会展数字化的核心瓶颈在「数据资产化」：观众行为数据缺少采集、脱敏与洞察的一体化工具；AI 数字人与实时翻译成熟度刚越过商用门槛。',
      '已服务 8 个头部展会的数字人导览与洞察分析（虚构），多语种能力与场景 Know-how 结合形成交付壁垒；团队具备大型展会运营背景。',
      '集团展会资源是其天然试验田与品牌背书；其工具可提升集团展会的观众洞察与招商转化；数据资产化经验可沉淀为集团会展数据能力。投资协同评分 92/100。',
      ['主办方公开访谈（虚构示例）', '界面新闻融资报道（虚构示例）', '展会实地调研记录']],
    [5,
      '长护险试点扩围新增 11 城，机构数字化采购进入放量期；政府采购网单周 6 条智慧照护中标公告，B 端付费能力被持续验证。',
      '照护行业人力缺口倒逼「设备替人 + 系统提效」，智慧照护 SaaS 与监测硬件一体化供应商稀缺。',
      '覆盖 200 余家机构的 SaaS+硬件一体化交付（虚构），等保三级资质齐备；团队兼具养老运营与 SaaS 背景。',
      '集团灵活用工与技能培训可输送照护人力并共建培训认证体系（人力协同）；员工福利渠道可分发其服务（渠道协同）；园区可落地康养样板点（场景协同）。投资协同评分 85/100。',
      ['国家医保局扩围公告', '政府采购网中标公告', '企业官网与融资披露']]
  ];
  for (const f of fq) {
    await conn.query('INSERT INTO four_questions (company_id, why_now, why_sector, why_company, why_dlg, sources, status, updated_by) VALUES (?,?,?,?,?,?,?,?)',
      [f[0], f[1], f[2], f[3], f[4], JSON.stringify(f[5]), 'AI生成+人工确认', 'fuyifan']);
  }

  /* ---------- 知识资产 ---------- */
  const kn = [
    ['产业研究', 'AI+人力资源科技赛道图谱（2026 版）', '梳理产业链上中下游：基础模型层（通用大模型厂商）、垂类引擎层（匹配/测评/面试）、应用层（招聘 SaaS、灵活用工平台）、服务层（交付与合规）。当前缺口集中在垂类引擎层；投资优先级：垂类引擎 > 应用层差异化 > 服务层整合。', ['AI', '人力资源', '赛道图谱'], 'fuyifan'],
    ['产业研究', '银发经济服务模式研究', '三类模式对比：机构智慧化（SaaS+硬件，B 端付费已验证）、居家照护服务（人力密集、依赖长护险）、老年文教（C 端付费分散）。建议优先布局机构智慧化与照护人力供给侧。', ['银发经济', '康养', '模式研究'], 'fuyifan'],
    ['产业研究', '具身智能商业化路径扫描', '整机厂主导「卖设备」，运营商以租赁切入中小工厂；单点盈利模型取决于设备利用率与运维密度。与人力资源行业结合点：人机混合用工调度、机器人运维新职业培训。', ['具身智能', '租赁运营'], 'invest02'],
    ['历史项目', '某 AI 面试产品合作评估复盘', '评估结论：产品对通用大模型依赖度高、差异化不足，未进入尽调。教训：对「套壳型」产品须验证模型自主性与数据积累路径。', ['复盘', 'AI 面试'], 'fuyifan'],
    ['历史项目', '某会展科技公司合作评估复盘', '评估结论：观众数据采集合规方案不完善，暂缓合作。教训：会展场景个人信息采集须前置合规审查。', ['复盘', '会展', '合规'], 'invest02'],
    ['方法论', '弱信号识别与信噪比评估手册', '五步法：① 全量采集并去重；② 按方向分类打强度分（1—100）；③ 置信度低于 40 分一律待核实；④ 连续 2 周无佐证的信号自动降级；⑤ 每周复盘误报率并更新阈值。信噪比 = 正常信号 /（正常 + 降级 + 排除）。', ['方法论', '弱信号'], 'fuyifan']
  ];
  for (const k of kn) {
    await conn.query('INSERT INTO knowledge_entries (type, title, content, tags, created_by) VALUES (?,?,?,?,?)', [k[0], k[1], k[2], JSON.stringify(k[3]), k[4]]);
  }

  /* ---------- 异常样本 ---------- */
  const exc = [
    ['轮次信息矛盾', '候选企业融资轮次在多源信息中不一致（工商 A 轮 / 媒体 B 轮）', '标记「待核实」，冻结评分与推荐，人工确认前不进入候选池统计', '已标记待核实并冻结，系统提示人工确认', '示例：某 AI 招聘企业 C 轮传闻（第 2 周）', '通过'],
    ['来源不可追溯', '信号仅有社交媒体截图，无原始出处', '置信度 ≤ 40 自动标记「转参考」，不计入方向判断依据', '已自动转入参考栏目并注明原因', '示例：AI 心理健康平台融资（第 2 周）', '通过'],
    ['企业已上市', '候选池监测发现企业已提交上市辅导备案', '自动移出「早期未上市候选池」，转入上市企业标杆参考', '已移出候选池并转入标杆参考栏目', '示例：云枢会展科技（虚构）若上市', '通过'],
    ['数据源矛盾', '融资金额两个来源相差 5 倍以上', '标记「待核实」并保留两处原文，禁止取均值或主观取舍', '已并列展示两处来源，标注待核实', '示例：某机器人运营商估值口径（第 3 周）', '通过'],
    ['信号超期失真', '政策信号发布超过 90 天仍被引用为「本周触发」', '自动降级为背景信息，不再计入本周 Why Now 依据', '已自动降级并在周报中移除', '示例：早期补贴政策（历史库）', '通过'],
    ['重复信号', '同一融资事件被 3 个来源重复推送', '按事件主键去重合并，保留最早与最权威来源', '已合并为单条并附多源链接', '示例：清洁机器人 B 轮报道（第 2 周）', '通过'],
    ['地域越界', '候选企业注册地在境外（新加坡）', '按投资边界移出境内候选池，转入全球技术与威胁雷达参考', '已移出并转入全球参考栏目', '示例：某跨境用工平台', '通过'],
    ['关联交易嫌疑', '候选企业与集团某供应商存在未披露关联关系', '标记「排除」并留痕，提交合规审查，禁止继续推进', '已排除并生成留痕记录', '示例：某外包服务商（第 3 周）', '通过']
  ];
  for (const e of exc) await conn.query('INSERT INTO exceptions (type, scenario, correct_action, actual_action, example, result) VALUES (?,?,?,?,?,?)', e);

  /* ---------- 活动日志 ---------- */
  const acts = [
    [2, '产业雷达', '生成周报', '生成第 3 周产业情报周报（草稿），汇总信号 22 条'],
    [2, '寻源与决策', 'AI 生成四问', '为「岗直聘智能科技」生成四问投资逻辑初稿'],
    [2, '知识大脑', '更新能力图谱', '补充「数据与技术服务」板块能力要素 2 项'],
    [3, '寻源与决策', '企业复核', '将「银龄伴学」标记为暂缓并注明原因']
  ];
  for (const a of acts) await conn.query('INSERT INTO activity_logs (user_id, module, action, detail) VALUES (?,?,?,?)', a);

  const [u] = await conn.query('SELECT COUNT(*) c FROM users');
  const [s] = await conn.query('SELECT COUNT(*) c FROM signals');
  const [co] = await conn.query('SELECT COUNT(*) c FROM companies');
  console.log(`✓ 初始化完成：用户 ${u[0].c}，信号 ${s[0].c}，企业 ${co[0].c}`);
  await conn.end();
}

main().catch(e => { console.error(e); process.exit(1); });
