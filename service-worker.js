// 由 build_bonjourr.js 生成。
// Bonjourr 的 main.js 会 navigator.serviceWorker.register("service-worker.js")（相对文档 -> 本文件）。
// 策略：网络优先，断网才回落缓存。父作用域 /wei8/sw.js 对静态资源是缓存优先，会卡住旧产物，故此处覆盖。
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
            return caches.match(req);
        })
    );
});
