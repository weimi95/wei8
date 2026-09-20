/* weather-loc.js
 * ---------------------------------------------------------------------------
 * 给天气块补两样上游没有的东西：
 *   1) 在天气描述行前面显示**当前城市名**（上游整份 index.html 里根本没有城市节点）；
 *   2) 让点击天气块跳到**该城市**的天气预报页，而不是中国天气网门户首页。
 *
 * 【为什么点击跳转要在这一层做，不能靠设置】
 *   display.ts:114-133 的 handleMoreInfo() 决定 <a id="weather"> 的 href：
 *     - moreinfo='accu' -> 用响应里的 link
 *     - 其余 -> 查一张写死的表；'custom' 时用 data.provider
 *   而设置里的 provider 是**静态字符串**，天生带不了「当前城市」这种运行时信息。
 *   过去正是靠 provider='https://www.weather.com.cn/' 跳门户首页 —— 老板要改的就是它。
 *   所以这里在 displayWeather() 跑完之后把 href 覆写成带城市的地址。
 *   观察器里做了「值不同才写」的守卫，避免自己触发自己形成死循环。
 *
 * 【数据从哪来】
 *   只读 weather-patch.js 成功时落盘的 localStorage['wei8-weather-last']：
 *     geo.city  —— 中文地名（由 weather-patch.js 解析出来）
 *     meta.url  —— 该城市天气页地址（天气网城市页 / 百度兜底）
 *   不碰上游任何内部状态，也不重复实现定位逻辑。
 *
 * 【为什么不是加在 #description 外面】
 *   #weather 是 display:block，把地名放在 #description 之前会让它单独占一行。
 *   放进 #description 作为首个子节点，才能读到「泉州 · 毛毛雨。现在气温 32°C。」这种一行。
 *   代价：设置里若关掉「天气描述」，地名会跟着一起隐藏 —— 语义上也算一致。
 * ---------------------------------------------------------------------------
 */
(function () {
    'use strict';

    var LAST_KEY = 'wei8-weather-last';
    var LABEL_ID = 'wei8-city';
    var SEPARATOR = ' ·';
    var pending = null;

    function log() {
        try {
            if (localStorage.getItem('wei8-weather-debug') === '1') {
                console.log.apply(console, ['[wei8-weather-loc]'].concat([].slice.call(arguments)));
            }
        } catch (e) { /* ignore */ }
    }

    function readLast() {
        try {
            var raw = localStorage.getItem(LAST_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            return null;
        }
    }

    // 设置里选「不显示详情」时不该有链接，这里尊重用户选择
    function moreInfoEnabled() {
        try {
            var d = JSON.parse(localStorage.getItem('bonjourr') || '{}');
            var m = d && d.weather ? d.weather.moreinfo : '';
            return !!m && m !== 'none';
        } catch (e) {
            return true;
        }
    }

    function apply() {
        var d = readLast();
        if (!d) return;

        var city = d.geo && d.geo.city ? String(d.geo.city).trim() : '';
        var url = d.meta && d.meta.url ? String(d.meta.url).trim() : '';
        var link = document.getElementById('weather');
        var desc = document.getElementById('description');
        if (!link || !desc) return;

        // ---- 1) 城市名 ----
        if (city) {
            var el = document.getElementById(LABEL_ID);
            if (!el) {
                el = document.createElement('span');
                el.id = LABEL_ID;
                // 内联样式：只是一个新节点，不值得再开一个样式表 + 版本号
                el.style.fontSize = '0.8em';
                el.style.opacity = '0.8';
                el.style.whiteSpace = 'nowrap';
                el.style.letterSpacing = '0.02em';
                desc.insertBefore(el, desc.firstChild);
                log('已插入地名节点，值为 ' + city);
            }
            var want = city + SEPARATOR;
            if (el.textContent !== want) el.textContent = want;
        }

        // ---- 2) 跳转地址 ----
        if (url && moreInfoEnabled() && link.getAttribute('href') !== url) {
            link.setAttribute('href', url);
            log('跳转地址 -> ' + url);
        }
    }

    function schedule() {
        if (pending) return;
        pending = setTimeout(function () {
            pending = null;
            apply();
        }, 60);
    }

    function start() {
        if (!document.getElementById('weather')) {
            // #main 还没建出来（理论上 defer 时 DOM 已就绪，这里只是兜底）
            document.addEventListener('DOMContentLoaded', start, { once: true });
            return;
        }
        apply();

        // displayWeather() 会在拿到响应后重写 #description 与 #weather[href]，
        // 所以挂观察器跟着它走，而不是只跑一次。
        var main = document.getElementById('main') || document.body;
        new MutationObserver(schedule).observe(main, {
            subtree: true,
            childList: true,
            characterData: true,
            attributes: true,
            attributeFilter: ['href', 'class'],
        });
        log('已挂上变更观察器');
    }

    // 运行时标记：给自动化校验一个可断言的证据点
    window.__wei8WeatherLoc = { apply: apply, get lastKey() { return LAST_KEY; } };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();
