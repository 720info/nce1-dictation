/* ============================================================
   test/lib.js —— 测试公共库
   三个验收套件（verify / edge / livecheck）共用这里的：
     · headless shell 自动定位
     · 内置静态服务器（不用手动起 python -m http.server）
     · 点击助手 / 等待稳定 / 虚拟键盘输入
     · 断言收集器
   ============================================================ */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(__dirname, 'shots');

const LIVE_URL = process.env.LIVE_URL || 'https://720info.github.io/nce1-dictation/';

/* ---------- playwright-core：先试常规解析，再退回托管 workspace ---------- */
let chromium;
try {
  ({ chromium } = require('playwright-core'));
} catch (e) {
  const alt = path.join(os.homedir(), '.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core');
  ({ chromium } = require(alt));
}

/* ---------- headless shell：自动找缓存里最新的一个 ---------- */
function findShell() {
  if (process.env.CHROME_SHELL) return process.env.CHROME_SHELL;
  const base = path.join(os.homedir(), 'Library/Caches/ms-playwright');
  if (fs.existsSync(base)) {
    const dirs = fs.readdirSync(base)
      .filter(d => d.indexOf('chromium_headless_shell-') === 0)
      .sort()
      .reverse();
    for (const d of dirs) {
      for (const arch of ['chrome-headless-shell-mac-arm64', 'chrome-headless-shell-mac-x64', 'chrome-headless-shell-linux64']) {
        const p = path.join(base, d, arch, 'chrome-headless-shell');
        if (fs.existsSync(p)) return p;
      }
    }
  }
  return null;   // 交给 playwright 自己找
}

/* ---------- 内置静态服务器 ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

function serve(root = ROOT, port = 0) {
  const srv = http.createServer((req, res) => {
    let rel = decodeURIComponent((req.url || '/').split('?')[0]);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(root, rel));
    if (!file.startsWith(root)) { res.writeHead(403); res.end('forbidden'); return; }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('404'); return; }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-cache'
      });
      res.end(buf);
    });
  });
  return new Promise((resolve, reject) => {
    srv.once('error', reject);
    srv.listen(port, '127.0.0.1', () => resolve({ srv, port: srv.address().port, url: `http://127.0.0.1:${srv.address().port}/index.html` }));
  });
}

/* ---------- 词库 ---------- */
function loadWords() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'data/words.json'), 'utf8'));
}
/** 中文释义 → 候选词数组（释义可能重复，取第一个） */
function indexByZh(words) {
  const m = {};
  (words || loadWords()).forEach(w => { (m[w.z] = m[w.z] || []).push(w); });
  return m;
}

/* ---------- 断言收集器 ---------- */
function runner() {
  const results = [], errors = [];
  return {
    results, errors,
    check(name, ok, extra) {
      results.push((ok ? '  ✓ ' : '  ✗ ') + name + (extra !== undefined ? '  → ' + extra : ''));
      if (!ok) errors.push('FAILED: ' + name);
      return !!ok;
    },
    note(msg) { results.push('    · ' + msg); },
    error(msg) { errors.push(msg); },
    report(title) {
      console.log('\n===== ' + title + ' =====');
      results.forEach(r => console.log(r));
      console.log('\n错误: ' + (errors.length ? '\n' + errors.join('\n') : '（无）'));
      return errors.length;
    }
  };
}

/* ---------- 浏览器启动 ---------- */
function launch(extraArgs) {
  const exe = findShell();
  const opts = {
    args: ['--no-sandbox', '--in-process-gpu', '--disable-gpu'].concat(extraArgs || [])
  };
  if (exe) opts.executablePath = exe;
  return chromium.launch(opts);
}

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

/** 建一个 iPhone 视口的 context */
function iphoneCtx(browser, vp) {
  return browser.newContext({
    viewport: vp || { width: 390, height: 844 },
    deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: IPHONE_UA
  });
}

/* ---------- 交互助手 ---------- */
/** 点击：优先原生点击，命中测试抖动时回退到真实坐标点击 */
async function clickEl(page, sel, timeout = 6000) {
  try { await page.click(sel, { timeout }); return 'native'; }
  catch (e) {
    const r = await page.evaluate(s => {
      const q = document.querySelector(s);
      if (!q) return null;
      const b = q.getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    }, sel);
    if (!r) throw e;
    await page.mouse.click(r.x, r.y);
    return 'coord';
  }
}

/** 等元素布局连续两帧不再变化，避免在抽屉上滑动画中途点击 */
async function waitStable(page, sel, timeout = 5000) {
  const start = Date.now();
  let last = null, same = 0;
  while (Date.now() - start < timeout) {
    const r = await page.evaluate(s => {
      const e = document.querySelector(s);
      if (!e) return null;
      const b = e.getBoundingClientRect();
      return [b.x, b.y, b.width, b.height].map(Math.round).join(',');
    }, sel);
    if (r && r === last) { if (++same >= 2) return; } else same = 0;
    last = r;
    await page.waitForTimeout(80);
  }
}

/** 用页面内置虚拟键盘逐字符输入（自动处理 shift / 空格） */
async function typeViaKbd(page, text) {
  for (const ch of text) {
    const lower = ch.toLowerCase();
    if (ch !== lower) await clickEl(page, '#kbd .key[data-act="shift"]');
    if (ch === ' ') await clickEl(page, '#kbd .key[data-act="space"]');
    else await clickEl(page, `#kbd .key[data-char="${lower}"]`);
  }
}

/** 关掉可能自动弹出的安装引导（若有） */
async function dismissInstall(page, ms = 700) {
  if (await page.isVisible('#install-mask')) {
    await page.waitForTimeout(ms);
    await clickEl(page, '#btn-install-close');
    await page.waitForTimeout(300);
    return true;
  }
  return false;
}

function shotDir(name) {
  const d = path.join(SHOTS, name);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

module.exports = {
  ROOT, SHOTS, LIVE_URL, IPHONE_UA, chromium,
  findShell, serve, loadWords, indexByZh,
  runner, launch, iphoneCtx,
  clickEl, waitStable, typeViaKbd, dismissInstall, shotDir, sleep
};
