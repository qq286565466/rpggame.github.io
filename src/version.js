/* 时空猪 · version.js — 版本号与更新日志（单一数据源，供 UI / README 对齐） */
(function (global) {
  'use strict';
  var SP = global.SP || (global.SP = {});

  SP.VERSION = '2.1.0';

  /**
   * 更新日志：新版本写在数组前面。
   * items 用短句，界面与 CHANGELOG.md 共用同一套事实。
   */
  SP.CHANGELOG = [
    {
      version: '2.1.0',
      date: '2026-10-08',
      title: '版本号与更新日志',
      items: [
        '登录页显示当前版本号，并可查看更新日志',
        '藏身处「帮助」面板增加版本信息与更新日志入口',
        '仓库新增 CHANGELOG.md，与游戏内日志保持同步'
      ]
    },
    {
      version: '2.0.0',
      date: '2026-10',
      title: '科多兽远征',
      items: [
        '改为刷装备养成的动作 RPG：可走动的藏身处、铁匠、商人与时空传送门',
        '四个生物群系地下城：刷够配额后挑战关底首领，通关解锁更深一层',
        '七部位装备、五品质与随机词条；强化 / 重铸 / 分解与属性对比',
        '传说装备独特效果真实生效；怪物属性二次成长形成装备门槛',
        '副本内支持 R 键自动攻击；触屏摇杆与技能钮',
        '本地账号存档（localStorage）与旧版进度自动迁移'
      ]
    }
  ];
})(typeof globalThis !== 'undefined' ? globalThis : this);
