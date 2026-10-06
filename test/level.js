/* ============================================================
   test/level.js —— 闯关模式验收
   ------------------------------------------------------------
   为什么要拦截词库：
     真实词库里存在「多个单词同一释义」的情况，测试只能靠中文反查答案，
     反查到的可能不是当前题的那一个，于是「全对拿 3 星」这类强断言会随机失败。
     所以这里用 route 把 data/words.json 换成一个「释义唯一」的测试词库，
     让每道题的答案可以被精确推导出来。真实词库的完整性由 verify.js 负责。

   覆盖：入口 → 关卡列表 → 解锁规则 → HUD/倒计时 → 连击计分 → 扣血
         → 生命耗尽结算 → 全对 3 星 → 解锁下一关 → 持久化 → 超时判错
   ============================================================ */
'use strict';

const path = require('path');
const L = require('./lib');

const OUT = L.shotDir('level');
const R = L.runner();

/* ---------- 构造「释义唯一」的测试词库：每关正好 10 个词 ---------- */
const TW = [];
for (let l = 1; l <= 144; l += 10) {
  for (let i = 1; i <= 10; i++) {
    TW.push({ w: 'w' + l + 'x' + i, z: '释义' + l + '-' + i, p: 'n.', l: l, ph: 'test' });
  }
}
const byZh = {};
TW.forEach(w => { byZh[w.z] = w; });

const START_CFG = () => {
  sessionStorage.setItem('nce1.installed.tip', '1');
  localStorage.setItem('nce1.settings.v1', JSON.stringify({ start: 1, end: 144, daily: 10, hints: true, auto: false, sound: false }));
};

/** 读出当前题的正确答案 */
async function answerOf(page) {
  const zh = (await page.textContent('#prompt-zh')).trim();
  return byZh[zh] ? byZh[zh].w : null;
}

/** 答一题；wrong=true 时故意输入错误答案；noNext=true 时答完不点「下一个」
    （生命耗尽那题要用它，否则会替测试把结算弹层点开） */
async function answerOne(page, wrong, noNext) {
  const ans = await answerOf(page);
  if (!ans) throw new Error('反查不到答案：' + (await page.textContent('#prompt-zh')));
  await page.keyboard.type(wrong ? 'zzz' : ans);
  await L.clickEl(page, '#btn-submit');
  await page.waitForTimeout(260);
  const fb = (await page.textContent('#fb-title')).trim();
  if (!noNext) {
    await L.clickEl(page, '#btn-next');
    await page.waitForTimeout(220);
  }
  return { ans, fb };
}

const livesOn = p => p.evaluate(() => document.querySelectorAll('#hud-lives i.on').length);
const hudScore = p => p.evaluate(() => +document.getElementById('hud-score').textContent);

(async () => {
  const { srv, url } = await L.serve();
  const b = await L.launch();

  const ctx = await b.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
    isMobile: true, hasTouch: true, userAgent: L.IPHONE_UA,
    serviceWorkers: 'block'          // 否则 SW 会绕过 page.route，测试词库换不进去
  });
  await ctx.route('**/words.json', r => r.fulfill({
    status: 200,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(TW)
  }));

  const page = await ctx.newPage();
  const consoleErrs = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrs.push(m.text()); });
  page.on('pageerror', e => consoleErrs.push(String(e)));

  await page.addInitScript(START_CFG);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#app:not([hidden])');
  await page.waitForTimeout(700);
  await L.dismissInstall(page, 400);

  /* ============ A. 首页闯关入口 ============ */
  R.check('首页有闯关模式入口', await page.isVisible('#btn-levels'));
  const entry = await page.evaluate(() => {
    const el = document.getElementById('btn-levels');
    const svg = el.querySelector('svg');
    const box = svg ? svg.getBoundingClientRect() : null;
    return {
      isSvg: !!svg,
      // 统一规格：全局 svg 规则给了 22px，图标不能被文字 emoji 替代
      w: box ? Math.round(box.width) : 0,
      sub: document.getElementById('lv-sub').textContent.trim(),
      stroke: svg ? getComputedStyle(svg).stroke : ''
    };
  });
  R.check('入口图标是线性 SVG（与其它图标同规格）',
    entry.isSvg && entry.w === 22, JSON.stringify(entry));
  R.check('入口初始显示 0 / 45 ★', entry.sub === '0 / 45 ★', entry.sub);
  await page.screenshot({ path: path.join(OUT, 'A-home.png') });

  /* ============ B. 关卡列表与解锁规则 ============ */
  await L.clickEl(page, '#btn-levels');
  await page.waitForSelector('#view-levels.is-active');
  await page.waitForTimeout(350);

  const grid = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('#lv-grid .lv-card'));
    return {
      n: cards.length,
      locked: cards.filter(c => c.disabled).length,
      firstOpen: !cards[0].disabled,
      firstNo: cards[0].querySelector('.lv-no').textContent.trim(),
      firstName: cards[0].querySelector('.lv-name').textContent.trim(),
      lastNo: cards[cards.length - 1].querySelector('.lv-no').textContent.trim(),
      lastName: cards[cards.length - 1].querySelector('.lv-name').textContent.trim(),
      starsTotal: document.getElementById('lv-total-stars').textContent.trim(),
      cleared: document.getElementById('lv-cleared').textContent.trim()
    };
  });
  R.check('渲染 15 张关卡卡片', grid.n === 15, grid.n);
  R.check('第 1 关默认解锁', grid.firstOpen && grid.firstNo === '1', JSON.stringify(grid));
  R.check('其余 14 关初始锁定', grid.locked === 14, grid.locked);
  R.check('关卡覆盖 Lesson 1–10 … 141–144',
    grid.firstName === 'Lesson 1–10' && grid.lastName === 'Lesson 141–144',
    grid.firstName + ' / ' + grid.lastName);
  R.check('初始星数 0 / 通关数 0', grid.starsTotal === '0' && grid.cleared === '0',
    grid.starsTotal + ' / ' + grid.cleared);
  await page.screenshot({ path: path.join(OUT, 'B-levels.png') });

  /* ============ C. 进入第 1 关：HUD 与倒计时 ============ */
  await L.clickEl(page, '#lv-grid .lv-card[data-lv="1"]');
  await page.waitForSelector('#view-quiz.is-active');
  await page.waitForTimeout(400);

  const hud = await page.evaluate(() => ({
    hudVisible: !document.getElementById('hud').hidden,
    lives: document.querySelectorAll('#hud-lives i.on').length,
    livesTotal: document.querySelectorAll('#hud-lives i').length,
    score: document.getElementById('hud-score').textContent.trim(),
    comboHidden: document.getElementById('hud-combo').hidden,
    timerVisible: !document.getElementById('timer').hidden,
    skipHidden: document.getElementById('btn-skip').hidden,
    count: document.getElementById('quiz-count').textContent.trim(),
    noEditable: document.querySelectorAll('input:not([type=range]):not([type=checkbox]),textarea,[contenteditable]').length
  }));
  R.check('闯关模式 HUD 可见', hud.hudVisible);
  R.check('生命值为 3 颗心且全亮', hud.lives === 3 && hud.livesTotal === 3, hud.lives + '/' + hud.livesTotal);
  R.check('初始得分 0', hud.score === '0', hud.score);
  R.check('连击未达 2 时不显示', hud.comboHidden === true);
  R.check('本题倒计时条可见', hud.timerVisible);
  R.check('闯关模式隐藏「跳过」按钮', hud.skipHidden === true);
  R.check('题序从 1 / 10 开始', hud.count === '1 / 10', hud.count);
  R.check('闯关页同样无可编辑元素（不唤起系统输入法）', hud.noEditable === 0, hud.noEditable);

  const t1 = await page.evaluate(() => getComputedStyle(document.getElementById('timer-fill')).transform);
  await page.waitForTimeout(700);
  const t2 = await page.evaluate(() => getComputedStyle(document.getElementById('timer-fill')).transform);
  R.check('倒计时条随时间收缩（scaleX 在变）', t1 !== t2, t1 + ' → ' + t2);
  await page.screenshot({ path: path.join(OUT, 'C-level1.png') });

  /* ============ D. 连击与计分 ============ */
  await answerOne(page, true);                      // 第 1 题：故意答错
  const afterWrong = { lives: await livesOn(page), score: await hudScore(page) };
  R.check('答错扣 1 颗心（3 → 2）', afterWrong.lives === 2, afterWrong.lives);
  R.check('答错不加分', afterWrong.score === 0, afterWrong.score);

  await answerOne(page, false);                     // 第 2 题：答对，连击 1
  R.check('第 1 次答对得 100 分', await hudScore(page) === 100, await hudScore(page));

  await answerOne(page, false);                     // 第 3 题：答对，连击 2
  const c2 = await page.evaluate(() => ({
    score: +document.getElementById('hud-score').textContent,
    comboHidden: document.getElementById('hud-combo').hidden,
    comboText: document.getElementById('hud-combo').textContent.trim()
  }));
  R.check('连击 ×2 时得分 100+120=220', c2.score === 220, c2.score);
  R.check('连击 ×2 时显示连击标记', !c2.comboHidden && /×\s*2/.test(c2.comboText), c2.comboText);

  await answerOne(page, false);                     // 第 4 题：答对，连击 3
  R.check('连击 ×3 时得分 220+140=360', await hudScore(page) === 360, await hudScore(page));
  await page.screenshot({ path: path.join(OUT, 'D-combo.png') });

  await answerOne(page, true);                      // 第 5 题：答错，连击清零
  const afterBreak = await page.evaluate(() => ({
    lives: document.querySelectorAll('#hud-lives i.on').length,
    comboHidden: document.getElementById('hud-combo').hidden,
    score: +document.getElementById('hud-score').textContent
  }));
  R.check('答错后连击清零', afterBreak.comboHidden === true);
  R.check('答错后得分不清零（累计保留）', afterBreak.score === 360, afterBreak.score);
  R.check('再次答错后剩 1 颗心', afterBreak.lives === 1, afterBreak.lives);

  /* ============ E. 生命耗尽 → 失败结算 ============ */
  await answerOne(page, true, true);                // 第 6 题：答错，心归零（不自动点下一个）
  const deadBtn = (await page.textContent('#btn-next')).trim();
  R.check('生命耗尽时按钮变为「查看结果」', deadBtn === '查看结果', deadBtn);
  await L.clickEl(page, '#btn-next');
  await page.waitForTimeout(450);

  const res1 = await page.evaluate(() => ({
    open: !document.getElementById('result-mask').hidden,
    title: document.getElementById('res-title').textContent.trim(),
    starsOn: document.querySelectorAll('#res-stars i.on').length,
    nextHidden: document.getElementById('btn-res-next').hidden,
    retry: document.getElementById('btn-res-retry').textContent.trim(),
    wrongItems: document.querySelectorAll('#res-wrong-box .res-wrong-i').length,
    right: document.getElementById('res-right').textContent.trim()
  }));
  R.check('生命耗尽后弹出结算', res1.open);
  R.check('失败时 0 星', res1.starsOn === 0, res1.starsOn);
  R.check('失败时不显示「下一关」', res1.nextHidden === true);
  R.check('失败时按钮文案为「重新挑战」', res1.retry === '重新挑战', res1.retry);
  R.check('结算列出本关错题', res1.wrongItems === 3, res1.wrongItems);
  R.check('结算答对数 3 / 10', res1.right === '3 / 10', res1.right);
  await page.screenshot({ path: path.join(OUT, 'E-fail.png') });

  /* ============ F. 重挑战全对 → 3 星 ============ */
  await L.clickEl(page, '#btn-res-retry');
  await page.waitForSelector('#view-quiz.is-active');
  await page.waitForTimeout(400);
  R.check('重新挑战后生命恢复 3 颗', await livesOn(page) === 3, await livesOn(page));

  for (let i = 0; i < 10; i++) {
    const r = await answerOne(page, false);
    if (r.fb !== '正确') { R.error('第 ' + (i + 1) + ' 题本应答对，实际反馈：' + r.fb + '（答案 ' + r.ans + '）'); break; }
  }
  await page.waitForTimeout(400);
  const res2 = await page.evaluate(() => ({
    open: !document.getElementById('result-mask').hidden,
    title: document.getElementById('res-title').textContent.trim(),
    starsOn: document.querySelectorAll('#res-stars i.on').length,
    right: document.getElementById('res-right').textContent.trim(),
    score: +document.getElementById('res-score').textContent,
    combo: document.getElementById('res-combo').textContent.trim(),
    nextHidden: document.getElementById('btn-res-next').hidden,
    nextText: document.getElementById('btn-res-next').textContent.trim()
  }));
  R.check('答完 10 题弹出结算', res2.open);
  R.check('全对拿 3 星', res2.starsOn === 3, res2.starsOn);
  R.check('结算标题为「完美通关！」', res2.title === '完美通关！', res2.title);
  R.check('结算答对 10 / 10', res2.right === '10 / 10', res2.right);
  // 连击加成封顶 +100（combo≥6 后每题固定 200 分）：
  // 100+120+140+160+180+200×5 = 1700
  R.check('满连击总分 1700（连击加成封顶 +100）', res2.score === 1700, res2.score);
  R.check('结算显示最高连击 ×10', res2.combo === '×10', res2.combo);
  R.check('通关后出现「挑战第 2 关」', !res2.nextHidden && /第 2 关/.test(res2.nextText), res2.nextText);
  await page.screenshot({ path: path.join(OUT, 'F-perfect.png') });

  /* ============ G. 解锁规则与列表回填 ============ */
  await L.clickEl(page, '#btn-res-back');
  await page.waitForSelector('#view-levels.is-active');
  await page.waitForTimeout(350);
  const after = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('#lv-grid .lv-card'));
    const c1 = cards[0], c2 = cards[1], c3 = cards[2];
    return {
      c1Stars: c1.querySelectorAll('.lv-stars i.on').length,
      c1Score: c1.querySelector('.lv-score').textContent.trim(),
      c1Perfect: c1.classList.contains('is-perfect'),
      c2Locked: c2.disabled,
      c3Locked: c3.disabled,
      total: document.getElementById('lv-total-stars').textContent.trim(),
      cleared: document.getElementById('lv-cleared').textContent.trim(),
      best: document.getElementById('lv-best').textContent.trim()
    };
  });
  R.check('第 1 关列表显示 3 星', after.c1Stars === 3, after.c1Stars);
  R.check('第 1 关标记为满星样式', after.c1Perfect === true);
  R.check('第 1 关显示最高分 1700', after.c1Score === '1700 分', after.c1Score);
  R.check('通关后第 2 关解锁', after.c2Locked === false);
  R.check('第 3 关仍然锁定（跳关不允许）', after.c3Locked === true);
  R.check('汇总星数 3 / 通关数 1 / 最高分 1700',
    after.total === '3' && after.cleared === '1' && after.best === '1700',
    after.total + ' / ' + after.cleared + ' / ' + after.best);
  await page.screenshot({ path: path.join(OUT, 'G-unlocked.png') });

  /* ============ H. 锁定关卡点不动 ============ */
  await page.evaluate(() => document.querySelector('#lv-grid .lv-card[data-lv="3"]').click());
  await page.waitForTimeout(400);
  R.check('点击锁定关卡不会进入听写页',
    !(await page.isVisible('#view-quiz.is-active')) && (await page.isVisible('#view-levels.is-active')));

  /* ============ I. 持久化 ============ */
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#app:not([hidden])');
  await page.waitForTimeout(700);
  await L.dismissInstall(page, 400);
  const home2 = await page.evaluate(() => document.getElementById('lv-sub').textContent.trim());
  R.check('刷新后首页入口保留 3 / 45 ★', home2 === '3 / 45 ★', home2);
  await L.clickEl(page, '#btn-levels');
  await page.waitForSelector('#view-levels.is-active');
  await page.waitForTimeout(300);
  const persisted = await page.evaluate(() => ({
    c1: document.querySelector('#lv-grid .lv-card[data-lv="1"] .lv-stars').querySelectorAll('i.on').length,
    c2: !document.querySelector('#lv-grid .lv-card[data-lv="2"]').disabled
  }));
  R.check('刷新后第 1 关星数与解锁状态保留', persisted.c1 === 3 && persisted.c2 === true,
    JSON.stringify(persisted));

  R.check('闯关流程零控制台错误', consoleErrs.length === 0, consoleErrs.slice(0, 2).join(' | ') || '（无）');
  await ctx.close();

  /* ============ J. 超时判错（单独 context，把时钟加速 30 倍） ============ */
  const ctx2 = await b.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
    isMobile: true, hasTouch: true, userAgent: L.IPHONE_UA,
    serviceWorkers: 'block'
  });
  await ctx2.route('**/words.json', r => r.fulfill({
    status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(TW)
  }));
  const p2 = await ctx2.newPage();
  // 只加速 Date.now：倒计时的 deadline 走它，而 setInterval 仍是真实节拍，
  // 于是 15 秒的限时会在 0.5 秒左右到期，不用真等 15 秒。
  await p2.addInitScript(() => {
    const realNow = Date.now.bind(Date);
    const t0 = realNow();
    Date.now = () => t0 + (realNow() - t0) * 30;
  });
  await p2.addInitScript(START_CFG);
  await p2.goto(url, { waitUntil: 'domcontentloaded' });
  await p2.waitForSelector('#app:not([hidden])');
  await p2.waitForTimeout(700);
  await L.dismissInstall(p2, 400);
  await L.clickEl(p2, '#btn-levels');
  await p2.waitForSelector('#view-levels.is-active');
  await p2.waitForTimeout(300);
  await L.clickEl(p2, '#lv-grid .lv-card[data-lv="1"]');
  await p2.waitForSelector('#view-quiz.is-active');
  await p2.waitForTimeout(1200);                    // 什么都不输入，等它超时

  const to = await p2.evaluate(() => ({
    title: document.getElementById('fb-title').textContent.trim(),
    fbShown: !document.getElementById('feedback').hidden,
    lives: document.querySelectorAll('#hud-lives i.on').length,
    urgent: document.getElementById('timer').classList.contains('is-urgent'),
    detail: document.getElementById('fb-detail').textContent
  }));
  R.check('超时自动判错并给出反馈', to.fbShown && to.title === '时间到', to.title);
  R.check('超时扣 1 颗心', to.lives === 2, to.lives);
  R.check('超时反馈提示未作答', /超时未作答/.test(to.detail));
  await p2.screenshot({ path: path.join(OUT, 'J-timeout.png') });
  await ctx2.close();

  await b.close();
  srv.close();

  const bad = R.report('闯关模式验收');
  process.exit(bad ? 1 : 0);
})().catch(e => {
  console.error('\n[中断] ' + e.message);
  R.report('闯关模式验收（中断，以下是已跑到的断言）');
  process.exit(1);
});
