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
 *   建议用同目录的 weather-config.html 图形化设置（含连通性自测）。
 * ---------------------------------------------------------------------------
 */
(function () {
    'use strict';

    var UPSTREAM = 'https://weather.bonjourr.fr/';
    var CFG_KEY = 'wei8-weather';
    var LAST_KEY = 'wei8-weather-last';
    var DBG_KEY = 'wei8-weather-debug';

    var DEFAULT_CITY = '泉州';
    var DEFAULT_COORDS = [24.874, 118.576];

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

    // 城市名解析成坐标
    function resolveCoords(cityName) {
        if (!cityName) return DEFAULT_COORDS.slice();
        var key = String(cityName).trim();
        if (CITIES[key]) return CITIES[key].slice();
        // 允许「泉州市」「福建省泉州市」这类写法
        for (var name in CITIES) {
            if (key.indexOf(name) !== -1) return CITIES[name].slice();
        }
        log('未在本地城市表命中：' + key + '，回退默认城市 ' + DEFAULT_CITY);
        return DEFAULT_COORDS.slice();
    }

    // ---------------------------------------------------------------------
    // 数据源 1：open-meteo（免费、无 key、已验证 CORS 为 *）
    // ---------------------------------------------------------------------
    function fetchOpenMeteo(lat, lon, unitF, cityName) {
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
                    meta: { url: 'https://www.weather.com.cn/' },
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
    function fetchQWeather(lat, lon, unitF, cfg, cityName) {
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
                meta: { url: 'https://www.weather.com.cn/' },
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

        var coords;
        var cityName = DEFAULT_CITY;

        if (qLat !== undefined && qLon !== undefined && qLat !== 0 && qLon !== 0) {
            coords = [qLat, qLon];            // geolocation=precise 时 Bonjourr 会带上
        } else if (qCity) {
            // 注意：URLSearchParams.get() 已经解码过一次，这里不能再 decodeURIComponent，
            // 否则城市名里的字面量 % 会被二次解码搞坏。
            var asked = String(qCity).trim();
            cityName = asked || DEFAULT_CITY;
            coords = resolveCoords(asked);    // geolocation=off 走这里
        } else {
            coords = DEFAULT_COORDS.slice();  // geolocation=approximate：不带定位，用默认城市
        }

        // 展示名归一化：本地表命中就换成规范名（「泉州市」-> 「泉州」）
        for (var k in CITIES) {
            if (cityName.indexOf(k) !== -1) { cityName = k; break; }
        }

        log('数据源=' + cfg.p + ' 坐标=' + coords.join(',') + ' 城市=' + cityName +
            ' 单位=' + (unitF ? 'F' : 'C'));

        var primary = cfg.p === 'qweather' && cfg.key
            ? fetchQWeather(coords[0], coords[1], unitF, cfg, cityName)
            : fetchOpenMeteo(coords[0], coords[1], unitF, cityName);

        return primary
            .catch(function (e) {
                log('主数据源失败：' + (e && e.message));
                // 主源失败时自动降级到另一个源
                if (cfg.p === 'qweather') {
                    return fetchOpenMeteo(coords[0], coords[1], unitF, cityName);
                }
                if (cfg.key) {
                    return fetchQWeather(coords[0], coords[1], unitF, cfg, cityName);
                }
                throw e;
            })
            .then(function (data) {
                try { localStorage.setItem(LAST_KEY, JSON.stringify(data)); } catch (e) { /* ignore */ }
                return data;
            })
            .catch(function (e) {
                log('全部数据源失败：' + (e && e.message));
                // 兜底 1：用上一次成功的结果，避免天气组件整个消失
                try {
                    var last = localStorage.getItem(LAST_KEY);
                    if (last) return JSON.parse(last);
                } catch (err) { /* ignore */ }
                // 兜底 2：最小合法结构 + 明确文案（Bonjourr 拿到非法响应会抛错，天气会整个不显示）
                return {
                    now: { temp: 0, feels: 0, description: '天气获取失败', icon: 'mist' },
                    geo: { country: 'CN', city: cityName, lat: coords[0], lon: coords[1] },
                    meta: { url: 'https://www.weather.com.cn/' },
                };
            });
    }

    // ---------------------------------------------------------------------
    // 安装劫持
    // ---------------------------------------------------------------------
    var origFetch = window.fetch ? window.fetch.bind(window) : null;
    if (!origFetch) {
        console.warn('[wei8-weather] 当前环境没有 window.fetch，天气改写未生效');
        return;
    }

    window.fetch = function (input, init) {
        var url = '';
        try {
            url = typeof input === 'string' ? input : (input && input.url) || '';
        } catch (e) { /* ignore */ }

        if (url.indexOf(UPSTREAM) === 0) {
            // 城市搜索建议走的是 provider=accuweather&geo=true，该分支上游仍正常
            // （实测返回 523B 城市列表），不要拦，透传即可。
            if (/[?&]geo=true/.test(url)) {
                log('放行上游城市搜索：' + url);
                return origFetch(input, init);
            }

            log('接管天气请求：' + url);
            return buildWeather(url).then(jsonResponse);
        }

        return origFetch(input, init);
    };

    log('已安装天气请求改写（上游 ' + UPSTREAM + ' -> 本地数据源）');
})();
