# 比赛雷达架构

## 组件

```mermaid
flowchart LR
  U[学生：专业/方向/目标] --> H[HarmonyOS App]
  U --> W[网页前端]
  H --> DS1[DeepSeek 官方 API]
  W --> B[Node.js 私有服务]
  B --> DS2[DeepSeek Search + Chat]
  B --> C[国内赛事目录]
  C --> S1[牛客自办赛事]
  C --> S2[4C 官方公告]
  B --> P[(按账号隔离的数据卷)]
  B --> R[证据校验与报告]
  R --> W
  R --> P
```

## Agent 状态流

```mermaid
stateDiagram-v2
  [*] --> ProfileSaved
  ProfileSaved --> QueryBuilt: 用户确认 AI 任务
  QueryBuilt --> Searching: 联网模式
  ProfileSaved --> CatalogReady: 已有目录模式
  Searching --> DomesticFiltered
  DomesticFiltered --> ModelSelecting
  CatalogReady --> ModelSelecting
  ModelSelecting --> EvidenceVerified
  EvidenceVerified --> ReportSaved: 有效证据
  EvidenceVerified --> EmptyReport: 无有效证据
  ReportSaved --> [*]
  EmptyReport --> [*]
```

## 网页账号与部署边界

```mermaid
flowchart LR
  V[浏览器] -->|HTTP 只读| Public[18081 公开服务]
  V -->|HTTPS / SSH 隧道| Proxy[可信入口]
  Proxy --> Private[Node 私有服务 18080]
  Private --> A[邮箱账号 + HttpOnly Session]
  A --> D[(个人偏好 / 收藏 / 计划 / 笔记 / AI 报告)]
  A --> K[(AES-256-GCM 加密的用户 Key)]
```

每个账号通过 `userId` 访问自己的个人数据和 AI 用量；公网只读服务不加载账号数据卷。普通 HTTP 不提供注册、登录或 Key 写入，因为密码和密钥会被明文传输。

## Tool Calling

联网模式首轮必须调用 `search_competitions`，目录模式首轮必须调用 `analyze_catalog`。Node 服务执行工具后，以 `role: tool` 把受限来源重新交给模型；最终结果再经过来源 ID 和逐字证据校验。这样“输入一句目标”可以完成检索、国内过滤、分析和保存，但模型不能直接生成未经来源支持的链接。

## 安全边界

- 公开 `18081` 容器只挂载赛事目录，只读，不挂载个人数据和 DeepSeek Key。
- 私有服务默认只监听服务器 `127.0.0.1:18080`，个人空间使用 HTTPS 或 SSH 隧道。
- HTTPS 反向代理需设置实际 `APP_ORIGIN` 和 `TRUST_PROXY=1`，并禁止公网直接访问 18080。
- 用户 API Key 使用服务器 `DATA_ENCRYPTION_KEY` 加密后落盘，响应只返回是否已配置，不返回 Key。
- AI 报告只接收保存的专业、方向、目标和公开赛事资料，不接收笔记、收藏 ID、计划 ID。
- API 返回的推荐必须引用输入来源 ID，并由本地证据校验后落盘。
