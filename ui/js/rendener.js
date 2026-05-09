// renderer.js - 渲染进程脚本

// 当页面加载完成后执行
window.addEventListener('DOMContentLoaded', () => {
  const versionsElement = document.getElementById('versions');
  
  // 从 preload.js 暴露的 API 获取版本信息并显示
  const electronVersion = versions.electron();
  const chromeVersion = versions.chrome();
  const nodeVersion = versions.node();
  
  versionsElement.innerHTML = `
    Electron: ${electronVersion}<br/>
    Chrome: ${chromeVersion}<br/>
    Node.js: ${nodeVersion}
  `;
});