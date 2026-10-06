#!/bin/bash
# ============================================================
#  新概念一册 · 单词听写 PWA  —— 本地预览启动器
#  双击运行即可。关闭这个终端窗口就会停止服务。
# ============================================================
cd "$(dirname "$0")" || exit 1

PORT=8080
while lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; do
  PORT=$((PORT + 1))
done

IP=$(ipconfig getifaddr en0 2>/dev/null)
[ -z "$IP" ] && IP=$(ipconfig getifaddr en1 2>/dev/null)

echo ""
echo "  ✒  新概念一册 · 单词听写"
echo "  ────────────────────────────────────────────"
echo "  电脑上打开：  http://localhost:$PORT"
if [ -n "$IP" ]; then
  echo "  手机上打开：  http://$IP:$PORT   （需和电脑同一 Wi-Fi）"
fi
echo ""
echo "  ⚠  注意：通过局域网 IP 访问时，手机浏览器不会启用"
echo "     Service Worker（离线能力）与「添加到主屏幕」。"
echo "     要真正装到手机桌面，请把整个文件夹部署到 https 站点。"
echo ""
echo "  按 Ctrl+C 停止服务。"
echo ""

open "http://localhost:$PORT" 2>/dev/null

exec /usr/bin/env python3 -m http.server "$PORT" --bind 0.0.0.0
