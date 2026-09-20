/* weather-settings.js
 * ---------------------------------------------------------------------------
 * 把「天气数据源」配置并进 Bonjourr 自带设置面板的 Weather & Greetings 区块，
 * 取代原先独立的 weather-config.html（不再另开一个页面）。
 *
 * 【为什么能这么做】
 * 不改上游源码：上游设置面板的 markup 是静态写在 index.html 里的
 * （产物 index.html:695 起是 <aside id="settings">，天气这段在 .as.as_weather，
 * 内含 #i_units / #i_forecast / #i_temp / #i_moreinfo / #weather_provider / #i_weatherhide）。
 * 我们只在这段里插一行自己的配置，并**复用上游既有类名**：
 *   .wrapper  -> 行容器（flex / space-between / min-height 31px）
 *   hr        -> 分隔线
 *   .param-btn-> 胶囊文字按钮（rgb(var(--accent-color) / .15) 底 + 主题色字）
 *   aside input[type=text] / select -> 原生输入框与下拉
 * 全套视觉都由上游 settings/inputs.css 提供，我们不自造皮肤，所以上游换主题我们不会花掉。
 *
 * 【存哪】localStorage['wei8-weather'] = {"p":"openmeteo"|"qweather","key":"…","host":"…"}
 * 与 weather-patch.js 共用同一个键（CFG_KEY），保存后由它在下一次请求时生效。
 *
 * 【为什么保存后要清缓存】
 * weatherCacheControl() 里 isAnHourLater = now > last + 3600000，
 * 一小时内不会重新取数。所以换数据源后必须清掉 lastWeather 缓存，
 * 否则用户会以为"没生效"。清完给出「刷新页面」入口。
 *
 * 【连通性自测】原 weather-config.html 里的自测功能一并搬进来（不砍功能）：
 * 直接用浏览器发请求，走的就是用户当前网络线路，哪个通就用哪个。
 *
 * 【注意】标签文本**故意不加** class="trn"：那是上游 i18n 的钩子，
 * 我们的中文文案不该被它按英文词表改写或清空。
 * ---------------------------------------------------------------------------
 */
(function () {
    'use strict';

    var CFG_KEY = 'wei8-weather';
    var LAT = 24.874;
    var LON = 118.576;
    var TEST_HOST_DEFAULT = 'devapi.qweather.com';

    function $(id) { return document.getElementById(id); }

    function readCfg() {
        var d = { p: 'openmeteo', key: '', host: '' };
        try {
            var o = JSON.parse(localStorage.getItem(CFG_KEY) || '{}');
            if (o && typeof o === 'object') {
                if (o.p === 'qweather' || o.p === 'openmeteo') d.p = o.p;
                if (typeof o.key === 'string') d.key = o.key;
                if (typeof o.host === 'string') d.host = o.host;
            }
        } catch (e) { /* 坏数据一律回落默认 */ }
        return d;
    }

    function writeCfg(cfg) {
        try {
            localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
            return true;
        } catch (e) {
            return false;
        }
    }

    // 清掉 Bonjourr 的天气缓存（lastWeather 是 storage.local 的键，直接写 localStorage）
    function clearWeatherCache() {
        try {
            localStorage.removeItem('lastWeather');
            localStorage.removeItem('wei8-weather-last');
        } catch (e) { /* ignore */ }
    }

    function say(msg, cls) {
        var el = $('wei8-wx-status');
        if (!el) return;
        el.className = 'wei8-wx-status' + (cls ? ' ' + cls : '');
        if (msg === '') {
            el.innerHTML = '';
            return;
        }
        el.innerHTML = msg;
    }

    function sayWithReload(msg, cls) {
        say(msg + ' <a href="#" class="wei8-wx-reload">点此刷新页面生效</a>', cls);
        var link = document.querySelector('.wei8-wx-reload');
        if (link) {
            link.addEventListener('click', function (ev) {
                ev.preventDefault();
                location.reload();
            });
        }
    }

    // 取数并返回 {status, ms, text}；沿用原配置页的 timed() 语义
    function timed(url, opts) {
        var t0 = performance.now();
        return fetch(url, opts || {}).then(function (r) {
            return r.text().then(function (t) {
                return { status: r.status, ms: Math.round(performance.now() - t0), text: t };
            });
        });
    }

    // ---------------------------------------------------------------------
    // 和风专属字段的显隐：用自己的类而不是上游 .dropdown，
    // 避免与上游的 toggleSettingsDropdown / 全局 click 逻辑互相干扰。
    // ---------------------------------------------------------------------
    function syncQwFields() {
        var sel = $('wei8-wx-source');
        var box = $('wei8-wx-qw');
        if (!sel || !box) return;
        box.classList.toggle('wei8-wx-hidden', sel.value !== 'qweather');
    }

    function fill() {
        var c = readCfg();
        var sel = $('wei8-wx-source');
        if (sel) sel.value = c.p;
        if ($('wei8-wx-key')) $('wei8-wx-key').value = c.key || '';
        if ($('wei8-wx-host')) $('wei8-wx-host').value = c.host || '';
        syncQwFields();
    }

    // ---------------------------------------------------------------------
    // 连通性自测
    // ---------------------------------------------------------------------
    function testOpenMeteo() {
        say('open-meteo 测试中…', 'wait');
        return timed(
            'https://api.open-meteo.com/v1/forecast?latitude=' + LAT + '&longitude=' + LON +
            '&current=temperature_2m,weather_code,apparent_temperature&timezone=auto',
        ).then(function (r) {
            if (r.status !== 200) throw new Error('HTTP ' + r.status);
            var d = JSON.parse(r.text);
            say('✅ open-meteo 可用 · HTTP 200 · ' + r.ms + ' ms · 当前 ' +
                d.current.temperature_2m + '°C（体感 ' + d.current.apparent_temperature + '°C）', 'ok');
            return true;
        }).catch(function (e) {
            say('❌ open-meteo 不可用（' + (e && e.message) +
                '）。你的网络到 api.open-meteo.com 不通，请改用和风天气。', 'bad');
            return false;
        });
    }

    function testQWeather() {
        var key = (($('wei8-wx-key') || {}).value || '').trim();
        var host = (($('wei8-wx-host') || {}).value || '').trim() || TEST_HOST_DEFAULT;

        if (!key) {
            say('请先填写和风天气 API Key 再测试。', 'bad');
            return Promise.resolve(false);
        }

        say('和风天气测试中…', 'wait');
        return timed('https://' + host + '/weather/v1/current/' + LAT + '/' + LON + '?lang=zh', {
            headers: { 'X-QW-Api-Key': key },
        }).then(function (r) {
            if (r.status !== 200) throw new Error('HTTP ' + r.status + ' · ' + r.text.slice(0, 160));
            say('✅ 和风天气可用（新版路径）· HTTP 200 · ' + r.ms + ' ms', 'ok');
            return true;
        }).catch(function (e1) {
            // 新版路径失败时回退旧版路径（和风有 v1 与 v7 两套路径）
            say('新版路径未通过，正在回退旧版 /v7/weather/now…', 'wait');
            return timed('https://' + host + '/v7/weather/now?location=' + LON + ',' + LAT + '&lang=zh', {
                headers: { 'X-QW-Api-Key': key },
            }).then(function (r) {
                if (r.status !== 200) throw new Error('HTTP ' + r.status + ' · ' + r.text.slice(0, 160));
                say('✅ 和风天气可用（旧版路径 /v7/weather/now）· HTTP 200 · ' + r.ms + ' ms', 'ok');
                return true;
            }).catch(function (e2) {
                say('❌ 和风天气不可用。<br>新版路径：' + (e1 && e1.message) +
                    '<br>旧版路径：' + (e2 && e2.message) +
                    '<br>请检查 Key 是否有效、API Host 是否与控制台「设置」里一致。', 'bad');
                return false;
            });
        });
    }

    // ---------------------------------------------------------------------
    // 挂载
    // ---------------------------------------------------------------------
    var MARKUP =
        '<hr />' +
        '<div class="wrapper">' +
            '<label for="wei8-wx-source">天气数据源</label>' +
            '<select id="wei8-wx-source">' +
                '<option value="openmeteo">open-meteo（免 Key）</option>' +
                '<option value="qweather">和风天气（需 Key）</option>' +
            '</select>' +
        '</div>' +
        '<p class="wei8-wx-note">Bonjourr 官方天气服务端已失效，本站把天气请求改接到上面的数据源。</p>' +
        '<div id="wei8-wx-qw" class="wei8-wx-hidden">' +
            '<div class="wrapper">' +
                '<label for="wei8-wx-key">和风 API Key</label>' +
                '<input id="wei8-wx-key" type="text" maxlength="128" autocomplete="off" ' +
                    'spellcheck="false" placeholder="控制台 › 凭据" />' +
            '</div>' +
            '<div class="wrapper">' +
                '<label for="wei8-wx-host">API Host</label>' +
                '<input id="wei8-wx-host" type="text" maxlength="128" autocomplete="off" ' +
                    'spellcheck="false" placeholder="abcxyz.qweatherapi.com" />' +
            '</div>' +
            '<p class="wei8-wx-note">Key 存在本机浏览器里。请给和风凭据加「应用限制」域名白名单，' +
                '把可用域名限定为本站。</p>' +
        '</div>' +
        '<div class="wei8-wx-actions">' +
            '<button type="button" class="param-btn" id="wei8-wx-test">测试</button>' +
            '<button type="button" class="param-btn" id="wei8-wx-save">保存</button>' +
            '<button type="button" class="param-btn" id="wei8-wx-reset">恢复默认</button>' +
        '</div>' +
        '<p class="wei8-wx-status" id="wei8-wx-status"></p>';

    function mount() {
        if ($('wei8-wx-source')) return true; // 幂等

        // 锚点：#weather_provider 是上游「Detailed weather → Custom provider」那一行的容器，
        // 我们的区块插在它**前面**（数据源决定数据从哪来，provider URL 决定点击跳哪去，语义相邻）。
        // 找不到就退到整个天气区块的容器。
        var anchor = $('weather_provider') || document.querySelector('.as.as_weather');
        if (!anchor || !anchor.parentNode) return false;

        var box = document.createElement('div');
        box.id = 'wei8-wx-block';
        box.innerHTML = MARKUP;
        anchor.parentNode.insertBefore(box, anchor);

        $('wei8-wx-source').addEventListener('change', syncQwFields);

        $('wei8-wx-save').addEventListener('click', function () {
            var before = readCfg();
            var cfg = {
                p: $('wei8-wx-source').value,
                key: ($('wei8-wx-key').value || '').trim(),
                host: ($('wei8-wx-host').value || '').trim(),
            };
            var changed = before.p !== cfg.p || before.key !== cfg.key || before.host !== cfg.host;

            if (!writeCfg(cfg)) {
                say('保存失败：浏览器本地存储不可写（隐私模式？）。', 'bad');
                return;
            }
            if (!changed) {
                say('配置没有变化，无需刷新。', 'ok');
                return;
            }
            clearWeatherCache();
            sayWithReload('已保存：' + (cfg.p === 'qweather' ? '和风天气' : 'open-meteo') + '，并已清掉旧天气缓存。', 'ok');
        });

        $('wei8-wx-reset').addEventListener('click', function () {
            try { localStorage.removeItem(CFG_KEY); } catch (e) { /* ignore */ }
            fill();
            clearWeatherCache();
            sayWithReload('已恢复默认（open-meteo）。', 'ok');
        });

        $('wei8-wx-test').addEventListener('click', function () {
            if ($('wei8-wx-source').value === 'qweather') {
                testQWeather();
            } else {
                testOpenMeteo();
            }
        });

        fill();
        return true;
    }

    function start() {
        if (mount()) return;

        // 设置面板在 index.html 里是静态的，正常情况下 defer 执行时已在 DOM 中；
        // 但上游改结构 / 极端时序下可能取不到锚点，这里做有限重试后放弃。
        var tries = 0;
        var timer = setInterval(function () {
            tries++;
            if (mount()) {
                clearInterval(timer);
                return;
            }
            if (tries > 60) {
                clearInterval(timer);
                console.warn('[wei8-weather-settings] 未找到设置面板锚点，跳过注入');
            }
        }, 250);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }

    // 给自动化校验一个可断言的句柄
    window.__wei8WeatherSettings = {
        mount: mount,
        readCfg: readCfg,
        writeCfg: writeCfg,
        clearWeatherCache: clearWeatherCache,
    };
})();
