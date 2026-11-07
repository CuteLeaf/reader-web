/**
 * 扩展后台：点工具栏图标直接打开右侧侧栏，并把快捷键转发给侧栏页面。
 * 侧栏没打开时消息无人接收，忽略即可。
 */
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
  /* 旧版本 Chrome 没有该方法，点图标会退回默认行为 */
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== 'toggle-stealth') return;
  chrome.runtime.sendMessage({ type: 'reader:toggle-stealth' }).catch(() => {
    /* 侧栏未打开 */
  });
});
