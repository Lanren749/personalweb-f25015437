import { Competition } from '../model/Competition';

// Fictional fixtures, not current event announcements. Never present as verified results.
export const DEMO_COMPETITIONS: Competition[] = [
  {
    id: 'demo-software', title: '软件应用开发挑战（示例）', organizer: '演示主办方',
    category: '软件开发', deadline: '2026-10-25', tags: ['ArkTS', '应用开发', '团队协作'],
    format: '作品提交 · 团队', accent: '#3366FF',
    description: '演示如何记录一个软件开发类竞赛。名称、主办方、日期均为测试数据，不对应真实报名活动。',
    deliverables: ['可运行的应用与代码仓库', '需求分析、架构说明和测试报告', '写清个人负责的功能，以及可复现的性能或体验改进']
  },
  {
    id: 'demo-cloud', title: '云与网络技能挑战（示例）', organizer: '演示主办方',
    category: '网络安全', deadline: '2026-11-15', tags: ['云计算', '网络安全', 'Linux'],
    format: '实验任务 · 团队', accent: '#D92D20',
    description: '演示云服务部署、网络配置与安全排障类任务。报名资格和赛事级别需在真实数据接入后核实。',
    deliverables: ['可重现的部署脚本与拓扑图', '故障定位记录和安全检查报告', '说明自己的排障过程与验证依据']
  },
  {
    id: 'demo-algorithm', title: '程序设计训练赛（示例）', organizer: '演示主办方',
    category: '算法竞赛', deadline: '2026-10-10', tags: ['算法', 'C++', '个人赛'],
    format: '在线编程 · 个人', accent: '#0B8F77',
    description: '已过期的演示条目，用于检查截止状态与筛选逻辑。系统不会把它计入即将截止赛事。',
    deliverables: ['题解与复杂度分析', '有依据的成绩或排名记录', '用例覆盖与算法优化过程']
  },
  {
    id: 'demo-ai', title: '人工智能应用挑战（示例）', organizer: '演示主办方',
    category: '人工智能', deadline: '2026-11-08', tags: ['AI', 'Python', '模型评估'],
    format: '方案与作品 · 团队', accent: '#7A5AF8',
    description: '演示一个 AI 应用项目的规划方式。这里不承诺奖金、实习、校招通道或获奖结果。',
    deliverables: ['数据处理与模型评估代码', '可复现实验和基线对照', '真实记录准确率、延迟或成本，并注明测试条件']
  },
  {
    id: 'demo-innovation', title: '创新产品方案挑战（示例）', organizer: '演示主办方',
    category: '创新创业', deadline: '2026-12-01', tags: ['产品设计', '需求调研', '原型'],
    format: '作品与答辩 · 团队', accent: '#C98013',
    description: '演示从需求调研到产品原型的项目实践。请根据个人参与情况记录简历材料。',
    deliverables: ['访谈记录与需求文档', '可演示的原型或最小可用产品', '记录个人贡献、用户反馈及迭代结果']
  }
];
