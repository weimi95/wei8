/*
 * Wei8 搜索增强层（不改 Bonjourr 上游源码）
 * ------------------------------------------------------------
 * 给 Bonjourr 的搜索框「左侧」加搜索引擎下拉、「上方」加分类标签（网页/图片/资讯/视频/地图）。
 *
 * 为什么能不改源码就换搜索引擎？（依据 bonjourr-src/src/scripts/features/searchbar.ts）
 *   - createSearchUrl() 把 engine 映射到写死的 URL 表，合法 engine 只有
 *     default, google, ddg, startpage, qwant, yahoo, bing, brave, ecosia, lilo, baidu, custom。
 *   - isValidEngine() 拒绝表外值 → 返回 about:blank。所以我们不能自造 engine id。
 *   - 表里有 custom：urls.custom = domcontainer?.dataset.request || ''。
 *   - 因此做法：把 #sb_container 的 dataset.engine 设成 'custom'，dataset.request 设成我们的 URL 模板（含 %s）。
 *   - 安全点：createSearchUrl 里 `const localizedEngine = tradThis(engine); result = localizedEngine.includes('%s') ? localizedEngine : urls[engine]`。
 *     zh-CN 语言包只有大写 "Custom" 键、没有小写 "custom"（已验证 translations.json:325），
 *     故 tradThis('custom') 返回字面量 'custom'（不含 %s）→ 安全回落到 urls.custom。此判断不要动。
 *   - 提交监听 submitSearch 挂在 form（#sb_container）自身，事件 target 即 form；
 *     所以挂在 document 上的捕获阶段（capture=true）submit 监听会先于它执行，我们在那里再写一遍 dataset，兜底。
 */
(function () {
    'use strict';

    // ====== 引擎 × 分类 URL 模板表（逐字使用团队已实测的可用性表）======
    // 写进 dataset.request 的是 URL 模板本身（含 %s），不是引擎 id；引擎 id 仅作内部键。
    var TPL = {
        baidu: {
            web: 'https://www.baidu.com/s?wd=%s',
            image: 'https://image.baidu.com/search/index?tn=baiduimage&word=%s',
            news: 'https://www.baidu.com/s?rtt=1&bsst=1&cl=2&tn=news&word=%s',
            video: 'https://www.baidu.com/sf/vsearch?pd=video&tn=vsearch&word=%s',
            map: 'https://map.baidu.com/search/%s'
        },
        bing: {
            web: 'https://cn.bing.com/search?q=%s',
            image: 'https://cn.bing.com/images/search?q=%s',
            news: 'https://cn.bing.com/news/search?q=%s',
            video: 'https://cn.bing.com/videos/search?q=%s',
            map: 'https://cn.bing.com/maps?q=%s'
        },
        so360: {
            web: 'https://www.so.com/s?q=%s',
            image: 'https://image.so.com/i?q=%s',
            news: 'https://news.so.com/ns?q=%s',
            video: 'https://www.so.com/s?q=%s&src=video',
            map: 'https://ditu.so.com/?k=%s'
        },
        sogou: {
            web: 'https://www.sogou.com/web?query=%s',
            image: 'https://pic.sogou.com/pics?query=%s',
            news: 'https://news.sogou.com/news?query=%s',
            video: 'https://v.sogou.com/v?query=%s',
            // 搜狗地图域名已注销（map.sogou.com 实测 ENOTFOUND）→ 用腾讯地图兜底
            map: 'https://map.qq.com/?type=geocode&keyword=%s'
        },
        sgoogle: {
            web: 'https://www.google.com/search?q=%s',
            image: 'https://www.google.com/search?tbm=isch&q=%s',
            news: 'https://www.google.com/search?tbm=nws&q=%s',
            video: 'https://www.google.com/search?tbm=vid&q=%s',
            map: 'https://www.google.com/maps/search/%s'
        },
        toutiao: {
            web: 'https://so.toutiao.com/search?keyword=%s',
            image: 'https://so.toutiao.com/search?keyword=%s&pd=atlas',
            news: 'https://so.toutiao.com/search?keyword=%s&pd=information',
            video: 'https://so.toutiao.com/search?keyword=%s&pd=video',
            // 头条无地图：&pd=map 实测与无参页面完全一致（无效）→ 回落到自身「网页」模板
            map: 'https://so.toutiao.com/search?keyword=%s'
        }
    };

    var ENGINES = [
        { id: 'baidu', name: '百度' },
        { id: 'bing', name: '必应' },
        { id: 'so360', name: '360' },
        { id: 'sogou', name: '搜狗' },
        { id: 'sgoogle', name: '谷歌' },
        { id: 'toutiao', name: '头条' }
    ];

    var TABS = [
        { id: 'web', name: '网页' },
        { id: 'image', name: '图片' },
        { id: 'news', name: '资讯' },
        { id: 'video', name: '视频' },
        { id: 'map', name: '地图' }
    ];

    var STORE_KEY = 'wei8-search';
    var DEFAULT = { e: 'baidu', t: 'web' };

    var built = false;
    var started = false;
    var state = { e: DEFAULT.e, t: DEFAULT.t };

    // 模块级缓存的 DOM 引用
    var sb = null; // #sb_container（Bonjourr 读 dataset 的容器 / 提交事件 target）
    var wrapper = null; // #searchbar-wrapper
    var searchbar = null; // #searchbar
    var tabsEl = null;
    var engineEl = null;
    var engineBtn = null;
    var engineList = null;

    function $(id) {
        try {
            return document.getElementById(id);
        } catch (e) {
            return null;
        }
    }

    function engineName(id) {
        for (var i = 0; i < ENGINES.length; i++) if (ENGINES[i].id === id) return ENGINES[i].name;
        return id;
    }

    // 读取持久化状态；e 不在引擎表 / t 不在分类表 → 各自回落默认值。
    function loadState() {
        try {
            var raw = localStorage.getItem(STORE_KEY);
            if (raw) {
                var o = JSON.parse(raw);
                if (o && typeof o === 'object') {
                    state.e = o.e && TPL[o.e] ? o.e : DEFAULT.e;
                    state.t = o.t && TPL[state.e] && TPL[state.e][o.t] ? o.t : DEFAULT.t;
                }
            }
        } catch (e) {
            /* 解析失败静默回落默认 */
        }
    }

    function saveState() {
        try {
            localStorage.setItem(STORE_KEY, JSON.stringify({ e: state.e, t: state.t }));
        } catch (e) {
            /* 隐私模式等写入失败静默吞掉 */
        }
    }

    // 核心：把当前选择写进 Bonjourr 实际读取的 dataset。
    // engine='custom' 时 createSearchUrl 返回 urls.custom = dataset.request。
    function applySelection() {
        if (!sb) return;
        try {
            sb.dataset.engine = 'custom';
            sb.dataset.request =
                TPL[state.e] && TPL[state.e][state.t] ? TPL[state.e][state.t] : TPL[DEFAULT.e][DEFAULT.t];
        } catch (e) {
            /* 极端情况下 dataset 不可写，忽略 */
        }
    }

    function updateTabsUI() {
        if (!tabsEl) return;
        var kids = tabsEl.children;
        for (var i = 0; i < kids.length; i++) {
            var k = kids[i];
            if (k && k.dataset && k.dataset.tab) {
                if (k.dataset.tab === state.t) k.classList.add('selected');
                else k.classList.remove('selected');
            }
        }
    }

    function updateEngineUI() {
        if (engineBtn) engineBtn.textContent = engineName(state.e);
        if (!engineList) return;
        var kids = engineList.children;
        for (var i = 0; i < kids.length; i++) {
            var k = kids[i];
            if (k && k.dataset && k.dataset.engine) {
                if (k.dataset.engine === state.e) k.classList.add('selected');
                else k.classList.remove('selected');
            }
        }
    }

    function focusSearch() {
        try {
            if (searchbar && searchbar.focus) searchbar.focus();
        } catch (e) {}
    }

    function selectTab(t) {
        if (!(TPL[state.e] && TPL[state.e][t])) return; // 不合法的 tab 忽略
        state.t = t;
        saveState();
        applySelection();
        updateTabsUI();
        focusSearch();
    }

    function selectEngine(e) {
        if (!TPL[e]) return; // 不合法的引擎忽略
        state.e = e;
        saveState();
        applySelection();
        updateEngineUI();
        closeList();
        focusSearch();
    }

    // 供测试直接调用的统一入口（等价于一次引擎+分类切换，不依赖点击/焦点）
    function select(e, t) {
        if (TPL[e] && TPL[e][t]) {
            state.e = e;
            state.t = t;
        } else if (TPL[e]) {
            state.e = e;
            state.t = DEFAULT.t;
        }
        saveState();
        applySelection();
        updateTabsUI();
        updateEngineUI();
    }

    function openList() {
        if (engineList) engineList.classList.add('shown');
    }
    function closeList() {
        if (engineList) engineList.classList.remove('shown');
    }
    function toggleList() {
        if (engineList) engineList.classList.toggle('shown');
    }

    function buildTabs() {
        tabsEl = document.createElement('div');
        tabsEl.id = 'wei8-search-tabs';
        tabsEl.setAttribute('role', 'tablist');
        for (var i = 0; i < TABS.length; i++) {
            var b = document.createElement('button');
            b.type = 'button'; // 在 form 内，必须显式 type=button 否则会触发表单提交
            b.id = 'wei8-tab-' + TABS[i].id;
            b.className = 'wei8-tab';
            b.dataset.tab = TABS[i].id;
            b.textContent = TABS[i].name;
            (function (tid) {
                b.addEventListener('click', function () {
                    selectTab(tid);
                });
            })(TABS[i].id);
            tabsEl.appendChild(b);
        }
    }

    function buildEngine() {
        engineEl = document.createElement('div');
        engineEl.id = 'wei8-engine';

        engineBtn = document.createElement('button');
        engineBtn.type = 'button';
        engineBtn.id = 'wei8-engine-btn';
        engineBtn.setAttribute('aria-haspopup', 'listbox');
        engineBtn.textContent = engineName(state.e);
        engineBtn.addEventListener('click', function (e) {
            if (e && e.stopPropagation) e.stopPropagation();
            toggleList();
        });

        engineList = document.createElement('div');
        engineList.id = 'wei8-engine-list';
        engineList.setAttribute('role', 'listbox');
        for (var i = 0; i < ENGINES.length; i++) {
            var item = document.createElement('button');
            item.type = 'button';
            item.id = 'wei8-engine-item-' + ENGINES[i].id;
            item.className = 'wei8-engine-item';
            item.dataset.engine = ENGINES[i].id;
            item.setAttribute('role', 'option');
            item.textContent = ENGINES[i].name;
            (function (eid) {
                item.addEventListener('click', function (ev) {
                    if (ev && ev.stopPropagation) ev.stopPropagation();
                    selectEngine(eid);
                });
            })(ENGINES[i].id);
            engineList.appendChild(item);
        }

        engineEl.appendChild(engineBtn);
        engineEl.appendChild(engineList);
    }

    function build() {
        if (built) return;
        sb = $('sb_container');
        wrapper = $('searchbar-wrapper');
        searchbar = $('searchbar');
        if (!sb || !wrapper) return; // 找不到元素直接放弃，不抛错

        buildTabs();
        buildEngine();

        try {
            // tabs 作为 #sb_container 的第一个子节点（在 searchbar-wrapper 之前）
            sb.insertBefore(tabsEl, sb.firstChild);
            // 引擎控件作为 #searchbar-wrapper 的第一个子节点（在 #searchbar 之前）
            wrapper.insertBefore(engineEl, wrapper.firstChild);
        } catch (e) {
            return;
        }

        // Escape 关闭下拉；点击下拉外部关闭
        try {
            document.addEventListener('keydown', function (e) {
                if (e && e.key === 'Escape') closeList();
            });
            document.addEventListener('click', function (e) {
                if (!engineEl || !engineList) return;
                if (!engineList.classList.contains('shown')) return;
                var t = e && e.target;
                var p = t;
                while (p) {
                    if (p === engineEl) return; // 落在引擎控件内部，由各自 handler 处理
                    p = p.parentNode;
                }
                closeList();
            });
        } catch (e) {}

        built = true;
    }

    // 初始化：只在 #sb_container 存在且未隐藏（Bonjourr 已显示搜索框）后构建，且幂等。
    function init() {
        try {
            sb = $('sb_container');
            wrapper = $('searchbar-wrapper');
            searchbar = $('searchbar');
            if (!sb) return; // 断言 #9：DOM 里完全没有容器也不抛错
            if (sb.classList.contains('hidden')) return; // 等 Bonjourr 初始化完（去掉 hidden）再构建
            if (built) return; // 幂等：重复调用不重复插入节点
            loadState();
            build();
            applySelection();
            updateTabsUI();
            updateEngineUI();
        } catch (e) {
            /* 整体 try/catch 兜底，绝不向上抛 */
        }
    }

    function start() {
        if (started) return;
        started = true;
        try {
            // 兜底轮询：每 100ms 检查，最多 ~200 次（20s）。与 MutationObserver 任选其一，都保证只构建一次。
            var tries = 0;
            var timer = setInterval(function () {
                tries++;
                init();
                if (built || tries > 200) {
                    try {
                        clearInterval(timer);
                    } catch (e) {}
                }
            }, 100);
            // MutationObserver 监听 #sb_container 的 class 变化（去掉 hidden 时构建）
            if (typeof MutationObserver !== 'undefined') {
                try {
                    var obs = new MutationObserver(function () {
                        init();
                    });
                    var c = $('sb_container');
                    if (c) obs.observe(c, { attributes: true, attributeFilter: ['class'] });
                } catch (e) {}
            }
            init(); // 立即尝试一次（DOM 已就绪时直接构建）
        } catch (e) {}
    }

    // 提交前兜底：document 捕获阶段 submit 监听先于 form 自身的 submitSearch 执行，
    // 保证 Bonjourr 读到的永远是当前选择（见 searchbar.ts：domcontainer.addEventListener('submit', submitSearch)）。
    function captureSubmit() {
        try {
            applySelection();
        } catch (err) {}
    }

    // ====== 启动 ======
    if (typeof document !== 'undefined') {
        try {
            document.addEventListener('submit', captureSubmit, true);
        } catch (e) {}
        start();
    }

    // 暴露幂等入口与内部表，供 verify_searchext.js 真执行测试（避免依赖定时器）
    if (typeof window !== 'undefined') {
        window.__wei8SearchExt = {
            init: init,
            start: start,
            select: select,
            selectTab: selectTab,
            selectEngine: selectEngine,
            applySelection: applySelection,
            _TPL: TPL,
            _state: function () {
                return { e: state.e, t: state.t };
            }
        };
        window.__wei8SearchExtInit = init;
    }
})();
