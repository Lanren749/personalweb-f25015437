# Career Radar · 比赛雷达

面向计算机专业的中国国内赛事与项目经历管理应用，支持 HarmonyOS 手机与 2in1。

## 课程作业交付

本项目按《开源 AI 技术实践》期末考查要求，选择“在普通应用中加入 Agent 能力”路线：在真实的赛事发现、筛选、收藏和参赛计划功能之上，使用 DeepSeek Search + Chat 完成国内赛事研究，并通过业务工具、Skill 和逐字证据校验约束模型输出。

这是我为大学生寻找比赛和规划项目经历制作的比赛雷达。公开副本保留 HarmonyOS App、网页版、共享赛事模型、来源过滤、AI 证据校验和测试代码，方便老师查看完整项目结构。

- 课程项目说明：[docs/COURSE-DELIVERABLE.md](docs/COURSE-DELIVERABLE.md)
- Agent Skill：[skills/competition-radar/SKILL.md](skills/competition-radar/SKILL.md)
- 架构图：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 现场演示脚本：[docs/DEMO-SCRIPT.md](docs/DEMO-SCRIPT.md)
- HTML 项目介绍：[docs/presentation.html](docs/presentation.html)
- AtomGit 仓库：https://atomgit.com/a2736484/bisai-radar

## 网页版（新增）

新增独立的 web/ 网页与服务器后端，原生 App 不变。支持手机/桌面浏览器、服务端北京时间每日采集、多用户邮箱注册登录、每用户独立的收藏计划笔记和 DeepSeek Key，以及手动 AI 研究。公开 HTTP 入口仅只读；个人空间需要 HTTPS 或电脑 SSH 安全通道。服务器部署、账号迁移、DeepSeek 私密配置、备份和限制见 web/README.md。原生 App 的本机数据不会自动迁移到网页版。

## 现在怎么用

1. 打开应用，点击右上角「联网更新」。首次启用自动检查时也会联网读取官方来源。
2. 在「近期赛程」看牛客自办算法赛；「官方公告」查看中国大学生计算机设计大赛通知。公告和开赛时间均不代表报名仍开放。
3. 打开详情，点「官方详情 / 报名」进入系统浏览器，核实资格、规则和报名时间，再自行报名。
4. 收藏或加入「报名计划」。在详情中填入记录提纲，补充个人职责、技术方案、代码链接和真实成果，选择阶段后保存。
5. 在「更新设置」设置每天的检查时间，也可进入腾讯、华为、蓝桥杯官网。
6. 在「偏好」自由填写专业、想发展的方向、需求和目前基础，然后点「保存我的偏好」。原分类按钮只作已有列表的快捷筛选，不再限制 AI 偏好。

## DeepSeek 与 AI 找比赛

1. 在手机「偏好 → DeepSeek 连接」粘贴自己的 API Key，点击「安全保存 Key」。**不要把 Key 发到聊天、写到源码或提交到版本库。**
2. 默认模型为 deepseek-flash，也可选择 deepseek-v4-pro。「测试连接」只读取官方模型列表，不生成内容；测试通过不代表搜索权限、余额或付费分析已验证。
3. 从发现页的「AI 找比赛」进入，或使用偏好页的同名入口。
4. 「联网搜索 + AI 推荐」最多执行 3 次实际搜索和 1 次模型分析，每次都先展示数据发送及费用确认。「只分析已有国内比赛」最多 1 次模型调用，不新增网页搜索。
5. 结果保留原检索标题、来源链接、发布日期（如有）、被引用的来源摘要、AI 匹配建议和建议作品产出。AI 只能引用输入来源的 ID，不能新增赛事链接；没有可信依据则不生成推荐。

接入依据为 2026-10-25 核对的 DeepSeek 官方文档：

- Search & Fetch： https://api-docs.deepseek.com/guides/search
- Search API： https://api-docs.deepseek.com/api/search
- Chat API： https://api-docs.deepseek.com/api/create-chat-completion
- 当前模型与调用方法： https://api-docs.deepseek.com/

应用固定请求 https://api.deepseek.com 的 /models、/v1/tools/search 和 /chat/completions。搜索接口和模型接口使用同一 DeepSeek Key；这不是把聊天模型的记忆包装为联网搜索，也不调用 DeepSeek 网页聊天界面。API 22 拦截器阻止鉴权请求的 HTTP 重定向，不允许把 Key 发往自定义网关。

### 搜索范围与限制

- 固定国内来源采集继续独立工作，不需要 Key。AI 搜索为额外能力，不修改既有赛事、收藏、计划和笔记。
- 搜索按自由填写的专业和方向，构造高校竞赛、国内企业挑战赛和企业赛事三组检索词，要求中文、近期约 180 天发布内容；最多读取 30 条去重候选。需求与基础用于模型匹配。并非无限代理或全国全部赛事穷举。
- 仅保留 HTTPS、公网格式、国内候选域名与国内赛事文字线索，排除已知国外比赛关键词，再由模型按国内限制选择；保守过滤会遗漏部分国内赛事。域名和文字不能绝对证明国内归属，推荐页明确标注“国内候选 · 来源待核实”。
- 搜索摘要不是主办方保证。报告不自动进入已核实官方赛事列表，也不自动收藏、报名或付款；打开外部来源需再次确认。报名资格、是否还开放、收费和截止时间必须自行核实原文。
- AI 建议不等于赛事事实，不承诺获奖、招聘或简历加分。不允许模型自造标题和链接，摘录必须能在输入资料逐字匹配。
- 没有国内候选时不调用模型；任何错误停止后续请求，不进行隐式付费重试。取消/切到后台会中断客户端请求，已发出的请求仍可能计费。失败保留上次报告。
- **AI 不加入每日自动更新**，不会静默调用付费服务。每日设置仍仅针对原固定来源的前台检查/打开补查。

### 密钥与数据

Key 使用 HarmonyOS AssetStoreKit，限当前设备、解锁时可读；不使用 Preferences 或文件明文回退。支持替换与确认删除；输入默认遮蔽，保存后清空，应用进入后台时清空未保存的 Key。安全存储不可用时会明确报错。

专业/需求/方向和最近一次 AI 报告保存在本机。报告使用应用私有文件完整写入后原子替换，不受普通偏好字符串长度限制；写入失败保留旧文件。只在没有报告文件时尝试迁移旧偏好中的有效报告，不删除旧记录。仅在确认 AI 操作后，将这些偏好和公开赛事内容发送给 DeepSeek；**不会上传参赛笔记、收藏 ID 或计划 ID**。搜索和模型服务可能计费，价格与账号权限以官方平台为准；不假定用户有余额或已开通。

分析已有比赛时，优先选取当前/近期赛程，再读取公告和历史条目。传入真实开赛/结束时间、当前赛程状态、资料读取时间和明确的未知报名截止；不把开赛时间当作报名截止。

当前已完成构建、无真实 Key 的页面验证及模拟响应测试；真实 Key 的鉴权、搜索权限、扣费和生成质量仍需用户在设备输入后验证。不要将 mock 测试等同于线上端到端成功。

## 当前功能与覆盖范围

- 自动读取两个国内来源：牛客自办算法赛、中国大学生计算机设计大赛组委会大赛动态；不需要购买 API 密钥。
- 牛客只收录已核实主办方的自办周赛、小白月赛、练习赛、挑战赛，不收录平台转载的国外赛程。算法赛程保留近 7 天结束的比赛及未来 120 天内赛程；4C 公告读取当前列表页、保留近 400 天发布内容。未遍历历史分页，也不代表全国全部赛事。
- Codeforces、AtCoder 已停止自动请求；旧缓存中的国外赛事不再展示。旧收藏标记、计划和笔记保留在本机，未做删除。
- 腾讯广告算法大赛、华为云大赛、蓝桥杯是**手动官网入口**，不声称已接入这些交互页面的自动采集。
- 搜索标题、主办方、方向、技能及说明；筛选近期赛程、进行中、官方公告、已结束。默认优先展示近期赛程，其次最新公告。
- 保存官方链接、读取时间、开赛时间或公告发布日期；不虚构报名截止时间、奖金、招聘机会或简历匹配分。
- 收藏、个人报名计划、阶段、参赛笔记与设置保存在设备；支持记录提纲、复制经历草稿、未保存退出确认和清除确认。
- 多来源独立失败处理，保留失败来源缓存；已收藏或加入计划的条目即使移出最新列表也尽量保留。缓存写入临时文件后原子替换。
- 手机发现页使用一个连续滚动列表：标题、搜索、方向筛选、更新状态和赛事卡片一起滚动，移除占空间的大统计卡；上滑后赛事可使用完整内容区。顶部品牌栏和底部导航常驻，点击底部入口回到对应列表顶部。桌面保留多栏布局。

## 每日更新的实际行为

时间采用北京时间。开启后，应用在前台每分钟检查是否到点；错过当天检查时间会在下次打开/回到前台时补查。失败后的自动重试至少间隔 15 分钟。手动按钮可以立即重试，各来源显示实际成功或失败结果。

**应用完全退出、设备休眠时不保证准点执行**；当前没有服务器定时采集、系统后台任务或系统通知。它不是后台全天候全网搜索服务。下一阶段如需这些能力，需要配置并验证服务端采集及通知方案，不能仅靠保存一个时间实现。

## 隐私与数据保留

笔记、收藏和计划不上传。固定来源更新请求官方公开页面；AI 操作按上节说明额外请求 DeepSeek。已核实赛事链接受域名白名单限制；AI 候选来源须通过 HTTPS 安全格式检查并由用户确认后打开。官网登录及报名交给系统浏览器。重要笔记请用「复制经历草稿」自行备份；卸载或清除应用数据可能丢失本地记录。个人阶段和计划不代表已向主办方报名成功。

旧演示收藏标记不自动删除；若对应条目不在真实列表中，页面会说明。演示数据文件仅用于回归测试，不再用于应用首页。

## 构建与运行

使用 DevEco Studio 打开当前目录。可运行于 HarmonyOS phone 与 2in1，公开源码不含本机签名材料，请在 DevEco Studio 中为自己的设备配置自动签名。

当前源码包内运行 64 项 App 业务逻辑测试、22 项网页版服务测试，网页共享模块构建通过。鸿蒙原生工程的设备安装与发布仍需使用本机 DevEco Studio 和设备完成。

- targetSdkVersion: 6.1.0(23)
- compatibleSdkVersion: 6.0.2(22)
- 实测设备: PC 模拟器 / API 22 / Release；华为 nova 12 Ultra（USB 连接，安装与启动成功）

终端可执行：

```bash
bash scripts/build.sh
```

构建脚本只在本进程使用 DevEco 自带 Node 和 SDK，避免终端旧的 DEVECO_SDK_HOME 干扰，不修改系统配置。若 DevEco 不在默认位置，可设置 DEVECO_APP_CONTENTS。

## 文件结构

- entry/src/main/ets/pages/Index.ets：页面、响应式布局和交互状态。
- entry/src/main/ets/model/Competition.ets：纯业务类型、日期、筛选、排序与校验。
- entry/src/main/ets/model/Radar.ets：更新调度判断、安全链接、缓存合并与记录类型。
- entry/src/main/ets/data/OfficialSources.ets：官方自动来源和手动入口。
- entry/src/main/ets/data/DemoCompetitions.ets：旧演示的测试夹具，不进入在线列表。
- entry/src/main/ets/services/FeedParsers.ets：官方 API / HTML 解析器。
- entry/src/main/ets/services/RadarService.ets：请求超时、独立失败与本地缓存。
- entry/src/main/ets/services/LocalStore.ets：设备本地持久化。
- entry/src/main/ets/model/Ai.ets：自由偏好、检索词、国内候选与引用校验。
- entry/src/main/ets/services/AiKeyStore.ets：系统安全存储中的 Key 生命周期，不做明文回退。
- entry/src/main/ets/services/AiService.ets：DeepSeek 模型检查、真实搜索、结构化分析及取消。
- entry/src/main/ets/services/AiReportStore.ets：长报告私有文件存储、完整写入校验及原子替换。
- tests/ai.test.cjs：AI 解析、来源校验、接口错误、取消、隐私与安全存储模拟测试。
- tests/ai-device-smoke.cjs：手机/PC 新页面、偏好保存及无 Key 引导；可选无效测试 Key 验证，避免覆盖现有密钥。
- tests/model.test.cjs：日期、筛选和存储失败回归测试。
- tests/radar.test.cjs：解析、定时补查、安全链接、断网及缓存失败测试。
- tests/live-device-smoke.cjs：当前版本的联网模拟器检查；只清理测试创建的收藏、计划和笔记。
- tests/device-smoke.cjs：旧离线演示的历史测试，不适用于当前真实数据版本。

运行纯逻辑测试：

```bash
/Applications/DevEco-Studio.app/Contents/tools/node/bin/node --test tests/model.test.cjs tests/radar.test.cjs tests/ai.test.cjs
```

设备检查需要先安装最新签名包、启动应用并让设备上线，测试默认连接 127.0.0.1:5555，可通过 HDC_TARGET 改写：

~~~bash
/Applications/DevEco-Studio.app/Contents/tools/node/bin/node tests/live-device-smoke.cjs
~~~

联网检查依赖来源可访问且有近期赛程。脚本不接受输入法协议，不自动操作真实报名。记录输入流程用内置提纲验证保存与重启恢复；真实键盘输入仍需用户完成小艺输入法首次设置后另测。

DeepSeek 与自由偏好初版验证见 docs/VALIDATION-2026-10-25-deepseek.md；后续持久化与赛程上下文修复见 docs/VALIDATION-2026-10-26-ai-hardening.md；国内来源与整页滚动更新见 docs/VALIDATION-2026-10-25-domestic.md；历史版本验证见 docs/VALIDATION-2026-10-19.md。

## 本次恢复

2026-10-18 检查时项目无 Git 历史。恢复依据是本任务中此前的浅色 Career Radar 界面和三栏结构；在此基础上修复交互与数据逻辑，并非逐字恢复旧源码。

原开发目录曾保留深色“赛道罗盘”首页的本地恢复备份；公开副本不携带该恢复目录，也不携带签名证书或密码。SDK 兼容配置已保留，设备签名需要在 DevEco Studio 中重新配置。
