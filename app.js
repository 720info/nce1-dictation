/* ============================================================
   新概念一册 · 单词听写  PWA
   纯前端 / 无依赖 / 离线可用
   ============================================================ */
(function () {
  'use strict';

  /* ---------------- 常量 ---------------- */
  var K = {
    settings: 'nce1.settings.v1',
    progress: 'nce1.progress.v1',
    daily: 'nce1.daily.v1',
    levels: 'nce1.levels.v1',
    install: 'nce1.install.dismissed',
    autoPop: 'nce1.install.popped'
  };
  var MAX_ATTEMPT = 3;        // 同一词一轮内最多出现次数（仅自由听写模式）
  var MAXLEN = 40;

  /* ---------------- 闯关配置 ---------------- */
  var LV_SPAN = 10;           // 每关覆盖的课数
  var LV_TOTAL = 15;          // 1–144 课 → 15 关
  var LV_Q = 10;              // 每关题量
  var LV_LIVES = 3;           // 生命值
  var LV_TIME = 15000;        // 每题限时（毫秒）
  var LV_URGENT = 5000;       // 剩余时间低于此值进入告急态

  /** 关卡表：第 n 关覆盖 Lesson (n-1)*10+1 到 n*10 */
  var LEVELS = (function () {
    var out = [];
    for (var i = 0; i < LV_TOTAL; i++) {
      var a = i * LV_SPAN + 1;
      var b = Math.min(a + LV_SPAN - 1, 144);
      out.push({ id: i + 1, a: a, b: b, name: 'Lesson ' + a + '–' + b });
    }
    return out;
  })();
  var MAX_STARS = LV_TOTAL * 3;

  /* ---------------- 工具 ---------------- */
  function $(id) { return document.getElementById(id); }
  function load(key, fallback) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch (e) { return fallback; }
  }
  function save(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* 隐私模式 */ }
  }
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  /** 判分归一化：忽略大小写、空格、连字符、撇号、句点 */
  function norm(s) {
    return String(s || '').toLowerCase()
      .replace(/[\u2018\u2019\u02bc`´]/g, "'")
      .replace(/[^a-z0-9]/g, '');
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* ---------------- 音效（WebAudio 合成，无外部资源） ---------------- */
  var AC = null;
  function tone(freqs, dur, type, gain) {
    if (!state.settings.sound) return;
    try {
      AC = AC || new (window.AudioContext || window.webkitAudioContext)();
      if (AC.state === 'suspended') AC.resume();
      freqs.forEach(function (f, i) {
        var o = AC.createOscillator(), g = AC.createGain();
        o.type = type || 'sine';
        o.frequency.value = f;
        var t0 = AC.currentTime + i * (dur * 0.62);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(gain || 0.16, t0 + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        o.connect(g); g.connect(AC.destination);
        o.start(t0); o.stop(t0 + dur + 0.02);
      });
    } catch (e) { /* 忽略 */ }
  }
  function sfxOk() { tone([784, 1046], 0.16, 'sine', 0.14); }
  function sfxNo() { tone([233, 175], 0.22, 'triangle', 0.15); }

  /* ---------------- 状态 ---------------- */
  var WORDS = [];
  var state = {
    settings: Object.assign(
      { start: 1, end: 144, daily: 10, hints: true, auto: false, sound: true },
      load(K.settings, {})
    ),
    progress: Object.assign({ mastered: {}, wrong: {} }, load(K.progress, {})),
    daily: Object.assign({ date: today(), done: 0, correct: 0 }, load(K.daily, {})),
    // 关卡进度：{ "1": { stars: 3, score: 1450, plays: 5 } }
    levels: load(K.levels, {})
  };
  var session = null;
  var shift = false, caps = false, lastShift = 0;

  function saveSettings() { save(K.settings, state.settings); }
  function saveProgress() { save(K.progress, state.progress); }
  function saveDaily() { save(K.daily, state.daily); }
  function saveLevels() { save(K.levels, state.levels); }
  function rollDaily() {
    if (state.daily.date !== today()) {
      state.daily = { date: today(), done: 0, correct: 0 };
      saveDaily();
    }
  }

  /* ---------------- 词池 ---------------- */
  function inRange(i) {
    var l = WORDS[i].l;
    return l >= state.settings.start && l <= state.settings.end;
  }
  function rangeIdx() {
    var out = [];
    for (var i = 0; i < WORDS.length; i++) if (inRange(i)) out.push(i);
    return out;
  }
  function poolIdx() {
    return rangeIdx().filter(function (i) { return !state.progress.mastered[i]; });
  }
  function masteredCount() {
    var n = 0;
    for (var k in state.progress.mastered) if (inRange(+k)) n++;
    return n;
  }
  function wrongCount() {
    return Object.keys(state.progress.wrong).length;
  }

  /* ---------------- 关卡进度 ---------------- */
  /** 某关覆盖的词索引（与自由听写是否已掌握无关，闯关是独立的固定题库） */
  function levelWords(lv) {
    var out = [];
    for (var i = 0; i < WORDS.length; i++) {
      if (WORDS[i].l >= lv.a && WORDS[i].l <= lv.b) out.push(i);
    }
    return out;
  }
  function levelRec(id) { return state.levels[id] || null; }
  /** 第 1 关默认解锁；其余需要上一关拿到 ≥1 星 */
  function levelUnlocked(id) {
    if (id <= 1) return true;
    var prev = levelRec(id - 1);
    return !!(prev && prev.stars >= 1);
  }
  function totalStars() {
    var n = 0;
    for (var k in state.levels) n += state.levels[k].stars || 0;
    return n;
  }
  function clearedCount() {
    var n = 0;
    for (var k in state.levels) if ((state.levels[k].stars || 0) >= 1) n++;
    return n;
  }
  function bestScore() {
    var n = 0;
    for (var k in state.levels) n = Math.max(n, state.levels[k].score || 0);
    return n;
  }

  /* ---------------- 视图切换 ---------------- */
  var currentView = 'home';
  var pushed = 0;            // 我们自己压入的历史条目数
  function go(view, fromPop) {
    // 返回首页时，把之前压入的历史条目弹掉，避免历史栈越堆越深
    if (view === 'home' && !fromPop && pushed > 0) {
      pushed--;
      history.back();
      return;
    }
    if (view !== 'home' && !fromPop) {
      pushed++;
      try { history.pushState({ v: view }, ''); } catch (e) { /* 忽略 */ }
    }
    currentView = view;
    ['home', 'levels', 'quiz', 'stats'].forEach(function (v) {
      $('view-' + v).classList.toggle('is-active', v === view);
    });
    window.scrollTo(0, 0);
    if (view === 'home') renderHome();
    if (view === 'levels') renderLevels();
    if (view === 'stats') renderStats();
  }

  /* ---------------- 首页渲染 ---------------- */
  function renderHome() {
    var s = state.settings;
    $('rng-start').value = s.start;
    $('rng-end').value = s.end;
    $('rng-daily').value = s.daily;
    $('lbl-start').textContent = s.start;
    $('lbl-end').textContent = s.end;
    $('lbl-daily').textContent = s.daily + ' 词';

    var total = rangeIdx().length;
    var pool = poolIdx().length;
    $('range-count').textContent = 'Lesson ' + s.start + '–' + s.end + ' · ' + total + ' 词';
    $('mini-pool').textContent = pool;
    $('mini-mastered').textContent = masteredCount();
    $('mini-today').textContent = state.daily.done;

    Array.prototype.forEach.call($('seg-daily').children, function (b) {
      b.classList.toggle('on', +b.dataset.n === s.daily);
    });
    Array.prototype.forEach.call($('presets').children, function (b) {
      b.classList.toggle('on', +b.dataset.a === s.start && +b.dataset.b === s.end);
    });

    $('btn-start').disabled = pool === 0;
    $('btn-start').textContent = pool === 0 ? '该范围单词已全部掌握' : '开始听写';

    // 闯关入口：显示已获星数，一眼看出进度
    $('lv-sub').textContent = totalStars() + ' / ' + MAX_STARS + ' ★';
  }

  /* ---------------- 关卡列表渲染 ---------------- */
  function starRow(n) {
    var out = '';
    for (var i = 1; i <= 3; i++) out += '<i class="' + (i <= n ? 'on' : '') + '"></i>';
    return out;
  }

  function renderLevels() {
    $('lv-total-stars').textContent = totalStars();
    $('lv-cleared').textContent = clearedCount();
    $('lv-best').textContent = bestScore();

    $('lv-grid').innerHTML = LEVELS.map(function (lv) {
      var rec = levelRec(lv.id);
      var open = levelUnlocked(lv.id);
      var stars = rec ? rec.stars : 0;
      var cls = 'lv-card' + (open ? '' : ' is-locked') + (stars >= 1 ? ' is-clear' : '') +
        (stars === 3 ? ' is-perfect' : '');
      return '<button class="' + cls + '" type="button" data-lv="' + lv.id + '"' +
        (open ? '' : ' disabled aria-disabled="true"') + '>' +
        '<span class="lv-no">' + lv.id + '</span>' +
        '<span class="lv-name">' + lv.name + '</span>' +
        (open
          ? '<span class="lv-stars">' + starRow(stars) + '</span>' +
            '<span class="lv-score">' + (rec && rec.score ? rec.score + ' 分' : '未挑战') + '</span>'
          : '<span class="lv-lock">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>' +
            '通关第 ' + (lv.id - 1) + ' 关解锁</span>') +
        '</button>';
    }).join('');
  }

  /* ---------------- 统计页渲染 ---------------- */
  function renderStats() {
    rollDaily();
    var d = state.daily;
    $('st-today-done').textContent = d.done;
    $('st-today-rate').textContent = d.done ? Math.round(d.correct / d.done * 100) + '%' : '—';
    $('st-mastered').textContent = Object.keys(state.progress.mastered).length;

    var ids = Object.keys(state.progress.wrong).filter(function (k) { return WORDS[+k]; });
    $('st-wrong-n').textContent = ids.length;
    $('wrong-badge').textContent = ids.length;
    ids.sort(function (a, b) { return state.progress.wrong[b].n - state.progress.wrong[a].n; });

    var box = $('wrong-list');
    if (!ids.length) {
      box.innerHTML = '<div class="empty">还没有错题，继续保持 ✒️</div>';
    } else {
      box.innerHTML = ids.map(function (k) {
        var w = WORDS[+k], r = state.progress.wrong[k];
        return '<div class="wrong-item">' +
          '<div class="wi-main">' +
          '<div class="wi-w">' + esc(w.w) + '</div>' +
          '<div class="wi-z">' + esc(w.z) + ' · Lesson ' + w.l + '</div>' +
          '</div>' +
          '<span class="wi-n' + (r.fixed ? ' is-fixed' : '') + '">' +
          (r.fixed ? '已订正' : '错 ' + r.n + ' 次') + '</span>' +
          '</div>';
      }).join('');
    }
    $('btn-retry-wrong').disabled = ids.length === 0;
  }

  /* ---------------- 虚拟键盘 ---------------- */
  var ROWS = [
    ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
    ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
    [{ t: 'shift', cls: 'fn', html: '<svg viewBox="0 0 24 24"><path d="M12 4l7 8h-4v7h-6v-7H5l7-8z"/></svg>' },
      'z', 'x', 'c', 'v', 'b', 'n', 'm',
      { t: 'back', cls: 'fn', html: '<svg viewBox="0 0 24 24"><path d="M20 6H9l-6 6 6 6h11a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1z"/><path d="M16 10l-4 4M12 10l4 4"/></svg>' }],
    [{ t: 'space', cls: 'wide', label: '空格' },
      { t: 'char', v: "'" }, { t: 'char', v: '-' }, { t: 'char', v: '.' }]
  ];

  function buildKeyboard() {
    var kbd = $('kbd');
    kbd.innerHTML = '';
    ROWS.forEach(function (row, ri) {
      var div = document.createElement('div');
      div.className = 'kbd-row' + (ri === 1 ? ' r2' : '');
      row.forEach(function (k) {
        var b = document.createElement('button');
        b.type = 'button';
        if (typeof k === 'string') {
          b.className = 'key';
          b.dataset.char = k;
          b.textContent = k;
        } else {
          b.className = 'key ' + (k.cls || '');
          b.dataset.act = k.t;
          if (k.v) b.dataset.char = k.v;
          if (k.html) b.innerHTML = k.html;
          else b.textContent = k.label || k.v || '';
        }
        div.appendChild(b);
      });
      kbd.appendChild(div);
    });
  }

  function shiftOn() { return caps || shift; }
  function paintKeyboard() {
    var on = shiftOn();
    Array.prototype.forEach.call($('kbd').querySelectorAll('.key[data-char]'), function (b) {
      var c = b.dataset.char;
      b.textContent = /^[a-z]$/.test(c) ? (on ? c.toUpperCase() : c) : c;
    });
    var sh = $('kbd').querySelector('.key[data-act="shift"]');
    if (sh) sh.classList.toggle('on', on);
  }

  /* ---------------- 听写流程 ---------------- */
  function startSession(indices) {
    rollDaily();
    if (!indices || !indices.length) { toast('这个范围没有可练的单词'); return; }
    var n = Math.min(state.settings.daily, indices.length);
    var queue = shuffle(indices.slice()).slice(0, n);
    session = {
      mode: 'free',
      total: queue.length,
      queue: queue,
      resolved: 0,
      right: 0,
      attempts: {},
      cur: null,
      input: '',
      revealed: false,
      ok: false
    };
    go('quiz');
    nextQuestion();
  }

  /* ---------------- 闯关流程 ---------------- */
  function startLevel(id) {
    var lv = LEVELS[id - 1];
    if (!lv) return;
    if (!levelUnlocked(id)) { toast('先通关第 ' + (id - 1) + ' 关'); return; }
    var pool = levelWords(lv);
    if (!pool.length) { toast('这一关没有词'); return; }

    rollDaily();
    var queue = shuffle(pool.slice()).slice(0, Math.min(LV_Q, pool.length));
    session = {
      mode: 'level',
      level: id,
      lv: lv,
      total: queue.length,
      queue: queue,
      resolved: 0,
      right: 0,
      wrongList: [],          // 本关答错的词，结算时列出来
      lives: LV_LIVES,
      combo: 0,
      maxCombo: 0,
      score: 0,
      attempts: {},
      cur: null,
      input: '',
      revealed: false,
      ok: false,
      deadline: 0,
      timerId: null,
      timedOut: false
    };
    go('quiz');
    nextQuestion();
  }

  /** 计分：基础 100，连击每多一层 +20，最多加到 +100 */
  function comboScore(combo) {
    return 100 + Math.min(combo - 1, 5) * 20;
  }

  function stopTimer() {
    if (session && session.timerId) { clearInterval(session.timerId); session.timerId = null; }
  }

  function paintTimer(left) {
    var l = (left == null) ? LV_TIME : Math.max(0, left);
    // 与进度条同理：走 transform 而不是 width
    $('timer-fill').style.transform = 'scaleX(' + (l / LV_TIME) + ')';
    $('timer').classList.toggle('is-urgent', l <= LV_URGENT);
  }

  function startTimer() {
    stopTimer();
    if (session.mode !== 'level') return;
    session.deadline = Date.now() + LV_TIME;
    session.timedOut = false;
    paintTimer(LV_TIME);
    session.timerId = setInterval(function () {
      if (!session || session.revealed) return;
      var left = session.deadline - Date.now();
      if (left <= 0) { stopTimer(); paintTimer(0); submitTimeout(); return; }
      paintTimer(left);
    }, 200);
  }

  /** 生命值渲染：实心 / 空心 */
  function paintHud() {
    var level = session && session.mode === 'level';
    $('hud').hidden = !level;
    $('timer').hidden = !level;
    $('btn-skip').hidden = !!level;      // 闯关模式不给跳过
    if (!level) return;

    var h = '';
    for (var i = 1; i <= LV_LIVES; i++) h += '<i class="' + (i <= session.lives ? 'on' : '') + '"></i>';
    $('hud-lives').innerHTML = h;

    var cb = $('hud-combo');
    if (session.combo >= 2) {
      cb.hidden = false;
      cb.textContent = '⚡ 连击 ×' + session.combo;
      cb.classList.toggle('is-hot', session.combo >= 5);
    } else {
      cb.hidden = true;
    }
    $('hud-score').textContent = session.score;
  }

  function nextQuestion() {
    if (!session.queue.length) return session.mode === 'level' ? finishLevel() : finishSession();
    session.cur = session.queue[0];
    session.input = '';
    session.revealed = false;
    session.ok = false;
    shift = false; caps = false;
    paintKeyboard();
    renderQuestion();
  }

  function renderQuestion() {
    var w = WORDS[session.cur];
    $('prompt-lesson').textContent = 'Lesson ' + w.l;
    $('prompt-zh').textContent = w.z;
    $('prompt-pos').textContent = state.settings.hints ? (w.p || '') : '';
    $('feedback').hidden = true;
    $('feedback').className = 'feedback';
    $('btn-submit').hidden = false;
    $('btn-next').hidden = true;
    $('answer').classList.remove('is-ok', 'is-err');
    $('quiz-count').textContent = (session.resolved + 1) + ' / ' + session.total;
    paintBar();
    paintHud();
    renderAnswer();
    startTimer();
  }

  /** 进度条：走 transform 而不是 width，避免每帧重新布局 */
  function paintBar() {
    $('quiz-bar-fill').style.transform = 'scaleX(' + (session.resolved / session.total) + ')';
  }

  function renderAnswer() {
    var t = session.input;
    var el = $('answer-text');
    el.style.fontSize = t.length > 16 ? '22px' : (t.length > 10 ? '26px' : '');
    // 光标由 CSS 的 ::after 提供，这里只维护文本节点：
    // 不再每次按键都 insertAdjacentHTML 重建光标，闪烁动画也就不会被打回起点
    if (!t) el.innerHTML = '<span class="ph">输入英文单词…</span>';
    else el.textContent = t;
    var box = $('answer');
    box.classList.toggle('is-empty', !t);
    box.classList.toggle('is-revealed', !!session.revealed);
  }

  function push(ch) {
    if (session.revealed || session.input.length >= MAXLEN) return;
    lastShift = 0;                     // 敲了别的键，双击 shift 的计时就作废
    session.input += ch;
    renderAnswer();
  }
  function backspace() {
    if (session.revealed || !session.input) return;
    lastShift = 0;
    session.input = session.input.slice(0, -1);
    renderAnswer();
  }

  // 注意：submit 会作为 click 的事件处理器绑定，事件对象会被当成第一个实参传进来。
  // 所以这里不能直接收 timedOut 参数，必须用零参包装，否则 event 对象是 truthy，
  // 会被误判成「超时提交」。
  function submit() { doSubmit(false); }
  function submitTimeout() { doSubmit(true); }

  /** @param {boolean} timedOut 由倒计时触发的提交，强制判错 */
  function doSubmit(timedOut) {
    if (session.revealed) return nextStep();
    if (!timedOut && !norm(session.input)) { toast('先输入答案再提交'); return; }

    stopTimer();

    var idx = session.cur, w = WORDS[idx];
    var ok = !timedOut && norm(session.input) === norm(w.w);
    session.revealed = true;
    session.ok = ok;
    session.timedOut = !!timedOut;
    session.attempts[idx] = (session.attempts[idx] || 0) + 1;

    var isLevel = session.mode === 'level';

    var fb = $('feedback');
    fb.hidden = false;
    fb.className = 'feedback ' + (ok ? 'is-ok' : 'is-err');
    $('fb-mark').textContent = ok ? '✓' : '✕';
    $('fb-title').textContent = ok ? '正确' : (timedOut ? '时间到' : '拼写不对');
    $('fb-detail').innerHTML =
      '<span class="en">' + esc(w.w) + '</span>' +
      (w.ph ? ' <span class="ipa">/' + esc(w.ph) + '/</span>' : '') +
      '<br>' + esc(w.z) +
      (ok ? '' : '<br><span style="color:var(--muted);font-size:13px">你写的是：' +
        esc(session.input || (timedOut ? '（超时未作答）' : '（空）')) + '</span>') +
      (isLevel && ok ? '<br><span class="fb-gain">+' + comboScore(session.combo + 1) + ' 分' +
        (session.combo + 1 >= 2 ? ' · 连击 ×' + (session.combo + 1) : '') + '</span>' : '');
    $('answer').classList.toggle('is-ok', ok);
    $('answer').classList.toggle('is-err', !ok);
    renderAnswer();

    $('btn-submit').hidden = true;
    $('btn-next').hidden = false;

    if (ok) {
      sfxOk();
      state.progress.mastered[idx] = Date.now();
      // 答对：从词库移出；若曾答错，错题本保留记录并标记为已订正
      var old = state.progress.wrong[idx];
      if (old) { old.fixed = true; old.t = Date.now(); }
      state.daily.done++; state.daily.correct++;
      saveProgress(); saveDaily();
      session.queue.shift();
      session.resolved++; session.right++;

      if (isLevel) {
        session.combo++;
        session.maxCombo = Math.max(session.maxCombo, session.combo);
        session.score += comboScore(session.combo);
        // 连击越高，音调越高，给一点即时正反馈
        if (session.combo >= 3) tone([880 + Math.min(session.combo, 8) * 60], 0.12, 'sine', 0.13);
      }
    } else {
      sfxNo();
      var rec = state.progress.wrong[idx] || { n: 0 };
      rec.n++; rec.t = Date.now(); rec.fixed = false;
      state.progress.wrong[idx] = rec;
      saveProgress();

      if (isLevel) {
        // 闯关：每题只出一次，不回炉；答错扣一颗心并清空连击
        session.combo = 0;
        session.lives--;
        session.wrongList.push(idx);
        session.queue.shift();
        session.resolved++;
      } else {
        // 自由听写：放回词库，稍后在随机位置重新出题
        session.queue.shift();
        if (session.attempts[idx] < MAX_ATTEMPT) {
          var pos = session.queue.length ? 1 + Math.floor(Math.random() * session.queue.length) : 0;
          session.queue.splice(pos, 0, idx);
        } else {
          session.resolved++;
        }
      }
    }
    paintBar();
    paintHud();

    var dead = isLevel && session.lives <= 0;
    var empty = !session.queue.length;
    $('btn-next').textContent = (dead || empty) ? (isLevel ? '查看结果' : '完成') : '下一个';

    if (state.settings.auto && !dead) {
      setTimeout(function () {
        if (session && session.revealed) nextStep();
      }, ok ? 800 : 1700);
    }
  }

  function nextStep() {
    if (!session) return;
    stopTimer();
    if (session.mode === 'level' && session.lives <= 0) return finishLevel();
    if (session.queue.length) {
      nextQuestion();
    } else {
      session.mode === 'level' ? finishLevel() : finishSession();
    }
  }

  function skip() {
    if (!session) return;
    if (session.mode === 'level') return;      // 闯关模式不给跳过
    if (session.revealed) return nextStep();
    session.queue.shift();
    session.resolved++;
    toast('已跳过');
    nextStep();
  }

  function finishSession() {
    var right = session.right, total = session.total;
    session = null;
    go('home');
    toast('本轮完成：' + right + ' / ' + total + ' 词');
  }

  /* ---------------- 关卡结算 ---------------- */
  function finishLevel() {
    stopTimer();
    var s = session;
    session = null;
    if (!s) return;

    var total = s.total;
    // 星级：全对 3 星，错 1 个 2 星，错 2 个 1 星；生命耗尽或错更多则 0 星（失败）
    var stars = 0;
    if (s.lives > 0) {
      if (s.right >= total) stars = 3;
      else if (s.right >= total - 1) stars = 2;
      else if (s.right >= total - 2) stars = 1;
    }

    var rec = state.levels[s.level] || { stars: 0, score: 0, plays: 0 };
    var improved = stars > rec.stars;
    rec.plays = (rec.plays || 0) + 1;
    rec.stars = Math.max(rec.stars || 0, stars);
    rec.score = Math.max(rec.score || 0, s.score);
    state.levels[s.level] = rec;
    saveLevels();

    paintHud();
    showResult(s, stars, improved);
  }

  function showResult(s, stars, improved) {
    var total = s.total;
    var passed = stars >= 1;
    var nextLv = LEVELS[s.level];                 // 下一关（id = level + 1）

    $('res-stars').innerHTML = (function () {
      var out = '';
      for (var i = 1; i <= 3; i++) {
        out += '<i class="' + (i <= stars ? 'on' : '') + '" style="animation-delay:' + (i * 90) + 'ms"></i>';
      }
      return out;
    })();
    $('res-title').textContent = passed
      ? (stars === 3 ? '完美通关！' : '通关！')
      : (s.lives <= 0 ? '生命耗尽' : '差一点点');
    $('res-sub').textContent = passed
      ? (improved ? '新纪录 · ' + (nextLv ? '已解锁第 ' + (s.level + 1) + ' 关' : '全部关卡通关') : '成绩已记录')
      : '拿到 1 星才能解锁下一关，再试一次吧';
    $('res-right').textContent = s.right + ' / ' + total;
    $('res-score').textContent = s.score;
    $('res-combo').textContent = '×' + s.maxCombo;

    var box = $('res-wrong-box');
    if (s.wrongList.length) {
      box.innerHTML = '<div class="res-wrong"><div class="res-wrong-h">本关错题</div>' +
        s.wrongList.map(function (i) {
          var w = WORDS[i];
          return '<div class="res-wrong-i"><b>' + esc(w.w) + '</b><span>' + esc(w.z) + '</span></div>';
        }).join('') + '</div>';
    } else {
      box.innerHTML = '';
    }

    var canNext = passed && s.level < LV_TOTAL;
    $('btn-res-next').hidden = !canNext;
    $('btn-res-next').textContent = canNext ? '挑战第 ' + (s.level + 1) + ' 关' : '';
    $('btn-res-retry').textContent = passed ? '再刷一次' : '重新挑战';

    if (passed) tone([659, 880, 1175], 0.2, 'sine', 0.15);
    else tone([196, 147], 0.3, 'triangle', 0.15);

    $('result-mask').hidden = false;
    $('result-mask').dataset.level = s.level;
    $('result-mask').dataset.passed = passed ? '1' : '0';
  }

  /* ---------------- 安装引导 ---------------- */
  var deferredPrompt = null;
  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: fullscreen)').matches ||
      window.navigator.standalone === true;
  }
  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function openInstall() {
    var body = $('install-body');
    if (isIOS()) {
      body.innerHTML =
        '<div class="step-list">' +
        '<div class="step-item"><span class="step-no">1</span><p>用 <b>Safari</b> 打开本页，点底部中间的 <b>分享</b> 按钮 <b>⤴</b>。</p></div>' +
        '<div class="step-item"><span class="step-no">2</span><p>在菜单里向下滑，选择 <b>「添加到主屏幕」</b>。</p></div>' +
        '<div class="step-item"><span class="step-no">3</span><p>右上角点 <b>「添加」</b>，桌面就会出现独立图标。</p></div>' +
        '</div>';
      $('btn-install-go').hidden = true;
    } else if (deferredPrompt) {
      body.innerHTML = '<div class="step-list"><div class="step-item"><span class="step-no">1</span><p>点下方按钮，浏览器会弹出安装确认。</p></div>' +
        '<div class="step-item"><span class="step-no">2</span><p>确认后桌面出现独立图标，打开即全屏，无地址栏。</p></div></div>';
      $('btn-install-go').hidden = false;
    } else {
      body.innerHTML = '<div class="step-list">' +
        '<div class="step-item"><span class="step-no">1</span><p>点浏览器右上角 <b>⋮</b> 菜单。</p></div>' +
        '<div class="step-item"><span class="step-no">2</span><p>选择 <b>「安装应用」</b> 或 <b>「添加到主屏幕」</b>。</p></div>' +
        '<div class="step-item"><span class="step-no">3</span><p>确认后即可从桌面独立全屏打开。</p></div>' +
        '</div>';
      $('btn-install-go').hidden = true;
    }
    $('install-mask').hidden = false;
  }

  /* ---------------- Toast ---------------- */
  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    t.style.animation = 'none';
    void t.offsetWidth;
    t.style.animation = '';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 1900);
  }

  /* ---------------- 事件绑定 ---------------- */
  function bind() {
    // 范围滑块
    ['start', 'end'].forEach(function (k) {
      $('rng-' + k).addEventListener('input', function () {
        state.settings[k] = +this.value;
        if (state.settings.start > state.settings.end) {
          if (k === 'start') state.settings.end = state.settings.start;
          else state.settings.start = state.settings.end;
        }
        saveSettings(); renderHome();
      });
    });
    $('rng-daily').addEventListener('input', function () {
      state.settings.daily = +this.value; saveSettings(); renderHome();
    });

    // 步进按钮
    document.addEventListener('click', function (e) {
      var b = e.target.closest('[data-step]');
      if (!b) return;
      var p = b.dataset.step.split(':'), k = p[0], d = +p[1];
      var lim = { start: [1, 144], end: [1, 144], daily: [1, 60] }[k];
      if (k === 'daily') state.settings.daily = Math.min(lim[1], Math.max(lim[0], state.settings.daily + d));
      else {
        var v = Math.min(lim[1], Math.max(lim[0], state.settings[k] + d));
        if (k === 'start') { state.settings.start = v; if (v > state.settings.end) state.settings.end = v; }
        else { state.settings.end = v; if (v < state.settings.start) state.settings.start = v; }
      }
      saveSettings(); renderHome();
    });

    // 预设
    $('presets').addEventListener('click', function (e) {
      var c = e.target.closest('.chip'); if (!c) return;
      state.settings.start = +c.dataset.a;
      state.settings.end = +c.dataset.b;
      saveSettings(); renderHome();
    });
    // 每日词数分段
    $('seg-daily').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      state.settings.daily = +b.dataset.n; saveSettings(); renderHome();
    });

    // 虚拟键盘
    $('kbd').addEventListener('click', function (e) {
      var k = e.target.closest('.key'); if (!k || !session || session.revealed) return;
      var act = k.dataset.act, ch = k.dataset.char;
      if (act === 'shift') {
        var now = Date.now();
        if (now - lastShift < 380) { caps = !caps; shift = false; }
        else { shift = !shift; }
        lastShift = now;
        paintKeyboard();
        return;
      }
      if (act === 'back') { backspace(); return; }
      if (act === 'space') { push(' '); return; }
      if (act === 'char') { push(ch); return; }
      if (ch) push(shiftOn() ? ch.toUpperCase() : ch);
      if (shift && !caps) { shift = false; paintKeyboard(); }
    });

    // 物理键盘
    document.addEventListener('keydown', function (e) {
      if (currentView !== 'quiz' || !session) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Backspace') { e.preventDefault(); backspace(); return; }
      if (e.key === 'Enter') { e.preventDefault(); session.revealed ? nextStep() : submit(); return; }
      if (e.key === 'Escape') { e.preventDefault(); quitQuiz(); return; }
      if (e.key === ' ') { e.preventDefault(); push(' '); return; }
      if (e.key.length === 1 && /[a-zA-Z0-9'\-.]/.test(e.key)) { e.preventDefault(); push(e.key); return; }
    });

    // 听写页按钮
    $('btn-submit').addEventListener('click', submit);
    $('btn-next').addEventListener('click', nextStep);
    $('btn-skip').addEventListener('click', skip);
    $('btn-quit').addEventListener('click', quitQuiz);

    // 首页 / 统计页
    $('btn-start').addEventListener('click', function () { startSession(poolIdx()); });
    $('btn-stats').addEventListener('click', function () { go('stats'); });
    $('btn-back-home').addEventListener('click', function () { go('home'); });

    // 闯关
    $('btn-levels').addEventListener('click', function () { go('levels'); });
    $('btn-levels-back').addEventListener('click', function () { go('home'); });
    $('lv-grid').addEventListener('click', function (e) {
      var c = e.target.closest('[data-lv]');
      if (!c || c.disabled) return;
      startLevel(+c.dataset.lv);
    });
    $('btn-res-retry').addEventListener('click', function () {
      var id = +$('result-mask').dataset.level;
      $('result-mask').hidden = true;
      startLevel(id);
    });
    $('btn-res-next').addEventListener('click', function () {
      var id = +$('result-mask').dataset.level + 1;
      $('result-mask').hidden = true;
      startLevel(id);
    });
    $('btn-res-back').addEventListener('click', function () {
      $('result-mask').hidden = true;
      go('levels');
    });
    $('btn-retry-wrong').addEventListener('click', function () {
      var ids = Object.keys(state.progress.wrong).filter(function (k) { return WORDS[+k]; }).map(Number);
      if (!ids.length) return;
      var keep = state.settings.daily;
      state.settings.daily = Math.max(keep, ids.length);
      startSession(ids);
      state.settings.daily = keep;
    });
    $('btn-reset').addEventListener('click', function () {
      var b = this;
      if (b.dataset.armed) {
        state.progress = { mastered: {}, wrong: {} };
        state.daily = { date: today(), done: 0, correct: 0 };
        state.levels = {};
        saveProgress(); saveDaily(); saveLevels();
        delete b.dataset.armed;
        b.textContent = '重置全部进度';
        renderStats(); toast('进度已清空');
      } else {
        b.dataset.armed = '1';
        b.textContent = '再点一次确认重置';
        setTimeout(function () { if (b.dataset.armed) { delete b.dataset.armed; b.textContent = '重置全部进度'; } }, 3000);
      }
    });

    // 设置
    $('btn-settings').addEventListener('click', function () {
      $('opt-hints').checked = state.settings.hints;
      $('opt-auto').checked = state.settings.auto;
      $('opt-sound').checked = state.settings.sound;
      $('settings-mask').hidden = false;
    });
    $('btn-settings-close').addEventListener('click', function () {
      $('settings-mask').hidden = true;
      if (currentView === 'home') renderHome();
      if (currentView === 'levels') renderLevels();
    });
    ['hints', 'auto', 'sound'].forEach(function (k) {
      $('opt-' + k).addEventListener('change', function () {
        state.settings[k] = this.checked; saveSettings();
      });
    });

    // 安装引导
    $('btn-install-close').addEventListener('click', function () {
      $('install-mask').hidden = true;
      save(K.install, true);
    });
    $('btn-install-go').addEventListener('click', function () {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function () { deferredPrompt = null; });
      $('install-mask').hidden = true;
    });
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferredPrompt = e;
      if (!isStandalone() && !load(K.autoPop, false)) {
        setTimeout(function () { openInstall(); save(K.autoPop, true); }, 1600);
      }
    });
    // 遮罩点击关闭
    ['install', 'settings'].forEach(function (n) {
      $(n + '-mask').addEventListener('click', function (e) {
        if (e.target === this) this.hidden = true;
      });
    });

    // 顶栏下边线：元素缓存下来，且只在状态真的翻转时才碰 DOM
    // （原来每次 scroll 都 querySelector 一次 + 无条件 toggle，滚动时白做功）
    var topbar = document.querySelector('.topbar');
    var stuck = false;
    window.addEventListener('scroll', function () {
      var s = window.scrollY > 4;
      if (s !== stuck) { stuck = s; topbar.classList.toggle('is-stuck', s); }
    }, { passive: true });

    // 返回键 / 手势返回
    window.addEventListener('popstate', function () {
      // 结算弹层开着时，返回键先关弹层（成绩已落盘，关掉不丢）
      if (!$('result-mask').hidden) { $('result-mask').hidden = true; return; }
      if (currentView !== 'home') { pushed = 0; go('home', true); }
    });
  }

  function quitQuiz() {
    var wasLevel = !!(session && session.mode === 'level');
    if (session && session.resolved > 0 && !session.revealed) {
      var msg = wasLevel ? '结束本关挑战？本关成绩不会保存。' : '结束本轮听写？已答对的单词会保留进度。';
      if (!confirm(msg)) return;
    }
    stopTimer();
    session = null;
    go(wasLevel ? 'levels' : 'home');
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    buildKeyboard();
    bind();
    fetch('data/words.json', { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        WORDS = data;
        rollDaily();
        go('home');
        $('app').hidden = false;
        setTimeout(function () {
          var sp = $('splash');
          sp.classList.add('is-gone');
          // 淡出结束后彻底摘掉：否则那条无限循环的加载动画会一直跑下去
          setTimeout(function () { sp.hidden = true; }, 600);
        }, 520);
        // 桌面快捷方式：?action=quiz / ?action=stats / ?action=levels
        var act = new URLSearchParams(location.search).get('action');
        if (act === 'stats') go('stats');
        if (act === 'levels') go('levels');
        if (act === 'quiz') {
          var p = poolIdx();
          if (p.length) startSession(p); else toast('这个范围没有可练的单词');
        }
        // 首次打开且未安装 → 自动弹出安装引导（每次会话最多一次）
        if (!act) setTimeout(function () {
          if (isStandalone() || load(K.install, false)) return;
          try {
            if (sessionStorage.getItem('nce1.installed.tip')) return;
            sessionStorage.setItem('nce1.installed.tip', '1');
          } catch (e) { /* 忽略 */ }
          openInstall();
        }, 1500);
      })
      .catch(function (err) {
        $('splash').innerHTML = '<div style="padding:24px;text-align:center;line-height:1.8">' +
          '<div style="font-size:15px">词库加载失败</div>' +
          '<div style="font-size:13px;opacity:.85;margin-top:6px">' + esc(err.message) + '</div>' +
          '<div style="font-size:12.5px;opacity:.75;margin-top:10px">请确认通过 http(s) 访问，而不是直接双击打开文件。</div></div>';
      });
  }

  // Service Worker：离线可用
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* 忽略 */ });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
