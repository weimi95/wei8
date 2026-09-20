/* weather-patch.js
 * ---------------------------------------------------------------------------
 * 由 build_bonjourr.js 复制到产物根，并在 index.html 中于 preset.js 之后、
 * main.js 之前以 <script defer> 注入（顺序即执行顺序，保证在任何天气请求前完成劫持）。
 *
 * 【为什么需要它】
 * Bonjourr 的天气取数走 https://weather.bonjourr.fr/ ，该服务端靠抓取（scraping）
 * 第三方天气网页取数据。实测（2026-09-20）三个 provider 全部失效：
 *   - auto        -> 200 + content-length: 0（空 body，无回退）
 *   - accuweather -> 503  No node found with class="header-loc"
 *   - foreca      -> 503  No node found with class="value temp temp_c"
 * 而其前端 request.ts 拿到空 body 直接 response.json() 且全程无 try/catch，
 * 结果是天气组件整个消失（连缓存都不显示）。
 * 且 request.ts:46 里 provider 参数是硬编码的 'auto'，改配置无用。
 * 另外设置里的「Custom provider」只是 <a href> 跳转地址（display.ts:128-132），
 * 与数据源无关。
 *
 * 【本文件做什么】
 * 劫持 window.fetch，命中 https://weather.bonjourr.fr/ 的请求就改写为直连
 * 可用的天气 API（open-meteo 默认 / 和风天气可选），并把响应转换成 Bonjourr
 * 前端期望的结构。零上游源码改动，删掉本文件即可完全回滚。
 *
 * 【配置】localStorage['wei8-weather'] = {"p":"openmeteo"|"qweather","key":"...","host":"..."}
 *   切换入口在 Bonjourr 自带设置面板 → Weather & Greetings → 「天气数据源」
 *   （由同目录的 weather-settings.js 注入，含连通性自测；不再有独立的配置页）。
 *
 * 【v2 修复 2026-09-20】两处真实缺陷，均由无头浏览器 CDP 探针（probe_live.js）定位：
 *   1) 取 URL 用 `input.url`，而 URL 实例上是 `href` -> url 恒为空串 -> 劫持从未生效。
 *      改为 urlOf()，覆盖 string / URL / Request 三种入参形态。
 *   2) query 参数是双重编码，必须再 decodeURIComponent 一次，否则城市名变脏值。
 *   历史教训：此前"实测通过"都是拿字符串 URL 手测的，字符串分支一直正常，
 *   所以缺陷被完整掩盖。拦截层一定要用**真实调用方的入参形态**验证。
 *
 * 【v3 2026-09-20】不再写死城市，改为按当前定位：
 *   - 老板要求「显示当前城市名 + 点击跳到该城市天气预报」。写死泉州是错的。
 *   - 定位方式（用 URL 上带什么来判断，因为改写层只能看到 URL）：
 *       URL 带 lat/lon  -> geolocation=precise，坐标用浏览器 GPS
 *       URL 带 query    -> geolocation=off，用户在设置里手填的城市（走内置坐标表）
 *       两者都没有      -> geolocation=approximate，由本文件自己做 IP 定位
 *   - 顺带把 meta.url 从「中国天气网门户首页」改成**该城市**的天气页：
 *       meta.url 是 Bonjourr 唯一会带进点击跳转的字段（display.ts:114-133 的 link），
 *       它的值由这里按城市算出来，城市页编码表见 city-codes.js（离线生成 + 逐条标题复验）。
 *       表里没有的城市回落百度搜索 —— 宁可能用，不要跳到错误的城市页。
 *   - 一次性迁移：预置里是 geolocation='off' + city='泉州'，这样 request.ts 只会发 query，
 *     改写层永远拿不到"当前定位"。所以下面把它切到 'approximate'。
 *     为什么不直接改 preset：preset.js 是整份重写 localStorage.bonjourr，
 *     递增 PRESET_VER 会把老板在设置里调好的东西（关掉的问候语、背景、书签顺序）全冲掉。
 *     故做定点迁移：只在"还完全没被用户动过"时改这一个字段，独立标记保证只跑一次。
 *
 * 【v3.1 2026-09-20】定位做成「双源链」，因为 ipwho.is 会限流
 *   实测（真实浏览器 + 本机 IP）：ipwho.is 稳定返回
 *     {"success":false,"message":"Rate limit exceeded"}（HTTP 429），
 *   等待 90 秒后依旧 429 —— 说明窗口是分钟级以上，不是瞬时抖动。
 *   而它是唯一「一次往返同时给出中文名 + 坐标」的免费接口，能力仍然最合适，
 *   所以不废弃，只是把它降级为**快路径**，另立一条不依赖它的降级链：
 *     A 快路径 ipwho.is            -> {中文名, 坐标}（一次请求）
 *     B 降级链 ip.zxinc.org        -> 中文名（实测准确：中国\t福建省\t\t泉州市，CORS 回显 Origin）
 *               └ 本地 CITIES 表    -> 坐标（命中即零请求，且坐标是我们信得过的）
 *               └ open-meteo geocoding -> 表外城市的坐标
 *   两条链**各自独立退避**，A 挂了不会阻断 B —— 否则"限流"会直接退化成"没有定位"。
 *
 *   为什么坐标不能只靠 geocoding（实测命中率极不稳定，逐条记录）：
 *     泉州    -> 命中 0       泉州市 -> 命中 1（福建省）✓
 *     厦门    -> 命中 0       厦门市 -> 命中 1（福建省）✓
 *     北京    -> 命中 3 ✓     北京市 -> 命中 0
 *     上海市  -> 命中「上海市/伊利诺伊州」@41.05,-90.50  ✗ 命中美国同名的坑！
 *     台北/建始/建始县 -> 命中 0
 *   结论：中文城市名走本地表最稳；geocoding 只作表外兜底，且**必须校验 country_code**，
 *   否则会把上海用户定位到美国。ACAO 已确认是 `*`，可跨域直接调用。
 * ---------------------------------------------------------------------------
 */
(function () {
    'use strict';

    var UPSTREAM = 'https://weather.bonjourr.fr/';
    var CFG_KEY = 'wei8-weather';
    var LAST_KEY = 'wei8-weather-last';
    var GEO_KEY = 'wei8-geo';
    var DBG_KEY = 'wei8-weather-debug';

    // ---------------------------------------------------------------------
    // 定位源 A（快路径）：ipwho.is
    // 实测**唯一**能一次往返同时给出「中文名 + 坐标」的免费接口，所以「显示的地名」和
    // 「取数的位置」天然同源、不会各说各话。缺点是会按 IP 限流（见 v3.1 注释）。
    //
    // 其它候选的实测结论（2026-09-20，本机直连 + 带 Origin 头）：
    //   ipapi.co                 -> 403，Cloudflare 盾
    //   ip-api.com               -> 403 "SSL unavailable"，免费版只给 http，https 页面用不了
    //   ipwhois.app              -> 403 {"success":false}
    //   ipinfo.io（免 token）     -> 200 + CORS *，但 city 是**英文且错**（本机被归到 Fuzhou，
    //                               而 rDNS 明写 ...qz.fj... = 泉州）
    //   api.ip.sb/geoip          -> 200 + CORS *，同样英文且更偏（Shishicun）
    //   freeipapi.com            -> 307 跳转
    //   BigDataCloud 逆地理       -> ECONNRESET
    //   nominatim.openstreetmap  -> 超时
    //   国内其它（pconline / 美团 / 百度 qifu / 淘宝 / vore.top / useragentinfo）
    //                            -> 403 / 404 / 无 CORS / DNS 不存在 / Redis 故障
    //
    // 注意 lang 必须写 **zh-CN**：lang=zh 返回英文（city=Quanzhou / region=Fujian Sheng）。
    var GEO_API = 'https://ipwho.is/?lang=zh-CN';
    var GEO_FAIL_KEY = 'wei8-geo-fail';

    // ---------------------------------------------------------------------
    // 定位源 B（降级链）：ip.zxinc.org 出中文名 + 本地表/geocoding 出坐标
    // 实测 200 且 ACAO 回显调用方 Origin（`Origin: https://weimi95.github.io`
    // -> `Access-Control-Allow-Origin: https://weimi95.github.io`），跨域可用；
    // 地名准确（本机 IP -> {"country":"中国\t福建省\t\t泉州市"}）。
    // 它的代价是**不给坐标**，所以必须再补一步；补坐标优先用本地 CITIES 表
    // （零请求、且坐标是我们信得过的），表外才问 geocoding。
    // ---------------------------------------------------------------------
    var GEO2_API = 'https://ip.zxinc.org/api.php?type=json';
    var GEO2_FAIL_KEY = 'wei8-geo2-fail';
    // geocoding 只作表外兜底。中文命中率极不稳定（泉州/厦门/北京市/台北 全为 0 命中），
    // 且「上海市」会命中美国伊利诺伊州的同名地，故**必须**校验 country_code。
    var GEOCODE_API = 'https://geocoding-api.open-meteo.com/v1/search';
    // 允许的国家/地区代码：把中国港澳台一并放行（同属中国），同时挡掉美国同名城市。
    var GEOCODE_CC = { CN: 1, HK: 1, MO: 1, TW: 1 };

    // 天气每小时刷一次，定位没必要跟着每小时问一遍；6 小时足够跟上出差/回家
    var GEO_TTL = 6 * 3600 * 1000;
    // 定位失败后的退避窗口：绝不能让每次开标签页都去撞一次限流。
    // 取 10 分钟是个折中：既不把限流打成雪崩，也不会把一次偶发失败锁死太久。
    // 两个源各自独立计时，A 在退避时 B 照常工作。
    var GEO_FAIL_TTL = 10 * 60 * 1000;

    var DEFAULT_CITY = '泉州';
    var DEFAULT_COORDS = [24.874, 118.576];

    // ---------------------------------------------------------------------
    // 一次性迁移：预置的「关闭定位 + 写死城市」-> 「自动 IP 定位」
    //
    // 为什么必须有这一步：geolocation='off' 时 request.ts:56-60 会把 city 当 query 发出去，
    // 改写层拿到的永远是那个写死的名字，「按当前定位」无从谈起。
    //
    // 为什么不去改 preset：preset.js 是**整份重写** localStorage.bonjourr，
    // 递增 PRESET_VER 会把老板在设置面板里调好的一切（关掉的问候语、背景、书签顺序…）全冲掉。
    // 所以做定点迁移：判定条件刻意写得很窄（两条都还是预置值才动），用户改过就绝不碰；
    // 独立标记键保证只跑一次，用户之后主动改回 'off' 也不会被改回来。
    // ---------------------------------------------------------------------
    (function migrateGeolocation() {
        var MARK = 'wei8-geol-migrated';
        try {
            if (localStorage.getItem(MARK) === '1') return;
            var raw = localStorage.getItem('bonjourr');
            if (raw) {
                var d = JSON.parse(raw);
                var w = d && d.weather;
                if (w && w.geolocation === 'off' && w.city === DEFAULT_CITY) {
                    w.geolocation = 'approximate';
                    localStorage.setItem('bonjourr', JSON.stringify(d));
                    log('迁移：geolocation off -> approximate（改为 IP 自动定位）');
                }
            }
            localStorage.setItem(MARK, '1');
        } catch (e) { /* localStorage 不可用时静默跳过，Bonjourr 会回落到内置默认值 */ }
    })();

    // ---------------------------------------------------------------------
    // 中文城市名 → [纬度, 经度]
    // 为什么需要本地表：open-meteo 的 geocoding 接口【中文入参查不到】
    // （实测 name=泉州 返回空对象，name=Quanzhou 才命中），
    // 所以中文城市名一律走本地表，命中即零额外请求。
    // ---------------------------------------------------------------------
    var CITIES = {
        泉州: [24.874, 118.576], 晋江: [24.781, 118.552], 石狮: [24.732, 118.648],
        莆田: [25.454, 119.008], 福州: [26.074, 119.296], 厦门: [24.48, 118.089],
        漳州: [24.513, 117.647], 龙岩: [25.075, 117.017], 三明: [26.263, 117.639],
        北京: [39.904, 116.407], 上海: [31.23, 121.474], 广州: [23.129, 113.264],
        深圳: [22.543, 114.058], 天津: [39.085, 117.201], 重庆: [29.563, 106.551],
        杭州: [30.274, 120.155], 南京: [32.06, 118.797], 苏州: [31.299, 120.585],
        无锡: [31.491, 120.312], 宁波: [29.868, 121.544], 温州: [27.994, 120.699],
        合肥: [31.821, 117.227], 成都: [30.573, 104.067], 武汉: [30.593, 114.306],
        长沙: [28.228, 112.939], 南昌: [28.682, 115.858], 郑州: [34.746, 113.625],
        西安: [34.341, 108.94], 济南: [36.651, 117.12], 青岛: [36.067, 120.383],
        沈阳: [41.805, 123.431], 大连: [38.914, 121.615], 长春: [43.817, 125.324],
        哈尔滨: [45.803, 126.535], 石家庄: [38.043, 114.515], 太原: [37.87, 112.549],
        南宁: [22.817, 108.366], 昆明: [24.88, 102.833], 贵阳: [26.647, 106.63],
        海口: [20.044, 110.199], 兰州: [36.061, 103.834], 西宁: [36.617, 101.778],
        银川: [38.487, 106.231], 乌鲁木齐: [43.826, 87.617], 呼和浩特: [40.842, 111.749],
        拉萨: [29.645, 91.14], 佛山: [23.022, 113.122], 东莞: [23.021, 113.752],
        珠海: [22.271, 113.577], 汕头: [23.354, 116.682], 香港: [22.319, 114.169],
        澳门: [22.199, 113.543], 台北: [25.033, 121.565],
    };

    // ---------------------------------------------------------------------
    // WMO weather_code → [Bonjourr icon_id, 中文描述]
    // icon_id 合法值来自产物 sprite src/assets/interface/weather-sprites.svg，
    // 只有这 10 个：clearsky / fewclouds / brokenclouds / overcastclouds /
    //              mist / lightrain / rain / sunnyrain / snow / thunderstorm
    // 注意 sunnyrain 只有 day 变体（夜间用 lightrain 代替）。
    // ---------------------------------------------------------------------
    var WMO = {
        0: ['clearsky', '晴'],
        1: ['fewclouds', '晴间多云'],
        2: ['fewclouds', '多云'],
        3: ['overcastclouds', '阴'],
        45: ['mist', '雾'],
        48: ['mist', '雾凇'],
        51: ['lightrain', '毛毛雨'],
        53: ['lightrain', '小雨'],
        55: ['lightrain', '细雨'],
        56: ['lightrain', '冻毛毛雨'],
        57: ['lightrain', '冻雨'],
        61: ['lightrain', '小雨'],
        63: ['rain', '中雨'],
        65: ['rain', '大雨'],
        66: ['rain', '冻雨'],
        67: ['rain', '强冻雨'],
        71: ['snow', '小雪'],
        73: ['snow', '中雪'],
        75: ['snow', '大雪'],
        77: ['snow', '雪粒'],
        80: ['sunnyrain', '阵雨'],
        81: ['rain', '强阵雨'],
        82: ['rain', '暴雨'],
        85: ['snow', '阵雪'],
        86: ['snow', '强阵雪'],
        95: ['thunderstorm', '雷阵雨'],
        96: ['thunderstorm', '雷阵雨伴冰雹'],
        99: ['thunderstorm', '强雷暴伴冰雹'],
    };

    // 和风天气（QWeather）icon code（3 位）→ Bonjourr icon_id
    function qweatherIcon(code) {
        var c = parseInt(String(code), 10);
        if (isNaN(c)) return 'fewclouds';
        if (c === 100 || c === 150) return 'clearsky';
        if (c === 104 || c === 154) return 'overcastclouds';
        if (c >= 101 && c <= 103) return 'fewclouds';
        if (c >= 151 && c <= 153) return 'fewclouds';
        if (c === 302 || c === 303 || c === 304) return 'thunderstorm';
        if (c === 300 || c === 301 || c === 350 || c === 351) return 'sunnyrain';
        if (c === 305 || c === 306 || c === 307 || c === 308 || c === 309 ||
            c === 310 || c === 311 || c === 312 || c === 313 || c === 314 ||
            c === 315 || c === 316 || c === 317 || c === 318 || c === 399) return 'rain';
        if (c >= 400 && c <= 410) return 'snow';
        if (c === 456 || c === 457) return 'snow';
        if (c >= 500 && c <= 515) return 'mist';
        if (c === 900 || c === 901 || c === 999) return 'mist';
        return 'fewclouds';
    }

    // ---------------------------------------------------------------------
    // 工具
    // ---------------------------------------------------------------------
    function log() {
        try {
            if (localStorage.getItem(DBG_KEY) === '1') {
                console.log.apply(console, ['[wei8-weather]'].concat([].slice.call(arguments)));
            }
        } catch (e) { /* ignore */ }
    }

    function readCfg() {
        var d = { p: 'openmeteo', key: '', host: '' };
        try {
            var raw = localStorage.getItem(CFG_KEY);
            if (raw) {
                var o = JSON.parse(raw);
                if (o && typeof o === 'object') {
                    if (o.p) d.p = String(o.p);
                    if (o.key) d.key = String(o.key);
                    if (o.host) d.host = String(o.host);
                }
            }
        } catch (e) { /* ignore */ }
        return d;
    }

    // 在多路候选字段名里取第一个有值的（兼容不同版本的接口字段命名）
    function pick(obj, keys) {
        if (!obj) return undefined;
        for (var i = 0; i < keys.length; i++) {
            var v = obj[keys[i]];
            if (v !== undefined && v !== null && v !== '') return v;
        }
        return undefined;
    }

    // ---------------------------------------------------------------------
    // 【2026-09-20 关键修复】从 fetch 的第一个入参里可靠地取出 URL 字符串
    //
    // 原写法 `input.url` 有一个致命盲点：Bonjourr 的 requestNewWeather 传的是
    // **URL 对象**（产物 main.js:10556 `const url = new URL("https://weather.bonjourr.fr/")`
    // -> :10570 `await fetch(url)`）。URL 实例上取 URL 的属性是 `href`，
    // 没有 `url`（`url` 这个别名只存在于 HTMLAnchorElement / HTMLAreaElement）。
    // 于是 input.url === undefined -> url 变成空串 -> indexOf(UPSTREAM) 恒为 -1
    // -> **每条请求都走最底下的透传分支**，劫持层形同不存在。
    //
    // 后果链（实测线上同款）：真实请求打到已失效的上游 weather.bonjourr.fr，
    // 它返回 200 + 空 body；request.ts:10574 的 `response?.json()` 抛
    // SyntaxError: Unexpected end of JSON input；firstStartWeather 是 async 且无
    // try/catch -> 未捕获 rejection -> displayWeather 永不执行 -> 天气组件永远
    // 停在 class="wait init" 且空白（display.ts:143 的摘 class 代码在最后，任何
    // 中途抛错都会留下这个现象）。
    //
    // 之所以长期没被发现：验证时一律用字符串 URL 手测，字符串分支一直是好的。
    // 教训：拦截层必须把 fetch 的三种入参形态（string / URL / Request）都覆盖到。
    // ---------------------------------------------------------------------
    function urlOf(input) {
        if (typeof input === 'string') return input;
        if (input) {
            if (typeof input.href === 'string') return input.href;   // URL 对象
            if (typeof input.url === 'string') return input.url;     // Request 对象
        }
        try {
            return String(input);
        } catch (e) {
            return '';
        }
    }

    function num(v) {
        var n = parseFloat(v);
        return isNaN(n) ? undefined : n;
    }

    function hhmm(iso) {
        // "2026-09-20T05:52" -> [5, 52]
        var m = /T(\d{1,2}):(\d{2})/.exec(String(iso));
        if (!m) return undefined;
        return [parseInt(m[1], 10), parseInt(m[2], 10)];
    }

    function jsonResponse(obj) {
        var body = JSON.stringify(obj);
        try {
            return new Response(body, {
                status: 200,
                headers: { 'Content-Type': 'application/json; charset=utf-8' },
            });
        } catch (e) {
            // 极老环境没有 Response 构造器时的兜底：Bonjourr 只用 .status 与 .json()
            return {
                status: 200,
                ok: true,
                json: function () { return Promise.resolve(obj); },
            };
        }
    }

    // 内置城市表查坐标：**严格命中，不兜底**。
    // 返回 null 表示"表里没有"，必须与 resolveCoords 的"查不到就用默认城市"区分开 ——
    // 降级链要靠这个 null 判断该不该再去问 geocoding。
    function lookupCity(cityName) {
        if (!cityName) return null;
        var key = String(cityName).trim();
        if (CITIES[key]) return CITIES[key].slice();
        // 允许「泉州市」「福建省泉州市」这类写法
        for (var name in CITIES) {
            if (key.indexOf(name) !== -1) return CITIES[name].slice();
        }
        return null;
    }

    // 城市名解析成坐标（manual 路线用；必须给出坐标，查不到就用默认城市）
    function resolveCoords(cityName) {
        var hit = lookupCity(cityName);
        if (hit) return hit;
        log('未在本地城市表命中：' + cityName + '，回退默认城市 ' + DEFAULT_CITY);
        return DEFAULT_COORDS.slice();
    }

    // ---------------------------------------------------------------------
    // IP 定位（geolocation=approximate 路线）—— 双源链
    //   源 A  ipwho.is      一次往返同时给出**中文城市名 + 坐标**（首选，但会被限流）
    //   源 B  ip.zxinc.org  给中文地名（准、稳、CORS 可用），坐标再用本地表/geocoding 补
    // 两个源**各自独立退避**：A 限流绝不能连带把 B 也掐掉，否则"限流"直接等于"没有定位"。
    // ---------------------------------------------------------------------
    function normCity(name) {
        var s = String(name == null ? '' : name).trim();
        if (!s) return '';
        // 各源可能返回「泉州市」「北京市」；去掉行政后缀，与内置表/编码表的键对齐
        var stripped = s.replace(/市$/, '');
        return stripped.length >= 2 ? stripped : s;
    }

    function readGeoCache() {
        try {
            var raw = localStorage.getItem(GEO_KEY);
            if (!raw) return null;
            var o = JSON.parse(raw);
            if (!o || !o.city || o.lat === undefined || o.lon === undefined) return null;
            if (Date.now() - (o.ts || 0) > GEO_TTL) return null;
            return o;
        } catch (e) {
            return null;
        }
    }

    function delay(ms) {
        return new Promise(function (resolve) {
            // 沙箱/老环境可能没有 setTimeout，退化成「不等待」即可，不影响正确性
            if (typeof setTimeout === 'function') setTimeout(resolve, ms);
            else resolve();
        });
    }

    // 退避按**源**分开记：key 由调用方传入（A 用 GEO_FAIL_KEY，B 用 GEO2_FAIL_KEY）
    function backoffActive(key) {
        try {
            var raw = localStorage.getItem(key);
            if (!raw) return false;
            var o = JSON.parse(raw);
            return Date.now() - (o.ts || 0) < GEO_FAIL_TTL;
        } catch (e) {
            return false;
        }
    }

    function markFailure(key) {
        try { localStorage.setItem(key, JSON.stringify({ ts: Date.now() })); } catch (e) { /* ignore */ }
    }

    function clearFailure(key) {
        try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
    }

    function saveGeo(out) {
        try { localStorage.setItem(GEO_KEY, JSON.stringify(out)); } catch (e) { /* ignore */ }
        return out;
    }

    // 429 / 5xx 基本都是瞬时限流：短退避后补一次；其它错误（如字段缺失）不重试
    function withRetryOnce(fn, tag) {
        return fn().catch(function (e) {
            var msg = String((e && e.message) || '');
            if (!/HTTP (429|5\d\d)/.test(msg)) throw e;
            log(tag + ' 返回 ' + msg + '，退避后重试一次');
            return delay(900).then(fn);
        });
    }

    // --------------------------- 源 A：ipwho.is ---------------------------
    function fetchIpGeoOnce() {
        return origFetch(GEO_API, { cache: 'no-store' })
            .then(function (r) {
                if (r.status !== 200) throw new Error('ipwho.is HTTP ' + r.status);
                return r.json();
            })
            .then(function (j) {
                if (!j || j.success === false) {
                    throw new Error('ipwho.is ' + ((j && j.message) || 'failed'));
                }
                var city = normCity(j.city);
                var lat = num(j.latitude);
                var lon = num(j.longitude);
                if (!city || lat === undefined || lon === undefined) {
                    throw new Error('ipwho.is 响应缺 city/latitude/longitude');
                }
                return saveGeo({
                    city: city, region: normCity(j.region),
                    lat: lat, lon: lon, src: 'ipwho', ts: Date.now(),
                });
            });
    }

    function fetchIpGeo() {
        return withRetryOnce(fetchIpGeoOnce, 'IP 定位(ipwho.is)');
    }

    // ------------------- 源 B：ip.zxinc.org + 坐标补全 -------------------
    // 解析 zxinc 的 country 字段。真实形态是制表符分隔的层级：
    //   "中国\t福建省\t\t泉州市"      -> 取最后一段「泉州市」
    //   "中国\t福建省"               -> 只有省级，**判失败**：
    //      显示省名却拿省会坐标，会造成"地名与数据不一致"，比没有名字更误导。
    //   为什么用 data.country 而不是 data.location：后者尾部挂着运营商
    //   （"泉州市 中国电信\t公众宽带"），取最后一段会变成「公众宽带」。
    function parseZxincGeo(j) {
        var d = j && j.data;
        if (!d) return '';
        var raw = d.country || d.location || '';
        if (!raw) return '';
        var parts = String(raw).split(/\t+/).map(function (s) { return s.trim(); });
        parts = parts.filter(function (p) { return p && !/^(中国|China)$/i.test(p); });
        if (!parts.length) return '';
        var last = parts[parts.length - 1];
        var name = normCity(last);
        if (!name) return '';
        // 只有省级一段时，除非该名字正好在内置表里（如「北京」），否则判失败
        if (parts.length === 1 && !CITIES[name]) return '';
        return name;
    }

    // 表外城市的坐标：open-meteo geocoding。
    // 两个候选**并行**问（"原名" 与 "原名+市"），因为实测命中规律不一致：
    //   泉州 -> 空，泉州市 -> 命中 ／ 厦门 -> 空，厦门市 -> 命中 ／ 北京 -> 命中，北京市 -> 空
    // 并且**必须**用 country_code 过滤：实测「上海市」首条命中的是
    // 美国伊利诺伊州的 Shanghai @41.05,-90.50，不过滤就会把上海用户定位到美国。
    function geocodeName(name) {
        var cands = [name, name + '市'];
        var reqs = cands.map(function (c) {
            var u = GEOCODE_API + '?name=' + encodeURIComponent(c) + '&count=5&language=zh&format=json';
            return origFetch(u, { cache: 'no-store' })
                .then(function (r) { return r.status === 200 ? r.json() : null; })
                .catch(function () { return null; });
        });
        return Promise.all(reqs).then(function (list) {
            for (var i = 0; i < list.length; i++) {
                var res = (list[i] && list[i].results) || [];
                for (var k = 0; k < res.length; k++) {
                    var it = res[k];
                    if (!it || !GEOCODE_CC[it.country_code]) continue;
                    var lat = num(it.latitude), lon = num(it.longitude);
                    if (lat === undefined || lon === undefined) continue;
                    return { name: normCity(it.name), lat: lat, lon: lon };
                }
            }
            return null;
        });
    }

    function fetchZxincGeoOnce() {
        return origFetch(GEO2_API, { cache: 'no-store' })
            .then(function (r) {
                if (r.status !== 200) throw new Error('zxinc HTTP ' + r.status);
                return r.json();
            })
            .then(function (j) {
                if (!j || j.code !== 0) throw new Error('zxinc code=' + (j && j.code));
                var city = parseZxincGeo(j);
                if (!city) throw new Error('zxinc 未给出市级地名');
                // 先查本地表：零额外请求，且坐标是我们信得过的
                var hit = lookupCity(city);
                if (hit) {
                    return saveGeo({
                        city: city, lat: hit[0], lon: hit[1], src: 'zxinc+table', ts: Date.now(),
                    });
                }
                return geocodeName(city).then(function (g) {
                    if (!g) throw new Error('城市「' + city + '」在本地表与 geocoding 均无坐标');
                    return saveGeo({
                        city: g.name || city, lat: g.lat, lon: g.lon,
                        src: 'zxinc+geocode', ts: Date.now(),
                    });
                });
            });
    }

    function fetchZxincGeo() {
        return withRetryOnce(fetchZxincGeoOnce, 'IP 定位(zxinc)');
    }

    // 链式取定位：先 A 后 B，各自独立退避
    function getGeo() {
        var cached = readGeoCache();
        if (cached) {
            log('IP 定位走缓存：' + cached.city + '（来源 ' + (cached.src || 'ipwho') + '）');
            return Promise.resolve(cached);
        }

        var stepA = backoffActive(GEO_FAIL_KEY)
            ? Promise.resolve(null)
            : fetchIpGeo()
                .then(function (g) { clearFailure(GEO_FAIL_KEY); return g; })
                .catch(function (e) {
                    log('定位源 A(ipwho.is) 失败：' + (e && e.message));
                    stats.lastError = 'geoA: ' + ((e && e.message) || e);
                    markFailure(GEO_FAIL_KEY);
                    return null;
                });

        return stepA.then(function (g) {
            if (g) return g;
            if (backoffActive(GEO2_FAIL_KEY)) {
                log('定位不可用（源 A 失败 + 源 B 在退避窗口内），本次使用兜底城市 ' + DEFAULT_CITY);
                stats.geoBackoff = true;
                return null;
            }
            return fetchZxincGeo()
                .then(function (g2) { clearFailure(GEO2_FAIL_KEY); return g2; })
                .catch(function (e) {
                    log('定位源 B(ip.zxinc.org) 失败：' + (e && e.message));
                    stats.lastError = 'geoB: ' + ((e && e.message) || e);
                    markFailure(GEO2_FAIL_KEY);
                    return null;
                });
        });
    }

    // ---------------------------------------------------------------------
    // 城市名 -> 中国天气网城市页地址
    // 编码表 city-codes.js 由 gen_city_codes.js 离线生成，**每条都用城市页 <title> 复验过**。
    // 表里没有的一律回落百度搜索：宁可能用（结果页首屏就是天气卡片），
    // 也好过猜一个编码跳到**别的城市**的页面 —— 那是更糟的错误。
    // ---------------------------------------------------------------------
    function findCityCode(city) {
        var codes = (typeof window !== 'undefined' && window.WEI8_CITY_CODES) || {};
        if (!city) return '';
        var cands = [city];
        var stripped = String(city).replace(/[市区县]$/, '');
        if (stripped && stripped !== city) cands.push(stripped);
        for (var i = 0; i < cands.length; i++) {
            if (codes[cands[i]]) return codes[cands[i]];
        }
        // 模糊兜底：「恩施土家族苗族自治州」-> 表里的「恩施」。
        // 取**最长**的匹配键，避免「南」这种过泛的键把南京/南昌都匹进来。
        var best = '';
        for (var k in codes) {
            for (var j = 0; j < cands.length; j++) {
                if (cands[j].indexOf(k) !== -1 && k.length > best.length) best = k;
            }
        }
        return best ? codes[best] : '';
    }

    function weatherPageUrl(city) {
        var code = findCityCode(city);
        if (code) return 'http://www.weather.com.cn/weather/' + code + '.shtml';
        log('城市「' + city + '」不在编码表内，跳转回落百度搜索');
        return 'https://www.baidu.com/s?wd=' + encodeURIComponent(city + '天气');
    }

    // ---------------------------------------------------------------------
    // 数据源 1：open-meteo（免费、无 key、已验证 CORS 为 *）
    // ---------------------------------------------------------------------
    function fetchOpenMeteo(lat, lon, unitF, cityName, pageUrl) {
        var url =
            'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon +
            '&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m' +
            '&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset' +
            '&timezone=auto&forecast_days=2';
        if (unitF) url += '&temperature_unit=fahrenheit';

        return origFetch(url, { cache: 'no-store' })
            .then(function (r) {
                // 必须检查状态码：否则 5xx/4xx 时 r.json() 仍可能解析出对象，
                // 我们会静默产出一份「0°C 多云」的假数据 —— 正是本次要修的那类失败。
                if (r.status !== 200) throw new Error('open-meteo HTTP ' + r.status);
                return r.json();
            })
            .then(function (d) {
                // 再校验必要字段，缺了就抛错走降级，不要拿残缺数据去渲染
                if (!d || !d.current) throw new Error('open-meteo 响应缺少 current');

                var cur = d.current || {};
                var code = parseInt(cur.weather_code, 10);
                var map = WMO[code] || ['fewclouds', '多云'];
                var icon = map[0];
                // sunnyrain 没有 night 变体，夜间退化成 lightrain
                if (icon === 'sunnyrain' && Number(cur.is_day) === 0) icon = 'lightrain';

                var out = {
                    now: {
                        temp: Math.round(num(cur.temperature_2m) ?? 0),
                        feels: Math.round(num(cur.apparent_temperature) ?? num(cur.temperature_2m) ?? 0),
                        description: map[1],
                        icon: icon,
                    },
                    geo: {
                        country: 'CN',
                        // 不能给空串：Bonjourr 的 firstStartWeather() 会把 geo.city 回写进设置
                        // （request.ts:128  data.city = currentWeather.approximation?.city ?? tradThis('City')），
                        // 空串不是 null/undefined，?? 不会兜底，会把城市写坏。
                        city: cityName || DEFAULT_CITY,
                        lat: num(d.latitude) ?? lat,
                        lon: num(d.longitude) ?? lon,
                    },
                    // meta.url 是 Bonjourr 唯一会带进「点击天气」的字段（display.ts:124,132 -> lastWeather.link）
                    meta: { url: pageUrl },
                };

                var dd = d.daily || {};
                var times = dd.time || [];
                if (times.length) {
                    out.daily = times.map(function (t, i) {
                        return {
                            // 补 T12:00:00，避免 new Date("YYYY-MM-DD") 被当 UTC 午夜
                            time: String(t).length === 10 ? String(t) + 'T12:00:00' : t,
                            high: Math.round(num((dd.temperature_2m_max || [])[i]) ?? 0),
                            low: Math.round(num((dd.temperature_2m_min || [])[i]) ?? 0),
                        };
                    });
                }
                var rise = hhmm((dd.sunrise || [])[0]);
                var set = hhmm((dd.sunset || [])[0]);
                if (rise && set) out.sun = { rise: rise, set: set };

                return out;
            });
    }

    // ---------------------------------------------------------------------
    // 数据源 2：和风天气 QWeather（可选，需自备 API Key + 专属 API Host）
    // 鉴权：请求头 X-QW-Api-Key；网关已实测返回 Access-Control-Allow-Origin: *
    // 新版路径 /weather/v1/current/{lat}/{lon}，旧版 /v7/weather/now?location=lon,lat
    // 字段命名用 pick() 做多路兼容，不假设单一版本。
    // ---------------------------------------------------------------------
    function fetchQWeather(lat, lon, unitF, cfg, cityName, pageUrl) {
        var key = cfg.key;
        var host = cfg.host || 'devapi.qweather.com';
        var base = 'https://' + host;
        var headers = { 'X-QW-Api-Key': key };
        var loc = lon + ',' + lat;

        function g(url) {
            return origFetch(url, { headers: headers, cache: 'no-store' }).then(function (r) {
                if (!r.ok) throw new Error('qweather ' + r.status);
                return r.json();
            });
        }

        var nowReq = g(base + '/weather/v1/current/' + lat + '/' + lon + '?lang=zh')
            .catch(function () {
                return g(base + '/v7/weather/now?location=' + loc + '&lang=zh');
            });

        var dailyReq = g(base + '/weather/v1/daily/' + lat + '/' + lon + '?lang=zh&days=3')
            .catch(function () {
                return g(base + '/v7/weather/3d?location=' + loc + '&lang=zh');
            })
            .catch(function () { return null; });

        return Promise.all([nowReq, dailyReq]).then(function (res) {
            var now = res[0] || {};
            var cur = pick(now, ['current', 'now']) || now;
            var code = pick(cur, ['icon', 'weatherCode', 'code']);
            var text = pick(cur, ['text', 'description', 'weather']);

            var out = {
                now: {
                    temp: Math.round(num(pick(cur, ['temp', 'temperature', 'temperature_2m'])) ?? 0),
                    feels: Math.round(
                        num(pick(cur, ['feelsLike', 'feels_like', 'apparent_temperature'])) ??
                        num(pick(cur, ['temp', 'temperature'])) ?? 0
                    ),
                    description: text || '多云',
                    icon: qweatherIcon(code),
                },
                geo: { country: 'CN', city: cityName || DEFAULT_CITY, lat: lat, lon: lon },
                meta: { url: pageUrl },
            };

            var d = res[1];
            if (d) {
                var list = pick(d, ['daily', 'forecast']) || [];
                if (list.length) {
                    out.daily = list.slice(0, 2).map(function (item) {
                        return {
                            time: String(pick(item, ['fxDate', 'date', 'time']) || '') + 'T12:00:00',
                            high: Math.round(num(pick(item, ['tempMax', 'temp_max', 'high'])) ?? 0),
                            low: Math.round(num(pick(item, ['tempMin', 'temp_min', 'low'])) ?? 0),
                        };
                    });
                }
            }
            return out;
        });
    }

    // ---------------------------------------------------------------------
    // 主流程：把上游 URL 翻译成本地数据源的等价结果
    // ---------------------------------------------------------------------
    function buildWeather(upstreamUrl) {
        var u;
        try {
            u = new URL(upstreamUrl);
        } catch (e) {
            return Promise.reject(new Error('bad url'));
        }

        var cfg = readCfg();
        var unitF = (u.searchParams.get('unit') || 'C').toUpperCase() === 'F';
        var qLat = num(u.searchParams.get('lat'));
        var qLon = num(u.searchParams.get('lon'));
        var qCity = u.searchParams.get('query');

        // ------------------------------------------------------------------
        // 定位方式判定：改写层只能看到 URL，所以用「URL 上带了什么」反推
        //   lat/lon  -> geolocation=precise，坐标来自浏览器 GPS
        //   query    -> geolocation=off，设置里手填的城市
        //   都没有     -> geolocation=approximate，由本文件自己做 IP 定位
        // ------------------------------------------------------------------
        var mode;
        var coords;
        var cityName = '';

        if (qLat !== undefined && qLon !== undefined && qLat !== 0 && qLon !== 0) {
            // geolocation=precise 时 Bonjourr 会带上坐标
            mode = 'gps';
            coords = [qLat, qLon];
        } else if (qCity) {
            // 【2026-09-20 修正】这里必须再解码一次。
            // 上游 request.ts:56-59 先把城市名 encodeURIComponent，再交给
            // url.searchParams.set('query', q)，而 searchParams 序列化时会再编码一次
            // '%' -> '%25'，实际发出的 query 是双重编码的：
            //   泉州 -> encodeURIComponent -> %E6%B3%89%E5%B7%9E -> 序列化 -> %25E6%25B3%2589%25E5%25B7%259E
            // （CDP 抓到的真实请求即为 %25E6%25B3%2589%25E5%25B7%259E）
            // 因此 searchParams.get() 只解掉一层，拿到的仍是 '%E6%B3%89%E5%B7%9E'。
            // 不解码的后果：本地城市表查不到 -> 坐标回落默认城市（碰巧相同，掩盖了问题），
            // 且 cityName 变成 '%E6%B3%89%E5%B7%9E' 被 firstStartWeather 回写进
            // data.city（request.ts:128），把用户的城市设置污染成百分号串。
            // 旧注释"不能再 decodeURIComponent"是错的。
            mode = 'manual';
            var asked = String(qCity).trim();
            try {
                asked = decodeURIComponent(asked);
            } catch (e) { /* 不是合法百分号序列就原样用 */ }
            cityName = asked || DEFAULT_CITY;
            coords = resolveCoords(asked);
        } else {
            mode = 'ip';
            coords = DEFAULT_COORDS.slice();
        }

        // 只有 gps / ip 需要问定位服务；manual 完全离线、零请求
        var geoStep = mode === 'manual' ? Promise.resolve(null) : getGeo();

        return geoStep.then(function (g) {
            if (mode === 'ip' && g) {
                // 坐标和城市名来自同一次定位 -> 取数的位置与显示的地名天然一致
                coords = [g.lat, g.lon];
                cityName = g.city;
            } else if (mode === 'gps' && g && g.city) {
                // GPS 只给坐标。本机实测没有可用的逆地理服务
                // （BigDataCloud ECONNRESET、Nominatim 超时），所以地名仍取 IP 定位结果：
                // 同城时完全一致，跨城时地名会略粗，但总好过没有名字。
                cityName = g.city;
            }
            if (!cityName) cityName = DEFAULT_CITY;

            // 展示名归一化：内置表命中就换成规范名（「泉州市」-> 「泉州」）
            for (var k in CITIES) {
                if (cityName.indexOf(k) !== -1) { cityName = k; break; }
            }

            var pageUrl = weatherPageUrl(cityName);
            log('定位方式=' + mode + ' 定位来源=' + ((g && g.src) || '无（兜底城市）') +
                ' 数据源=' + cfg.p + ' 坐标=' + coords.join(',') +
                ' 城市=' + cityName + ' 单位=' + (unitF ? 'F' : 'C'));
            stats.geoMode = mode;
            stats.geoSource = (g && g.src) || '';   // ipwho / zxinc+table / zxinc+geocode / 空
            stats.lastCity = cityName;
            stats.lastWeatherUrl = pageUrl;

            var primary = cfg.p === 'qweather' && cfg.key
                ? fetchQWeather(coords[0], coords[1], unitF, cfg, cityName, pageUrl)
                : fetchOpenMeteo(coords[0], coords[1], unitF, cityName, pageUrl);

            return primary
                .catch(function (e) {
                    log('主数据源失败：' + (e && e.message));
                    // 主源失败时自动降级到另一个源
                    if (cfg.p === 'qweather') {
                        return fetchOpenMeteo(coords[0], coords[1], unitF, cityName, pageUrl);
                    }
                    if (cfg.key) {
                        return fetchQWeather(coords[0], coords[1], unitF, cfg, cityName, pageUrl);
                    }
                    throw e;
                })
                .then(function (data) {
                    try { localStorage.setItem(LAST_KEY, JSON.stringify(data)); } catch (e) { /* ignore */ }
                    return data;
                })
                .catch(function (e) {
                    log('全部数据源失败：' + (e && e.message));
                    stats.lastError = String((e && e.message) || e);
                    // 兜底 1：用上一次成功的结果，避免天气组件整个消失
                    try {
                        var last = localStorage.getItem(LAST_KEY);
                        if (last) return JSON.parse(last);
                    } catch (err) { /* ignore */ }
                    // 兜底 2：最小合法结构 + 明确文案（Bonjourr 拿到非法响应会抛错，天气会整个不显示）
                    return {
                        now: { temp: 0, feels: 0, description: '天气获取失败', icon: 'mist' },
                        geo: { country: 'CN', city: cityName, lat: coords[0], lon: coords[1] },
                        meta: { url: pageUrl },
                    };
                });
        });
    }

    // 运行时可观测标记：给自动化校验（probe_live.js）一个可断言的证据点，
    // 用来区分「劫持层压根没接上」和「接上了但数据源失败」。
    var stats = {
        installed: false,
        hits: 0,
        lastUrl: '',        // 最后一条被接管的上游请求 URL
        lastError: '',
        geoMode: '',        // 'ip' | 'gps' | 'manual'
        geoSource: '',      // 定位来源：ipwho / zxinc+table / zxinc+geocode / ''（兜底城市）
        geoBackoff: false,  // 处于定位失败退避窗口内（本次跳过请求）
        lastCity: '',       // 解析出的中文地名
        lastWeatherUrl: '', // 该地名的天气页地址（点击跳转目标）
    };
    try { window.__wei8Weather = stats; } catch (e) { /* ignore */ }

    // ---------------------------------------------------------------------
    // 安装劫持
    // ---------------------------------------------------------------------
    var origFetch = window.fetch ? window.fetch.bind(window) : null;
    if (!origFetch) {
        console.warn('[wei8-weather] 当前环境没有 window.fetch，天气改写未生效');
        return;
    }
    stats.installed = true;

    window.fetch = function (input, init) {
        var url = urlOf(input);

        if (url.indexOf(UPSTREAM) === 0) {
            // 城市搜索建议走的是 provider=accuweather&geo=true，该分支上游仍正常
            // （实测返回 523B 城市列表），不要拦，透传即可。
            if (/[?&]geo=true/.test(url)) {
                log('放行上游城市搜索：' + url);
                return origFetch(input, init);
            }

            log('接管天气请求：' + url);
            stats.hits++;
            stats.lastUrl = url;
            return buildWeather(url).then(jsonResponse);
        }

        return origFetch(input, init);
    };

    log('已安装天气请求改写（上游 ' + UPSTREAM + ' -> 本地数据源）');
})();
