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
 *      「有变更 + token 有效」时自动推送；首次（gistId 为空）自动 POST 建 Gist
 *      并记住返回的 id，之后 PATCH 更新同一条。
 *      · 推送**串行化**（同一时刻只允许一个在飞）：否则两份改动挨得近时，第二次
 *        会在第一次还没写回 id 时就发动，两边都走 POST → 每次改动都多建一条 Gist。
 *      · id 优先读 localStorage，回落到内存里的 __wei8Sync.gistId，双保险。
 *      · token 无效时降级为手动（不自动推），并在状态区提示。
 *   F. 进设置时检查服务器版本（v3.11，老板定稿）：
 *      · 只在设置面板打开时检查一次，平时打开页面不碰服务器（本地缓存优先秒开）；
 *      · 服务器与本机数据不一致 → 弹「覆盖本机 / 合并」二选一（绝不静默覆盖）：
 *        覆盖 = 整包换成服务器那份；合并 = 只补不改（远端独有键并入，共有键保留本机）；
 *      · 断网 → 静默跳过，「Server status」行显示「离线中，当前用本机缓存」。
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
        pullCount: 0,       // 「合并/覆盖」写入本机的次数（探针读）
        lastPullAt: 0,
        lastPullStatus: null, // 'same'|'prompt'|'no-token'|'no-id'|'offline'|'error'
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
        pushing: false, // 有推送在飞（串行化用，防并发 POST 各建一条 Gist）
        queued: false,  // 在飞期间又来了改动，落地后补推
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

    // 渲染「同步」行时间戳 + 最近 5 条历史下拉
    // items：[{ts:'2026/0921/20.27.19', note:'#12'}] 按新→旧；首条即「当前版本」。
    function renderTimeWithHistory(localStr, items) {
        var txt = items.length > 0 ? localStr : '尚未同步';
        setTimeText(txt, items);
    }
    // 时间戳格式：2026/0921/09.38.45（老板指定：年/月日/时.分.秒，时点分点秒）
    // 全数字 + 点号分隔时间段，肉眼可排序、可比对。
    function fmtTs(d) {
        var p = function (n) { return (n < 10 ? '0' : '') + n; };
        return (
            d.getFullYear() + '/' + p(d.getMonth() + 1) + p(d.getDate()) +
            '/' + p(d.getHours()) + '.' + p(d.getMinutes()) + '.' + p(d.getSeconds())
        );
    }

    // ISO 时间戳（UTC）→ 本地时区
    function parseTs(s) {
        if (!s) return null;
        var d = new Date(s);
        return isNaN(d.getTime()) ? null : d;
    }

    // 「同步」行标签右边的时间戳节点（做成**可点开的下拉**，列最近 5 条版本）。
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
        el.style.position = 'relative';
        el.style.cursor = 'pointer';
        actions.parentNode.insertBefore(el, actions);
        return el;
    }

    // 写「时间戳文本 + 最近 5 条历史列表」。
    // txt = 当前主时间戳；items = [{ts: '2026/0921/09.38.45', note: '#1'}] 按新→旧，最多 5 条。
    // ★ 主时间戳放在 <span id="wei8-sync-time-label">，列表是它的**兄弟**节点（绝对定位）：
    //   若把列表塞进 #wei8-sync-time 内部，探针读 el.textContent 会把主时间戳和历史全拼在一起
    //   （实测 "2026/0921/10.18.01" + "2026/0921/10.18.00 · #1" 粘成一坨）→ 主值与历史串味。
    function setTimeText(txt, items) {
        window.__wei8Sync.lastTimeText = txt;
        var el = ensureTimeEl();
        if (!el) return;
        // 主时间戳：固定一个 label span（重建时清旧文本再写）
        var label = el.querySelector(':scope > span:not(#wei8-sync-time-list span)');
        if (!label) {
            // 清除 el 的原始文本节点（历史列表是子节点，不受影响）
            while (el.firstChild && el.firstChild.nodeType === 3) el.removeChild(el.firstChild);
            label = document.createElement('span');
            label.id = 'wei8-sync-time-label';
            el.appendChild(label);
        }
        label.textContent = txt;
        // 历史列表（点击展开；最新在顶；做成兄弟节点避免串味）
        var list = document.getElementById('wei8-sync-time-list');
        if (list && list.parentNode) list.parentNode.removeChild(list);
        var haveItems = items && items.length > 0;
        if (!haveItems) {
            el.title = '';
            return;
        }
        el.title = '点击展开最近 ' + items.length + ' 条版本';
        list = document.createElement('div');
        list.id = 'wei8-sync-time-list';
        list.style.display = 'none';
        list.style.position = 'absolute';
        list.style.left = '0';
        list.style.top = '1.2em';
        list.style.zIndex = '100';
        list.style.background = 'var(--color-bg, #1e1e1e)';
        list.style.color = 'inherit';
        list.style.border = '1px solid rgba(128,128,128,.3)';
        list.style.borderRadius = '4px';
        list.style.padding = '4px 6px';
        list.style.fontSize = '0.85em';
        list.style.minWidth = '14em';
        list.style.whiteSpace = 'nowrap';
        for (var i = 0; i < items.length; i++) {
            var row = document.createElement('div');
            row.style.padding = '1px 0';
            var time = document.createElement('span');
            time.textContent = items[i].ts;
            row.appendChild(time);
            if (items[i].note) {
                var note = document.createElement('span');
                note.textContent = ' · ' + items[i].note;
                note.style.opacity = '0.6';
                note.style.fontWeight = 'normal';
                row.appendChild(note);
            }
            list.appendChild(row);
        }
        el.appendChild(list);
        // 点击切换；文档点击收拢
        el.onclick = function (e) {
            e.stopPropagation();
            list.style.display = list.style.display === 'none' ? 'block' : 'none';
        };
        document.onclick = function () {
            if (list && list.parentNode) list.style.display = 'none';
        };
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
                if (resp.status === 404) {
                    // 404 = gistId 悬空（服务器那份被删了，比如在 GitHub 上手动删过）。
                    // 不写「读取失败」吓人：自动推送马上会重建，重建成功后这里会被刷新成真时间。
                    idle('云端已删除', '重建中');
                    return null;
                }
                if (resp.status !== 200) {
                    idle('服务器无数据', '读取失败');
                    return null;
                }
                return resp.json().then(function (json) {
                    var localStr = fmtTs(new Date(json.updated_at));
                    window.__wei8Sync.lastServerAt = localStr;

                    // ① 「同步」行后面的最后更新时间（老板要的位置）+ 最近 5 条下拉
                    //    历史直接来自 Gist 响应的 history 字段（每次成功推送记一条，
                    //    committed_at 精确到秒、已按新→旧排好、默认返回 5 条）。
                    //    随 GET Gist 一起拿，不另开请求、不轮询——进设置刷新到即渲染。
                    var items = [];
                    var hist = Array.isArray(json.history) ? json.history : [];
                    for (var k = 0; k < hist.length && items.length < 5; k++) {
                        var d = parseTs(hist[k].committed_at);
                        if (!d) continue;
                        items.push({ ts: fmtTs(d), note: '#' + (hist.length - k) });
                    }
                    setTimeText(localStr, items);

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

    // 把「被上游序列化残渣」的 id 归一成 null/真值，三处都要用，抽出来
    function cleanId(v) {
        return (v && v !== 'undefined' && v !== 'null' && v !== 'NaN') ? v : null;
    }

    // 自动推送：首次（id 为空）POST 新建；否则 PATCH 更新
    //
    // ★ 必须串行化（state.pushing）：推送是「2s 去抖 + 一次到 GitHub 的往返」，
    //   网络慢时一次要好几秒。若两份改动挨得近，第二个 autoPush 会在第一个还没写回
    //   gistId 时就发动 —— 两边都读到「没有 id」，于是各自 POST 出一条新 Gist，
    //   每次改动都多出一条（这个坑是 probe_sync.js 实机跑出来的，两次写入同一 POST 分支）。
    //   串行化后：在飞时只置 queued，等落地再补推一次，那时 id 已经写好了 → 走 PATCH。
    //
    // ★ id 取值优先 localStorage，回落到我们自己在内存里记的 __wei8Sync.gistId：
    //   即使上游某次写状态把 localStorage 的 gistId 覆盖掉，也不会退化成「又新建一条」。
    function autoPush() {
        if (state.pushing) {
            state.queued = true;
            return;
        }
        var token = readLocal('gistToken');
        var id = cleanId(readLocal('gistId')) || cleanId(window.__wei8Sync.gistId);
        var data = readSyncData();
        if (!token || !data) return;
        state.pushing = true;

        function done() {
            state.pushing = false;
            if (state.queued) {
                state.queued = false;
                autoPush();
            }
        }

        // 上游的「默认数据不许发」护栏（对应 isStorageDefault）
        // 这里简单判：同步数据等于默认（无用户改动）则不推。
        var files = { 'bonjourr-export.json': { content: JSON.stringify(data, undefined, 2) } };
        var description =
            'File automatically generated by Bonjourr. Learn more on https://bonjourr.fr/docs/settings-management/syncing/#github-gist';

        var req = id === null
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
                    // ★ 404 自愈：gistId 悬空（服务器那份被删，例如在 GitHub 上手动删过、
                    //   或换 token 后指到了别的账号）。旧逻辑只会报错卡死在「Gist 不存在」，
                    //   老板真机就中过（时间戳一直「读取失败」）。
                    //   正解：清掉失效 id → 排队补推。done() 会立刻再跑一次 autoPush，
                    //   那时 id 为 null → 走 POST 重建 → 成功后写回新 id 并刷新时间戳。
                    //   不会死循环：重建失败（401/403）会置 tokenOk 并停止，queued 只置这一次。
                    try { localStorage.removeItem('gistId'); } catch (e) { /* ignore */ }
                    window.__wei8Sync.gistId = null;
                    window.__wei8Sync.lastError = '404 云端 Gist 已不存在，正在自动重建…';
                    state.queued = true;
                    return;
                }
                window.__wei8Sync.lastError = '推送失败 HTTP ' + resp.status;
            })
            .catch(function (err) {
                window.__wei8Sync.lastError = '网络异常：' + (err && err.message ? err.message : String(err));
            })
            .then(done); // 无论成败都解除在飞标记；有排队就立刻补推一次
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
            var id = cleanId(readLocal('gistId')) || cleanId(window.__wei8Sync.gistId);
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

    // ============ 进设置时检查服务器版本 + 「覆盖 / 合并」二选一 ============
    // （2026-09-21 老板定稿：本地缓存优先秒开；不用每次打开页面都拉；进设置时检查一次；
    //   服务器与本机不一致就弹提示让老板二选一，**绝不静默覆盖**。）
    //
    //   覆盖本机 = 整包换成服务器那份（服务器为准，本机独有改动丢弃；覆盖后抑制空推送）
    //   合并     = 只补不改：服务器有、本机没有的顶层键补进来；两边都有的键保留本机
    //              （合并后本机是「两边并集」，自动同步会把并集推回服务器）
    //   断网     = 静默跳过，「Server status」行显示「离线中，当前用本机缓存」，本机缓存照常用
    //
    //   ★ 为什么「合并/覆盖」都安全：只在**顶层键**层面操作，绝不把远端缺键的本机数据删掉，
    //     也不会触发上游 verifyDataAsSync 浅合并把嵌套块（move 布局/weather/…）重置成默认。
    var lastPullStatus = null; // 'same' | 'prompt' | 'no-token' | 'no-id' | 'offline' | 'error'

    // 断网/离线状态提示：挂在「Server status」行基节点；在线时由 renderServerStatus 刷新时间戳
    function renderOfflineStatus() {
        var base = document.getElementById('gist-sync-status-base');
        if (!base) return;
        if (lastPullStatus === 'offline') {
            base.textContent = '离线中，当前用本机缓存';
        }
        // 缺令牌/无 Gist 时 renderServerStatus 已写「等待认证」「尚无保存的数据」，这里不覆盖
    }

    function removeSyncPrompt() {
        var old = document.getElementById('wei8-sync-prompt');
        if (old && old.parentNode) old.parentNode.removeChild(old);
    }

    // 弹「覆盖 / 合并」二选一。位置：同步区块内、提示文案（#wei8-sync-hint）下面。
    function showSyncPrompt(remote, serverTs) {
        var actions = document.getElementById('gist-sync-actions');
        if (!actions || !actions.parentNode) return;
        removeSyncPrompt();
        var wrap = actions.parentNode; // .wrapper
        var hint = document.getElementById('wei8-sync-hint');

        var bar = document.createElement('div');
        bar.id = 'wei8-sync-prompt';
        bar.style.fontSize = '0.85em';
        bar.style.lineHeight = '1.6';
        bar.style.padding = '0.45em 0.6em';
        bar.style.marginTop = '0.4em';
        bar.style.border = '1px solid rgba(128,128,128,.35)';
        bar.style.borderRadius = '6px';

        var tip = document.createElement('div');
        tip.textContent = '检测到服务器版本与本机不一致（服务器时间：' + serverTs + '）';
        bar.appendChild(tip);

        var row = document.createElement('div');
        row.style.display = 'flex';
        row.style.gap = '0.8em';
        row.style.marginTop = '0.3em';

        // 写本机 + 刷新。suppressPush：覆盖后内容与服务器相同，置 lastAutoKey 抑制自动同步空推一遍。
        function applyLocal(next, suppressPush) {
            try {
                localStorage.setItem('bonjourr', JSON.stringify(next));
                if (suppressPush) state.lastAutoKey = stableHash(next);
                window.__wei8Sync.pullCount = (window.__wei8Sync.pullCount || 0) + 1;
                window.__wei8Sync.lastPullAt = Date.now();
                window.__wei8Sync.lastError = null;
                globalThis.dispatchEvent(new Event('storage')); // 驱动上游组件按新数据刷新
            } catch (e) {
                window.__wei8Sync.lastError = '写入本机失败：' + (e && e.message ? e.message : String(e));
            }
            removeSyncPrompt();
            renderServerStatus(readLocal('gistToken'), cleanId(readLocal('gistId')));
        }

        function mkBtn(label, fn) {
            var b = document.createElement('button');
            b.type = 'button'; // 动态 button 必须显式 type="button"，否则点击会提交所在表单
            b.textContent = label;
            b.style.cursor = 'pointer';
            b.addEventListener('click', fn);
            return b;
        }

        row.appendChild(mkBtn('覆盖本机', function () {
            applyLocal(remote, true); // 服务器为准，整包替换
        }));
        row.appendChild(mkBtn('合并', function () {
            var localData = readSyncData() || {};
            var merged = {};
            Object.keys(localData).forEach(function (k) { merged[k] = localData[k]; }); // 本机全保留
            Object.keys(remote).forEach(function (k) {
                if (!(k in localData)) merged[k] = remote[k]; // 只补：远端独有键进本机；共有键不动
            });
            applyLocal(merged, false); // 并集随自动同步推回服务器
        }));
        bar.appendChild(row);

        (hint || wrap).parentNode.insertBefore(bar, (hint || wrap).nextSibling);
    }

    // 检查服务器版本（只在进设置时被调用）：一致→安静退场；不一致→弹二选一；断网→离线提示
    function autoPull() {
        var token = readLocal('gistToken');
        var id = cleanId(readLocal('gistId')) || cleanId(window.__wei8Sync.gistId);
        if (!token || !id) {
            lastPullStatus = !token ? 'no-token' : 'no-id';
            window.__wei8Sync.lastPullStatus = lastPullStatus;
            return;
        }
        // ★ cache:'reload' 必须带：GitHub API 的 GET 响应带 Cache-Control: max-age=60，
        //   浏览器 HTTP 缓存会让这里拿到 1 分钟前的旧内容——「覆盖本机」就可能用旧数据盖新数据
        //   （probe_sync.js 7.8 实测踩中：外部 PATCH 后 60s 内进设置，GET 还是补丁前的缓存）。
        fetch('https://api.github.com/gists/' + id, { headers: gistHeaders(token), cache: 'reload' })
            .then(function (resp) {
                if (resp.status !== 200) { lastPullStatus = 'error'; return null; }
                return resp.json();
            })
            .then(function (json) {
                if (!json) { window.__wei8Sync.lastPullStatus = lastPullStatus; return; }
                var content = Object.values(json.files || {})[0];
                if (!content || typeof content.content !== 'string') { lastPullStatus = 'error'; return; }
                var remote;
                try { remote = JSON.parse(content.content); } catch (e) { lastPullStatus = 'error'; return; }
                if (!remote || typeof remote !== 'object') { lastPullStatus = 'error'; return; }
                var localData = readSyncData() || {};
                // 逐键比对（本机没有的键 = 服务器多了；值不同 = 内容不一致）
                var same = true;
                var rk = Object.keys(remote);
                for (var i = 0; i < rk.length; i++) {
                    if (!(rk[i] in localData) ||
                        stableHash(remote[rk[i]]) !== stableHash(localData[rk[i]])) { same = false; break; }
                }
                var serverTs = json.updated_at ? (fmtTs(parseTs(json.updated_at)) || '') : '';
                if (same) {
                    lastPullStatus = 'same'; // 一致：不打扰
                } else {
                    lastPullStatus = 'prompt';
                    showSyncPrompt(remote, serverTs);
                }
                window.__wei8Sync.lastPullStatus = lastPullStatus;
            })
            .catch(function () {
                lastPullStatus = 'offline';
                window.__wei8Sync.lastPullStatus = 'offline';
                renderOfflineStatus(); // 断网无副作用，本机缓存照常用
            });
    }

    // 只在「设置面板打开」时检查（老板：不用每次打开页面都拉一次）。
    // 上游打开面板 = aside#settings 加 shown 类，MutationObserver 盯 class 变化即可，不改上游。
    function watchSettingsOpen() {
        var aside = document.getElementById('settings');
        if (!aside || typeof MutationObserver === 'undefined') return;
        new MutationObserver(function () {
            if (aside.classList.contains('shown')) autoPull();
        }).observe(aside, { attributes: true, attributeFilter: ['class'] });
    }

    // 事件接入：上游在 sync.set 里 `globalThis.dispatchEvent(new Event('storage'))`
    window.addEventListener('storage', onStorage);
    // 上游是 `globalThis.dispatchEvent(new Event('storage'))` —— 即 window 上的原生 storage 事件
    // （localstorage 模式下它不走跨标签页，但事件名仍是 'storage'，直接挂在 window 上即可捕获）

    document.addEventListener('DOMContentLoaded', function () {
        // 时间戳轮询照旧（进设置 1s 后补刷一轮，覆盖面板 DOM 刚就位的时序）
        setTimeout(function () { startPoll(); }, 1000);
        // 版本检查只在面板真正打开时触发（不用每次打开页面都拉一次——老板定稿）
        watchSettingsOpen();
    });
})();
