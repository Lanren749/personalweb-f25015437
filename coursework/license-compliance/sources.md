# 来源、范围与材料归属

核对日期：2026-10-29。以下固定版本用于复现，不声称为最新版本。

## 项目与工具的官方来源

1. Apache Commons CLI 官方仓库：https://github.com/apache/commons-cli
2. 固定源码：https://github.com/apache/commons-cli/tree/698b238276c0e22e97e4aec703a0b00201d29666
3. 项目官网：https://commons.apache.org/proper/commons-cli/
4. Apache Rat 官网：https://creadur.apache.org/rat/
5. 实际工具下载：https://repo.maven.apache.org/maven2/org/apache/rat/apache-rat/0.16.1/apache-rat-0.16.1.jar
6. Apache License 2.0 原文：https://www.apache.org/licenses/LICENSE-2.0.txt
7. Jekyll v4.3.4 MIT 原文：https://github.com/jekyll/jekyll/blob/v4.3.4/LICENSE
8. Git v2.47.0 COPYING 原文：https://github.com/git/git/blob/v2.47.0/COPYING

项目标签 rel/commons-cli-1.9.0 的 tag 对象为 be78abd93d5f4ad7e82acdcc13ccc7243aae5806，解引用后的 commit 为 698b238276c0e22e97e4aec703a0b00201d29666。2026-10-29 通过 git ls-remote 核实，相关命令见 evidence/commands.txt，版本、来源和下载指纹见 evidence/provenance.json。官网页面可随时间更新，本次实验以固定源码和指定 JAR 为边界；本地 SHA-256 不冒充发布者独立签名验证。

## 原文节选与判断依据

evidence/source-excerpts/ 来自上述固定提交的 LICENSE.txt、NOTICE.txt、pom.xml、.gitignore、src/site/resources/download_cli.cgi、src/site/resources/profile.jacoco。为便于查看，部分文件名加了 .txt，内容未改写。原有 LICENSE 与 NOTICE 保留，引用材料不改为本仓库 MIT 授权。保存 Unknown 文件节选供审查，不代表授予其新的许可证。

evidence/apache-license-2.0.txt 为 Apache 官方原文；重点为第2条授权、第3条专利、第4条再分发和 NOTICE、第6条商标。evidence/jekyll-v4.3.4-LICENSE.txt 用于核对 MIT 的版权/许可声明保留要求；evidence/git-v2.47.0-COPYING.txt 用于核对项目 GPLv2 声明以及第2(b)、3条义务。项目顶层许可证不能自动覆盖所有依赖或素材。

evidence/apache-rat-0.16.1.pom 与 rat-official-page.html 为工具来源参考；rat-help.txt 为实际工具输出。rat-report.txt/xml 与 own-site-rat.txt/xml 是原始扫描结果。统计由 XML 汇总，不是法律保证。

## 教师公开作业与模板

教师公开仓库：https://github.com/yifanlinshui/Sandau-Open-Source-Innovation-Thinking

本次依据其中“第二章平时作业：开源软件许可证分析”目录的平时作业要求.docx和教师模板。要求包括选取开源项目、说明工具安装、给出检测结果并详细分析，报告不超过五页；模板要求宋体五号、英文 Times New Roman、1.25倍行距和空白教师评定栏。两份实际输入文件的名称与内容 SHA-256 记录于 evidence/course-assignment-inputs.json，未重新分发教师文档。

教师成绩评定标准禁止代写。因此本材料明确保留 AI 辅助实际实验与分析复核稿身份，学生须自行复现、理解并修改后再依要求提交。本文未采用所谓“三份用户文档”或额外选型手册作为来源。
