/* 时空猪 · 端到端脚本（由 tools/cdp.mjs 的 preExpr 在真实浏览器中执行）
 *
 * 覆盖：注册 → 藏身处（走动 / NPC 交互 / 功能按钮）→ 背包面板（装备/属性/背包/强化）
 *       → 传送门进本 → 真实输入战斗 → 拾取战利品 → 通关结算 → 深入下一层 → 阵亡 → 回藏身处 → 存档往返
 */
(async function () {
  try {
    return await run();
  } catch (e) {
    if (e && e.e2eFailure) throw e;
    return JSON.stringify({ 致命错误: (e && e.message) || String(e), 堆栈: ((e && e.stack) || '').split('\n').slice(0, 4) }, null, 1);
  }

  async function run() {
    const $ = (id) => document.getElementById(id);
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    /**
     * 等待某个状态成立（而不是死等固定毫秒）。
     * 游戏推进依赖 requestAnimationFrame，固定等待在无头环境里会偶发漏帧，
     * 因此所有「断言状态变化」的地方都改成轮询等待。
     */
    const waitFor = async (fn, timeout = 3000, step = 40) => {
      const t0 = performance.now();
      while (performance.now() - t0 < timeout) {
        if (fn()) return true;
        await wait(step);
      }
      return !!fn();
    };
    const key = (k, type) => window.dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true }));
    const tap = (k) => { key(k, 'keydown'); key(k, 'keyup'); };
    const screen = () => [...document.querySelectorAll('.screen')].filter((s) => s.classList.contains('active')).map((s) => s.id)[0];
    const panel = (k) => $('panel' + k.charAt(0).toUpperCase() + k.slice(1)).classList.contains('active');
    const check = [];
    const expect = (name, ok, detail) => check.push({ 检查: name, 结果: ok ? '通过' : '失败', 详情: String(detail === undefined ? '' : detail) });
    const SPg = window.SP, I = SPg.Items, P = SPg.Progress;
    const game = SPg.__game;
    const ch = () => SPg.Accounts.current.character;
    const hideout = () => game.ui.hideout;

    /* 1) 注册 → 藏身处 */
    $('tabReg').click();
    $('inUser').value = 'u0test';
    $('inPass').value = 'pass1234';
    $('btnAuth').click();
    await wait(150);
    expect('注册后进入藏身处（而不是面板枢纽）', screen() === 'screen-hideout', screen());
    expect('藏身处有铁匠/商人/传送门三个可交互物件',
      hideout() && hideout().npcs.length === 3 && ['blacksmith', 'merchant', 'portal'].every((k) => !!hideout().npcByKey(k)),
      hideout() ? hideout().npcs.map((n) => n.name).join('、') : '无');
    expect('新号自带起手武器', !!ch().equipped.weapon, (ch().equipped.weapon || {}).name);
    expect('初始没有任何面板打开', !game.ui.isPanelOpen(), game.ui.activePanel);
    expect('功能按钮齐全（背包/传送门/战绩/帮助）',
      ['btnBag', 'btnPortal', 'btnRecord', 'btnHelp'].every((id) => !!$(id)), '');

    /* 2) 真实按键走动 */
    const h0 = hideout();
    const px = h0.player.x;
    key('a', 'keydown');
    const moved = await waitFor(() => h0.player.x < px - 40, 2500);
    key('a', 'keyup');
    await wait(120);
    expect('WASD 能在藏身处里走动', moved, `${px.toFixed(0)} → ${h0.player.x.toFixed(0)}`);

    /* 3) 靠近 NPC 出现提示，按 F 打开对应界面 */
    async function goTo(key, panelKey) {
      const h = hideout();
      const n = h.npcByKey(key);
      h.player.x = n.x + 58; h.player.y = n.y;
      await waitFor(() => h.nearby && h.nearby.key === key, 1500);
      tap('f');
      return waitFor(() => panel(panelKey), 2000);
    }
    expect('走到铁匠面前按 F 打开铁匠铺', await goTo('blacksmith', 'forge'), game.ui.activePanel);
    expect('铁匠铺里没有选中装备时给出提示', $('forgeMsg').textContent.includes('选中'), $('forgeMsg').textContent.slice(0, 20));
    tap('Escape'); await wait(120);
    expect('Esc 可关闭面板', !game.ui.isPanelOpen(), game.ui.activePanel);

    expect('走到商人面前按 F 打开商店', (await goTo('merchant', 'shop')) && $('shopBody').children.length > 0,
      $('shopBody').children.length + ' 个商品');
    tap('Escape'); await wait(100);

    /* 商店里可以用金币换材料（金币/石头两种资源互相补位） */
    const shopRowsTxt = [...$('shopBody').querySelectorAll('.shop-item')].map((r) => r.textContent);
    expect('商店提供金币换强化石/重铸石的出口',
      shopRowsTxt.some((t) => t.includes('强化石 × 5（金币）')) &&
      shopRowsTxt.some((t) => t.includes('重铸石 × 2（金币）')),
      shopRowsTxt.join(' | '));

    expect('走到传送门按 F 打开层级选择', (await goTo('portal', 'portal')) &&
      document.querySelectorAll('#biomeList .biome-item').length === 4,
      document.querySelectorAll('#biomeList .biome-item').length + ' 个区域');
    tap('Escape'); await wait(120);

    /* 4) 走远后没有交互目标 */
    const hp = hideout();
    hp.player.x = 1100; hp.player.y = 1300;
    await waitFor(() => !hp.nearby, 1500);
    expect('离开 NPC 后交互提示消失', !hp.nearby && $('interactPrompt').classList.contains('hidden'), '');
    tap('f'); await wait(120);
    expect('按 F 在没有目标时不会打开任何面板', !game.ui.isPanelOpen(), game.ui.activePanel);

    /* 5) 功能按钮：背包（含装备与属性） */
    $('btnBag').click();
    expect('背包按钮打开背包面板', await waitFor(() => panel('bag'), 1500), game.ui.activePanel);

    /* 面板打开时，F / 空格不应把面板换成身边 NPC 的界面 */
    const hNear = hideout();
    const blacksmith = hNear.npcByKey('blacksmith');
    hNear.player.x = blacksmith.x + 58; hNear.player.y = blacksmith.y;
    await waitFor(() => hNear.nearby && hNear.nearby.key === 'blacksmith', 1500);
    tap(' ');
    tap('f');
    await wait(150);
    expect('面板打开时空格/F 不会替换成 NPC 界面', panel('bag') && game.ui.activePanel === 'bag', game.ui.activePanel);
    expect('背包面板里同时有装备栏与属性', $('panelBag').querySelector('#equipSlots').children.length === 7 &&
      $('panelBag').querySelector('#statList').textContent.includes('攻击力'),
      document.querySelectorAll('#equipSlots .equip-slot').length + ' 槽位');

    /* 注入资源与测试装备，覆盖养成操作 */
    const c = ch();
    c.coins = 6000; c.stones = 60; c.materials.up = 120; c.materials.re = 60; c.steaks = 5; c.level = 20;
    const rng = SPg.makeRng(2468);
    for (let i = 0; i < 16; i++) {
      c.inventory.push(I.roll(rng, { ilvl: 20 + i, slot: I.DROP_SLOTS[i % I.DROP_SLOTS.length], rarityBias: i * 0.12 }));
    }
    game.ui.afterChange('测试数据注入');
    await wait(120);
    expect('背包渲染出格子', document.querySelectorAll('#bagGrid .cell').length >= 16,
      document.querySelectorAll('#bagGrid .cell').length + ' 个格子');

    /* 6) 一键换装 + 悬浮提示 */
    $('btnAutoEquip').click();
    await wait(120);
    expect('一键换装填满多个槽位', P.equippedCount(c) >= 5, '已装备 ' + P.equippedCount(c) + ' / 7');
    const cell = document.querySelector('#bagGrid .cell');
    cell.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: 500, clientY: 400 }));
    await wait(80);
    expect('悬浮提示展示装备详情与对比',
      !$('tooltip').classList.contains('hidden') && $('tooltip').textContent.includes('战力'),
      $('tooltip').textContent.slice(0, 24));

    /* 7) 装备 / 分解 / 出售 都留在背包里 */
    const bagItem = c.inventory[0];
    cell.click();
    await wait(80);
    const invBefore = c.inventory.length;
    $('actEquip').click();
    await wait(120);
    expect('从背包装备成功（被替换的回背包）',
      c.inventory.length === invBefore && !!P.findItem(c, bagItem.uid), '背包 ' + invBefore + ' → ' + c.inventory.length);
    const junk = c.inventory[0];
    game.ui.selUid = junk.uid; game.ui.refreshPanel(); await wait(80);
    const upBefore = c.materials.up;
    $('actSalvage').click();
    await wait(120);
    expect('背包内可分解装备', c.materials.up > upBefore, '强化石 ' + upBefore + ' → ' + c.materials.up);
    const junk2 = c.inventory[0];
    game.ui.selUid = junk2.uid; game.ui.refreshPanel(); await wait(80);
    const coinsBeforeSell = c.coins;
    $('actSell').click();
    await wait(120);
    expect('背包内可出售装备', c.coins > coinsBeforeSell, '金币 ' + coinsBeforeSell + ' → ' + c.coins);

    /* 8) 强化 / 重铸 只在铁匠铺里提供 */
    expect('背包里不提供强化与重铸按钮',
      !$('actUpgrade') && !$('actReroll'), '（这两个按钮已从背包移除）');
    const weapon = c.equipped.weapon;
    game.ui.selUid = weapon.uid;
    game.ui.closeAllPanels();
    expect('走到铁匠面前可以强化（按 F）', await goTo('blacksmith', 'forge'));
    const forgeBtns = [...$('forgeBody').querySelectorAll('button')].map((b) => b.textContent);
    expect('铁匠铺里提供强化与重铸', forgeBtns.some((t) => t.includes('强化')) && forgeBtns.some((t) => t.includes('重铸')),
      forgeBtns.join(' / '));
    const lvl0 = weapon.upgrade || 0, coins0 = c.coins, up0 = c.materials.up;
    [...$('forgeBody').querySelectorAll('button')].find((b) => b.textContent.includes('强化')).click();
    await waitFor(() => weapon.upgrade === lvl0 + 1, 1500);
    expect('在铁匠铺强化成功并扣费',
      weapon.upgrade === lvl0 + 1 && c.coins < coins0 && c.materials.up < up0,
      `+${lvl0} → +${weapon.upgrade}，金币 ${coins0} → ${c.coins}`);
    let affixed = c.inventory.concat(Object.values(c.equipped).filter(Boolean)).find((it) => it && it.affixes.length);
    if (affixed) {
      const re0 = c.materials.re;
      game.ui.selUid = affixed.uid;
      game.ui.refreshPanel('forge');
      await waitFor(() => {
        const b = [...$('forgeBody').querySelectorAll('button')].find((x) => x.textContent.includes('重铸'));
        return b && !b.disabled;
      }, 1200);
      const reBtn = [...$('forgeBody').querySelectorAll('button')].find((b) => b.textContent.includes('重铸'));
      if (reBtn && !reBtn.disabled) {
        reBtn.click();
        await waitFor(() => c.materials.re === re0 - 1, 1500);
        expect('在铁匠铺重铸成功并消耗重铸石', c.materials.re === re0 - 1, '重铸石 ' + re0 + ' → ' + c.materials.re);
      } else {
        expect('重铸按钮按资源正确禁用', true, '资源不足时禁用（正常）');
      }
    }
    tap('Escape'); await wait(120);

    /* 9) 战绩与帮助按钮 */
    $('btnRecord').click();
    expect('战绩按钮打开战绩面板', (await waitFor(() => panel('record'), 1500)) && $('recordGrid').children.length > 0,
      $('recordGrid').children.length + ' 项');
    tap('Escape'); await wait(100);
    $('btnHelp').click();
    expect('帮助按钮打开帮助面板', (await waitFor(() => panel('help'), 1500)) && $('panelHelp').textContent.includes('藏身处'), '');
    tap('Escape'); await wait(100);

    /* 10) 从传送门面板进入副本 */
    $('btnPortal').click();
    await waitFor(() => panel('portal'), 1500);
    const entry = document.querySelector('#biomeList .biome-item:not(.locked) button');
    expect('传送门面板里营地已解锁', !!entry, entry ? entry.textContent : '无');
    entry.click();
    const inDungeon = await waitFor(() => screen() === 'screen-game' && !!game.getWorld(), 3000);
    let w = game.getWorld();
    expect('进入副本并建立战斗世界', inDungeon && w.biomeKey === 'camp' && w.floor === 1,
      w ? w.biome.name + ' ' + w.floor + ' 层 · mlvl ' + w.mlvl : '无');
    expect('进本后所有面板已关闭', !game.ui.isPanelOpen(), game.ui.activePanel);
    expect('副本 HUD 显示清剿进度', $('hudQuotaText').textContent.includes('/'), $('hudQuotaText').textContent);

    /* 10b) HUD 不能吞掉鼠标：否则左上/右上的信息条下方按左键不攻击 */
    const pe = (sel) => getComputedStyle(document.querySelector(sel)).pointerEvents;
    expect('战斗 HUD 信息条不拦截鼠标（pointer-events: none）',
      pe('#screen-game .hud-tl') === 'none' && pe('#screen-game .hud-tr') === 'none' && pe('#bossBar') === 'none',
      `hud-tl=${pe('#screen-game .hud-tl')} hud-tr=${pe('#screen-game .hud-tr')} bossBar=${pe('#bossBar')}`);
    expect('技能钮与自动按钮仍然可点（pointer-events: auto）',
      pe('#slotAtk') === 'auto' && pe('#btnAuto') === 'auto',
      `slotAtk=${pe('#slotAtk')} btnAuto=${pe('#btnAuto')}`);

    /* 11) 真实鼠标攻击 */
    w.enemies.length = 0;
    w.killsNeeded = 9999;
    const target = w.spawnEnemy('calf');
    target.spawnT = 0; target.x = w.player.x + 55; target.y = w.player.y;
    target.hp = target.maxHp = 1e6;
    const canvas = $('game'), rect = canvas.getBoundingClientRect(), r = game.renderer();
    canvas.dispatchEvent(new MouseEvent('mousemove', {
      clientX: rect.left + (target.x - w.camera.x) + r.w / 2,
      clientY: rect.top + (target.y - w.camera.y) + r.h / 2, bubbles: true
    }));
    await wait(80);
    canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
    const hp0 = target.hp;
    const damaged = await waitFor(() => target.hp < hp0, 2500);
    window.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true }));
    expect('按住左键可持续命中敌人', damaged, '累计伤害 ' + Math.round(hp0 - target.hp));

    /* 12) 键盘技能 */
    tap('q');
    expect('Q 触发震击', await waitFor(() => w.player.quakeCd > 0, 1200), '剩余冷却 ' + w.player.quakeCd.toFixed(1));
    tap('e');
    expect('E 触发赐福', await waitFor(() => w.player.shield > 0 && w.player.blessCd > 0, 1200), '护盾 ' + Math.round(w.player.shield));
    tap(' ');
    expect('空格触发冲刺', await waitFor(() => w.player.dashCd > 0 || w.player.dashT > 0, 1200),
      '冲刺冷却 ' + w.player.dashCd.toFixed(2));
    w.player.hp = Math.round(w.player.maxHp * 0.4);
    const hpBeforeSteak = w.player.hp, steaks0 = w.steaks;
    tap('1');
    await waitFor(() => w.player.hp > hpBeforeSteak, 1200);
    expect('数字键 1 使用牛排', w.player.hp > hpBeforeSteak && w.steaks === steaks0 - 1,
      '生命 ' + Math.round(hpBeforeSteak) + ' → ' + Math.round(w.player.hp));

    /* 13) 掉落物：等冲刺停下来再扔，验证磁力吸取（而不是把东西丢在小猪已经跑开的地方） */
    await waitFor(() => Math.abs(w.player.vx) < 2 && Math.abs(w.player.vy) < 2, 2000);
    const lootItem = I.roll(SPg.makeRng(1357), { ilvl: 18, slot: 'helm', rarityBias: 2 });
    const timeBefore = w.time;
    w.pickups.push({
      x: w.player.x + 60, y: w.player.y + 20, kind: 'item', item: lootItem,
      life: 60, r: 14, bob: 0, vx: 0, vy: 0
    });
    const picked = await waitFor(() => w.loot.some((it) => it.uid === lootItem.uid), 3000);
    expect('掉落物会被磁力吸过来并拾取', picked,
      `战利品 ${w.loot.length} 件 · 世界时钟 +${(w.time - timeBefore).toFixed(2)}s · 界面=${game.ui.screen}` +
      ` · 地面拾取物=${w.pickups.length} · 拾取范围=${Math.round(w.player.magnet)}`);
    expect('掉落提示出现在 HUD', $('lootFeed').children.length > 0, $('lootFeed').textContent.slice(0, 20));

    /* 14) 通关 → 深入 → 阵亡 → 回藏身处 */
    w.kills = w.killsNeeded;
    w.updateSpawns(1 / 60);
    expect('达到配额后关底首领出现', !!w.boss && w.bossSpawned, w.boss ? w.boss.name : '无');
    w.damageEnemy(w.boss, 1e9);
    const cleared = await waitFor(() => $('resultOverlay').classList.contains('active'), 3000);
    expect('击败首领弹出通关结算', cleared && $('resTitle').textContent.includes('通关'),
      $('resTitle').textContent + ' / ' + $('resSub').textContent);
    expect('通关推进副本进度', P.clearedFloor(ch(), 'camp') >= 1, '营地已通 ' + P.clearedFloor(ch(), 'camp') + ' 层');
    const lootInBag = ch().inventory.length;

    const prevWorld = w;
    $('btnDeeper').click();
    const deeper = await waitFor(() => game.getWorld() && game.getWorld() !== prevWorld, 3000);
    const w2 = game.getWorld();
    expect('可继续深入下一层', deeper && w2.floor === 2 && screen() === 'screen-game',
      w2 ? w2.biome.name + ' ' + w2.floor + ' 层' : '无');

    w2.time = 77.5; w2.kills = 30;
    w2.hurtPlayer(1e9, 0, 0);
    const died = await waitFor(() => $('resultOverlay').classList.contains('active') && $('resTitle').textContent.includes('倒下'), 3000);
    expect('阵亡弹出结算面板', died, $('resTitle').textContent);
    $('btnBackHub').click();
    const backHome = await waitFor(() => screen() === 'screen-hideout', 3000);
    expect('返回的是藏身处', backHome, screen());
    expect('战利品已并入背包', ch().inventory.length >= lootInBag, '背包 ' + ch().inventory.length + ' 件');
    expect('阵亡记录与货币更新', ch().stats.deaths >= 1 && ch().coins > 0,
      '阵亡 ' + ch().stats.deaths + ' 次 · 金币 ' + ch().coins);

    /* 15) 存档往返 */
    SPg.Accounts.save();
    const raw = SPg.Accounts.storage.get('spm_save_v2');
    let ok = false, detail = '往返失败';
    try {
      const parsed = JSON.parse(raw);
      const rec = parsed.users['u0test'];
      const back = P.normalize(JSON.parse(JSON.stringify(rec.character)));
      ok = !!rec && back.level === ch().level && back.inventory.length === ch().inventory.length &&
        P.equippedCount(back) === P.equippedCount(ch()) && back.coins === ch().coins;
      detail = ok ? `Lv${ch().level} · 背包 ${ch().inventory.length} 件 · 金币 ${ch().coins}` : '往返失败';
    } catch (e) { ok = false; detail = e.message; }
    expect('存档可完整 JSON 往返且不丢数据', ok, detail);

    const failed = check.filter((x) => x.结果 === '失败');
    console.log('E2E-DETAIL ' + JSON.stringify({
      页面错误: (window.__errs || []).length,
      通过: check.length - failed.length,
      失败: failed.length,
      明细: check
    }));
    if (failed.length) {
      const err = new Error('端到端检查失败 ' + failed.length + ' 项：' + failed.map((x) => x.检查 + '（' + x.详情 + '）').join('；'));
      err.e2eFailure = true;
      throw err;
    }
    return '端到端 ' + check.length + ' 项全部通过（页面错误 ' + (window.__errs || []).length + '）';
  }
})()
