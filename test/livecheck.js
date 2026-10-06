/* ============================================================
   test/livecheck.js —— 线上验收套件（9 项）
   直接打真实 GitHub Pages 地址，验证 HTTPS 环境下：
     manifest 可解析 / Service Worker 能注册 / 断网可用 / 判分正常

   跑法：node test/livecheck.js
   换地址：LIVE_URL=https://xxx/ node test/livecheck.js
   ============================================================ */
'use strict';

const path = require('path');
const L = require('./lib');

const URL = process.env.LIVE_URL || L.LIVE_URL;

(async () => {
  const OUT = L.shotDir('live');
  const R = L.runner();

  console.log('目标: ' + URL);
  const browser = await L.launch();
  const ctx = await L.iphoneCtx(browser);
  const p = await ctx.newPage();
  p.on('console', m => { if (m.type() === 'error') R.error('CONSOLE: ' + m.text()); });
  p.on('pageerror', e => R.error('PAGEERROR: ' + e.message));

  try {
    await p.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
    await p.waitForSelector('#app:not([hidden])', { timeout: 20000 });
    await p.waitForTimeout(1200);
    await p.screenshot({ path: path.join(OUT, 'live-01.png') });
    R.check('线上首页渲染', await p.isVisible('#view-home'));

    /* 关闭安装引导（HTTPS 下会自动弹出） */
    const popped = await p.waitForSelector('#install-mask:not([hidden])', { timeout: 8000 }).then(() => true).catch(() => false);
    if (popped) {
      await p.waitForTimeout(900);
      await p.screenshot({ path: path.join(OUT, 'live-02-install.png') });
      await L.clickEl(p, '#btn-install-close');
    }
    R.check('HTTPS 下自动弹出安装引导', popped, popped ? '' : '未弹出');
    await p.waitForTimeout(400);

    const pool = (await p.textContent('#mini-pool')).trim();
    R.check('词库从线上加载成功', +pool > 600, '可练 ' + pool + ' 词');

    /* manifest 真的被浏览器认出来了吗 */
    const mf = await p.evaluate(async () => {
      const href = document.querySelector('link[rel=manifest]').href;
      const j = await (await fetch(href)).json();
      return { name: j.name, display: j.display, icons: j.icons.length, theme: j.theme_color };
    });
    R.check('manifest 可解析且 standalone', mf.display === 'standalone' && mf.icons >= 3,
      mf.name + ' / icons=' + mf.icons + ' / theme=' + mf.theme);

    /* 跑一轮听写 */
    await L.clickEl(p, '#presets .chip[data-a="1"][data-b="20"]');
    await p.waitForTimeout(150);
    await L.clickEl(p, '#seg-daily button[data-n="5"]');
    await p.waitForTimeout(150);
    await L.clickEl(p, '#btn-start');
    await p.waitForSelector('#view-quiz.is-active');
    await p.waitForTimeout(500);
    await p.screenshot({ path: path.join(OUT, 'live-03-quiz.png') });
    R.check('线上进入听写页', (await p.textContent('#quiz-count')).trim() === '1 / 5');

    await p.keyboard.type('zzz');
    await L.clickEl(p, '#btn-submit');
    await p.waitForTimeout(400);
    R.check('线上判分生效', (await p.textContent('#fb-title')).trim() === '拼写不对');
    await p.screenshot({ path: path.join(OUT, 'live-04-feedback.png') });

    /* Service Worker（HTTPS 下才可能） */
    const sw = await p.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return { ok: false, why: 'navigator.serviceWorker 不存在' };
      const r = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise(res => setTimeout(() => res(null), 12000))
      ]);
      if (!r) return { ok: false, why: 'ready 超时' };
      return { ok: true, scope: r.scope, caches: await caches.keys() };
    });
    R.check('HTTPS 下 Service Worker 已激活', sw.ok, sw.ok ? sw.scope : sw.why);
    R.check('预缓存已建立', sw.ok && sw.caches && sw.caches.length > 0, sw.ok ? String(sw.caches) : '—');

    await p.waitForTimeout(800);
    await ctx.setOffline(true);
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(2000);
    const offOK = await p.isVisible('#view-home');
    const offPool = await p.textContent('#mini-pool');
    await p.screenshot({ path: path.join(OUT, 'live-05-offline.png') });
    R.check('断网重载后仍可用', offOK && +offPool > 0, '词池=' + offPool);
    await ctx.setOffline(false);
  } finally {
    await browser.close();
  }

  process.exit(R.report('线上验收') ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
