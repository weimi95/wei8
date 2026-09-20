/* lunar-date.js —— 在「阳历日期」前面加一段农历（例：丙午年八月初十 · 9月20日星期日）
 * ---------------------------------------------------------------------------
 * 老板原话：「阳历前面能加上阴历不？比如 丙午年八月初十」
 *   → 目标渲染：`丙午年八月初十 · 9月20日星期日`
 *
 * 【为什么不自己写农历算法，也不复用上游那套】
 *   上游 main.js 里其实**自带**一套农历换算（`convertSolar2Lunar` / `getVnCalendar`），
 *   但它只对越南语生效（`lang === "vi"`），而且渲染在阳历**之后**的
 *   `.clock-date-secondary` 里 —— 位置和要求都不对。
 *   更要命的是它是打包进 main.js 的模块内函数，外部脚本根本拿不到；
 *   硬要复用只能把 100+ 行算法抄一份过来自己维护（历表、闰月、岁差……）。
 *   → 改用浏览器**自带的**农历：`Intl.DateTimeFormat('zh-CN-u-ca-chinese')`。
 *     ICU 提供官方历法数据：干支（yearName）、闰月、大小月全都有，
 *     零维护、任意年份都对，不用我们跟着天文历表更新。实测 Chrome/Edge 直接可用。
 *     Node 侧实测（2026-09-20）：2026丙午年八月10 / 闰月样本 2025乙巳年闰六月1 /
 *     跨年样本 2026-02-16 得 2025乙巳年腊月29 —— 干支跟着**农历年**走，正确。
 *
 * 【唯一要自己补的一块】
 *   ICU 给的「日」是阿拉伯数字（`day: "10"`），中文习惯要「初十」；
 *   月已经是中文（八月 / 正月 / 腊月 / 闰六月），干支是「丙午」。
 *   → 只需一个 1..30 的数字→汉字转换（cnDay）。就这么多。
 *
 * 【插在哪、为什么不会被上游刷掉】
 *   插在 `.clock-date` 的**第一个子节点**（上游自己的 aa/bb/cc 之前）→ 天然排在阳历前面。
 *   上游 clockDate() 只写 aa/bb/cc/secondary 的 textContent，从不碰我们的节点，
 *   所以它能一直留在原地；而且上游只在「首次」和「整点那一分钟」才重绘日期
 *   （clock.ts：`if (isNextHour || firstStart) clockDate(...)`），
 *   根本没有每秒重建 DOM 的行为，不需要去拦截它。
 *
 * 【时区：世界时钟开着时，每一格说的是不同城市的日期】
 *   照抄上游 clocks 数组的构造方式（顶层 `worldclocks` 里筛出有 region 的；一个都没有就用
 *   `clock.timezone`），按 `data-index` 逐格取时区，保证「农历跟它自己那行阳历同一天」。
 *   拿不到设置时退回 `auto`（= 浏览器本地时区），不会抛。
 *
 * 【刻意不做的事（都是本项目栽过的坑）】
 *   ① 不给插入节点设 font-size / opacity —— 那等于在插入点凭空造出一个新的排版尺度，
 *      父级 17px 时它 13.65px，用户一眼就问"这几个字大小怎么跟后面不一样"。
 *      全部跟随 `.clock-date` 原有的 1.5em。
 *   ② 不加 `trn` 类 —— 那是上游 i18n 翻译器的目标类，会被它整段清空。
 *   ③ 不碰上游任何事件流（不 stopImmediatePropagation、不拦 pointerdown）。
 *   ④ Intl 不支持农历时**整个不插入**（页面保持原样），而不是插一个空壳占位。
 *   ⑤ 不引外部库、不联网。整个文件零依赖。
 * ---------------------------------------------------------------------------
 */
(function () {
    'use strict';

    // 幂等：重复注入只生效一次（构建/手动调试都可能碰到）
    if (window.__wei8Lunar) return;

    var CLS = 'wei8-lunar';
    var SEP = ' · ';
    var TICK = 15000; // 农历只在零点变，15s 轮询纯属兜底（成本约几十微秒）
    var MAP_ATTR = 'data-wei8-lunar'; // 挂在 .clock-date 上，标记"这一格已经处理过"

    var state = { applied: 0, unsupported: false, last: null };
    window.__wei8Lunar = state;

    // ---- 1..30 → 汉字日名（唯一需要自己实现的历法相关逻辑）----
    // 规则：1-10 初X；11-19 十X；20 二十；21-29 廿X；30 三十
    function cnDay(n) {
        var unit = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
        if (n <= 10) return '初' + unit[n]; // 初一 .. 初十
        if (n < 20) return '十' + unit[n - 10]; // 十一 .. 十九
        if (n === 20) return '二十';
        if (n < 30) return '廿' + unit[n - 20]; // 廿一 .. 廿九
        return '三十';
    }
    state.cnDay = cnDay;

    // ---- Intl 农历格式化器（按时区缓存）----
    var fmts = {};
    function getFmt(tz) {
        var key = tz || 'auto';
        if (key in fmts) return fmts[key];
        var f = null;
        try {
            var opts = { year: 'numeric', month: 'long', day: 'numeric' };
            if (key !== 'auto') opts.timeZone = key;
            f = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', opts);
            // 自检：拿不到 yearName（干支）的实现在这里就判掉，避免输出"年八月初十"这种半截货
            var parts = f.formatToParts(new Date());
            var got = false;
            for (var i = 0; i < parts.length; i++) {
                if (parts[i].type === 'yearName' && parts[i].value) got = true;
            }
            if (!got) f = null;
        } catch (e) {
            f = null; // 不支持的浏览器 / 非法时区
        }
        fmts[key] = f;
        return f;
    }

    // ---- 取当前农历文本；任何异常都返回 ''（调用方据此决定不插入）----
    function lunarOf(tz, now) {
        var f = getFmt(tz);
        if (!f) return '';
        var parts;
        try {
            parts = f.formatToParts(now || new Date());
        } catch (e) {
            return '';
        }
        var y = '',
            mo = '',
            day = '';
        for (var i = 0; i < parts.length; i++) {
            var t = parts[i].type,
                v = parts[i].value;
            if (t === 'yearName') y = v;
            else if (t === 'month') mo = v;
            else if (t === 'day') day = v;
        }
        var n = parseInt(day, 10);
        if (!y || !mo || !(n >= 1 && n <= 30)) return '';
        return y + '年' + mo + cnDay(n);
    }

    // ---- 读时钟设置，还原上游的时区列表 ----
    // ★ 存储结构（照 SYNC_DEFAULT 核过，别想当然）：
    //     localStorage.bonjourr.clock      = { size, ampm, analog, ..., worldclocks: false, timezone: "auto" }
    //     localStorage.bonjourr.worldclocks = []        ← 世界时钟**列表在顶层**，不是 clock.world
    //   两者同名但类型不同：clock 里那个是开关（bool），顶层那个是数组。
    function tzList() {
        var s = {};
        try {
            s = JSON.parse(localStorage.getItem('bonjourr') || '{}') || {};
        } catch (e) {
            s = {};
        }
        var clock = s.clock || {};
        var out = [];
        var world = s.worldclocks;
        if (clock.worldclocks && Object.prototype.toString.call(world) === '[object Array]') {
            for (var i = 0; i < world.length; i++) {
                // 上游：clocks.push(...world.filter(({ region }) => region))
                if (world[i] && world[i].region) out.push(world[i].timezone || 'auto');
            }
        }
        if (!out.length) out.push(clock.timezone || 'auto');
        return out;
    }

    function indexOfClock(p) {
        var w = p.closest ? p.closest('.clock-wrapper') : null;
        if (!w) return 0;
        var v = parseInt(w.getAttribute('data-index'), 10);
        return v > 0 ? v : 0;
    }

    function ownSpan(p) {
        var kids = p.children;
        for (var i = 0; i < kids.length; i++) {
            if (kids[i].className === CLS) return kids[i];
        }
        return null;
    }

    // ---- 主循环：把农历插到阳历前面 ----
    function apply() {
        var nodes = document.querySelectorAll('.clock-date');
        if (!nodes.length) return;
        var tzs = tzList();
        var now = new Date();
        for (var i = 0; i < nodes.length; i++) {
            var p = nodes[i];
            var idx = indexOfClock(p);
            var tz = tzs[idx] || tzs[0] || 'auto';
            var txt = lunarOf(tz, now);
            var span = ownSpan(p);

            if (!txt) {
                // 浏览器不支持农历 → 撤掉已有节点，页面回到原样
                if (span) span.parentNode.removeChild(span);
                state.unsupported = true;
                continue;
            }
            if (!span) {
                span = document.createElement('span');
                span.className = CLS;
                // ★ 位置：第一个子节点 = 阳历之前
                p.insertBefore(span, p.firstChild);
                state.applied++;
            }
            var want = txt + SEP;
            if (span.textContent !== want) span.textContent = want;
            p.setAttribute(MAP_ATTR, tz);
            state.last = txt;
        }
    }
    state.apply = apply;
    state.lunarOf = lunarOf;

    function boot() {
        apply();
        // 上游是 defer + 异步初始化（等本地化文件），时钟可能在之后才被克隆出来，
        // 这里补两次短延迟复查，之后交给低频轮询。
        setTimeout(apply, 1200);
        setTimeout(apply, 4000);
        setInterval(apply, TICK);
        document.addEventListener('visibilitychange', function () {
            if (!document.hidden) apply();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
