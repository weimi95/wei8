/* sync-patch.js — Wei8 同步修复层（Github Gist）
 * ---------------------------------------------------------------------------
 * 上游有一个只在「纯网页（online）构建」下发作的 bug，会让 Gist 同步**首次永远失败**：
 *
 *   1. storage.ts:214 localSet() 在 localstorage 模式下逐键写：
 *        if (typeof val === 'string') localStorage.setItem(key, val)
 *        else localStorage.setItem(key, JSON.stringify(val))
 *      当 val 是 undefined 时走 else 分支，而 **JSON.stringify(undefined) 返回的是 JS 的
 *      undefined（不是字符串 "undefined"）**，交给 setItem 后按 WebIDL 被转成字符串
 *      "undefined" 存了进去。
 *
 *   2. storage.ts:237 localGet() 读回时只认三种形态：{/[ 开头的 JSON、true/false、纯数字；
 *      剩下的原样返回字符串 → 于是 local.gistId 变成**字符串 "undefined"**（真值）。
 *
 *   3. gist.ts:116 sendGist() 靠 `id === undefined` 判断「还没有 Gist，去新建一个」。
 *      字符串 "undefined" 不等于 undefined → **新建分支永远进不去**，
 *      转而走到 gist.ts:135 isGistIdValid("undefined") → 'u' 不是十六进制 → false
 *      → 抛 GIST_ERROR.ID = "Invalid Gist ID in settings."
 *
 * 触发条件（几乎人人都会踩）：填了有效 token → 提交 → findGistId() 在账号里找不到
 * 名为 bonjourr-export.json 的私有 gist（首次当然没有）→ 返回 undefined → 落盘成脏值。
 * 此时界面显示「尚无保存的数据」（正常），但一按「发送」就报 Gist ID 无效。
 *
 * 另一个迷惑源：isGistTokenValid() 打的是 `GET /gists?since=...`，该端点
 * `allows_permissionless_access=true`（实测：细粒度 token 无 Gists 权限也返回 200），
 * 所以两个按钮会被正常点亮 —— 看起来"token 没问题"，实际 token 可能根本没有 gist 写权限。
 * 实测无 Gists 权限的细粒度 PAT：POST /gists -> 403，
 * 响应头 x-accepted-github-permissions: gists=write。
 * → 需要 Account permissions → Gists → Read and write（classic token 则是勾 gist scope）。
 *
 * 本层做两件事：
 *   A. 装载期 + 点「发送/得到」前，把这种「被写成字符串的 undefined/null/NaN」清掉，
 *      让 gistId 真正回到 undefined，使上游的新建分支能正常命中。
 *      （必须在点按钮**之前**清：上游是 pointerdown 触发的，所以用 document 捕获阶段抢先。）
 *   B. 在同步区块补一行纯中文提示，说明「首次点发送会自动建 Gist」+「token 权限要求」。
 *      这两个是使用 Gist 同步唯二的坑，上游界面上一个字都没提。
 *
 * 注意：本层只清「明显是序列化残渣」的值，不动任何正常字符串。
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
    window.__wei8Sync = { cleaned: cleaned, hits: 0 };

    // A) 抢先清理 —— 上游的「得到 / 发送」是 clickdown 库挂在**按钮自身**上的
    //    pointerdown/keydown/click，所以 document 的**捕获阶段**一定先执行。
    //    不清这一步，用户「提交 token 后立刻点发送」这一路径仍然会报 Gist ID 无效。
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
})();
