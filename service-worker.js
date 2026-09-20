// 由 build_bonjourr.js 生成。
// Bonjourr 的 main.js 会 navigator.serviceWorker.register("service-worker.js")（相对文档 -> 本文件）。
// 策略：网络优先，断网才回落缓存 —— 这样线上更新能立刻生效，断网时仍有页面可看。
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
        fetch(req).then(function (res) {
            if (res && res.status === 200 && res.type === 'basic') {
                var clone = res.clone();
                caches.open(CACHE).then(function (c) { c.put(req, clone); });
            }
            return res;
        }).catch(function () {
            // 断网兜底：先按原样找缓存（忽略查询串，因为我们的资源都带 ?v=N），
            // 再退到首页；都没有就明确回 504，别把 undefined 交给 respondWith。
            return caches.match(req, { ignoreSearch: true }).then(function (hit) {
                if (hit) return hit;
                if (req.mode === 'navigate') return caches.match('./index.html', { ignoreSearch: true });
                return new Response('', { status: 504, statusText: 'wei8 offline: not cached' });
            }).then(function (r) {
                return r || new Response('', { status: 504, statusText: 'wei8 offline: not cached' });
            });
        })
    );
});
