/* 时空猪 · 旧存档迁移断言（刷新之后执行）
 * 核对 v1「生存竞技版」存档经过 Accounts.load() 迁移后的结果，并验证旧密码仍可登录。
 * 任何一项失败都会抛错，由 tools/cdp.mjs 转成非 0 退出码。
 */
(function () {
  var SP = window.SP;
  var checks = [];
  function expect(name, ok, detail) {
    checks.push({ 检查: name, 结果: ok ? '通过' : '失败', 详情: String(detail === undefined ? '' : detail) });
  }
  function screen() {
    var list = document.querySelectorAll('.screen');
    for (var i = 0; i < list.length; i++) if (list[i].classList.contains('active')) return list[i].id;
    return null;
  }

  expect('迁移后停在登录页', screen() === 'screen-login', screen());
  expect('页面无历史 JS 异常', (window.__errs || []).length === 0, (window.__errs || []).join(' | '));

  var rec = SP.Accounts.users['oldpig'];
  expect('旧账号被迁移进新版存档', !!rec, Object.keys(SP.Accounts.users).join(','));
  if (rec) {
    var ch = rec.character;
    expect('角色名保留', rec.name === '老猪', rec.name);
    expect('pig-coin 保留', ch.coins === 342, ch.coins);
    expect('alpha-stone 保留', ch.stones === 7, ch.stones);
    expect('牛排保留', ch.steaks === 5, ch.steaks);
    expect('累计击杀保留', ch.stats.kills === 120, ch.stats.kills);
    expect('旧战绩局数保留', ch.stats.runs === 9, ch.stats.runs);
    expect('旧永久强化折算为强化石', ch.materials.up === 36, ch.materials.up);
    expect('旧秘宝折算为重铸石', ch.materials.re === 6, ch.materials.re);
    expect('赠送了合法起手武器', SP.Progress.validItem(ch.equipped.weapon),
      ch.equipped.weapon ? ch.equipped.weapon.name : '无');
    expect('旧最高波次折算为副本进度', ch.progress.camp === 3, ch.progress.camp);
    expect('迁移后森林已解锁', SP.Progress.isUnlocked(ch, 'forest'),
      SP.Progress.unlockedBiomes(ch).join(','));
    expect('七个装备槽齐全', SP.Items.EQUIP_SLOTS.every(function (s) { return s in ch.equipped; }),
      SP.Items.EQUIP_SLOTS.length + ' 个');
    expect('角色等级从 1 级重新开始', ch.level === 1, ch.level);
    expect('角色属性可正常派生', SP.deriveCharacter(ch).maxHp > 0,
      Math.round(SP.deriveCharacter(ch).damage) + ' 攻击 / ' + Math.round(SP.deriveCharacter(ch).maxHp) + ' 生命');
  }

  var good = SP.Accounts.login('oldpig', 'pass9999');
  expect('旧密码仍可登录', good.ok === true, good.ok ? SP.Accounts.current.name : good.msg);
  var bad = SP.Accounts.login('oldpig', 'wrongpass');
  expect('错误密码被拒绝', bad.ok === false, bad.msg || '');
  if (good.ok) SP.Accounts.current = good.rec;
  expect('已写入新版存档', !!SP.Accounts.storage.get('spm_save_v2'), '');

  var failed = checks.filter(function (c) { return c.结果 === '失败'; });
  console.log('MIGRATE-DETAIL ' + JSON.stringify({
    通过: checks.length - failed.length, 失败: failed.length, 明细: checks
  }));
  if (failed.length) {
    throw new Error('旧存档迁移检查失败 ' + failed.length + ' 项：' +
      failed.map(function (c) { return c.检查 + '（' + c.详情 + '）'; }).join('；'));
  }
  return '旧存档迁移 ' + checks.length + ' 项全部通过';
})()
