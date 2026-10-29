# 来源、范围与材料归属

核对日期：2026-10-29。

## 选题与工具

1. Apache Commons CLI 官方 GitHub 仓库：https://github.com/apache/commons-cli
2. 固定源码：https://github.com/apache/commons-cli/tree/698b238276c0e22e97e4aec703a0b00201d29666
3. 项目官网：https://commons.apache.org/proper/commons-cli/
4. Apache Rat 官网：https://creadur.apache.org/rat/
5. 实际工具下载：https://repo.maven.apache.org/maven2/org/apache/rat/apache-rat/0.16.1/apache-rat-0.16.1.jar
6. Apache License 2.0 原文：https://www.apache.org/licenses/LICENSE-2.0

项目标签 `rel/commons-cli-1.9.0` 的 tag 对象为 `be78abd93d5f4ad7e82acdcc13ccc7243aae5806`，解引用后的 commit 为 `698b238276c0e22e97e4aec703a0b00201d29666`。2026-10-29 通过 `git ls-remote` 核实，见 `evidence/version-verification.txt`。官网页面可能随时间更新，本次实际使用版本以 JAR manifest 和 provenance.json 为准。

## 原文节选

`evidence/source-excerpts/` 来自上述固定提交的对应文件：`LICENSE.txt`、`NOTICE.txt`、`pom.xml`、`.gitignore`、`src/site/resources/download_cli.cgi`、`src/site/resources/profile.jacoco`。为便于查看，部分文件名加了 `.txt`，内容未改写。Commons CLI 原有 LICENSE 与 NOTICE 保留；引用材料不改为本仓库 MIT 授权。Unknown 文件的授权状态仍按报告分析，保存节选用于教育性审查不代表授予其新的许可证。

`evidence/apache-license-2.0.txt` 为 Apache 官方许可证文本；`apache-rat-0.16.1.pom`、`rat-official-page.html` 为工具的来源与功能参考；`rat-report.txt/xml` 是工具原始输出。报告中的统计由实际 XML 汇总，不能当成法律保证。

## 参考手册的使用边界

三份用户文档提供选题、格式和工具选型建议；正式功能与许可条件以固定版本工具帮助及许可证原文为准。尤其“GPL 仅修改并分发才有义务”“宽松许可随便用、保留声明即可”等简写不能作为结论。本文重点分析 Apache-2.0 的第3、4、6条，不从工具告警直接推出整个商业产品的合规状态。

老师的模板、要求与选型手册未重新分发，文件名与内容哈希记录于 `evidence/assignment-inputs.json`，便于核对本次依据。

## 扩展练习的补充来源

- 教师公开课程仓库：https://github.com/yifanlinshui/Sandau-Open-Source-Innovation-Thinking 。此前公开作业要求和模板的名称、SHA-256 保存在 evidence/course-assignment-inputs.json；本次三份用户文档记录在 evidence/assignment-inputs.json，两组来源各自保留。
- Jekyll v4.3.4 的 MIT 原文：https://github.com/jekyll/jekyll/blob/v4.3.4/LICENSE ，对应 evidence/jekyll-v4.3.4-LICENSE.txt，用于许可证比较练习。
- Git v2.47.0 的 COPYING 原文：https://github.com/git/git/blob/v2.47.0/COPYING ，对应 evidence/git-v2.47.0-COPYING.txt，用于核对 GPLv2 声明及第 2(b)、3 条的讨论。
- companion-exercises.md、components-inventory.csv 与个人网站四文件扫描保留为独立扩展材料，不计入五页主报告正文。

固定版本用于复现实验，不声称为最新版本。本地下载指纹用于完整性核对，不冒充发布者独立签名认证。个人网站快照中的旧班级与旧目录保留其历史扫描输入身份，当前信息以仓库首页及新报告为准。
