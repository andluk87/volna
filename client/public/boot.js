/* Keeps startup failures from appearing as a blank WebView. */
(() => {
  const escapeHtml = (value) => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const showFailure = (error) => {
    if (window.__VOLNA_BOOT_FAILURE_SHOWN__) return;
    const root = document.getElementById('root');
    if (!root) return;
    window.__VOLNA_BOOT_FAILURE_SHOWN__ = true;
    const detail = String(error || 'Неизвестная ошибка запуска')
      .replace(/https?:\/\/[^\s]+/g, '[адрес скрыт]')
      .slice(0, 500);
    root.innerHTML = `<main style="min-height:100dvh;box-sizing:border-box;padding:32px;display:grid;place-items:center;background:#0e1720;color:#edf3f8;font:16px system-ui,sans-serif"><section style="width:min(420px,100%);padding:26px;box-sizing:border-box;border:1px solid #293a48;border-radius:20px;background:#17212b;box-shadow:0 18px 60px #0005"><div style="width:48px;height:48px;display:grid;place-items:center;border-radius:16px;background:#58b7e8;color:#102232;font-size:24px;font-weight:700">В</div><h1 style="font-size:21px;margin:22px 0 10px">Волна не загрузилась</h1><p style="color:#a8bac7;line-height:1.55;margin:0 0 18px">Не удалось запустить интерфейс приложения. Перезапустите его. Если ошибка повторится, отправьте разработчику диагностику ниже.</p><details style="color:#9eb1bf;font-size:12px"><summary style="cursor:pointer">Диагностика</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${escapeHtml(detail)}</pre><p>URL: ${escapeHtml(location.protocol + '//' + location.host + location.pathname)}</p><p>WebView: ${escapeHtml(navigator.userAgent)}</p></details><button id="volna-retry" style="width:100%;margin-top:20px;padding:13px;border:0;border-radius:12px;background:#58b7e8;color:#102232;font:inherit;font-weight:700">Перезапустить</button></section></main>`;
    root.querySelector('#volna-retry').addEventListener('click', () => location.reload());
  };

  window.addEventListener('error', (event) => {
    if (event.target && event.target !== window) {
      if (event.target.tagName !== 'SCRIPT') return;
      const file = event.target.src || event.target.href || event.target.tagName;
      showFailure(`Не загрузился ресурс приложения: ${file}`);
      return;
    }
    showFailure(event.message || 'Ошибка JavaScript при запуске');
  }, true);
  window.addEventListener('unhandledrejection', (event) => {
    showFailure(event.reason?.message || event.reason || 'Ошибка приложения при запуске');
  });
  setTimeout(() => {
    if (!window.__VOLNA_APP_READY__) showFailure('Приложение не завершило запуск за 30 секунд');
  }, 30000);
})();
