/* 截图用：确保背包面板打开，并把鼠标悬浮到第一件装备上，展示词条与对比提示 */
(function () {
  var SP = window.SP;
  if (!SP || !SP.__game) return '页面尚未就绪';
  SP.__game.ui.openPanel('bag');
  var cell = document.querySelector('#bagGrid .cell');
  if (!cell) return '背包里没有可悬浮的格子';
  var r = cell.getBoundingClientRect();
  cell.dispatchEvent(new MouseEvent('mouseenter', {
    bubbles: true,
    clientX: Math.round(r.left + r.width / 2),
    clientY: Math.round(r.top + r.height / 2)
  }));
  return '已悬浮：' + cell.textContent.trim();
})()
