// 由 build_bonjourr.js 生成。
// Bonjourr 的 main.js 会 navigator.serviceWorker.register("service-worker.js")（相对文档 -> 本文件）。
// 策略（v3）：**导航请求网络优先**（换部署后第一次打开就是新版，不再卡旧壳）+ 其余同源 GET 缓存优先（秒开）。
//   导航 = 打开页面/刷新：先走网络拿新的，成功就顺手刷缓存；断网才回落缓存（旧壳也比打不开强）。
//   其余资源（js/css/图片…）都带 ?v=N，缓存优先；命中即回并后台刷新。
//   ★ 为什么导航要特殊：index.html 是唯一**不带版本号**的本机资源，靠「改 ?v= 破缓存」对它无效，
//   统一「缓存优先」会永远命中首次写入的旧壳（2026-10-04 老板实机踩中，一直看到已删掉的「法国制造」页脚）。
// 作用域是 /wei8/，与任何父级作用域的 SW 互不干涉（同作用域只能有一个 SW）。
var CACHE = 'wei8-bonjourr-v7';
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
        // ⓪ ★ v3.27 导航请求（打开页面/刷新）走**网络优先**。
        //   为什么：index.html 是**唯一不带版本号**的本机资源（所有 js/css 都带 ?v=N，靠改版本号破缓存），
        //   下面 ① 的「精确匹配 + 缓存优先」对无版本号的 URL 永远命中**首次写入**的那份 → 换部署后
        //   永远读到旧壳。2026-10-04 老板实机踩中：v3.22 明明已把「法国制造/支持Bonjourr/版本号行」
        //   从页脚删掉了，正常窗口却一直显示那三样（旧壳），无痕窗口（无 SW 缓存）才显示新的。
        //   代价：打开页面那一下要走网络（本地/CN 到 GitHub Pages 通常几十毫秒，感知不到）。
        //   收益：**换版后第一次打开就是新版**，不必强刷、不必手动清缓存。
        //   断网时仍回落到缓存（旧壳也比打不开强），所以「离线可用」不受影响。
        if (req.mode === 'navigate') {
            return fetch(req).then(function (res) {
                if (res && res.status === 200 && res.type === 'basic') {
                    var clone = res.clone();
                    caches.open(CACHE).then(function (c) { c.put(req, clone); });
                }
                return res;
            }).catch(function () {
                return caches.match(req, { ignoreSearch: true }).then(function (fb) {
                    return fb || caches.match('./index.html', { ignoreSearch: true })
                        || new Response('', { status: 504, statusText: 'wei8 offline: not cached' });
                });
            });
        }
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
