# 《开源 AI 技术实践》期末项目说明

## 1. 项目基本信息

- 项目名称：比赛雷达（Bisai Radar）
- 项目定位：面向计算机专业学生的中国国内竞赛发现、筛选和经历规划应用
- 选择路线：在已有普通应用中加入 Agent 能力
- 运行形态：HarmonyOS 手机/2in1 App + Node.js 网页版
- AI 服务：DeepSeek 官方 API（Key 只保存在服务端或设备安全存储）
- 代码仓库：[AtomGit](https://atomgit.com/a2736484/bisai-radar)

## 2. 为什么适合作为课程项目

这不是只返回一句聊天文本的 Demo。项目原本就有赛事采集、筛选、收藏、参赛计划和笔记功能，Agent 能力建立在这些可验证的业务对象上：

1. 用户填写专业、兴趣方向、目标和基础。
2. Agent 生成 3 组有时间范围的中文检索词。
3. `search_competitions` 工具调用 DeepSeek Search API 获取候选来源。
4. `filter_domestic_sources` 工具只保留中国国内赛事候选，排除国外赛事和不安全链接。
5. Agent 只能从带有来源 ID 的输入中选择推荐，不得编造标题、链接、日期或奖项。
6. `verify_evidence` 工具逐字核对推荐证据，合格结果才写入报告。
7. 页面展示推荐理由、下一步作品产出和原始来源，用户仍需自行核实报名资格和截止时间。

这条链路同时解决了一个真实问题：学生不是单纯想“问 AI 一个问题”，而是要从近期国内赛事中找到适合自己的实践机会，并把过程沉淀为可写入简历的真实成果。

## 3. Agent 能力与业务工具

| 工具 | 输入 | 输出 | 真实作用 |
| --- | --- | --- | --- |
| `build_search_queries` | 专业、方向、目标、当前日期 | 最多 3 条中文检索词 | 限定近期、高校/企业竞赛和国内范围 |
| `search_competitions` | 一条检索词 | 搜索来源列表 | 调用 DeepSeek Search API，限制请求次数和响应大小 |
| `filter_domestic_sources` | 来源列表 | 国内候选来源 | 校验 HTTPS、域名、国内文字线索和国外关键词 |
| `analyze_catalog` | 已采集的国内赛事 | 赛事来源列表 | 不联网分析已有资料，避免无必要的付费搜索 |
| `verify_evidence` | Agent 推荐 JSON、来源列表 | 合法推荐或空结果 | 校验来源 ID、逐字证据、国内属性和字段长度 |
| `save_report` | 通过校验的报告 | 本地持久化结果 | 原子写入并保留上一次有效报告 |

工具实现对应代码：

- 网页版 Agent 编排：[web/server/ai.mjs](../web/server/ai.mjs)
- 共用候选与证据校验：[entry/src/main/ets/model/Ai.ets](../entry/src/main/ets/model/Ai.ets)
- 网页接口和会话边界：[web/server/main.mjs](../web/server/main.mjs)
- 网页版前端调用：[web/public/app.js](../web/public/app.js)

## 4. 一次完整执行链

```text
专业/方向/目标
    |
    v
build_search_queries
    |
    +--> search_competitions (最多 3 次)
    |          |
    |          v
    +--> filter_domestic_sources (HTTPS + 国内归属线索)
               |
               v
        DeepSeek 结构化分析
               |
               v
        verify_evidence
               |
               v
        save_report -> 页面展示来源、理由、行动建议
```

程序把用户填写内容当作数据，不把其中的文字当作系统指令；来源网页也不会获得工具调用权限。没有候选来源时不会继续调用模型，失败不会自动重试付费请求。

## 5. 可复现运行

### 本地网页

```bash
cd web
npm ci --ignore-scripts
npm run build
npm test
npm start
```

打开 `http://localhost:18080/`。无 Key 时可以查看赛事和测试普通业务；要演示真实 AI，需要在自己的交互终端设置 `web/.env`，不能把 Key 写入命令行参数或提交到 Git。

### Docker 网页

```bash
cd web
cp .env.example .env
node scripts/setup-data-key.mjs
sudo docker compose up -d --build
```

启动后在 HTTPS 或 SSH 隧道页面注册账号，再到“我的偏好”输入自己的 DeepSeek Key。旧单人数据迁移才需要 `setup-password.mjs`；公开 HTTP 进程只提供赛事只读页面，不接受密码、个人数据或 API Key。

### HarmonyOS App

用 DevEco Studio 打开项目根目录，选择 phone 或 2in1 设备运行。命令行构建脚本为：

```bash
bash scripts/build.sh
```

## 6. 演示验收点

1. 打开“发现比赛”，搜索或筛选国内赛事，进入一个详情页查看官方来源。
2. 在“我的偏好”填写专业、方向和目标，保存后刷新验证持久化。
3. 在安全的本地/HTTPS入口进入“AI 找比赛”，选择“只分析已有国内比赛”展示低成本 Agent 流程。
4. 确认数据发送范围后执行联网搜索，展示检索词、来源证据、推荐理由和作品产出建议。
5. 说明 Agent 不会把笔记、收藏或计划上传，也不会把国外赛事混入国内推荐。
6. 打开“参赛计划”，记录个人职责、技术方案和真实成果，复制经历草稿。

建议课堂演示分为 8 分钟功能展示和 2 分钟问答：前 4 分钟展示普通应用与手机/网页入口，后 4 分钟展示 Agent 的工具调用、证据校验和个人数据隔离。没有域名时使用电脑 SSH 隧道打开私有网页；不要在公网 HTTP 页面输入密码或 Key。

## 7. 已知边界

- AI 推荐不是报名资格、截止时间、获奖概率或招聘承诺；最终以主办方官网为准。
- 国内筛选是保守的来源校验，不声称穷举全国全部赛事。
- DeepSeek 真实搜索可能产生费用，每日任务有服务端额度；失败也不会自动重试。
- 手机个人空间需要可信 HTTPS；无域名阶段通过电脑 SSH 安全通道演示，公网页面是只读模式。正式开放注册和个人 AI 前必须配置域名、可信证书和反向代理。
