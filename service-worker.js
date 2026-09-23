// 由 build_bonjourr.js 生成。
// Bonjourr 的 main.js 会 navigator.serviceWorker.register("service-worker.js")（相对文档 -> 本文件）。
// 策略（v2，缓存优先 = 秒开）：同源 GET 有缓存就**立刻回缓存**（不等网络，弱网/断网都秒开），
// 同时后台拉网络刷新缓存（stale-while-revalidate）。无缓存才走网络，失败再兜底。
// 代价：每次部署后首个打开可能是旧壳（后台已刷好，下次打开就是新的），最多落后一版。
// 作用域是 /wei8/，与任何父级作用域的 SW 互不干涉（同作用域只能有一个 SW）。
var CACHE = 'wei8-bonjourr-v5';
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
        // ① 精确匹配（含查询串）：产物资源都带 ?v=N，换版后请求新的 ?v 必定 miss -> 一定走网络拿新文件。
        //    ★★ 这里绝不能带 ignoreSearch。原因：caches.match 在 ignoreSearch 下会匹配到**更早写入**的
        //       同路径旧条目（?v=8）并「立刻返回」，新内容虽然也被抓进了缓存，却永远轮不到它 ->
        //       页面**永久卡在旧版**，不是「落后一版、下次就好」。
        //       2026-09-22 老板实机踩中：昨晚 deploy 把 sync-patch ?v=8->9、settings-lock ?v=3->4，
        //       正常窗口一直看到旧版（旧密码按钮/旧时间戳下拉），无痕窗口因没有 SW 缓存才看到新版。
        //       ignoreSearch 只留给 ③ 断网兜底用。
        caches.match(req).then(function (exact) {
            if (exact) {
                // 秒开主路径：命中就立刻回，同一条目后台刷新
                fetch(req).then(function (res) {
                    if (res && res.status === 200 && res.type === 'basic') {
                        var clone = res.clone();
                        caches.open(CACHE).then(function (c) { c.put(req, clone); });
                    }
                }).catch(function () {});
                return exact;
            }
            // ② 精确未命中（首次访问 / 换版后的新资源）：等网络
            return fetch(req).then(function (res) {
                if (res && res.status === 200 && res.type === 'basic') {
                    var clone = res.clone();
                    caches.open(CACHE).then(function (c) { c.put(req, clone); });
                }
                return res;
            }).catch(function () {
                // ③ 断网兜底：只有拿不到网络时才允许忽略查询串找旧版缓存 -> 导航回落首页 -> 明确 504
                return caches.match(req, { ignoreSearch: true }).then(function (fb) {
                    if (fb) return fb;
                    if (req.mode === 'navigate') return caches.match('./index.html', { ignoreSearch: true });
                    return null;
                });
            }).then(function (r) {
                return r || new Response('', { status: 504, statusText: 'wei8 offline: not cached' });
            });
        })
    );
});
