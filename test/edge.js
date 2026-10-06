/* ============================================================
   test/edge.js —— 边界验收套件（19 项）
   覆盖：已安装（standalone）行为 / 小屏 iPhone SE / iPhone 15 /
         超长短语不溢出 / iPad / 横屏

   跑法：node test/edge.js
   ============================================================ */
'use strict';

const path = require('path');
const L = require('./lib');

(async () => {
  const { srv, url } = await L.serve();
  const BASE = url;
  const OUT = L.shotDir('edge');

  const byZh = L.indexByZh(L.loadWords());
  const R = L.runner();

  const browser = await L.launch();

  try {
    /* ============ 0. 老浏览器兜底（静态检查） ============ */
    {
      const fs = require('fs');
      const css = fs.readFileSync(path.join(L.ROOT, 'styles.css'), 'utf8');
      const m = css.match(/#app\{[^}]*\}/);
      const block = m ? m[0] : '';
      const iVh = block.indexOf('min-height:100vh');
      const iDvh = block.indexOf('min-height:100dvh');
      R.check('styles.css 里 #app 有 dvh 兜底（vh 在前、dvh 在后）', iVh >= 0 && iDvh > iVh,
        iVh < 0 ? '缺少 100vh 兜底' : (iDvh < 0 ? '缺少 100dvh' : `vh@${iVh} < dvh@${iDvh}`));
    }

    /* ============ A. 已安装（standalone）模式 ============ */
    const mk = async (setup, label) => {
      const ctx = await L.iphoneCtx(browser);
      if (setup) await ctx.addInitScript(setup);
      const p = await ctx.newPage();
      p.on('pageerror', e => R.error(label + ' PAGEERROR: ' + e.message));
      await p.goto(BASE, { waitUntil: 'networkidle' });
      await p.waitForSelector('#app:not([hidden])');
      await p.waitForTimeout(3000);          // 超过自动弹安装引导的 1.5s
      return { ctx, p };
    };

    // A1: 普通浏览器标签页 —— 应该弹安装引导
    {
      const { ctx, p } = await mk(() => sessionStorage.removeItem('nce1.installed.tip'), 'A1');
      R.check('未安装时自动弹安装引导', await p.isVisible('#install-mask'));
      await ctx.close();
    }

    // A2: iOS 从主屏幕启动 —— navigator.standalone = true（iOS 真实 API）
    //     注意：CDP 的 Emulation.setEmulatedMedia(display-mode) 在 headless shell 里
    //     不生效且不报错，所以这里必须用 iOS 自己的 navigator.standalone。
    {
      const { ctx, p } = await mk(() => {
        Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
      }, 'A2');
      const dm = await p.evaluate(() => ({
        standalone: navigator.standalone,
        matchStandalone: matchMedia('(display-mode: standalone)').matches
      }));
      R.check('iOS 已安装标识 navigator.standalone 生效', dm.standalone === true, JSON.stringify(dm));
      R.check('已安装时不再自动弹安装引导', await p.isHidden('#install-mask'));
      R.check('已安装时首页正常渲染', await p.isVisible('#view-home') && +(await p.textContent('#mini-pool')) > 600);
      await p.screenshot({ path: path.join(OUT, 'A2-installed-ios.png') });
      await ctx.close();
    }

    /* ============ B. 小屏手机：听写页必须整屏放得下 ============ */
    for (const [label, vp] of [['iPhoneSE', { width: 375, height: 667 }], ['iPhone15', { width: 393, height: 852 }]]) {
      const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      const p = await ctx.newPage();
      p.on('pageerror', e => R.error(label + ' PAGEERROR: ' + e.message));
      await p.addInitScript(() => {
        localStorage.setItem('nce1.settings.v1', JSON.stringify({ start: 1, end: 144, daily: 10, hints: true, auto: false, sound: false }));
        localStorage.removeItem('nce1.install.dismissed');
        sessionStorage.setItem('nce1.installed.tip', '1');
      });
      await p.goto(BASE, { waitUntil: 'networkidle' });
      await p.waitForSelector('#app:not([hidden])');
      await p.waitForTimeout(900);
      await L.dismissInstall(p);
      await L.clickEl(p, '#btn-start');
      await p.waitForSelector('#view-quiz.is-active');
      await p.waitForTimeout(500);

      const m = await p.evaluate(() => {
        const r = s => { const e = document.querySelector(s); return e ? e.getBoundingClientRect() : null; };
        const sub = r('#btn-submit'), kbd = r('#kbd'), ans = r('#answer');
        return {
          innerH: innerHeight, docH: document.documentElement.scrollHeight,
          kbdBottom: Math.round(kbd.bottom), subBottom: Math.round(sub.bottom), subTop: Math.round(sub.top),
          ansW: Math.round(ans.width), kbdH: Math.round(kbd.height)
        };
      });
      R.check(`${label} 听写页整屏放得下（不出现纵向滚动）`, m.docH <= m.innerH + 2, `视口高 ${m.innerH} / 文档高 ${m.docH}`);
      R.check(`${label} 提交按钮完整可见`, m.subBottom <= m.innerH + 1 && m.subTop > 0, `按钮底 ${m.subBottom} ≤ ${m.innerH}`);
      R.check(`${label} 虚拟键盘完整可见`, m.kbdBottom <= m.innerH + 1, `键盘底 ${m.kbdBottom}`);
      await p.screenshot({ path: path.join(OUT, `B-${label}-quiz.png`) });
      await ctx.close();
    }

    /* ============ C. 超长短语（Royal Air Force）渲染不溢出 ============ */
    {
      const ctx = await browser.newContext({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      const p = await ctx.newPage();
      p.on('pageerror', e => R.error('C PAGEERROR: ' + e.message));
      await p.addInitScript(() => {
        // 93 课共 6 词，daily=6 保证 'Royal Air Force' 必被抽到
        localStorage.setItem('nce1.settings.v1', JSON.stringify({ start: 93, end: 93, daily: 6, hints: true, auto: false, sound: false }));
        sessionStorage.setItem('nce1.installed.tip', '1');
      });
      await p.goto(BASE, { waitUntil: 'networkidle' });
      await p.waitForSelector('#app:not([hidden])');
      await p.waitForTimeout(900);
      await L.dismissInstall(p);
      await L.clickEl(p, '#btn-start');
      await p.waitForSelector('#view-quiz.is-active');
      await p.waitForTimeout(400);

      let found = false;
      for (let i = 0; i < 8 && !found; i++) {
        const zh = (await p.textContent('#prompt-zh')).trim();
        const w = byZh[zh] && byZh[zh][0];
        if (!w) break;
        if (w.w === 'Royal Air Force') { found = true; break; }
        await L.typeViaKbd(p, w.w);
        await L.clickEl(p, '#btn-submit');
        await L.sleep(250);
        await L.clickEl(p, '#btn-next');
        await L.sleep(250);
      }
      R.check('抽到超长短语 Royal Air Force', found);

      if (found) {
        await L.typeViaKbd(p, 'Royal Air Force');
        await L.sleep(250);
        const echo = (await p.textContent('#answer-text')).replace(/\s+/g, ' ').trim();
        R.check('长短语完整输入（含空格与大写）', echo === 'Royal Air Force', JSON.stringify(echo));
      }

      const t = await p.evaluate(() => {
        const box = document.querySelector('#answer'), el = document.querySelector('#answer-text');
        const es = getComputedStyle(el);
        return {
          boxW: box.clientWidth, boxScrollW: box.scrollWidth,
          txtW: el.clientWidth, txtScrollW: el.scrollWidth,
          font: es.fontSize, boxH: box.clientHeight,
          docW: document.documentElement.scrollWidth, innerW: innerWidth
        };
      });
      R.check('长答案不撑破容器（无横向溢出）', t.boxScrollW <= t.boxW + 1 && t.txtScrollW <= t.txtW + 1,
        `容器 ${t.boxW}/${t.boxScrollW}  文本 ${t.txtW}/${t.txtScrollW}`);
      R.check('长答案时自动缩小字号', parseFloat(t.font) < 30, 'font-size=' + t.font);
      R.check('页面无横向滚动', t.docW <= t.innerW + 1, `${t.docW} ≤ ${t.innerW}`);
      await p.screenshot({ path: path.join(OUT, 'C-long-answer.png') });
      await ctx.close();
    }

    /* ============ D. 平板 / 横屏 ============ */
    for (const [label, vp] of [['iPad', { width: 820, height: 1180 }], ['landscape', { width: 844, height: 390 }]]) {
      const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2 });
      const p = await ctx.newPage();
      p.on('pageerror', e => R.error(label + ' PAGEERROR: ' + e.message));
      await p.addInitScript(() => sessionStorage.setItem('nce1.installed.tip', '1'));
      await p.goto(BASE, { waitUntil: 'networkidle' });
      await p.waitForSelector('#app:not([hidden])');
      await p.waitForTimeout(900);
      await L.dismissInstall(p);
      await L.clickEl(p, '#btn-start');
      await p.waitForSelector('#view-quiz.is-active');
      await p.waitForTimeout(500);
      const m = await p.evaluate(() => ({
        docH: document.documentElement.scrollHeight, innerH: innerHeight,
        docW: document.documentElement.scrollWidth, innerW: innerWidth
      }));
      R.check(`${label} 无横向滚动`, m.docW <= m.innerW + 1, `${m.docW} ≤ ${m.innerW}`);
      await p.screenshot({ path: path.join(OUT, `D-${label}.png`) });
      R.check(`${label} 页面可渲染`, await p.isVisible('#view-quiz'));
      await ctx.close();
    }
  } finally {
    await browser.close();
    srv.close();
  }

  process.exit(R.report('边界验收') ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
