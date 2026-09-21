// 由 build_bonjourr.js 生成。
// Bonjourr 的 main.js 会 navigator.serviceWorker.register("service-worker.js")（相对文档 -> 本文件）。
// 策略（v2，缓存优先 = 秒开）：同源 GET 有缓存就**立刻回缓存**（不等网络，弱网/断网都秒开），
// 同时后台拉网络刷新缓存（stale-while-revalidate）。无缓存才走网络，失败再兜底。
// 代价：每次部署后首个打开可能是旧壳（后台已刷好，下次打开就是新的），最多落后一版。
// 作用域是 /wei8/，与任何父级作用域的 SW 互不干涉（同作用域只能有一个 SW）。
var CACHE = 'wei8-bonjourr-v3';
var PREFIX = 'wei8-bonjourr-';

self.addEventListener('install', function () {
    self.skipWaiting();
});

self.addEventListener('activate', function (event) {
    event.waitUntil(
        caches.keys().then(function (keys) {
            return Promise.all(
                keys.filter(function (k) { return k.indexOf(PREFIX) === 0 && k !== CACHE; })
                    .map(function (k) { return caches.delete(k); })
            );
        }).then(function () { return self.clients.claim(); })
    );
});

self.addEventListener('fetch', function (event) {
    var req = event.request;
    if (req.method !== 'GET') return;
    if (new URL(req.url).origin !== self.location.origin) return;

    event.respondWith(
        caches.match(req, { ignoreSearch: true }).then(function (hit) {
            // 后台刷新缓存：不阻塞响应，拿到 200 就更新（旧壳自动滚到新版）
            var refresh = fetch(req).then(function (res) {
                if (res && res.status === 200 && res.type === 'basic') {
                    var clone = res.clone();
                    caches.open(CACHE).then(function (c) { c.put(req, clone); });
                }
                return res;
            }).catch(function () { return null; });

            if (hit) return hit; // ★ 秒开主路径：有缓存立刻返回

            // 无缓存（首次访问 / 新版本资源 ?v=N）：等网络，失败再兜底
            return refresh.then(function (res) {
                if (res) return res;
                if (req.mode === 'navigate') return caches.match('./index.html', { ignoreSearch: true });
                return new Response('', { status: 504, statusText: 'wei8 offline: not cached' });
            }).then(function (r) {
                return r || new Response('', { status: 504, statusText: 'wei8 offline: not cached' });
            });
        })
    );
});
