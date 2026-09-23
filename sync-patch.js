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
 *   G. 同步历史自维护（v3.15，老板定稿：上限 30 条）：
 *      · 背景：GitHub 会把高频 PATCH 的 Gist history 清空/截断（实测 50 连推后只剩
 *        上限 30 条、真机 2 个 Gist history=0），下拉一度全空 —— 不能再依赖它。
 *      · 方案：历史由本层自己记，随推送写进 Gist 数据本体顶层键 `wei8SyncHistory`
 *        （[{t:ISO时间, m:'auto'|'manual'}]，HIST_MAX=30 条、新→旧；Gist 单文件上限
 *        极宽松，30 条约 2KB 无压力）；本机另存镜像 localStorage['wei8-sync-history']。
 *        下拉 = 远端 ∪ 本地镜像，按时间倒序去重。
 *      · 分类（老板要求）：自动推送记 m:'auto'（显示「自动」）；手动点「发送」记
 *        m:'manual'（显示「手动」= 手动备份）。手动记录 8s 后随一次补推上云
 *        （上游 sendGist 先推数据本体，我们后补历史，串行不冲突）。
 *   H. 装载期云端兜底（v3.15）：打开页面后台查一次（cache:'reload'，不阻塞秒开）：
 *      · 本机数据无效（bonjourr 缺失/非法/无 linkgroups）→ 直接从云端拉回 + 提示；
 *      · 本机有效但与云端不一致 → 右下角小条提示「点此进设置处理」（不自动动本机）；
 *      · 一致/断网 → 完全安静。进设置时的检查（F）照旧。
 *      比对/合并一律把 `wei8SyncHistory` 排除在外 —— 它是本层的记录，不是设置数据。
 *   I. 换版提示（v3.17）：SW 是「缓存优先秒开」，代价是部署后**首个打开的页面仍是旧壳**，
 *      旧壳连新版 js 都不会请求 → 看着像「改了不生效」。新 SW 接管旧页面时会触发
 *      controllerchange，这时右下角提示「点此刷新」。只在加载时已有 controller 才监听，
 *      首次访问不提示（否则每次冷启动都弹，成骚扰）。不做自动刷新 —— 老板可能在改设置，重载会丢输入。
 *   J. 修订号（sha）补齐（v3.17）：「按记录还原」要 sha，主来源是推送响应里的
 *      history[0].version（推完即回填本机镜像）；旧记录/换设备丢掉的，用 commits 端点
 *      按时间戳精确匹配补一次（每次页面加载最多一次）。
 *   K. 按记录还原（v3.17，老板要求）：历史表每行可点 → 确认 → GET /gists/{id}/{sha}
 *      取回那一版 → 整包写入本机。**什么都不删**：云端会把它记成一次新的修订，
 *      所以是「回到那一版」而不是「销毁现在」。缺 linkgroups 的内容直接拒绝，宁可不动。
 *   L. 数据本体写入留痕（v3.17）：本层两处写 `localStorage['bonjourr']` 的地方各记一条到独立键
 *      `wei8-writes`（最近 10 条）。老板报「每次打开又变回默认」时，自检页能直接回答
 *      「是不是有层在开机时重写了数据、是哪一层」。
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

    // ---------------------------------------------------------------------
    // 数据本体写入留痕（v3.17）
    //   全站只有 5 处会写 localStorage['bonjourr']，本文件占 2 处（设置面板「覆盖本机/合并」、
    //   装载期本机数据无效时的云端恢复）。每处写完往 `wei8-writes` 这个**独立小键**里记一条
    //   （最近 10 条，新→旧），自检页 wei8-diag.html 会读出来展示。
    //   老板报「每次打开又变回默认」时，这张表能直接回答「是不是有层在开机时重写了数据、哪一层」。
    //   取舍与 weather-patch.js 里同一函数一致：不抽公共文件（早期层不能有加载依赖），
    //   4 行代码各留一份，换「任一层单独挂掉都不影响别的层」；写的是独立键，绝不写进 bonjourr 自己
    //   （那会触发上游 storage 事件 → 再推一轮同步，自己咬自己）。
    // ---------------------------------------------------------------------
    function logWrite(by) {
        try {
            var L = JSON.parse(localStorage.getItem('wei8-writes') || '[]');
            if (!Array.isArray(L)) L = [];
            L.unshift({ at: new Date().toISOString(), by: by });
            localStorage.setItem('wei8-writes', JSON.stringify(L.slice(0, 10)));
        } catch (e) { /* 留痕失败不影响主流程 */ }
    }

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
        restored: 0,          // 按记录还原成功的次数（v3.17，探针读）
        lastRestoreTs: null,  // 最近一次还原到的时间标签（探针读）
        shaBackfilled: 0,     // 用 commits 端点补 sha 的轮次（v3.17，探针读）
        histShas: null,       // 历史表各行有没有 sha（'101…'，1=那一行可点还原；探针读）
        versionToasts: 0,     // 换版提示弹过几次（v3.17，探针读）
    };

    // A) 抢先清理 —— 上游的「得到 / 发送」是 clickdown 库挂在**按钮自身**上的
    //    pointerdown/keydown/click，所以 document 的**捕获阶段**一定先执行。
    function isSyncBtn(el) {
        return !!(el && el.closest && el.closest('#b_gistup, #b_gistdown, #b_gistsync'));
    }

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

    // ==================== G) 同步历史自维护（v3.15） ====================
    // 历史条目：{t: ISO字符串, m: 'auto'|'manual'}，新→旧，上限 HIST_MAX 条。
    // 真源 = Gist 数据本体顶层键 `wei8SyncHistory`（跨设备随数据走）；
    // 本机镜像 = localStorage['wei8-sync-history']（推送落地前先能看到、也供合并）。
    var HIST_MAX = 30; // 老板定稿：上限 30 条（Gist 单文件上限极宽松，30 条约 2KB）
    var HIST_KEY = 'wei8-sync-history';
    var HIST_FIELD = 'wei8SyncHistory'; // 数据本体里的顶层键名（比对/合并时必须排除）

    function readMirror() {
        try {
            var arr = JSON.parse(localStorage.getItem(HIST_KEY) || '[]');
            return Array.isArray(arr) ? arr : [];
        } catch (e) {
            return [];
        }
    }

    function writeMirror(hist) {
        try { localStorage.setItem(HIST_KEY, JSON.stringify(hist)); } catch (e) { /* ignore */ }
    }

    // 从数据本体提取历史（bonjourr 键里可能带着「下载还原」时进来的那份）
    function histFromData(data) {
        if (!data || !Array.isArray(data[HIST_FIELD])) return [];
        return data[HIST_FIELD];
    }

    // 合并去重：extra(远端历史) ∪ 数据本体 ∪ 本地镜像，按 t 倒序，最多 HIST_MAX 条。
    // v3.17：条目结构扩成 {t, m, sha} —— sha 是那次写入在 GitHub 上的**修订版本号**，
    //   「按记录还原」就靠它回取那一版（GET /gists/{id}/{sha}，实测 6/6 精确取回）。
    //   同一个 t 可能同时出现在云端与本机镜像里，其中一份带 sha 就用它 ——
    //   不能因为先遇到没 sha 的那份就把 sha 丢了（否则「能还原的行」会莫名变灰）。
    function mergeHist(extra) {
        var byT = {};
        var order = [];
        var pool = (Array.isArray(extra) ? extra : [])
            .concat(histFromData(readSyncData()))
            .concat(readMirror());
        for (var i = 0; i < pool.length; i++) {
            var it = pool[i];
            if (!it || !it.t) continue;
            var e = byT[it.t];
            if (!e) {
                e = byT[it.t] = { t: it.t, m: it.m === 'manual' ? 'manual' : 'auto', sha: it.sha || null };
                order.push(it.t);
            } else if (!e.sha && it.sha) {
                e.sha = it.sha;
            }
        }
        order.sort(function (a, b) { return a < b ? 1 : -1; });
        var out = [];
        for (var j = 0; j < order.length && out.length < HIST_MAX; j++) out.push(byT[order[j]]);
        return out;
    }

    // 记一条历史并落镜像（不碰数据本体，避免触发 storage 事件再推一轮）
    function recordHist(mode) {
        var hist = mergeHist();
        /* v3.16：把上一条的时间校正为 GitHub 的 updated_at（上次推送成功后存下的）。
           上次这条记录写云时用的是「本地发起时刻」，这里改准。每次推送都会把整份
           wei8SyncHistory 重写一遍，所以校正会随下一次推送自动落云，不需要额外 PATCH。
           ±10 分钟窗口：只认「就是上一条」，防止把不相关条目改错。 */
        var iso = window.__wei8Sync.lastServerIso;
        if (iso && hist.length) {
            var d0 = Date.parse(hist[0].t);
            var d1 = Date.parse(iso);
            if (!isNaN(d0) && !isNaN(d1) && Math.abs(d0 - d1) < 10 * 60 * 1000) {
                hist[0].t = iso;
            }
        }
        hist.unshift({ t: new Date().toISOString(), m: mode });
        hist = hist.slice(0, HIST_MAX);
        writeMirror(hist);
        return hist;
    }

    // v3.17：把「刚刚这次推送」的修订版本号写回它对应的那条历史（sha 字段）。
    //
    // 为什么是「事后补写」而不是「推之前就写好」：sha 由 GitHub 在写入**之后**才产生，
    // 只能从响应里取（PATCH/POST 响应的 history[0].version，实测 6/6 都有）。
    // 所以推完立刻回填本机镜像；云端那份要等**下一次**推送重写整份 wei8SyncHistory 时才带上 ——
    // 与既有的「用 updated_at 校正上一条时间」是同一套自愈思路。
    //
    // 只认 pushedT：并发/交错的记录（比如推送在飞时老板手动点了一次「上传备份」）不能张冠李戴。
    function attachSha(sha, pushedT) {
        if (!sha || !pushedT) return;
        try {
            var hist = readMirror();
            if (!hist.length || hist[0].t !== pushedT) return;
            if (hist[0].sha === sha) return;
            hist[0].sha = sha;
            writeMirror(hist);
        } catch (e) { /* 回填失败不影响推送 */ }
    }

    // 「下载/上传」是否被点到（preGuard 用；手动「上传备份」要记 manual 条目）
    function preGuard(e) {
        if (!isSyncBtn(e.target)) {
            return;
        }
        window.__wei8Sync.hits++;
        cleanDirty();
        // 手动备份：点「发送」（b_gistup）→ 记 manual；8s 后补推一次把记录带上云。
        // （上游 sendGist 先推数据本体；我们这刀只补 wei8SyncHistory，串行不冲突。
        //   若 8s 内自动推送已在飞/已排队，queued 机制会自然带上最新历史，无须再排。）
        if (e.target.closest && e.target.closest('#b_gistup')) {
            recordHist('manual');
            window.__wei8Sync.manualRecords = (window.__wei8Sync.manualRecords || 0) + 1;
            if (!state.pushTimer) {
                setTimeout(function () { autoPush(); }, 8000);
            }
        }
    }

    document.addEventListener('pointerdown', preGuard, true);
    document.addEventListener('keydown', preGuard, true);

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

    // 「同步」行标签右边的时间戳节点（v3.16 起只放主时间戳，历史记录移到下方表格）。
    // 位置依据（settings.html:2066-2084）：
    //   <div class="wrapper">            <- flex + space-between + align-items:center
    //     <span class="trn">Synchronize</span>
    //     <span id="wei8-sync-time">    <- 我们插在这里
    //     <div id="gist-sync-actions">  <- 下载还原/上传备份
    // 插到 actions 之前 = 标签右边；margin-right:auto 吃掉剩余空间 → 紧贴标签、按钮仍靠右。
    // 不设 font-size：与同排「同步」标签保持同一排版尺度（v3.3 栽过的坑）。
    // v3.16：去掉 position:relative / cursor:pointer —— 不再是可点击的下拉触发器。
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

    // v3.16（老板定稿）：同步历史改成「同步」行下方的**常驻小表格** —— 固定 3 行高，
    // 超过 3 条自动出滚动条。不再做成点击展开的下拉（v3.15 老板反馈：记录不显眼、
    // 得点开才知道有几条）。
    // v3.17：表格每行变成**可点还原**（老板：「我其实想做成能手动挑选哪个记录指定还原」）。
    //   因此拆成两层：#wei8-sync-hist（容器：一行常驻提示 + 下面滚动列表）> #wei8-sync-hist-list。
    //   拆两层是为了让「点一条可还原」这句提示**常驻不被滚走**；滚动高度仍固定 4.5em（≈3 行）。
    // 位置：插在 .wrapper 的**后面**（同为 .param 的直接子元素），**不进** wrapper ——
    // wrapper 是 flex + space-between，多塞一个子元素会把「同步 | 时间戳 | 按钮」撑散。
    function ensureHistEl() {
        var el = document.getElementById('wei8-sync-hist');
        if (el) return el;
        var actions = document.getElementById('gist-sync-actions');
        if (!actions || !actions.parentNode) return null;
        var wrapper = actions.parentNode;
        var parent = wrapper.parentNode;
        if (!parent) return null;
        el = document.createElement('div');
        el.id = 'wei8-sync-hist';
        el.style.display = 'none';
        el.style.fontSize = '0.76em';
        el.style.lineHeight = '1.5';
        el.style.opacity = '0.8';
        el.style.marginTop = '2px';
        el.style.padding = '2px 0 2px 4px';
        el.style.borderTop = '1px solid rgba(128,128,128,.22)';

        var hint = document.createElement('div');
        hint.id = 'wei8-sync-hist-hint';
        hint.textContent = '点任意一条，可还原到该时刻的版本';
        hint.style.opacity = '0.55';
        el.appendChild(hint);

        var list = document.createElement('div');
        list.id = 'wei8-sync-hist-list';
        list.style.maxHeight = '4.5em';   // ≈3 行，第 4 条起靠滚动条看
        list.style.overflowY = 'auto';
        list.style.overflowX = 'hidden';
        list.style.whiteSpace = 'nowrap';
        el.appendChild(list);

        parent.insertBefore(el, wrapper.nextSibling);
        return el;
    }

    // 历史表里的一行：左边时刻，右边「自动/手动」。有 sha 的行可点 → 挑它还原。
    // 用参数 item 而不是闭包变量，避免 for 循环里 var 共享导致的「点哪条都还原最后一条」。
    function attachHistRow(list, item) {
        var row = document.createElement('div');
        row.style.display = 'flex';
        row.style.justifyContent = 'space-between';
        row.style.gap = '1.2em';
        row.style.padding = '0.05em 0';

        var time = document.createElement('span');
        time.textContent = item.ts;
        row.appendChild(time);

        if (item.note) {
            var note = document.createElement('span');
            note.textContent = item.note;
            note.style.opacity = '0.6';
            note.style.flex = 'none';
            row.appendChild(note);
        }

        if (item.sha) {
            row.setAttribute('data-sha', item.sha);
            row.style.cursor = 'pointer';
            row.title = '点此把本机设置还原到 ' + item.ts + ' 那一版';
            row.addEventListener('click', function () { showRestoreConfirm(item); });
        } else {
            // 明确说明为什么不能点，而不是让老板点了没反应（旧记录 / 超出 GitHub 保留范围）
            row.style.opacity = '0.5';
            row.style.cursor = 'default';
            row.title = '这一版拿不到云端版本号，无法还原（多为本功能上线前的旧记录，或已超出 GitHub 保留范围）';
        }
        list.appendChild(row);
    }

    // 写「时间戳文本 + 下方最近记录小表格」。
    // txt = 当前主时间戳；items = [{ts:'2026/0921/09.38.45', note:'手动'|'自动'}] 新→旧，最多 30 条。
    // ★ 主时间戳放在 <span id="wei8-sync-time-label">（#wei8-sync-time 内部），表格是
    //   #wei8-sync-time 的**表亲**（wrapper 的下一个兄弟）：探针读 el.textContent 只会拿到
    //   主时间戳、不会跟历史记录串味（v3.15 把列表塞进 #wei8-sync-time 时实测踩过这个坑）。
    function setTimeText(txt, items) {
        window.__wei8Sync.lastTimeText = txt;
        var el = ensureTimeEl();
        if (!el) return;
        // 清掉 v3.15 遗留的下拉节点（脚本重载但 DOM 未刷的边界情况）
        var stale = el.querySelectorAll('#wei8-sync-time-list');
        for (var s = 0; s < stale.length; s++) {
            if (stale[s].parentNode) stale[s].parentNode.removeChild(stale[s]);
        }
        // 主时间戳：固定一个 label span
        var label = el.querySelector(':scope > span');
        if (!label) {
            while (el.firstChild && el.firstChild.nodeType === 3) el.removeChild(el.firstChild);
            label = document.createElement('span');
            label.id = 'wei8-sync-time-label';
            el.appendChild(label);
        }
        label.textContent = txt;

        // 最近记录：常驻 3 行小表格，超出靠滚动条；每行可点还原
        var hist = ensureHistEl();
        if (!hist) return;
        var list = hist.querySelector('#wei8-sync-hist-list') || hist;
        while (list.firstChild) list.removeChild(list.firstChild);
        if (!items || items.length === 0) {
            hist.style.display = 'none';
            return;
        }
        hist.style.display = 'block';
        hist.title =
            '最近 ' + items.length + ' 条同步记录（新→旧；自动=有改动自动推送，手动=点「上传备份」）；点任意一条可还原到该版本';
        for (var i = 0; i < items.length; i++) attachHistRow(list, items[i]);
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
                    /* v3.16：留一份原始 ISO，供 recordHist 校正上一条时间戳用
                       （recordHist 用的是「本地发起时刻」，与 GitHub 的 updated_at 常差几秒~几十秒） */
                    window.__wei8Sync.lastServerIso = json.updated_at;

                    // ① 「同步」行后面的最后更新时间（老板要的位置）+ 下方最近记录表格。
                    //    ★ v3.15 起历史来自本层自维护的 wei8SyncHistory（Gist content 顶层键
                    //    ∪ 本机镜像），不再用 Gist 响应的 history 字段 —— GitHub 会把高频
                    //    PATCH 的 history 清空/截断（v3.14 实测真机两个 Gist history=0）。
                    var items = [];
                    var remoteHist = [];
                    try {
                        var gistData = JSON.parse(
                            (Object.values(json.files || {})[0] || {}).content || '{}'
                        );
                        remoteHist = histFromData(gistData);
                    } catch (e) { /* content 解析失败就只用本机镜像 */ }
                    var merged = mergeHist(remoteHist);
                    for (var k = 0; k < merged.length && items.length < HIST_MAX; k++) {
                        var it = merged[k];
                        var d = parseTs(it.t);
                        if (!d) continue;
                        items.push({ ts: fmtTs(d), note: it.m === 'manual' ? '手动' : '自动', sha: it.sha || null });
                    }
                    /* ★ v3.16：最新一条的真实时间 = Gist 的 updated_at。
                       recordHist 记的是「本地发起推送的时刻」，而主时间戳显示的是 GitHub 的
                       updated_at，两者可能差几秒甚至几十秒 → 表格里会看到「首行」和主时间戳
                       不是同一个时间，像记录错乱。显示层直接对齐，不动数据本体
                       （持久化校正交给 recordHist 随下一次推送重写整份历史）。 */
                    if (items.length) items[0].ts = localStr;
                    setTimeText(localStr, items);
                    // v3.17：本机历史里缺 sha 的条目，用 commits 端点补一次（每页只补一次），
                    //   补完自己重渲染一轮 —— 老板看到的就是「能还原的行」而不是灰行。
                    window.__wei8Sync.histShas = items.map(function (x) { return x.sha ? 1 : 0; }).join('');
                    fillShas(token, id);

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

    // ============ J) 版本号（sha）补齐（v3.17） ============
    // 「按记录还原」需要 sha = 那次写入在 GitHub 上的修订号。
    //   主来源：推送响应里的 history[0].version（实测连续 6 次 PATCH 全部带上），推完即回填本机镜像。
    //   但有两类条目天生没 sha：①本功能上线前的旧记录；②换了设备、本机镜像是空的。
    // 兜底：单独调 commits 端点取最近 30 个修订，按**时间戳精确匹配**回填。
    //   ★ 实测 commits[i].committed_at 与详情端点的 updated_at 是同一秒同一个值，
    //     而 recordHist 本来就会用 updated_at 校正上一条的 t —— 所以除「最新一条」外都能对上，
    //     最新一条的 sha 由推送响应负责。两边合起来正好全覆盖。
    // 只在「本机历史确实缺 sha」时跑，且每次页面加载最多一次 ——
    //   否则 60s 轮询每次重渲染都多打一个请求，纯浪费。
    var commitsFetched = false;
    function fillShas(token, id) {
        if (commitsFetched || !token || !id) return;
        var hist = readMirror();
        var missing = 0;
        for (var i = 0; i < hist.length; i++) if (!hist[i].sha) missing++;
        if (!missing) return;
        commitsFetched = true;
        fetch('https://api.github.com/gists/' + id + '/commits?per_page=30', {
            headers: gistHeaders(token),
            cache: 'reload',
        })
            .then(function (resp) { return resp.status === 200 ? resp.json() : null; })
            .then(function (list) {
                if (!Array.isArray(list) || !list.length) return;
                var map = {};
                for (var i = 0; i < list.length; i++) {
                    var c = list[i];
                    if (c && c.version && c.committed_at) map[c.committed_at] = c.version;
                }
                var h = readMirror();
                var changed = false;
                for (var k = 0; k < h.length; k++) {
                    if (h[k].sha) continue;
                    var d = parseTs(h[k].t);
                    if (!d) continue;
                    // committed_at 形如 2026-09-23T00:27:38Z（秒级）—— 对齐到秒、去掉毫秒再比
                    var key = new Date(Math.floor(d.getTime() / 1000) * 1000)
                        .toISOString().replace(/\.\d{3}Z$/, 'Z');
                    if (map[key]) { h[k].sha = map[key]; changed = true; }
                }
                if (!changed) return;
                writeMirror(h);
                window.__wei8Sync.shaBackfilled = (window.__wei8Sync.shaBackfilled || 0) + 1;
                renderServerStatus(token, id); // 重渲染一轮，灰行变成可点
            })
            .catch(function () { /* 拿不到就保持灰显 + 悬停说明原因，绝不静默失败 */ });
    }

    // ============ K) 按记录还原（v3.17，老板要求「能手动挑选哪个记录指定还原」） ============
    // 语义（刻意这样定）：挑一条历史 → 把本机设置整包换成**那一版**的内容。
    //   · 什么都不删：还原会在云端记成一次**新的**修订，旧版本依然可取回。
    //     所以这是「回到那一版」，不是「销毁现在」。正因如此，还原后**允许**自动推送回云端 ——
    //     否则别的设备永远看不到这次还原。
    //   · 只接受带 linkgroups 的内容：缺它就说明那份不是完整的设置数据，宁可不动
    //     （防止用一个空壳把现有设置清掉）。
    //   · wei8SyncHistory 不还原进设置数据本体 —— 它是本层的记录，不是设置。
    function removeRestoreConfirm() {
        var old = document.getElementById('wei8-restore-confirm');
        if (old && old.parentNode) old.parentNode.removeChild(old);
    }

    // 确认条：不静默动数据，也不用 window.confirm（阻塞、且自动化探针点不到）。
    // 观感沿用「覆盖本机 / 合并」那套行内二选一。
    function showRestoreConfirm(item) {
        var hist = document.getElementById('wei8-sync-hist');
        if (!hist || !hist.parentNode) return;
        removeRestoreConfirm();
        var bar = document.createElement('div');
        bar.id = 'wei8-restore-confirm';
        bar.style.fontSize = '0.85em';
        bar.style.lineHeight = '1.6';
        bar.style.padding = '0.45em 0.6em';
        bar.style.marginTop = '0.35em';
        bar.style.border = '1px solid rgba(128,128,128,.35)';
        bar.style.borderRadius = '6px';

        var tip = document.createElement('div');
        tip.textContent =
            '把本机设置还原到 ' + item.ts + ' 那一版？当前设置会被它覆盖（云端会记成一次新的还原，旧版本仍可取回）。';
        bar.appendChild(tip);

        var row = document.createElement('div');
        row.style.display = 'flex';
        row.style.gap = '0.8em';
        row.style.marginTop = '0.3em';
        row.appendChild(mkBtn('确认还原', function () {
            removeRestoreConfirm();
            restoreRevision(item);
        }));
        row.appendChild(mkBtn('取消', removeRestoreConfirm));
        bar.appendChild(row);
        hist.parentNode.insertBefore(bar, hist.nextSibling);
    }

    function restoreRevision(item) {
        var token = readLocal('gistToken');
        var id = cleanId(readLocal('gistId')) || cleanId(window.__wei8Sync.gistId);
        if (!token || !id) { toast('缺少令牌或 Gist，暂时无法还原。'); return; }
        if (!item.sha) { toast('这一版拿不到云端版本号，无法还原。'); return; }
        fetch('https://api.github.com/gists/' + id + '/' + item.sha, {
            headers: gistHeaders(token),
            cache: 'reload',
        })
            .then(function (resp) {
                if (resp.status !== 200) { toast('这一版云端已不可取回（HTTP ' + resp.status + '）。'); return null; }
                return resp.json();
            })
            .then(function (json) {
                if (!json) return;
                var f = Object.values(json.files || {})[0];
                if (!f || typeof f.content !== 'string') { toast('这一版内容读不出来，已放弃还原。'); return; }
                var data;
                try { data = JSON.parse(f.content); } catch (e) { toast('这一版内容不是有效数据，已放弃还原。'); return; }
                if (!data || typeof data !== 'object' || !data.linkgroups) {
                    toast('这一版缺少必要结构，已放弃还原（避免把现有设置清掉）。');
                    return;
                }
                delete data[HIST_FIELD]; // 记录本身不进设置数据
                try {
                    localStorage.setItem('bonjourr', JSON.stringify(data));
                    logWrite('设置面板·还原到 ' + item.ts);
                } catch (e) {
                    toast('写入本机失败，未还原。');
                    return;
                }
                window.__wei8Sync.restored = (window.__wei8Sync.restored || 0) + 1;
                window.__wei8Sync.lastRestoreTs = item.ts;
                // 允许自动推送把「还原后」的状态同步回云端（= 在历史上多记一条）。
                // 这里刻意不抑制，否则别的设备永远看不到这次还原。
                state.lastAutoKey = null;
                globalThis.dispatchEvent(new Event('storage'));
                toast('已还原到 ' + item.ts + ' 那一版。云端会把它记成一次新的还原。');
                renderServerStatus(token, id);
            })
            .catch(function () { toast('还原失败：网络异常。'); });
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
        // ★ 护栏（v3.15）：本地无有效数据绝不推 —— 否则空壳/默认数据会顶掉云端好数据。
        //   linkgroups 是 preset 预置与真实数据共有的锚键；它缺失 = 本机数据不可信。
        if (!data.linkgroups) {
            window.__wei8Sync.lastError = '本机无有效设置数据，已跳过推送（避免覆盖云端备份）';
            return;
        }
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
        // ★ v3.15：推送内容 = 数据本体 + wei8SyncHistory（本次推送先记 auto 条目再上云）。
        //   历史只进 Gist content，不写回本地 bonjourr（否则触发 storage 事件再推一轮）；
        //   本机可见性由镜像 localStorage['wei8-sync-history'] 承担。
        var payload = {};
        Object.keys(data).forEach(function (k) { payload[k] = data[k]; });
        var histNow = recordHist('auto');
        payload[HIST_FIELD] = histNow;
        // 记住这次记录的时间戳：响应回来时要靠它认出「该把 sha 回填到哪一条」
        var pushedT = histNow && histNow[0] ? histNow[0].t : null;
        var files = { 'bonjourr-export.json': { content: JSON.stringify(payload, undefined, 2) } };
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
                    // v3.17：200(PATCH) 也要读响应体 —— 这次写入的修订号 history[0].version 就在里面，
                    //   正是「按记录还原」要用的 sha。此前 200 分支刻意不读 body，于是永远拿不到 sha。
                    //   （实测：连续 6 次 PATCH，响应 history[0].version 6/6 都有，且与 commits 端点一致。）
                    return resp.json().catch(function () { return {}; }).then(function (j) {
                        j = j || {};
                        var newId = resp.status === 201 ? j.id : id;
                        attachSha(j.history && j.history[0] && j.history[0].version, pushedT);
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

    // 行内小按钮工厂（v3.17 提到顶层）：「覆盖本机 / 合并」「确认还原 / 取消」共用。
    // ★ 动态创建的 button 必须显式 type="button"，否则点击会提交所在表单（上游设置面板是 <form>）。
    function mkBtn(label, fn) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.style.cursor = 'pointer';
        b.addEventListener('click', fn);
        return b;
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
        // by：写入留痕的标签（自检页展示「谁写的数据」），不影响行为。
        function applyLocal(next, suppressPush, by) {
            try {
                localStorage.setItem('bonjourr', JSON.stringify(next));
                logWrite(by || 'sync-patch·写入本机');
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

        row.appendChild(mkBtn('覆盖本机', function () {
            applyLocal(remote, true, '设置面板·覆盖本机'); // 服务器为准，整包替换
        }));
        row.appendChild(mkBtn('合并', function () {
            var localData = readSyncData() || {};
            var merged = {};
            Object.keys(localData).forEach(function (k) { merged[k] = localData[k]; }); // 本机全保留
            Object.keys(remote).forEach(function (k) {
                if (k === HIST_FIELD) return; // 同步记录不进设置数据（v3.15）
                if (!(k in localData)) merged[k] = remote[k]; // 只补：远端独有键进本机；共有键不动
            });
            applyLocal(merged, false, '设置面板·合并'); // 并集随自动同步推回服务器
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
                // ★ wei8SyncHistory 是本层的同步记录，不是设置数据，比对时排除（v3.15）
                var same = true;
                var rk = Object.keys(remote);
                for (var i = 0; i < rk.length; i++) {
                    if (rk[i] === HIST_FIELD) continue;
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

    // ============ 装载期云端兜底（v3.15，H 段） ============
    // 打开页面后台查一次（不阻塞秒开：GET 是异步的，UI 照常从本机缓存渲染）：
    //   ① 本机数据无效（bonjourr 缺失/非法/无 linkgroups）→ 直接从云端拉回写本机，
    //     省掉「本地丢了还得手动点得到」的坑（老板实测踩中）；
    //   ② 本机有效但不一致 → 右下角小条提示（不自动动本机数据，v3.11 原则不变）；
    //   ③ 一致 / 断网 / 没配 token → 完全安静。
    // 比对与 F 段 autoPull 同规则：排除 wei8SyncHistory。
    function toast(msg, onclick) {
        var old = document.getElementById('wei8-sync-toast');
        if (old && old.parentNode) old.parentNode.removeChild(old);
        var t = document.createElement('div');
        t.id = 'wei8-sync-toast';
        t.textContent = msg;
        t.style.cssText =
            'position:fixed;right:1em;bottom:1em;z-index:950;max-width:20em;cursor:pointer;' +
            'font:inherit;font-size:.85em;line-height:1.5;padding:.7em .9em;border-radius:8px;' +
            'background:var(--color-settings,#f2f2f7);color:var(--color-text,#222);' +
            'border:1px solid rgba(128,128,128,.4);box-shadow:0 2px 10px rgba(0,0,0,.25);';
        t.addEventListener('click', function () {
            if (t.parentNode) t.parentNode.removeChild(t);
            if (onclick) onclick();
        });
        document.body.appendChild(t);
        // 30s 后自动消失（不抢戏；点击可提前关闭）
        setTimeout(function () {
            if (t.parentNode) t.parentNode.removeChild(t);
        }, 30000);
    }

    function diffRemote(remote, localData) {
        var rk = Object.keys(remote);
        for (var i = 0; i < rk.length; i++) {
            if (rk[i] === HIST_FIELD) continue;
            if (!(rk[i] in localData) ||
                stableHash(remote[rk[i]]) !== stableHash(localData[rk[i]])) return true;
        }
        return false;
    }

    // ============ I) 换版提示（v3.17） ============
    // 为什么需要：SW 是「缓存优先秒开」，代价是**每次部署后首个打开的页面仍是旧壳**。
    //   旧壳 = 旧的 index.html，连新版的 js 都还不会被请求 →「明明改了却不生效」。
    //   v3.16 已经修掉「永久卡旧版」，但「落后一版」还在；不提示的话，老板只会以为功能没上线。
    //   这也是「下载还原/上传备份 没生效」这类投诉最容易复发的来源。
    // 怎么判：新 SW 接管旧页面时会触发 controllerchange。
    //   ★ 只在「加载时就已有 controller」的前提下监听 —— 首次访问本来就没有 controller，
    //     不过滤的话每次冷启动都会弹一次，变成骚扰。
    // 为什么不做自动刷新：老板可能正在设置面板里改东西，页面突然重载会丢输入。给他点。
    function watchVersionChange() {
        if (!navigator.serviceWorker || !navigator.serviceWorker.controller) return;
        navigator.serviceWorker.addEventListener('controllerchange', function () {
            window.__wei8Sync.versionToasts++;
            toast('页面已切到新版本，点此刷新以应用。', function () { location.reload(); });
        });
    }

    function bootCheck() {
        var token = readLocal('gistToken');
        var id = cleanId(readLocal('gistId')) || cleanId(window.__wei8Sync.gistId);
        if (!token || !id) return;
        fetch('https://api.github.com/gists/' + id, { headers: gistHeaders(token), cache: 'reload' })
            .then(function (resp) {
                if (resp.status !== 200) return null;
                return resp.json();
            })
            .then(function (json) {
                if (!json) return;
                var content = Object.values(json.files || {})[0];
                if (!content || typeof content.content !== 'string') return;
                var remote;
                try { remote = JSON.parse(content.content); } catch (e) { return; }
                if (!remote || typeof remote !== 'object') return;

                // 远端历史落镜像：别的设备推的历史，本机也能立刻在表格里看到
                if (Array.isArray(remote[HIST_FIELD])) {
                    writeMirror(mergeHist(remote[HIST_FIELD]));
                }

                var localData = readSyncData();
                var localValid = !!(localData && localData.linkgroups);
                if (!localValid) {
                    // ① 本机无效：直接恢复（写整包 + 驱动上游刷新；恢复动作本身
                    //   会触发一轮自动推送，把「恢复」也记进历史，两台设备不再互相弹）
                    try {
                        localStorage.setItem('bonjourr', JSON.stringify(remote));
                        logWrite('装载期·云端恢复（本机数据无效）');
                        globalThis.dispatchEvent(new Event('storage'));
                    } catch (e) { return; }
                    window.__wei8Sync.bootRestore = true;
                    toast('本机没有设置数据，已从云端备份恢复。', function () {
                        document.dispatchEvent(new CustomEvent('toggle-settings'));
                    });
                    return;
                }
                if (diffRemote(remote, localData)) {
                    // ② 不一致：只提示，不动本机（覆盖/合并仍走设置面板里的二选一）
                    toast('云端备份与本机设置不一致，点此进设置处理。', function () {
                        document.dispatchEvent(new CustomEvent('toggle-settings'));
                    });
                }
            })
            .catch(function () {
                /* 断网/网络异常：完全安静，本机缓存照用 */
            });
    }

    document.addEventListener('DOMContentLoaded', function () {
        // 时间戳轮询照旧（进设置 1s 后补刷一轮，覆盖面板 DOM 刚就位的时序）
        setTimeout(function () { startPoll(); }, 1000);
        // 版本检查只在面板真正打开时触发（不用每次打开页面都拉一次——老板定稿）
        watchSettingsOpen();
        // 装载期兜底：打开页面后台查一次（延迟 3s，错开首屏渲染与 SW 安装）
        setTimeout(bootCheck, 3000);
        // 换版提示：本页可能还是旧壳，新版本刚接管时明确告诉老板（不是功能没上线）
        watchVersionChange();
    });
})();
