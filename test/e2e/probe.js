/* 时空猪 · 端到端探针：截图前采集页面最终状态（由 tools/cdp.mjs 的 expr 执行） */
(function () {
  var w = window.SP && SP.__game && SP.__game.getWorld ? SP.__game.getWorld() : null;
  return JSON.stringify({
    页面错误: (window.__errs || []).slice(0, 5),
    当前界面: [].slice.call(document.querySelectorAll('.screen')).filter(function (s) {
      return s.classList.contains('active');
    }).map(function (s) { return s.id; }),
    本地存储可用: window.SP ? SP.Accounts.storage.persistent : null,
    当前账号: window.SP && SP.Accounts.current ? SP.Accounts.current.name : null,
    局内: w ? { 时间: +w.time.toFixed(1), 波次: w.wave, 击杀: w.kills, 生命: Math.round(w.player.hp), 等级: w.player.level } : null
  });
})()
