/* 时空猪 · 旧存档迁移端到端（由 tools/cdp.mjs 的 preExpr 执行）
 * 往 localStorage 写入一份「生存竞技版」的 v1 存档，然后刷新页面，
 * 让 ui.js 里的 Accounts.load() 真正走一遍迁移逻辑。
 * 探针（probe-migrate.js）会在刷新后的页面上核对结果。
 */
(function () {
  var SP = window.SP;
  if (!SP || !SP.hashPassword) return '页面尚未就绪';

  var legacy = {
    v: 1,
    users: {
      oldpig: {
        name: '老猪',
        hash: SP.hashPassword('oldpig', 'pass9999'),
        created: Date.now() - 86400000,
        coins: 342,
        stones: 7,
        steaks: 5,
        runs: 9,
        kills: 120,
        guest: false,
        // 旧版的永久强化 / 秘宝，应折算成强化石与重铸石
        perm: { maxHp: 3, damage: 2, speed: 1, armor: 0, luck: 0, greed: 0 },
        stonePerm: { startLevel: 2, startShield: 1 },
        best: { wave: 12, kills: 200, time: 500 }
      }
    }
  };
  try {
    localStorage.setItem('spm_save_v1', JSON.stringify(legacy));
    localStorage.removeItem('spm_save_v2');
  } catch (e) {
    return '无法写入 localStorage: ' + e.message;
  }
  setTimeout(function () { window.location.reload(); }, 40);
  return '已写入 v1 旧存档，准备刷新页面';
})()
