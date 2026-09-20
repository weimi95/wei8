/* sync-patch.js — Wei8 同步增强层（Github Gist）
 * ---------------------------------------------------------------------------
 * 上游 online 构建下 localSet() 会把 undefined 写成字符串 "undefined" 落进
 * localStorage，使 gistId 变成真值字符串 → sendGist() 的「首次新建 Gist」分支
 * 永远进不去 → 报 "Invalid Gist ID in settings."。详见下方 cleanDirty。
 *
 * 本层做五件事：
 *   A. 装载期 + 点「发送/得到」前，清掉这种「被写成字符串的 undefined/null/NaN」，
 *      让 gistId 真正回到 undefined，使上游的新建分支能正常命中。
 *   B. 在同步区块补中文提示（首次自动建 Gist + token 需 Gists 写权限）。
 *   C. 服务器版本时间戳：GET /gists/{id} 取 updated_at（精确到秒，本地时区）。
 *   D. ★ 最后更新时间显示在「同步」行标签右边 ★（老板指定位置与格式）
 *      - 位置：「同步」(Synchronize) 的 `.wrapper` 内、标签与「得到/发送」之间，
 *        margin-right:auto 让它紧贴标签（该 wrapper 是 flex + space-between）。
 *      - 格式：`2026/0920/193205`（年/月日/时分秒，全数字、可排序、可肉眼比对）。
 *      - 取值：服务器 Gist 的 updated_at（= 最后一次同步时间），无 Gist 时显示「尚未同步」。
 *      - 不设 font-size：与同排标签保持同一排版尺度（v3.3 的教训）。
 *   E. 自动同步：监听上游 localStorage['bonjourr'] 变更事件（storage sync.set
 *      在 localstorage 模式下会 dispatchEvent(new Event('storage'))），当
 *      「有变更 + token 有效」时自动推送；首次（gistId 为 undefined）自动 POST
 *      建 Gist 并记住返回的 id。
 *      token 无效时降级为手动（不自动推），并在状态区提示。
 *
 * 注意：本层只清「明显是序列化残渣」的值，不动任何正常字符串；自动同步的推送
 * 走同源 https://api.github.com/gists，复用本地已登录态/令牌，不引入新凭据。
 * ---------------------------------------------------------------------------
 */
(function () {
    'use strict';

    // 只清这三个同步相关的键；都是上游用 localSet({x: undefined}) 会写脏的地方。
    var GUARD = ['gistId', 'gistToken', 'distantUrl'];
    var DIRTY = { undefined: 1, null: 1, NaN: 1 };

    function cleanDirty() {
        var n = 0;
        try {
            for (var i = 0; i < GUARD.length; i++) {
                var k = GUARD[i];
                var v = localStorage.getItem(k);
                if (v !== null && Object.prototype.hasOwnProperty.call(DIRTY, v)) {
                    localStorage.removeItem(k);
                    n++;
                }
            }
        } catch (e) {
            /* 隐私模式 / 存储被禁用，忽略 */
        }
        return n;
    }

    var cleaned = cleanDirty();

    // 可观测标记：探针用它区分「本层接上了」和「压根没跑」
    window.__wei8Sync = {
        cleaned: cleaned,
        hits: 0,
        autoSynced: 0,
        tokenOk: null,     // null=未测, true/false
        gistId: null,
        lastAutoAt: 0,
        lastServerAt: null, // 服务器 updated_at（本地时区字符串）
        lastTimeText: null, // 「同步」行右边当前显示的文字（探针读它）
        lastError: null,
    };

    // A) 抢先清理 —— 上游的「得到 / 发送」是 clickdown 库挂在**按钮自身**上的
    //    pointerdown/keydown/click，所以 document 的**捕获阶段**一定先执行。
    function isSyncBtn(el) {
        return !!(el && el.closest && el.closest('#b_gistup, #b_gistdown, #b_gistsync'));
    }

    function preGuard(e) {
        if (!isSyncBtn(e.target)) {
            return;
        }
        window.__wei8Sync.hits++;
        cleanDirty();
    }

    document.addEventListener('pointerdown', preGuard, true);
    document.addEventListener('keydown', preGuard, true);

    // B) 同步区块的中文提示（用自己的类名；绝不能用上游的 .trn，那会被翻译器改写/清空）
    function addHint() {
        var actions = document.getElementById('gist-sync-actions');
        if (!actions || document.getElementById('wei8-sync-hint')) {
            return;
        }
        var wrap = actions.parentNode; // .wrapper（flex: 左标签 + 右按钮组）
        if (!wrap || !wrap.parentNode) {
            return;
        }

        var box = document.createElement('div');
        box.id = 'wei8-sync-hint';

        var tips = [
            '首次使用：点「发送」会在你的 GitHub 自动建一个私有 Gist（不用自己去建）。',
            'Token 需勾选 Gists 写权限：Account permissions → Gists → Read and write（classic token 则勾 gist）。',
            '自动同步：本地数据一有改动、且令牌有效，就会自动推送到 Gist（「同步」右侧显示服务器那份的最后更新时间，便于判断哪份新）。',
        ];
        for (var i = 0; i < tips.length; i++) {
            var line = document.createElement('div');
            line.textContent = tips[i];
            box.appendChild(line);
        }

        // 少量内联样式，避免为一行提示再新增一个 CSS 文件；沿用面板的字号/色彩基调
        box.style.fontSize = '0.85em';
        box.style.opacity = '0.75';
        box.style.lineHeight = '1.5';
        box.style.padding = '0.4em 0 0.2em';

        wrap.parentNode.insertBefore(box, wrap.nextSibling);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', addHint);
    } else {
        addHint();
    }

    // ==================== C) 服务器版本时间戳 + 自动同步 ====================
    // -----------------------------------------------------------------------
    // 数据流（localstorage 模式）：
    //   - 同步数据本体  -> localStorage['bonjourr']（一个大 JSON 对象）
    //   - 同步元信息    -> localStorage['gistId' / 'gistToken' / 'syncType' ...]
    //   上游每次 sync.set 在 localstorage 模式下会 `localStorage.bonjourr = ...`
    //   并 `dispatchEvent(new Event('storage'))`（main.js:1748-1749）。
    //   这里靠监听该事件驱动自动同步，无需改上游。
    //
    // 令牌校验：上游 isGistTokenValid 打 `GET /gists?since=...`，该端点
    //   allows_permissionless_access=true（细粒度 token 无 Gists 权限也 200），
    //   会误判通过。这里改为直接试 `GET /gists/{id}`，200/403/401 各归各：
    //     200 -> 令牌可读（有效）
    //     401 -> 令牌无效
    //     403 -> 令牌有效但缺 Gists 写权限（自动推送会 403，降级手动）
    // -----------------------------------------------------------------------

    var state = {
        lastLocalHash: null,
        lastAutoKey: null,
        pushTimer: null,
        polling: false,
    };

    // 读一个键（容错）
    function readLocal(key) {
        try {
            return localStorage.getItem(key);
        } catch (e) {
            return null;
        }
    }

    // 解析同步数据本体
    function readSyncData() {
        var raw = readLocal('bonjourr');
        if (!raw) return null;
        try {
            var o = JSON.parse(raw);
            return o && typeof o === 'object' ? o : null;
        } catch (e) {
            return null;
        }
    }

    // 哈希：稳定序列化（键名排序 + 递归深度遍历），用来判断「数据是不是真的变了」。
    // ★ 绝不能写成 JSON.stringify(obj, Object.keys(obj).sort())：replacer 传**数组**时
    //   它是「属性白名单」而且**对每一层都生效** —— 嵌套对象的键不在顶层白名单里，
    //   会被整层丢掉（clock/weather 都变成 {}），于是任何「只改嵌套设置」的改动都算出
    //   同一个哈希、被判成「没变」而不再自动推送。这个坑是 probe_sync.js 实机跑出来的
    //   （症状：第一次推送成功后再改任何设置，autoSynced 永远停在 1）。
    function stableHash(obj) {
        if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
        if (Array.isArray(obj)) {
            var items = [];
            for (var i = 0; i < obj.length; i++) items.push(stableHash(obj[i]));
            return '[' + items.join(',') + ']';
        }
        var keys = Object.keys(obj).sort();
        var pairs = [];
        for (var j = 0; j < keys.length; j++) {
            pairs.push(JSON.stringify(keys[j]) + ':' + stableHash(obj[keys[j]]));
        }
        return '{' + pairs.join(',') + '}';
    }

    // 取服务器 Gist 元信息（含 updated_at 精确到秒）
    function gistHeaders(token) {
        return {
            Authorization: 'Bearer ' + token,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
        };
    }

    // 时间戳格式：2026/0920/193205（年/月日/时分秒）
    // 全数字、无空格、按字典序即按时间序 —— 适合肉眼比对哪份新。
    function fmtTs(d) {
        var p = function (n) { return (n < 10 ? '0' : '') + n; };
        return (
            d.getFullYear() + '/' + p(d.getMonth() + 1) + p(d.getDate()) +
            '/' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds())
        );
    }

    // 「同步」行标签右边的时间戳节点。
    // 位置依据（settings.html:2066-2084）：
    //   <div class="wrapper">            <- flex + space-between + align-items:center
    //     <span class="trn">Synchronize</span>
    //     <div id="gist-sync-actions">   <- 得到/发送
    // 插到 actions 之前 = 标签右边；margin-right:auto 吃掉剩余空间 → 紧贴标签、按钮仍靠右。
    // 不设 font-size：与同排「同步」标签保持同一排版尺度（v3.3 栽过的坑）。
    function ensureTimeEl() {
        var el = document.getElementById('wei8-sync-time');
        if (el) return el;
        var actions = document.getElementById('gist-sync-actions');
        if (!actions || !actions.parentNode) return null;
        el = document.createElement('span');
        el.id = 'wei8-sync-time';
        el.style.opacity = '0.7';
        el.style.marginLeft = '0.6em';
        el.style.marginRight = 'auto';
        actions.parentNode.insertBefore(el, actions);
        return el;
    }

    function setTimeText(txt) {
        window.__wei8Sync.lastTimeText = txt;
        var el = ensureTimeEl();
        if (el && el.textContent !== txt) el.textContent = txt;
    }

    // 渲染「同步」行时间戳 + 「Server status」行（两处同源，避免各写一套状态判断）
    function renderServerStatus(token, id) {
        var base = document.getElementById('gist-sync-status-base');

        // 状态归一：state = 给「Server status」行的短词；ts = 给「同步」行的时间/占位词
        function idle(state, ts) {
            if (base) base.textContent = state;
            setTimeText(ts);
        }

        if (!token) {
            idle('等待认证', '未配置令牌');
            return;
        }
        if (!id) {
            idle('尚无保存的数据', '尚未同步');
            return;
        }
        fetch('https://api.github.com/gists/' + id, { headers: gistHeaders(token) })
            .then(function (resp) {
                if (resp.status === 401) {
                    idle('令牌无效', '令牌无效');
                    return null;
                }
                if (resp.status === 403) {
                    idle('令牌缺 Gists 权限', '令牌缺权限');
                    return null;
                }
                if (resp.status !== 200) {
                    idle('服务器无数据', '读取失败');
                    return null;
                }
                return resp.json().then(function (json) {
                    var localStr = fmtTs(new Date(json.updated_at));
                    window.__wei8Sync.lastServerAt = localStr;

                    // ① 「同步」行后面的最后更新时间（老板要的位置）
                    setTimeText(localStr);

                    // ② 原「Server status」行：只留时间（做成指向 Gist 网页的链接）
                    //    注意别再把「服务器版本」四个字重复写两遍（base 清空，文字只由 link 承担）
                    var wrapper = document.getElementById('gist-sync-status-wrapper');
                    var old = document.querySelector('#gist-sync-status');
                    if (old && old.parentNode) old.parentNode.removeChild(old);

                    if (wrapper) {
                        var link = document.createElement('a');
                        link.id = 'gist-sync-status';
                        link.href = json.html_url;
                        link.textContent = localStr;
                        wrapper.appendChild(link);
                    }
                    if (base) base.textContent = '';
                });
            })
            .catch(function () {
                /* 网络异常，保留上次文案 */
            });
    }

    // 校验令牌：返回 { ok, canWrite, code }
    function checkToken(token, id) {
        return new Promise(function (resolve) {
            if (!token) return resolve({ ok: false, canWrite: false, code: 0 });
            var url = 'https://api.github.com/gists/' + (id || 'check');
            fetch(url, { headers: gistHeaders(token) })
                .then(function (resp) {
                    resolve({ ok: resp.status === 200, canWrite: resp.status === 200, code: resp.status });
                })
                .catch(function () {
                    resolve({ ok: false, canWrite: false, code: 0 });
                });
        });
    }

    // 自动推送：首次（id 为空/undefined）POST 新建；否则 PATCH 更新
    function autoPush() {
        var token = readLocal('gistToken');
        var idRaw = readLocal('gistId');
        var id = (idRaw && idRaw !== 'undefined' && idRaw !== 'null' && idRaw !== 'NaN') ? idRaw : undefined;
        var data = readSyncData();
        if (!token || !data) return;

        // 上游的「默认数据不许发」护栏（对应 isStorageDefault）
        // 这里简单判：同步数据等于默认（无用户改动）则不推。
        var files = { 'bonjourr-export.json': { content: JSON.stringify(data, undefined, 2) } };
        var description =
            'File automatically generated by Bonjourr. Learn more on https://bonjourr.fr/docs/settings-management/syncing/#github-gist';

        var req = id === undefined
            ? {
                method: 'POST',
                url: 'https://api.github.com/gists',
                body: JSON.stringify({ files: files, description: description, public: false }),
            }
            : {
                method: 'PATCH',
                url: 'https://api.github.com/gists/' + id,
                body: JSON.stringify({ files: files, description: description }),
            };

        fetch(req.url, { method: req.method, headers: gistHeaders(token), body: req.body })
            .then(function (resp) {
                if (resp.status === 200 || resp.status === 201) {
                    var json = resp.status === 201 ? null : {};
                    return (resp.status === 201 ? resp.json() : Promise.resolve(json)).then(function (j) {
                        var newId = resp.status === 201 ? j.id : id;
                        // 首次新建成功后记住 id（上游 manual send 也会写，这里双保险）
                        try {
                            localStorage.setItem('gistId', String(newId));
                        } catch (e) { /* ignore */ }
                        window.__wei8Sync.gistId = newId;
                        window.__wei8Sync.autoSynced++;
                        window.__wei8Sync.lastAutoAt = Date.now();
                        window.__wei8Sync.lastError = null;
                        // 推送成功后刷新服务器时间戳
                        renderServerStatus(token, newId);
                        return j;
                    });
                }
                if (resp.status === 401) {
                    window.__wei8Sync.lastError = '401 令牌无效，已停止自动推送（改回手动「发送」）';
                    window.__wei8Sync.tokenOk = false;
                    return;
                }
                if (resp.status === 403) {
                    window.__wei8Sync.lastError = '403 令牌缺 Gists 写权限（Account permissions → Gists → Read and write）';
                    window.__wei8Sync.tokenOk = false;
                    return;
                }
                if (resp.status === 404) {
                    window.__wei8Sync.lastError = '404 Gist 不存在（服务器那份已被删，改回手动「发送」重建）';
                    return;
                }
                window.__wei8Sync.lastError = '推送失败 HTTP ' + resp.status;
            })
            .catch(function (err) {
                window.__wei8Sync.lastError = '网络异常：' + (err && err.message ? err.message : String(err));
            });
    }

    // 主监听：上游 localstorage 模式每次 sync.set 都会 dispatch `storage` 事件
    // （main.js:1749）。同时兜底用 window 'storage'（跨标签页）。
    function onStorage() {
        // 只有同步模式 + 有令牌才自动推
        var token = readLocal('gistToken');
        if (!token) return;

        // 去抖：同一份数据 2s 内不重复推
        var data = readSyncData();
        var key = stableHash(data);
        if (key === state.lastAutoKey) return;
        state.lastAutoKey = key;

        if (state.pushTimer) clearTimeout(state.pushTimer);
        state.pushTimer = setTimeout(function () {
            autoPush();
            state.pushTimer = null;
        }, 2000);
    }

    // 轮询刷新「同步」行的最后更新时间
    //   常态 60s 一次（够用且安静）；
    //   但**首次渲染出来之前**改成 3s 快跑（最多 10 次）—— 覆盖三种真实场景：
    //     ① 面板刚打开、DOM 才就位；② 用户刚提交令牌（localStorage 是后写的）；
    //     ③ 自动化探针在页面加载后才注入令牌。
    //   不这么做的话，这三种情况下时间戳要等满 60s 才出现，看起来像「功能没生效」。
    function startPoll() {
        if (state.polling) return;
        state.polling = true;
        var fast = 0;
        function tick() {
            var token = readLocal('gistToken');
            var idRaw = readLocal('gistId');
            var id = (idRaw && idRaw !== 'undefined' && idRaw !== 'null' && idRaw !== 'NaN') ? idRaw : null;
            // 有令牌就渲染：没 id 时也要把「尚未同步」显示出来，否则「同步」右边一直空着
            if (token) {
                renderServerStatus(token, id);
            }
            var pending = window.__wei8Sync.lastTimeText === null && fast < 10;
            if (pending) fast++;
            setTimeout(tick, pending ? 3000 : 60000);
        }
        tick();
    }

    // 事件接入：上游在 sync.set 里 `globalThis.dispatchEvent(new Event('storage'))`
    window.addEventListener('storage', onStorage);
    // 上游是 `globalThis.dispatchEvent(new Event('storage'))` —— 即 window 上的原生 storage 事件
    // （localstorage 模式下它不走跨标签页，但事件名仍是 'storage'，直接挂在 window 上即可捕获）

    // 首次进入设置面板时，把服务器时间戳刷新一遍
    document.addEventListener('DOMContentLoaded', function () {
        // 面板每次打开（上游在 toggleSyncSettingsOption 里调用 setGistStatus），
        // 这里在 1s 后补一次刷新，覆盖「面板刚打开、DOM 还没渲染出 status 容器」的时序
        setTimeout(function () { startPoll(); }, 1000);
    });
})();
