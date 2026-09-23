// write-guard.js —— 数据本体「完整写入台账」（v3.18）
//
// 为什么需要它：v3.17 只在「我们自己的层」里埋了 logWrite（preset / sync-patch / weather-patch）。
// 于是自检页那张表有个致命盲区 —— **上游 main.js 写 localStorage['bonjourr'] 时一个字都不记**。
// 老板报「删了百度，刷新又回来」「每次打开变回默认」时，如果动手的是上游，那张表永远看不见，
// 我们就只能在代码里瞎猜。本层把盲区补上：拦截 Storage.prototype.setItem / removeItem，
// 凡是动「bonjourr」这个键的，一律留痕。
//
// 归属判定用**调用栈**（new Error().stack 里会出现发起写入的脚本 URL）：
//   · 栈里出现我们自己某个层的文件名 → 跳过。那些层已经用自己的 logWrite 记了带语义的标签，
//     再记一条就是重复记账，表格会变噪音。
//   · 否则 → 记成「上游/未知写入」，并附上「键数 120→119、少了 links0001w8」这类**可判读的摘要**。
// 这样老板下次说「百度又回来了」，表格里会直接写出「谁写的、加了哪几个键」，不用再猜。
//
// 铁律（与全站一致）：
//   · 只用 origSet/origRemove 转调，绝不改变行为 —— 本层是观测者，不是改造者。
//   · 任何异常都必须被吞掉：留痕失败绝不能让页面写不进数据。
//   · 不写 bonjourr（因此不进构建脚本里的 BONJOURR_WRITERS 台账）。
(function () {
    'use strict';

    var TARGET = 'bonjourr';
    var LOGKEY = 'wei8-writes';
    var MAX = 10;
    // 我们自己的层：这些文件的写入由各自的 logWrite 负责，本层不重复记。
    // ★ 前缀必须是「行首 / 斜杠 / 反斜杠 / 空白」四选一 —— 只写 [\/\\] 是不够的：
    //   Chrome 里带完整 URL 的帧是 `at https://…/sync-patch.js?v=11:1:14`（斜杠，能认），
    //   而 Node/vm 与某些 sourcemap 场景下是 `at sync-patch.js:1:14`（**前面是空格**）。
    //   少认一种形态不会报错，只会静默把本层的写入当成「上游写入」重复记账 —— 正是最难发现的那类错。
    //   （这条是 verify 里真跑 vm 测出来的，不是读代码看出来的。）
    var OURS = /(?:^|[\/\\\s])(preset|sync-patch|weather-patch|settings-lock|lunar-date|city-codes|search-ext|quotes-link|weather-settings|weather-loc)\.js/;

    function parse(s) {
        if (typeof s !== 'string') return null;
        try { return JSON.parse(s); } catch (e) { return 'BAD'; }
    }

    // 把「写入前 / 写入后」压成一句可判读的摘要。刻意只记条数与键名差异，不记内容
    // （设置数据里有老板自己的东西，留痕表只陈述「变了什么结构」）。
    function summarize(before, after) {
        var b = parse(before);
        var a = parse(after);
        var out = {};
        function keys(o) { return o && typeof o === 'object' && !Array.isArray(o) ? Object.keys(o) : null; }
        var bk = keys(b);
        var ak = keys(a);
        if (b === 'BAD') out.beforeState = '写入前的内容不是合法 JSON（已损坏）';
        out.beforeKeys = bk ? bk.length : null;
        out.afterKeys = ak ? ak.length : null;
        if (bk && ak) {
            var added = ak.filter(function (k) { return bk.indexOf(k) === -1; });
            var gone = bk.filter(function (k) { return ak.indexOf(k) === -1; });
            out.added = added.length;
            out.removed = gone.length;
            var pl = added.filter(function (k) { return /^links\d{4}w8$/.test(k); });
            if (pl.length) {
                out.presetLinksAdded = pl.length;
                out.sample = pl.slice(0, 3).join(',') + (pl.length > 3 ? '…' : '');
            }
            var cn = (bk.indexOf('linkgroups') > -1 ? 1 : 0) + (ak.indexOf('linkgroups') > -1 ? 1 : 0);
            if (cn === 2 && gone.length === 0 && pl.length === 0) {
                // linkgroups 在两份里都在、也没增删键 → 可能只是内容被换（分组被重排/改名）
                out.note = '键集合不变，可能是内容被整包替换';
            }
            if (gone.length && gone.length <= 3) out.removedSample = gone.join(',');
        }
        return out;
    }

    function logRaw(by, before, after) {
        try {
            var L = JSON.parse(localStorage.getItem(LOGKEY) || '[]');
            if (!Array.isArray(L)) L = [];
            L.unshift({ at: new Date().toISOString(), by: by, d: summarize(before, after) });
            localStorage.setItem(LOGKEY, JSON.stringify(L.slice(0, MAX)));
        } catch (e) { /* 留痕失败不影响页面 */ }
    }

    function fromOurLayer() {
        try {
            var st = new Error().stack || '';
            return OURS.test(st);
        } catch (e) { return false; }
    }

    try {
        if (typeof Storage === 'undefined' || !Storage.prototype) return;
        var proto = Storage.prototype;
        var origSet = proto.setItem;
        var origRemove = proto.removeItem;
        if (typeof origSet !== 'function' || typeof origRemove !== 'function') return;

        proto.setItem = function (key, value) {
            if (String(key) === TARGET && !fromOurLayer()) {
                var before = null;
                try { before = origSet === null ? null : this.getItem(key); } catch (e) { before = null; }
                try { logRaw('上游/未知写入', before, value); } catch (e) {}
            }
            return origSet.call(this, key, value);
        };

        proto.removeItem = function (key) {
            // 删「数据本体」是全站禁止的动作（构建台账闸门也拦），真发生必须留下铁证
            if (String(key) === TARGET) {
                try { logRaw('★★ 有东西删掉了数据本体 bonjourr', '{}', 'null'); } catch (e) {}
            }
            return origRemove.call(this, key);
        };
    } catch (e) { /* 拦截失败就退化成 v3.17 的行为，不影响功能 */ }
})();
