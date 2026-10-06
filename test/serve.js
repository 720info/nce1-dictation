#!/usr/bin/env node
/* 本地预览：起一个静态服务器并把地址打出来
   跑法：node test/serve.js   （或 npm run serve）
   默认 8080，被占用就自动往后找 */
'use strict';

const L = require('./lib');

(async () => {
  const want = Number(process.env.PORT || 8080);
  let r;
  for (let p = want; p < want + 40; p++) {
    try { r = await L.serve(L.ROOT, p); break; }
    catch (e) { if (e.code !== 'EADDRINUSE') throw e; }
  }
  if (!r) { console.error('找不到可用端口'); process.exit(1); }

  const os = require('os');
  const ips = [];
  const nets = os.networkInterfaces();
  Object.keys(nets).forEach(n => nets[n].forEach(a => {
    if (a.family === 'IPv4' && !a.internal) ips.push(a.address);
  }));

  console.log('\n  单词听写 · 本地预览\n');
  console.log('  本机:   http://127.0.0.1:' + r.port + '/');
  ips.forEach(ip => console.log('  局域网: http://' + ip + ':' + r.port + '/   （手机用这个）'));
  console.log('\n  Ctrl+C 停止\n');
})().catch(e => { console.error(e); process.exit(1); });
