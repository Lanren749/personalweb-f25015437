# 许可证测试作业

宋佳威｜F2505437｜F250117｜上海杉达学院｜指导教师：祝欣蓉

对应 **第 2 章 / 平时作业 1：开源许可证分析**；主报告题为“许可证测试作业：Apache Commons CLI 合规分析”。

**AI 辅助实际实验与分析复核稿。** 扫描已执行并保留原始证据；课程禁止代写，因此本人应先复现、理解并按自己的分析修改后再提交。这些材料不表示本人已独立操作、完成学习或答辩。

## 文件入口

- [Word 报告](F250117-F2505437-宋佳威-许可证测试作业.docx)：教师原模板的封面及评价表，评分留空；正文宋体五号、英文 Times New Roman、1.25倍行距。
- [PDF 报告](F250117-F2505437-宋佳威-许可证测试作业.pdf)：由同一 DOCX 实际转换，验证含封面和评价表共5页。PDF 用本机 Songti SC 替代宋体；DOCX 的字体仍指定宋体。
- [Markdown 正文](F250117-F2505437-宋佳威-许可证测试作业.md)：可编辑正文。
- [companion-exercises.md](companion-exercises.md)：许可证比较、闭源商业集成案例及个人网站四文件子集实验；独立于五页主报告。
- [components-inventory.csv](components-inventory.csv)：基于扫描与人工复核的组件/材料清单，不是全仓自动 SBOM。
- [evidence/](evidence/)：原始 XML/TXT、下载和环境日志、来源/哈希、源码文件清单及补扫精确快照。
- [sources.md](sources.md)：原文链接和条款定位。教师公开资料的文件名与哈希见 evidence/course-assignment-inputs.json。

## 实验结果

Apache Commons CLI 1.9.0 固定 commit 698b238276c0e22e97e4aec703a0b00201d29666；Apache Rat 0.16.1。全部116个输入文件已覆盖：109 standard（106 Apache 头、3 unknown），3 notice，4 binary。未知项保持待核，未通过排除或改许可证来消除告警。

个人网站补扫只含 index.html、README.md、LICENSE、THIRD_PARTY_NOTICES.md 快照，得到1 MIT standard、1 notice、2 binary。两份 binary 实际为 UTF-8 中文文档，是工具分类局限；不能将0 unknown写成整体合规。photo.jpg只做人工清单，不在扫描或代码MIT授权中。

## 复现实验

需要Java、curl、tar、Python 3与互联网，在仓库根目录运行：

    bash 作业/许可证测试作业/scripts/reproduce-full.sh

脚本下载并校验固定工具与源码，在临时目录扫描全部源码和自有四文件快照，输出到本目录 reproduced/。不会覆盖原证据，不会修改上游源码。脚本实际运行通过；evidence/full-reproduction-check.json 记录除时间戳外两次结果一致。下载指纹不冒充发布者独立签名认证。

只复现 Apache Commons CLI 主报告可运行 bash 作业/许可证测试作业/scripts/reproduce.sh，默认结果保存在 .work/reproduced/。两个输出目录均已加入 Git 忽略规则。

scripts/summarize_full_rat.py 仅汇总真实 Rat XML 和核对文件范围，不是许可证扫描器。Rat不解析完整传递依赖、不审查图片权属、不作法律保证。

## 重新生成报告

需要python-docx、pypdf与LibreOffice（soffice）：

    python3 作业/许可证测试作业/scripts/build_report.py --template '/教师模板的绝对路径.docx'

若学校严格要求Windows宋体嵌入PDF，可在已安装宋体的Word/WPS中再次导出并确认五页以内。

## 本人应复核

1. 运行脚本并解释各类计数，逐项打开三个unknown文件。
2. 确认中文文档误分类及个人照片、经历、材料来源。
3. 阅读Apache/MIT/GPL官方原文，用自己的话修订条件分析。
4. 按教师要求补写自己的理解；保持教师评定栏为空。

报告文稿和个人信息不因仓库代码MIT声明变成MIT授权。第三方许可证、原文件节选继续受其自身许可约束。未随仓库再分发完整上游源码、JAR或系统字体。

报告生成器的输入仅为本目录已打包的 evidence/provenance.json、evidence/rat-report.xml 和通过 --template 显式指定的教师原模板。模板未打包；请从 sources.md 中的教师公开仓库获取，并可与 evidence/assignment-inputs.json 核对 SHA-256。旧命令 build_course_report.py 保留为兼容入口。无需私人目录或本机缓存。Mac 系统字体路径仅用于存在时启用的可选字体映射；其他系统使用已安装字体。只生成 Word/Markdown 时可加 --no-pdf，无需 LibreOffice 或 pypdf。

## 历史实验记录

本次统一更正当前报告、主页和说明中的班级，并调整作业名称与目录。evidence/own-site-inputs/ 保存的是此前实际扫描的四份网站文件，旧班级与旧路径属于当时的原始输入；扫描日志中的路径也保留原样，以便与 SHA-256 清单逐字节核对。它们不是当前网站或提交资料。

[返回作业目录](../README.md)
