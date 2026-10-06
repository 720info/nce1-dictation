# 新概念一册 · 单词听写 PWA

《新概念英语》第一册单词听写练习。纯前端、零依赖、可离线，安装到手机主屏幕后全屏独立运行，外观与原生 App 一致。

## 🔗 线上地址

**https://720info.github.io/nce1-dictation/**

用手机浏览器打开这个链接即可直接使用，或按下文「装到手机桌面」一节添加到主屏幕。

---

## 一、怎么跑起来

### 装到手机桌面

线上地址是 HTTPS 的，所以 PWA 的安装与离线能力**开箱可用**：

| 平台 | 操作 |
|---|---|
| **iOS / Safari** | 分享按钮 ⤴ → 「添加到主屏幕」→ 添加 |
| **Android / Chrome** | 右上角 ⋮ → 「安装应用」（页面内也会自动弹引导，点一下即可） |

装好后桌面出现独立图标，打开是全屏、无地址栏，断网也能继续听写。

### 本地预览（电脑）

双击 **`启动预览.command`**（首次运行若提示无权限，在终端执行一次 `chmod +x 启动预览.command`）。
脚本会自动选端口、打开浏览器，并打印手机可访问的局域网地址。

或者手动起一个静态服务：

```bash
cd nce1-dictation-pwa
python3 -m http.server 8080
```

> ⚠️ **不能直接双击 `index.html` 打开**（`file://` 协议下浏览器禁止读取词库、注册 Service Worker）。
> 必须通过 `http://` 或 `https://` 访问。
>
> 也注意：通过局域网 IP（`http://192.168.x.x`）访问时，手机浏览器**不会**启用 Service Worker，
> 也无法「添加到主屏幕」—— 那种情况下用上面的线上地址。

### 自己重新部署

把整个文件夹原样传到任意静态托管即可，无需构建：

```bash
git init -b main && git add -A && git commit -m "init"
gh repo create <你的仓库名> --public --source=. --remote=origin --push
gh api -X POST repos/<你>/<仓库名>/pages -f "source[branch]=main" -f "source[path]=/"
```

---

## 二、功能对照

| 需求 | 实现 |
|---|---|
| 课程范围选择 | 起始课 / 结束课 双向滑块 + 步进按钮，范围 1–144 课；另附 7 个常用区间快捷芯片 |
| 听写交互 | 出题显示中文释义（含词性提示），输入英文单词，提交即判对错 |
| 防联想输入 | **页面内不存在任何可编辑元素**（无 `input` / `textarea` / `contenteditable`），系统输入法在原理上无法唤起，也就不存在联想、自动补全、候选词 |
| 手机虚拟键盘 | 页面内置 QWERTY 键盘：26 字母 + 空格 / 撇号 / 连字符 / 句点 + 退格 + 上档键（连点两下锁定大写） |
| 电脑物理键盘 | 桌面端自动隐藏虚拟键盘，直接敲字即可；`Enter` 提交 / 下一题，`Backspace` 删除，`Esc` 退出 |
| 每日词数 | 5 / 10 / 15 / 20 / 30 一键切换，或滑块自定义 1–60 |
| 记忆复习算法 | 答对 → 移出词库，不再出题；答错 → 放回词库，并在本轮随机位置重新出题（同一词每轮最多 3 次） |
| 首页 | 课程范围、每日词数、范围内可练/已掌握/今日完成、开始听写 |
| 听写页 | 中文释义、虚拟键盘、提交、对错反馈（含正确拼写、音标、释义） |
| 统计页 | 今日完成数、今日正确率、累计已掌握、错题记录（含课号与错误次数，「已订正」状态） |
| 额外 | 「只练错题」、进度本地持久化、音效开关、安装引导 |

**判分宽容度**：忽略大小写、空格、连字符、撇号和句点。所以 `bus stop`、`busstop`、`Mr.`、`mr` 都算对——考的是拼写字母，不是标点。

---

## 三、PWA 打包清单

### 1. Web App Manifest（`manifest.webmanifest`）

```json
{
  "name": "新概念一册 · 单词听写",
  "short_name": "单词听写",
  "display": "standalone",          // 独立窗口，无地址栏
  "display_override": ["standalone", "fullscreen", "minimal-ui"],
  "start_url": "./index.html",
  "scope": "./",
  "theme_color": "#4c6ef5",
  "background_color": "#4c6ef5",    // 安卓启动页底色
  "orientation": "portrait",
  "icons": [ 192 any, 512 any, 512 maskable ],
  "shortcuts": [ 开始听写, 查看错题 ]
}
```

图标由脚本生成，非占位图：`icons/icon-192.png`、`icon-512.png`、`icon-maskable-512.png`（已按 maskable 安全区缩放）。

### 2. Service Worker（`sw.js`）

- 安装时预缓存应用外壳 + 词库 + 全部图标
- 导航请求走「网络优先，断网回退缓存首页」
- 静态资源走「缓存优先，后台顺带更新」
- 版本号变更时自动清理旧缓存

### 3. 苹果 iOS 适配

```html
<meta name="apple-mobile-web-app-capable" content="yes">        <!-- 全屏独立模式 -->
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">  <!-- 状态栏 -->
<meta name="apple-mobile-web-app-title" content="单词听写">      <!-- 桌面名称 -->
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png"> <!-- 180px 桌面图标 -->
```

启动页：安卓由 manifest 的 `background_color` + 图标自动生成；iOS 由页面内的品牌色启动遮罩承担，避免白屏。

### 4. 安装引导

打开网页后自动弹出一次（每次会话最多一次，可「以后再说」永久关闭）：

- **iOS** → 三步图示说明：分享 ⤴ → 添加到主屏幕 → 添加
- **Android（支持 `beforeinstallprompt`）** → 直接给「立即安装」按钮，调用原生安装弹窗
- **其它浏览器** → 引导到右上角 ⋮ 菜单里的「安装应用 / 添加到主屏幕」

---

## 四、文件结构

```
nce1-dictation-pwa/
├── index.html              单页应用（首页 / 听写页 / 统计页 + 两个抽屉浮层）
├── styles.css              全部样式，浅色主题，含 iOS 安全区适配
├── app.js                  全部逻辑：抽词、判分、记忆算法、进度持久化、安装引导
├── sw.js                   Service Worker，离线缓存
├── manifest.webmanifest    PWA 清单
├── data/words.json         词库 648 条（46 KB）
├── icons/                  192 / 512 / maskable-512 / apple-touch-icon / favicon
├── 启动预览.command         本地预览启动器
└── README.md
```

---

## 五、词库说明

- **648 个单词 / 短语**，覆盖 **Lesson 1–143 的全部 72 个课次**，每课 2–14 词，平均 9 词
- 每条包含：英文、中文释义、词性、音标、所属课号
- 数据来源：开源仓库 `LiDuoMiao/new-concept-english` 的 NCE1 逐课笔记（按课次成对组织，含释义与音标），并做了去重、释义分隔符归一化
- 课号按教材惯例挂在**奇数课**（新词出现在奇数课的 New Words and Expressions 中），偶数课为句型练习

> 说明：另有开源词表收录约 850–900 词，但缺少课号，且其自动生成的释义错误率较高（如 `good → 好处`、`Mrs. → 先生`、`I → 碘元素`），会造出无法作答的题。为保证「按课范围抽词」的准确性和题目可用性，最终采用课号精确、释义可靠的那一份。

---

## 六、已验证项

用 headless Chromium 按 iPhone 视口 + 桌面视口跑过完整交互测试，43 项断言全通过、零控制台报错，包括：
- 页面内可编辑元素数为 **0**（系统输入法无法唤起）
- 虚拟键盘 26 字母 + 标点键齐全、大小写切换正确
- 物理键盘输入 / `Enter` 提交 / 下一题
- 答错 → 该词在后续随机位置重新出题（实测序列：`游客；旅行者` 答错 → 中间 4 题 → 第 6 题重新出现）
- 答对 → 移出词库，今日完成数与正确率同步
- 错题记录含课号、错误次数与「已订正」状态
- 刷新后进度保留
- Service Worker 激活、预缓存建立、**断网重载后仍可正常听写**
- 桌面端自动隐藏虚拟键盘、限宽 520px 居中

线上部署后**又对 `https://720info.github.io/nce1-dictation/` 实跑了一遍**，9 项全通过、零控制台报错：

- 首页渲染、词库从线上加载（648 词）
- HTTPS 下自动弹出安装引导
- `manifest.webmanifest` 以 `application/manifest+json` 返回，`display: standalone`、3 个图标、主题色正确
- 进入听写页、判分生效
- **Service Worker 在 HTTPS 下成功激活**，预缓存 `nce1-dictation-1.0.0` 建立
- **断网重载后仍可正常听写**
