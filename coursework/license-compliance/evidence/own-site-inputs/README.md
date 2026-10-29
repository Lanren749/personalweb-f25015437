# 宋佳威 · 个人主页与开源创新思维课程实践

上海杉达学院 · 大二 · **F25017 班** · **学号 F2505437**

本仓库整理个人简历网站、CANN 算子预研代码和开源许可证扫描实验。根据老师公开课程资料核对，整理日期为 **2026-10-29**。仓库地址中的 `f25015437` 保留原名；作业内学号以本人本次提供的 **F2505437** 为准。

> **学习与真实性说明**：新增代码、实验记录和分析文字由 AI 辅助完成，报告是供本人复现、理解和修改的复核稿。老师成绩标准明确禁止代写、抄袭和数据造假。上传仓库不等于完成本人学习、比赛报名或正式作业提交；请阅读 [AI 协作说明](docs/ai-assistance.md) 和 [提交清单](docs/submission-checklist.md)。

## 作业入口

| 教师资料中的任务 | 仓库材料 | 需要本人完成的环节 |
| --- | --- | --- |
| 9 月 17 日：个人仓库、简历网站、上传源码 | [index.html](index.html) / [网站使用说明](docs/website.md) | 核对原有简历经历与公开信息 |
| 9 月 24 日：CANN 报名、卡时、初步代码 | [CANN 预研代码和测试](coursework/cann/README.md) | 确认具体赛题、报名/补报、卡时领取、NPU 验证 |
| 10 月 8 日：开源项目许可证扫描分析，报告不超过 5 页 | [扫描报告与原始结果](coursework/license-compliance/) | 复现扫描、复核结论、用自己的理解修订报告 |
| 第 2 章课件：自己的课程项目组件清单 | [合规实验目录](coursework/license-compliance/) | 理解扫描边界与第三方材料归属 |
| 课程总评：视频、博客、认知考核、成果汇总 | [成果记录与提交清单](docs/submission-checklist.md) | 真实创作、真实平台数据、本人报告/答辩 |

## 快速运行

网站没有构建步骤和第三方前端依赖。下载仓库后直接打开 `index.html`，或运行：

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

浏览器访问 `http://127.0.0.1:8000`。桌面与手机均可使用，禁用 JavaScript 时正文仍可见。

CANN 示例的运行、测试与硬件限制请见 [coursework/cann/README.md](coursework/cann/README.md)。扫描报告的工具版本、原始输出与复现步骤请见 [coursework/license-compliance](coursework/license-compliance/)。

## 课程来源与范围

- [教师课程仓库](https://github.com/yifanlinshui/Sandau-Open-Source-Innovation-Thinking)，本次核对版本 `7eb78cf38a80d2517636a6b451fb5f6ab24bdf91`。
- 根目录《卓越班每周作业汇总.docx》《开源创新思维课程成绩评定标准.docx》。
- 第二章目录《平时作业要求.docx》及报告模板；课件《第2章 开源许可证（上课讲解）.pptx》第 28 页。
- 课程海报显示的 CANN 报名截止日期为 **2026-10-16**，早于本次整理日期；是否可以补报应向老师或主办方确认。
- 教师仓库未列明本课程统一结课截止日期，认知报告的最终格式仍以教师后续通知为准。

本仓库不把未发生的平台操作、比赛成绩、阅读量、播放量或商业转化写成完成记录，也不为凑数量创建无意义的提交或协作。

## 许可证与归属

本仓库原创程序代码采用 [MIT License](LICENSE)。照片、个人信息、报告文字及外部项目的许可证文本/扫描原始结果不自动适用该代码授权，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

欢迎针对真实问题提出 Issue 或提交 PR；贡献流程见 [CONTRIBUTING.md](CONTRIBUTING.md)。
