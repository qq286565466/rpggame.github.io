/* 时空猪 · Minecraft 式多人 UI 探针（tools/cdp.mjs preExpr） */
(async function () {
  const $ = (id) => document.getElementById(id);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (fn, timeout = 4000, step = 50) => {
    const t0 = performance.now();
    while (performance.now() - t0 < timeout) {
      if (fn()) return true;
      await wait(step);
    }
    return !!fn();
  };
  const check = [];
  const expect = (name, ok, detail) => check.push({
    检查: name, 结果: ok ? '通过' : '失败', 详情: String(detail === undefined ? '' : detail)
  });

  try {
    $('btnGuest').click();
    await waitFor(() => document.getElementById('screen-hideout')?.classList.contains('active'), 3000);
    expect('游客进入藏身处', document.getElementById('screen-hideout')?.classList.contains('active'), '');

    $('btnOnline').click();
    await wait(200);
    expect('打开多人面板', $('panelOnline')?.classList.contains('active'), '');
    expect('标题为多人游戏', !!document.querySelector('#panelOnline h2')?.textContent?.includes('多人游戏'),
      document.querySelector('#panelOnline h2')?.textContent);
    expect('服务器列表视图可见', $('mpViewList')?.classList.contains('active'), '');
    expect('有加入/直接连接/添加按钮',
      !!($('btnMpJoin') && $('btnMpDirect') && $('btnMpAdd')), '');

    $('btnMpRefresh').click();
    await wait(900);
    const row = document.querySelector('.mp-server-row');
    expect('列表有服务器条目', !!row, document.querySelectorAll('.mp-server-row').length);

    $('btnMpDirect').click();
    await wait(100);
    expect('进入直接连接', $('mpViewDirect')?.classList.contains('active'), '');
    $('mpDirectAddr').value = '127.0.0.1:4321';
    $('btnMpDirectJoin').click();

    const joined = await waitFor(() => {
      const st = $('onlineStatus')?.textContent || '';
      return st.includes('已接入') || st.includes('接入') || $('mpViewLobby')?.classList.contains('active');
    }, 5000);
    expect('加入本地服务器', joined, $('onlineStatus')?.textContent);
    expect('进入大厅视图', $('mpViewLobby')?.classList.contains('active'), '');
    expect('已加入信息可见', !!($('mpConnectedInfo')?.textContent || '').includes('已加入'),
      $('mpConnectedInfo')?.textContent);

    return JSON.stringify({ ok: check.every((c) => c.结果 === '通过'), check }, null, 1);
  } catch (e) {
    return JSON.stringify({
      ok: false,
      致命错误: (e && e.message) || String(e),
      check
    }, null, 1);
  }
})();
