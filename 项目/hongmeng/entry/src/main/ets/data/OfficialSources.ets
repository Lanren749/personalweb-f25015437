import { SourceInfo } from '../model/Radar';

export const OFFICIAL_SOURCES: SourceInfo[] = [
  { id: '4c', name: '中国大学生计算机设计大赛', url: 'https://jsjds.blcu.edu.cn/dsdt.htm', automatic: true,
    description: '读取组委会大赛动态；公告不等于开放报名。请结合本校校赛通知核实资格与时间。' },
  { id: 'nowcoder', name: '牛客自办算法赛', url: 'https://ac.nowcoder.com/acm/contest/vip-index', automatic: true,
    description: '读取牛客自办的周赛、小白月赛、练习赛与挑战赛；不收录其转载的国外赛程。线上练习赛可积累算法实践，不等同于国家级奖项。' },
  { id: 'tencent', name: '腾讯广告算法大赛', url: 'https://algo.qq.com/', automatic: false,
    description: '官方交互页面，需在浏览器查看当届赛题、资格及报名时间；不自动推断在招状态。' },
  { id: 'huawei', name: '华为云大赛', url: 'https://competition.huaweicloud.com/', automatic: false,
    description: '官方赛事门户，浏览器内查看当前活动；账户登录及报名由官网完成。' },
  { id: 'lanqiao', name: '蓝桥杯', url: 'https://dasai.lanqiao.cn/', automatic: false,
    description: '官方赛事入口，请结合学校通知确认组别、校内安排与报名费用。' }
];
