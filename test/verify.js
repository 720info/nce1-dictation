/* ============================================================
   test/verify.js —— 主验收套件（43 项）
   覆盖：首页配置 / 安装引导 / 无系统输入法 / 虚拟键盘 / 物理键盘 /
         判分反馈 / 复习算法（答错回炉）/ 统计与错题本 / 持久化 /
         Service Worker + 断网可用 / 桌面端

   跑法：node test/verify.js
   ============================================================ */
'use strict';

const path = require('path');
const L = require('./lib');

(async () => {
  const { srv, url } = await L.serve();
  const BASE = url;
  const OUT = L.shotDir('verify');

  const WORDS = L.loadWords();
  const byZh = L.indexByZh(WORDS);
  const R = L.runner();

  const browser = await L.launch();
  const ctx = await L.iphoneCtx(browser);
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') R.error('CONSOLE: ' + m.text()); });
  page.on('pageerror', e => R.error('PAGEERROR: ' + e.message));

  try {
    /* ---------- 1. 首页 ---------- */
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForSelector('#app:not([hidden])', { timeout: 10000 });
    await page.waitForTimeout(1100);
    await page.screenshot({ path: path.join(OUT, '01-home.png') });
    R.check('首页渲染', await page.isVisible('#view-home'));

    /* ---------- 1b. 左上角品牌标 = App 图标的矢量复刻 ---------- */
    const brand = await page.evaluate(() => {
      const s = document.querySelector('.brand-mark');
      if (!s || s.tagName.toLowerCase() !== 'svg') return { tag: s ? s.tagName : null };
      const rects = s.querySelectorAll('rect');
      const circle = s.querySelector('circle');
      const grad = s.querySelector('linearGradient');
      const box = s.getBoundingClientRect();
      const cs = getComputedStyle;
      return {
        tag: 'svg',
        rects: rects.length,
        whiteInner: !!(rects[1] && (rects[1].getAttribute('fill') || '').toLowerCase() === '#fff'),
        hasGrad: !!grad,
        hasCheck: !!circle && (circle.getAttribute('fill') || '').toLowerCase() === '#37b24d',
        // 关键：不能被全局那条「线性图标统一描边」规则命中
        polluted: s.matches('svg:not(.brand-mark)'),
        shapesStroke: [cs(rects[0]).stroke, cs(rects[1]).stroke, cs(s.querySelector('path')).stroke],
        checkStroke: cs(s.querySelectorAll('path')[1]).stroke,
        w: Math.round(box.width), h: Math.round(box.height)
      };
    });
    R.check('左上角品牌标是矢量图形（非文字标）', brand.tag === 'svg', JSON.stringify(brand));
    R.check('品牌标含渐变底 + 白色内块 + 绿勾（与 App 图标同构图）',
      brand.rects >= 2 && brand.whiteInner && brand.hasGrad && brand.hasCheck, JSON.stringify(brand));
    R.check('品牌标未被全局图标描边规则污染',
      brand.polluted === false && brand.shapesStroke.every(s => s === 'none') && brand.checkStroke === 'rgb(255, 255, 255)',
      JSON.stringify(brand.shapesStroke) + ' 勾=' + brand.checkStroke);
    R.check('品牌标尺寸为正方形', brand.w === brand.h && brand.w >= 30, `${brand.w}x${brand.h}`);

    /* ---------- 2. 安装引导（iOS） ---------- */
    await page.waitForSelector('#install-mask:not([hidden])', { timeout: 8000 });
    await L.waitStable(page, '#btn-install-close');
    await page.screenshot({ path: path.join(OUT, '02-install-ios.png') });
    const body = (await page.textContent('#install-body')).replace(/\s+/g, ' ');
    R.check('iOS 安装引导含三步', /Safari/.test(body) && /添加到主屏幕/.test(body) && /添加/.test(body));
    R.check('安装按钮文案正确', (await page.textContent('#install-title')).trim() === '添加到主屏幕');
    await L.clickEl(page, '#btn-install-close');
    await page.waitForTimeout(300);
    R.check('关闭安装引导后浮层消失', await page.isHidden('#install-mask'));

    /* ---------- 3. 无系统输入法 ---------- */
    const editable = await page.evaluate(() =>
      document.querySelectorAll('input:not([type=range]):not([type=checkbox]), textarea, [contenteditable=""], [contenteditable="true"]').length);
    R.check('页面内可编辑元素为 0（系统输入法无法唤起）', editable === 0, editable);

    /* ---------- 4. 课程范围 / 每日词数 ---------- */
    await L.clickEl(page, '#presets .chip[data-a="1"][data-b="20"]');
    await page.waitForTimeout(120);
    await L.clickEl(page, '#seg-daily button[data-n="5"]');
    await page.waitForTimeout(120);
    const rangeTxt = (await page.textContent('#range-count')).trim();
    R.check('课程范围生效', /Lesson 1–20/.test(rangeTxt), rangeTxt);
    R.check('预设按钮高亮', await page.evaluate(() => document.querySelector('#presets .chip[data-a="1"][data-b="20"]').classList.contains('on')));
    await L.clickEl(page, '[data-step="end:-1"]');
    await page.waitForTimeout(120);
    R.check('结束课步进生效', (await page.textContent('#lbl-end')).trim() === '19', await page.textContent('#lbl-end'));
    await L.clickEl(page, '#presets .chip[data-a="1"][data-b="20"]');
    await page.screenshot({ path: path.join(OUT, '03-home-configured.png') });

    /* ---------- 5. 开始听写 ---------- */
    await L.clickEl(page, '#btn-start');
    await page.waitForSelector('#view-quiz.is-active');
    await page.waitForTimeout(450);
    await page.screenshot({ path: path.join(OUT, '04-quiz-empty.png') });
    R.check('进入听写页', await page.isVisible('#view-quiz'));
    R.check('进度显示 1 / 5', (await page.textContent('#quiz-count')).trim() === '1 / 5', await page.textContent('#quiz-count'));
    R.check('虚拟键盘已渲染 4 行', (await page.locator('#kbd .kbd-row').count()) === 4);
    const letterKeys = await page.locator('#kbd .key[data-char]')
      .evaluateAll(els => els.filter(e => /^[a-z]$/.test(e.dataset.char)).length);
    R.check('键盘含 26 个字母键', letterKeys === 26, letterKeys);
    const puncKeys = await page.locator('#kbd .key[data-char]')
      .evaluateAll(els => els.filter(e => !/^[a-z]$/.test(e.dataset.char)).map(e => e.dataset.char));
    R.check('键盘含空格/撇号/连字符/句点', await page.isVisible('#kbd .key[data-act="space"]') && puncKeys.join('') === "'-.",
      '标点键=' + JSON.stringify(puncKeys));
    R.check('键盘含退格/上档键', await page.isVisible('#kbd .key[data-act="back"]') && await page.isVisible('#kbd .key[data-act="shift"]'));

    /* 性能相关的两条静态断言，防止以后被改回「每帧布局 / 每次按键重建节点」 */
    const bar = await page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector('#quiz-bar-fill'));
      return { transform: cs.transform, transition: cs.transitionProperty };
    });
    R.check('进度条走 transform 而非 width（width 动画每帧都要重新布局）',
      /matrix/.test(bar.transform) && !/(^|,)\s*width/.test(bar.transition), JSON.stringify(bar));
    const caret = await page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector('#answer-text'), '::after');
      return { w: cs.width, anim: cs.animationName };
    });
    R.check('光标由 CSS ::after 提供（按键时不再重建节点、动画不被重置）',
      caret.anim === 'blink' && caret.w === '2px', JSON.stringify(caret));

    /* ---------- 6. 第 1 题：虚拟键盘故意答错 ---------- */
    const q1 = (await page.textContent('#prompt-zh')).trim();
    const a1 = byZh[q1][0];
    const allSeen = [q1];
    console.log('  第1题: 「' + q1 + '」→ ' + a1.w);
    await L.typeViaKbd(page, 'zzzz');
    await page.screenshot({ path: path.join(OUT, '05-quiz-typed.png') });
    R.check('虚拟键盘输入回显', (await page.textContent('#answer-text')).replace(/\s/g, '') === 'zzzz');
    await L.clickEl(page, '#btn-submit');
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(OUT, '06-quiz-wrong.png') });
    R.check('答错反馈正确', (await page.textContent('#fb-title')).trim() === '拼写不对');
    R.check('答错时显示正确答案', (await page.textContent('#fb-detail')).includes(a1.w));
    R.check('答错时高亮红色', (await page.getAttribute('#answer', 'class')).includes('is-err'));
    R.check('答错后出现「下一个」', await page.isVisible('#btn-next'));
    await L.clickEl(page, '#btn-next');
    await page.waitForTimeout(300);

    /* ---------- 7. 第 2 题：物理键盘答对 ---------- */
    const q2 = (await page.textContent('#prompt-zh')).trim();
    const a2 = byZh[q2][0];
    allSeen.push(q2);
    console.log('  第2题: 「' + q2 + '」→ ' + a2.w);
    await page.keyboard.type(a2.w);
    R.check('物理键盘输入回显', (await page.textContent('#answer-text')).replace(/\s/g, '') === a2.w.replace(/\s/g, ''));
    await L.clickEl(page, '#btn-submit');
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(OUT, '07-quiz-correct.png') });
    R.check('答对反馈正确', (await page.textContent('#fb-title')).trim() === '正确');
    R.check('答对时高亮绿色', (await page.getAttribute('#answer', 'class')).includes('is-ok'));
    await L.clickEl(page, '#btn-next');
    await page.waitForTimeout(300);

    /* ---------- 8. 第 3 题：虚拟键盘大小写（回归 shift 误锁大写） ---------- */
    const q3 = (await page.textContent('#prompt-zh')).trim();
    const a3 = byZh[q3][0];
    allSeen.push(q3);
    console.log('  第3题: 「' + q3 + '」→ ' + a3.w);
    await L.typeViaKbd(page, a3.w);
    const typed3 = (await page.textContent('#answer-text')).replace(/\s/g, '');
    R.check('虚拟键盘大小写与答案一致', typed3 === a3.w.replace(/\s/g, ''), typed3 + ' vs ' + a3.w);
    await L.clickEl(page, '#btn-submit');
    await page.waitForTimeout(350);
    R.check('虚拟键盘作答判定正确', (await page.textContent('#fb-title')).trim() === '正确');
    await L.clickEl(page, '#btn-next');
    await page.waitForTimeout(300);

    /* ---------- 9. 走完剩余题目，检查错词是否回炉 ---------- */
    let guard = 0;
    while (guard++ < 25) {
      if (!(await page.isVisible('#view-quiz.is-active'))) break;
      const q = (await page.textContent('#prompt-zh')).trim();
      const cnt = (await page.textContent('#quiz-count')).trim();
      allSeen.push(q);
      const t = byZh[q] && byZh[q][0];
      if (!t) break;
      await L.typeViaKbd(page, t.w);
      const echo = (await page.textContent('#answer-text')).replace(/\s/g, '');
      await L.clickEl(page, '#btn-submit');
      await page.waitForTimeout(220);
      const title = (await page.textContent('#fb-title')).trim();
      console.log('  [循环' + guard + '] ' + cnt + ' 「' + q + '」输入=' + echo + ' 期望=' + t.w + ' → ' + title);
      await L.clickEl(page, '#btn-next');
      await page.waitForTimeout(220);
    }
    R.check('答错的单词被放回并再次出题', allSeen.slice(1).includes(q1),
      '「' + q1 + '」答错后完整出题序列: ' + allSeen.join(' / '));
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, '08-back-home.png') });
    R.check('一轮结束回到首页', await page.isVisible('#view-home'));

    /* ---------- 10. 统计页 ---------- */
    await L.clickEl(page, '#btn-stats');
    await page.waitForSelector('#view-stats.is-active');
    await page.waitForTimeout(450);
    await page.screenshot({ path: path.join(OUT, '09-stats.png') });
    const todayDone = (await page.textContent('#st-today-done')).trim();
    const rate = (await page.textContent('#st-today-rate')).trim();
    const mastered = (await page.textContent('#st-mastered')).trim();
    const wrongN = (await page.textContent('#st-wrong-n')).trim();
    R.check('今日完成数 > 0', +todayDone > 0, todayDone);
    R.check('正确率是百分比', /%$/.test(rate), rate);
    R.check('已掌握数 = 今日答对数', +mastered > 0, mastered);
    R.check('错题本记录 1 条', wrongN === '1', wrongN);
    const wrongTxt = (await page.textContent('#wrong-list')).replace(/\s+/g, ' ').trim();
    R.check('错题本显示错词', wrongTxt.includes(a1.w), wrongTxt.slice(0, 60));
    R.check('错题本显示状态（错误次数或已订正）', /错 \d+ 次|已订正/.test(wrongTxt), wrongTxt.slice(0, 60));
    R.check('错题本显示课号', /Lesson \d+/.test(wrongTxt));

    /* ---------- 11. 进度持久化 ---------- */
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('#app:not([hidden])');
    await page.waitForTimeout(900);
    R.check('刷新后进度保留', (await page.textContent('#mini-today')).trim() === todayDone,
      '刷新前 ' + todayDone + ' / 刷新后 ' + (await page.textContent('#mini-today')).trim());
    await page.screenshot({ path: path.join(OUT, '10-after-reload.png') });

    /* ---------- 12. Service Worker + 离线 ---------- */
    const sw = await page.evaluate(async () => {
      const r = await navigator.serviceWorker.ready;
      const ks = await caches.keys();
      return { scope: r.scope, active: !!r.active, caches: ks };
    });
    R.check('Service Worker 已激活', sw.active, sw.scope);
    R.check('预缓存已建立', sw.caches.length > 0, sw.caches.join(','));
    const cached = await page.evaluate(async () => {
      const c = await caches.open((await caches.keys())[0]);
      const ks = await c.keys();
      return ks.map(r => new URL(r.url).pathname.split('/').pop()).sort();
    });
    console.log('  缓存内容: ' + cached.join(', '));

    await page.waitForTimeout(600);
    await ctx.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
    const offHome = await page.isVisible('#view-home');
    const offPool = await page.textContent('#mini-pool');
    await page.screenshot({ path: path.join(OUT, '11-offline.png') });
    R.check('断网后仍可打开并使用', offHome && +offPool > 0, '词池=' + offPool);
    await ctx.setOffline(false);

    /* ---------- 13. 桌面端 ---------- */
    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const p2 = await ctx2.newPage();
    p2.on('pageerror', e => R.error('DESKTOP PAGEERROR: ' + e.message));
    await p2.goto(BASE, { waitUntil: 'networkidle' });
    await p2.waitForSelector('#app:not([hidden])');
    await p2.waitForTimeout(1100);
    await p2.screenshot({ path: path.join(OUT, '12-desktop-home.png') });
    await L.dismissInstall(p2);
    await L.clickEl(p2, '#btn-start');
    await p2.waitForSelector('#view-quiz.is-active');
    await p2.waitForTimeout(450);
    await p2.screenshot({ path: path.join(OUT, '13-desktop-quiz.png') });

    const dq = (await p2.textContent('#prompt-zh')).trim();
    const da = byZh[dq][0];
    console.log('  桌面端题目: 「' + dq + '」→ ' + da.w);
    await p2.keyboard.type(da.w);
    await p2.keyboard.press('Enter');                 // 回车提交
    await p2.waitForTimeout(450);
    await p2.screenshot({ path: path.join(OUT, '14-desktop-answered.png') });
    R.check('桌面端物理键盘可直接作答', (await p2.textContent('#fb-title')).trim() === '正确', dq + ' → ' + da.w);
    R.check('桌面端不显示虚拟键盘（用物理键盘）', await p2.isHidden('#kbd'));
    R.check('桌面端显示键盘提示', await p2.isVisible('.kbd-hint'));
    await p2.keyboard.press('Enter');                 // 回车进入下一题
    await p2.waitForTimeout(400);
    R.check('桌面端回车可进入下一题', (await p2.textContent('#quiz-count')).trim() === '2 / 10',
      await p2.textContent('#quiz-count'));
    const dEditable = await p2.evaluate(() =>
      document.querySelectorAll('input:not([type=range]):not([type=checkbox]), textarea, [contenteditable]').length);
    R.check('桌面端同样无可编辑元素', dEditable === 0, dEditable);
    const dw = await p2.evaluate(() => ({
      app: Math.round(document.querySelector('#app').getBoundingClientRect().width),
      innerW: innerWidth,
      scrollW: document.documentElement.scrollWidth
    }));
    R.check('桌面端内容占满整屏（不再限宽居中）', dw.app === dw.innerW, `${dw.app} / 视口 ${dw.innerW}`);
    R.check('桌面端无横向滚动', dw.scrollW <= dw.innerW + 1, `${dw.scrollW} ≤ ${dw.innerW}`);
    const dTopbar = await p2.evaluate(() => {
      const t = getComputedStyle(document.querySelector('.topbar'));
      return { bf: t.backdropFilter || t.webkitBackdropFilter || 'none' };
    });
    R.check('顶栏不用 backdrop-filter（移动端滚动掉帧的主因）', dTopbar.bf === 'none', dTopbar.bf);

    await ctx2.close();
  } finally {
    await browser.close();
    srv.close();
  }

  process.exit(R.report('主验收') ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
