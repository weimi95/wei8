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
 *   E. ★ v3.21 已移除自动同步：不再监听 storage 事件、不再自动推送。
 *      数据只在本机 localStorage；只有点「上传备份」才上云（上游自带 sendGist，
 *      本层在 clickdown 捕获阶段把同步历史注入 bonjourr 一并带上），只有点「刷新」
 *      才去问服务器拉时间戳与历史。理由：自动推送是「删了百度又回来」的元凶之一，
 *      老板定调大道至简 —— 任何不由他主动点触发的云端同步都砍掉。
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
 *   H. ★ v3.21 已移除装载期云端兜底 bootCheck：打开页面不再自动拉云端、本机数据无效时
 *      也不再整包从云端覆盖。代价是本机数据真丢了得手动点「下载还原」，但换来了
 *      「没有任何自动通道能把删掉的链接复活」——这正是老板要的确定性。
 *   I. 换版提示（v3.17）：SW 是「缓存优先秒开」，代价是部署后**首个打开的页面仍是旧壳**，
 *      旧壳连新版 js 都不会请求 → 看着像「改了不生效」。新 SW 接管旧页面时会触发
 *      controllerchange，这时右下角提示「点此刷新」。只在加载时已有 controller 才监听，
 *      首次访问不提示（否则每次冷启动都弹，成骚扰）。不做自动刷新 —— 老板可能在改设置，重载会丢输入。
 *   J. 修订号（sha）补齐（v3.17）：「按记录还原」要 sha，主来源是推送响应里的
 *      history[0].version（推完即回填本机镜像）；旧记录/换设备丢掉的，用 commits 端点
 *      按时间戳精确匹配补一次（每次页面加载最多一次）。
 *      ★ v3.20 补第二来源：GET /gists/{id} 响应里的 history[0].version 就是「当前这一版」的
 *      修订号，用它给**最新一行**补 sha。原来只有推送响应一个来源 → v3.17 之前攒下的记录、
 *      换设备后空镜像的记录全是灰行，整张表点不出任何东西（老板报的「点记录没反应」）。
 *   K. 按记录还原（v3.17，老板要求）：历史表每行可点 → 确认 → GET /gists/{id}/{sha}
 *      取回那一版 → 整包写入本机。**什么都不删**：云端会把它记成一次新的修订，
 *      所以是「回到那一版」而不是「销毁现在」。缺 linkgroups 的内容直接拒绝，宁可不动。
 *      ★ v3.20：灰行（拿不到版本号）也做成可点 —— 点了给一条 #wei8-restore-note 解释
 *      「为什么不能还原 + 怎么才能有能还原的记录」。原写法是点了什么都不发生，
 *      老板的感受只能是「这功能坏了」，而不是「这条记录不可还原」。
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
            '同步是手动的：改完点「上传备份」才上云；点「刷新」拉取服务器时间戳与历史记录。',
            '首次使用点「上传备份」会在你的 GitHub 自动建一个私有 Gist（不用自己去建）。',
            'Token 需勾选 Gists 写权限：Account permissions → Gists → Read and write（classic token 则勾 gist）。',
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
    //   v3.21 起本层不再监听该事件（不自动推送），只在老板主动点「上传备份」时借上游上传带上历史。
    //
    // 令牌校验：上游 isGistTokenValid 打 `GET /gists?since=...`，该端点
    //   allows_permissionless_access=true（细粒度 token 无 Gists 权限也 200），
    //   会误判通过。这里改为直接试 `GET /gists/{id}`，200/403/401 各归各：
    //     200 -> 令牌可读（有效）
    //     401 -> 令牌无效
    //     403 -> 令牌有效但缺 Gists 写权限（自动推送会 403，降级手动）
    // -----------------------------------------------------------------------

    // v3.21：state 不再需要推送调度字段（已无自动推送/轮询/排队），保留最小结构。
    var state = {};

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

    // 「下载/上传」是否被点到（preGuard，捕获阶段，先于上游 handler）：
    //   v3.21 手动模式 —— 不再有任何自动推送。点「上传备份」（b_gistup）时做两件事：
    //   ① 记一条 manual 历史到本地镜像；② 把历史注入 bonjourr 的顶层键 wei8SyncHistory，
    //   让上游自带的 sendGist 在它那次上传里把历史一并带上云。
    //   注入安全：v3.21 已无自动推送监听，注入不会触发「写→storage 事件→再推」的二次回路；
    //   上游 verifyDataAsSync 会忽略未知顶层键，不影响解析。
    function preGuard(e) {
        if (!isSyncBtn(e.target)) {
            return;
        }
        window.__wei8Sync.hits++;
        cleanDirty();
        if (e.target.closest && e.target.closest('#b_gistup')) {
            recordHist('manual');
            window.__wei8Sync.manualRecords = (window.__wei8Sync.manualRecords || 0) + 1;
            try {
                var d = readSyncData();
                if (d) {
                    d[HIST_FIELD] = readMirror();
                    localStorage.setItem('bonjourr', JSON.stringify(d));
                }
            } catch (e2) { /* 注入失败不影响上传本身 */ }
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
    //   拆两层是为了让「点一条可还原」这句提示**常驻不被滚走**；滚动高度固定 16em（≈10 行，v3.22 加高）。
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
        hint.textContent = '点亮着的那几条可以点，点了会问你要不要还原；灰的（写着「不可还原」）是拿不到云端版本号的旧记录 —— 点它也会告诉你怎么回事';
        hint.style.opacity = '0.55';
        el.appendChild(hint);

        var list = document.createElement('div');
        list.id = 'wei8-sync-hist-list';
        list.style.maxHeight = '16em';   // ≈10 行（v3.22：老板嫌 6 行还小，加高；第 11 条起靠滚动条看）
        list.style.overflowY = 'auto';
        list.style.overflowX = 'hidden';
        list.style.whiteSpace = 'nowrap';
        el.appendChild(list);

        parent.insertBefore(el, wrapper.nextSibling);
        return el;
    }

    // v3.20：把 GET /gists/{id} 响应里的 history[0].version（= 当前修订号）补到**最新那一行**。
    //   为什么原来没有、为什么必须补：sha 的唯一来源一直是「推送响应」，所以
    //     ① v3.17 之前攒下的记录：云端那份 wei8SyncHistory 里没有 sha 字段，镜像里也没有；
    //     ② 换设备：镜像空，靠 commits 端点补，但超出 30 个修订的配不上，且那次请求可能早就打过了
    //        （commitsFetched 是一次性闩），闩上之后新出现的缺 sha 条目再也没人管；
    //     ③ 老板刚好在一段时间里只「下载还原」不推送。
    //   这些情况下整张表都是灰行 —— 老板的原话「点下面的记录也没弹出来问我要不要还原」，
    //   有很大一部分就是这么来的（灰行当时**没有**点击反馈，点了确实什么都不发生）。
    //   GET 响应的 history 字段被上游截断过（不能当历史列表用，见 renderServerStatus 的注释），
    //   但 history[0].version 仍然是「当前这一版」的确定修订号 —— 拿它给最新一行补 sha 无损。
    //
    // ★ 只认 hist[0]（最新那条），不往后扫：
    //   当前修订号只对「刚刚那一次写入」有意义。往后扫会把同一个修订号也发给更旧的条目 ——
    //   老板点那条旧记录，还原回来的却是**最新**那一版，等于骗他。
    //   ±10 分钟窗口（与 recordHist 校正时间同源）则挡住「最新一条其实是很久以前的记录」的情况。
    function attachNewestSha(iso, sha) {
        if (!sha || !iso) return;
        var ms = Date.parse(iso);
        if (isNaN(ms)) return;
        try {
            var hist = readMirror();
            if (!hist.length || !hist[0]) return;
            if (hist[0].sha) return;                    // 已有 sha（推送响应给的更精确）就不动
            var d = parseTs(hist[0].t);
            if (!d) return;
            if (Math.abs(d.getTime() - ms) > 10 * 60 * 1000) return;
            hist[0].sha = sha;
            writeMirror(hist);
            window.__wei8Sync.shaFromGist = (window.__wei8Sync.shaFromGist || 0) + 1;
        } catch (e) { /* 补不上就维持灰显，绝不静默失败：灰行现在点了会给解释 */ }
    }

    // 历史表里的一行：左边时刻，右边「自动/手动」。有 sha 的行可点 → 挑它还原。
    // 用参数 item 而不是闭包变量，避免 for 循环里 var 共享导致的「点哪条都还原最后一条」。
    function attachHistRow(list, item) {
        var row = document.createElement('div');
        row.style.display = 'flex';
        row.style.justifyContent = 'space-between';
        row.style.gap = '1.2em';
        row.style.padding = '0.05em 0';
        row.style.userSelect = 'none';       // v3.20：可点的行别在双击时顺手选中文字

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
            row.setAttribute('data-restorable', '1');
            row.style.cursor = 'pointer';
            row.title = '点此把本机设置还原到 ' + item.ts + ' 那一版';
            row.addEventListener('click', function () { showRestoreConfirm(item); });
        } else {
            // v3.18：光靠悬停提示不够 —— 老板的反馈是「选中了某个记录，但根本没有还原的选项」。
            //   必须在行上**看得见**地写出为什么不能点，而不是让他以为功能没上线。
            // ★ v3.20：灰行也做成可点，点了**给一句解释**（#wei8-restore-note）。
            //   原来的写法是「灰行点了什么都不发生」—— 老板点完的感受就是「这功能坏了」，
            //   而不是「这条记录不可还原」。一个点不出任何反馈的点击目标 = 静默失败。
            row.setAttribute('data-restorable', '0');
            row.style.opacity = '0.5';
            row.style.cursor = 'pointer';
            row.title = '这一版拿不到云端版本号，无法还原（多为本功能上线前的旧记录，或已超出 GitHub 保留范围）—— 点一下会告诉你怎么办';
            row.addEventListener('click', function () { showNoRestoreNote(item); });
            var no = document.createElement('span');
            no.textContent = '不可还原';
            no.style.flex = 'none';
            no.style.opacity = '0.9';
            no.style.fontSize = '0.85em';
            row.appendChild(no);
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
        if (!items || items.length === 0) {
            /* v3.20：items 为空**不等于**「没有记录」。
               idle() 那三条分支（等认证 / 没数据 / 读失败，含 60 秒轮询里偶发的 403 限流）
               都是不带 items 调过来的；旧写法在这里无条件 display:none，于是老板正看着的
               记录表会在一次瞬时错误后被抹掉 —— 记录还在不在、点了有没有反应都无从谈起。
               这些行本来就是本机镜像里的历史，与本次请求成不成功无关，所以：已经渲染过就留着。 */
            if (!list.children.length) hist.style.display = 'none';
            return;
        }
        while (list.firstChild) list.removeChild(list.firstChild);   // 重渲染前清空（只在真有 items 时）
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

                    /* v3.20：先用响应里的当前修订号给最新一行补 sha，**再**渲染 ——
                       顺序不能反：反了这一轮渲染出来的最新一行仍是灰的，得等下一轮才亮，
                       老板点下去依然没反应（这类「差一轮」的 bug 只在真机上表现为「功能坏了」）。 */
                    attachNewestSha(json.updated_at,
                        json.history && json.history[0] && json.history[0].version);

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

    // ============ J) 版本号（sha）补齐（v3.17 起；v3.18 把兜底匹配从「秒级相等」改成「容忍窗口 + 一对一」） ============
    // 「按记录还原」需要 sha = 那次写入在 GitHub 上的修订号。
    //   主来源：推送响应里的 history[0].version（实测连续 6 次 PATCH 全部带上），推完即回填本机镜像。
    //   但有两类条目天生没 sha：①本功能上线前的旧记录；②换了设备、本机镜像是空的。
    // 兜底：单独调 commits 端点取最近 30 个修订，按**容忍窗口（±5 分钟）+ 一对一**回填。
    //   v3.17 曾按「秒级完全相等」匹配，实机证明太严：recordHist 记的是本机发起时刻，
    //   校正成 GitHub 的 updated_at 要等下一次推送，所以旧记录永远配不上 → 全是灰行。
    //   反过来「最新一条」的 sha 由推送响应负责，两边合起来正好全覆盖。
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
                /* v3.18：改「容忍窗口 + 一对一」匹配。
                   老写法要求「本机记录的时刻」与 committed_at **秒级完全相等**，实际几乎对不上：
                   recordHist 记的是**本机发起推送的时刻**，而把 t 校正成 GitHub 的 updated_at
                   只发生在**下一次**推送时（见 recordHist 的 lastServerIso 那段）。
                   于是老板手里那些 v3.17 之前的旧记录永远是灰行 —— 他能"选中"却没有还原入口。
                   现在给 ±5 分钟窗口，按最近的未占用修订配对（一对一，不会两条记录抢同一个 sha）。 */
                var pool = [];
                for (var i = 0; i < list.length; i++) {
                    var c = list[i];
                    if (!c || !c.version || !c.committed_at) continue;
                    var ms = Date.parse(c.committed_at);
                    if (isNaN(ms)) continue;
                    pool.push({ ms: ms, sha: c.version, used: false });
                }
                if (!pool.length) return;
                var h = readMirror();
                var changed = false;
                var TOL = 5 * 60 * 1000;
                for (var k = 0; k < h.length; k++) {
                    if (h[k].sha) continue;
                    var d = parseTs(h[k].t);
                    if (!d) continue;
                    var t = d.getTime();
                    var best = -1;
                    var bestDiff = TOL + 1;
                    for (var q = 0; q < pool.length; q++) {
                        if (pool[q].used) continue;
                        var diff = Math.abs(pool[q].ms - t);
                        if (diff > TOL || diff >= bestDiff) continue;
                        best = q;
                        bestDiff = diff;
                    }
                    if (best > -1) {
                        h[k].sha = pool[best].sha;
                        pool[best].used = true;
                        changed = true;
                    }
                }
                if (!changed) return;
                writeMirror(h);
                window.__wei8Sync.shaBackfilled = (window.__wei8Sync.shaBackfilled || 0) + 1;
                window.__wei8Sync.shaBackfillTol = TOL;
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
        var old2 = document.getElementById('wei8-restore-note');
        if (old2 && old2.parentNode) old2.parentNode.removeChild(old2);
    }

    // v3.20：所有插在记录表下面的小条的公共外壳 —— 统一「贴一条竖线 + 轻底色 + 自动滚进视野」。
    //   为什么要统一外壳：老板点完看不到东西，一半是「条生成了但在可视区外/不够显眼」。
    //   只把它生成出来（探针断言的那种）不足以说明人看得见，所以外观也进实现。
    function mkNoteBar(id) {
        var hist = document.getElementById('wei8-sync-hist');
        if (!hist || !hist.parentNode) return null;
        removeRestoreConfirm();
        var bar = document.createElement('div');
        bar.id = id;
        bar.style.fontSize = '0.85em';
        bar.style.lineHeight = '1.6';
        bar.style.padding = '0.45em 0.6em';
        bar.style.marginTop = '0.35em';
        bar.style.border = '1px solid rgba(128,128,128,.35)';
        // 分开写三个分量：写成 borderLeft 简写时，值里带 var() 会被 CSSOM 判为无效而整条丢弃
        //（实测 bar.style.borderLeftWidth 读回来是空串）——竖线就白加了。
        bar.style.borderLeftWidth = '3px';
        bar.style.borderLeftStyle = 'solid';
        bar.style.borderLeftColor = 'rgb(var(--accent-color, 41 144 255))';
        bar.style.borderRadius = '6px';
        bar.style.background = 'rgba(128,128,128,.10)';
        hist.parentNode.insertBefore(bar, hist.nextSibling);
        // 插完立刻把它滚到**视野中间** —— 「生成了但在屏幕外」和「没生成」对老板是一回事。
        // 用 center 而不是 nearest：nearest 在「小条正好是面板内容的最后一块」时只会把它贴到
        // 下边缘（实测 getBoundingClientRect().top 落在 899 / 视口 900），仍然看不全。
        try { bar.scrollIntoView({ block: 'center' }); } catch (e) { /* 老浏览器不支持就跳过 */ }
        return bar;
    }

    // v3.20：灰行（拿不到云端版本号）点了给一句人话，而不是什么都不发生。
    //   能做的两件事都写清楚：① 去点「上传备份」，新记录就带版本号；
    //   ② 超出 GitHub 保留范围的旧版本来就取不回来，这不是页面的问题。
    function showNoRestoreNote(item) {
        var bar = mkNoteBar('wei8-restore-note');
        if (!bar) return;
        var tip = document.createElement('div');
        tip.textContent = '这条记录（' + item.ts + '）拿不到云端版本号，所以没法还原 —— '
            + '它不是坏了：多为「按记录还原」这个功能上线之前留下的旧记录，或者已经超出 GitHub 的保留范围。'
            + '点一次上面的「上传备份」，从这一条往后的记录就都能还原了。';
        bar.appendChild(tip);
        var row = document.createElement('div');
        row.style.display = 'flex';
        row.style.gap = '0.8em';
        row.style.marginTop = '0.3em';
        row.appendChild(mkBtn('知道了', removeRestoreConfirm));
        bar.appendChild(row);
    }

    // 确认条：不静默动数据，也不用 window.confirm（阻塞、且自动化探针点不到）。
    // 观感沿用「覆盖本机 / 合并」那套行内二选一。
    function showRestoreConfirm(item) {
        var bar = mkNoteBar('wei8-restore-confirm');
        if (!bar) return;

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

    // ============ v3.21 手动刷新（取代原自动推送 / 60s 轮询 / 装载期兜底） ============
    // 仅有的「主动问服务器」入口：点「刷新」按钮。无自动推送、无轮询、无装载期拉取，
    // 页面打开不碰服务器，数据只在本机。渲染逻辑全部复用 renderServerStatus。
    function refreshSync() {
        var token = readLocal('gistToken');
        var id = cleanId(readLocal('gistId')) || cleanId(window.__wei8Sync.gistId);
        renderServerStatus(token, id); // 无 token 时 renderServerStatus 自己显示「未配置令牌」
    }

    // 「刷新」按钮：放进同步区块的按钮组（下载还原 / 上传备份 旁），常驻可见。
    // 点它 = 主动问一次服务器，把时间戳主行 + 历史列表渲染出来（默认两者都隐藏）。
    function addRefreshButton() {
        var actions = document.getElementById('gist-sync-actions');
        if (!actions || document.getElementById('b_sync_refresh')) return;
        var btn = document.createElement('button');
        btn.id = 'b_sync_refresh';
        btn.className = 'param-btn';
        btn.type = 'button';
        btn.textContent = '刷新';
        btn.addEventListener('click', refreshSync);
        actions.appendChild(btn);
    }

    // ============ v3.21：进设置自动比对（覆盖/合并弹窗）已移除 ============
    // 大道至简：不再自动 GET 服务器、不再弹「覆盖本机 / 合并」二选一。只有点「刷新」才拉一次，
    // 且只展示时间戳与历史，绝不静默覆盖本机数据。mkBtn / removeSyncPrompt 保留给 K 段「按记录还原」。

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

    // ============ v3.21：showSyncPrompt / autoPull / watchSettingsOpen 已移除（大道至简） ============

    // ============ v3.21：装载期云端兜底 bootCheck / diffRemote 已移除（大道至简） ============
    // 不再打开页面就查服务器、不再自动恢复/比对。只有点「刷新」才拉一次且仅展示。
    // toast 保留：watchVersionChange（换版提示）与「按记录还原」仍会用到。
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

    document.addEventListener('DOMContentLoaded', function () {
        // v3.21 大道至简：打开页面不碰服务器、不轮询、不自动恢复。
        // 仅保留手动入口：①「刷新」按钮（主动问一次服务器，展示时间戳与历史）
        //   ② watchVersionChange 换版提示（SW 缓存优先导致落后一版的已知坑）
        addRefreshButton();
        watchVersionChange();
    });
})();
