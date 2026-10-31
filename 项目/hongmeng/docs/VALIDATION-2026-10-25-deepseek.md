# DeepSeek 与自由偏好 · 2026-10-25

## 本次实现

- 偏好中新增专业（80 字）、方向（200 字）、需求/基础（600 字）自由输入，版本化本机保存。保留原快捷分类，但不限制 AI 偏好。
- 新增 DeepSeek Key 安全保存、替换、确认删除和连接测试；使用 AssetStoreKit，DEVICE_UNLOCKED、THIS_DEVICE、OVERWRITE。安全存储不可用时明确失败，不回退到 Preferences 或源码明文。
- 发现页和偏好页可进入独立“AI 找比赛”页面。手机仍整页滚动，不把 AI 大块结果挤进原发现列表。
- 实际请求 DeepSeek Search API（/v1/tools/search），根据专业/方向执行最多三组检索，再使用 /chat/completions 分析公开候选来源。另一模式只分析现有国内赛事，不新增搜索。
- 固定官方接口域名，不提供任意网关；API 22 重定向拦截器不允许转发带凭证请求。连接测试仅 GET /models。
- 请求前确认数据发送和计费；无自动付费任务、隐式重试或后台调用。切后台/离开 Ability 时取消。错误保留历史报告。
- 仅展示通过国内候选和引用校验的线索；标题与 URL 直接取检索结果，AI 只能选已有 ID，证据必须逐字匹配输入资料。建议与来源信息分开呈现，来源标记“待核实”。
- 最近报告本机保存，标明运行时间、检索词、模式及当时使用的偏好。结果不自动导入已核实目录，不代报名或付费。

## 官方接口核对

2026-10-25 实读的官方资料：

- https://api-docs.deepseek.com/guides/search ：独立 Search / Fetch API，同一 Bearer API Key；真实搜索，不是聊天模型默认联网。
- https://api-docs.deepseek.com/api/search ：POST /v1/tools/search，query 最多 128 个 Unicode 字符，count 1–50，返回 results/title/url/snippet/summary/date 等。
- https://api-docs.deepseek.com/api/create-chat-completion ：deepseek-flash / deepseek-v4-pro、JSON 输出和关闭思考模式。
- https://api-docs.deepseek.com/ ：当前模型名称。

没有把历史 deepseek-chat / deepseek-reasoner 名称或网页端能力当作当前 API 合约。搜索与模型费用以官网规则和账号情况为准，不承诺免费。

## 已完成验证

- Hvigor：ArkTS 编译、打包、签名成功；最终包覆盖安装到 nova 12 Ultra 和 PC 模拟器。未变动 SDK、签名或包名。
- 逻辑测试 60/60：原 42 项 + 新增 18 项。覆盖偏好边界、URL 安全、国外条目排除、检索词长度、来源 ID/引用约束、空结果不生成、请求上限、数据最小化、错误脱敏、取消、密钥安全存储和重定向防护。
- nova 12 Ultra 新功能 14 项设备检查通过：入口、连续滚动、自由输入控件、保存当前偏好、重启恢复、配置状态、无 Key 本地拦截、返回发现和导航。没有输入或读取用户真实 Key。
- PC 模拟器新功能 18 项检查通过：上述相应页面检查，加系统安全存储写入/重启恢复/删除。仅使用明确无效的测试 Key 向官方 /models 验证 401 路径；没有执行搜索或内容生成。测试 Key 已确认删除并重启验证不存在。
- 原联网流程 17 项 PC 回归全部通过：两个国内来源更新、收藏/计划重启恢复、笔记保存与删除确认、公告标记、每日设置及隐私说明。测试创建的笔记与标记已还原。
- 真机截图已实际读取并检查偏好顶部和 AI 页；界面没有重叠，底部导航保持可用。测试截图输出为 JPEG，避免 snapshot_display 对 PNG 扩展名不支持导致伪成功。
- 测试脚本修正短控件裁剪识别，改用小步滑动；原先大幅滑动越过状态文字的失败是自动化定位问题，未以失败测试宣称通过。

## 仍未验证 / 已知边界

- **没有用户真实 Key，因此尚未验证真实鉴权成功、搜索权限、余额、付费调用与线上推荐质量。** 官方 401 路径和 mock 成功响应不能代表付费端到端已通。
- 搜索为三组受限查询，每组最多 10 条、近约 180 天页面，并不是全网穷举。保守国内域名/关键词过滤可能漏掉真实国内比赛，也不能数学上证明国内归属；用户仍应核实来源。
- 搜索摘要不是主办方保证，国内赛事也可能已过报名期。页面不会把发布日期冒充报名截止。
- AI 不加入每日自动检查；原每日检查仍仅针对已有固定来源，前台执行与打开补查，非服务器后台定时任务。
- Key 存储没有明文回退。手机本轮未输入任何真实或测试 Key；系统安全存储完整写入/读取/删除路径在 PC 模拟器验证。

## 复现

~~~bash
bash scripts/build.sh
/Applications/DevEco-Studio.app/Contents/tools/node/bin/node --test tests/model.test.cjs tests/radar.test.cjs tests/ai.test.cjs
HDC_TARGET=2UCUT24314003698 /Applications/DevEco-Studio.app/Contents/tools/node/bin/node tests/ai-device-smoke.cjs
TEST_FIXTURE_KEY=1 /Applications/DevEco-Studio.app/Contents/tools/node/bin/node tests/ai-device-smoke.cjs
~~~

设备测试保存当前页面已有偏好，不替换为测试专业。无效 Key 检查只在无已存密钥时执行，并在 finally 中确认删除；不会覆盖已有 Key。运行前确保目标设备解锁。不要并发操作同一台设备。
