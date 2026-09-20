/* settings-lock.js — Wei8 设置面板密码锁
 * ---------------------------------------------------------------------------
 * 需求（老板）：进设置要先输密码（2026）。
 *
 * 设计取舍 —— 为什么是「遮罩」而不是「拦截事件」：
 *   上游打开设置面板有不止一条路径：`#show-settings` 的 pointerdown（settings.ts:58）、
 *   body 上的 Escape keydown（settings.ts:57）、右键菜单里的 [data-action="openTheseSettings"]
 *   （settings.ts:60-66），后续每次开关还走 document 上的 click 分发（events.ts:138-140）
 *   → 最终都汇到 `new CustomEvent('toggle-settings')`。
 *   如果去逐个拦截这些事件，就要在解锁后**重放合成事件**才能打开面板，而首次打开还要同时
 *   命中 init 与 toggle 两条链路 —— 一旦拦错，老板会**彻底打不开设置**（不可接受的失败模式）。
 *
 *   本层改为：**完全不碰上游的事件流**，面板照常打开，但在它上面盖一层自带的锁屏。
 *   - 上游零耦合 → 不会出现"锁坏了导致打不开设置"；
 *   - 解锁后遮罩消失即用，无需重放任何事件，不存在双重开关；
 *   - 失效模式是"打开但看不到内容"，永远比"打不开"安全。
 *
 * 实现要点：
 *   - `html.wei8-locked` 标记整机锁定；遮罩 `#wei8-lock` 插在 `aside#settings` 首位。
 *   - 显隐条件纯 CSS：`html.wei8-locked aside.shown #wei8-lock { display: flex }`
 *     —— 直接复用上游自己的 `.shown` 状态，不需要 MutationObserver 去跟（少一处可能失同步的状态）。
 *   - 锁定期间给 `aside` 加 `overflow: hidden`，否则面板可滚动时 absolute 遮罩会跟着滚走。
 *   - 焦点陷阱：锁定期间把焦点圈在锁屏内，堵掉「Tab 到面板控件再按空格」这条绕过。
 *   - 样式由本脚本自己注入 `<style>`，不新增 CSS 文件：安全相关的 UI 不该依赖
 *     "样式表有没有正确加载/缓存有没有破" 这类外部条件。
 *   - 解锁状态存 localStorage，默认 12 小时免输（UNLOCK_HOURS）。改这个数字即可调整。
 *
 * 强度说明（务必对老板讲清）：这是**防身边人**的锁，不是安全边界。
 *   站点源码公开、密码明文写在下面，且清一下 localStorage 即可绕过。
 *   要更硬需要服务端校验，那不是纯静态站能提供的能力。
 * ---------------------------------------------------------------------------
 */
(function () {
    'use strict';

    // 已被加载过就直接退出：后面会挂 document 级监听与 MutationObserver，
    // 重复执行会留下第二份监听（虽然正常只会被 index.html 引入一次，但这类"脚本被包含两次"
    // 的意外在拼产物/做注入时并不罕见，加一行守卫成本极低）。
    if (window.__wei8Lock) {
        return;
    }

    var PASS = '2026'; // ← 密码（明文；站点公开，见上方强度说明）
    var UNLOCK_HOURS = 12; // ← 解锁后免输时长（小时）
    var KEY = 'wei8-settings-unlock';

    var ROOT = document.documentElement;

    function readUntil() {
        try {
            var t = parseInt(localStorage.getItem(KEY) || '0', 10);
            return Number.isFinite(t) ? t : 0;
        } catch (e) {
            return 0;
        }
    }

    var mark = { locked: false, tries: 0, until: 0 };
    window.__wei8Lock = mark;

    if (readUntil() > Date.now()) {
        return; // 仍在免输窗口内，什么都不做
    }

    mark.locked = true;
    ROOT.classList.add('wei8-locked');

    var CSS = [
        // 锁定期间面板不许滚动，否则 absolute 遮罩会被滚走
        'html.wei8-locked aside { overflow: hidden; }',
        '#wei8-lock {',
        '  display: none;',
        '  position: absolute; inset: 0; z-index: 999;',
        '  flex-direction: column; align-items: center; justify-content: center; gap: .85em;',
        '  box-sizing: border-box; padding: 2em 1.6em; text-align: center;',
        '  background: var(--color-settings, #f2f2f7); color: var(--color-text, #222);',
        '}',
        // 面板自己的 .shown 就是唯一真源：它一出现，锁屏就盖上
        'html.wei8-locked aside.shown #wei8-lock { display: flex; }',
        '#wei8-lock .t { margin: 0; font-size: 1.05em; font-weight: 600; }',
        '#wei8-lock .d { margin: 0; max-width: 17em; font-size: .85em; line-height: 1.55; opacity: .72; }',
        '#wei8-lock input {',
        '  width: 8.5em; padding: .55em .2em; text-align: center; letter-spacing: .35em;',
        '  font: inherit; font-size: 1.05em; border-radius: 10px; outline: none;',
        '  border: 1px solid var(--color-border, #c8c7cc);',
        '  background: var(--color-input, #eaeaee); color: var(--color-text, #222);',
        '}',
        '#wei8-lock .row { display: flex; gap: .6em; align-items: center; }',
        '#wei8-lock button {',
        '  font: inherit; font-size: .95em; padding: .5em 1.15em; border: 0; cursor: pointer;',
        '  border-radius: 999px; background: rgb(var(--accent-color, 41 144 255) / .15);',
        '  color: rgb(var(--accent-color, 41 144 255));',
        '}',
        '#wei8-lock button.ghost { background: none; color: var(--color-light-text, #5a5858); }',
        '#wei8-lock .err { min-height: 1.2em; font-size: .85em; color: rgb(var(--danger-color, 230 75 67)); }',
    ].join('\n');

    var box = null;
    var input = null;
    var errLine = null;
    var asideEl = null;

    // ★ 焦点陷阱只在「面板真的打开着」时生效。
    //   否则它会跟页面上的正常输入抢焦点 —— 本站有搜索框，锁着的时候用户
    //   一点搜索框就会被这里把焦点抢走，变成打不了字。这个判断不能省。
    function onFocusIn(e) {
        if (!ROOT.classList.contains('wei8-locked')) return;
        if (!asideEl || !asideEl.classList.contains('shown')) return;
        if (!box || !box.isConnected) return;
        if (e.target && box.contains(e.target)) return;
        if (input) input.focus();
    }

    function unlock() {
        mark.locked = false;
        mark.until = Date.now() + UNLOCK_HOURS * 3600 * 1000;
        try {
            localStorage.setItem(KEY, String(mark.until));
        } catch (e) {
            /* 隐私模式，忽略：本次会话内仍已解锁 */
        }
        ROOT.classList.remove('wei8-locked');
        document.removeEventListener('focusin', onFocusIn, true);
    }

    function tryPass() {
        if (!input) return;
        mark.tries++;
        var v = (input.value || '').trim();
        if (v === PASS) {
            unlock();
            return;
        }
        errLine.textContent = '密码不对';
        input.value = '';
        input.focus();
    }

    function build() {
        var aside = document.getElementById('settings');
        if (!aside) return false;
        asideEl = aside;
        if (document.getElementById('wei8-lock')) return true; // 幂等

        var style = document.createElement('style');
        style.id = 'wei8-lock-style';
        style.textContent = CSS;
        (document.head || ROOT).appendChild(style);

        box = document.createElement('div');
        box.id = 'wei8-lock';

        var title = document.createElement('p');
        title.className = 't';
        title.textContent = '本站设置已加锁';

        var desc = document.createElement('p');
        desc.className = 'd';
        desc.textContent = '输入密码后即可进入设置。解锁后 ' + UNLOCK_HOURS + ' 小时内免输。';

        input = document.createElement('input');
        input.type = 'password';
        input.inputMode = 'numeric';
        input.autocomplete = 'off';
        input.maxLength = 16;
        input.setAttribute('aria-label', '设置密码');
        input.placeholder = '密码';

        errLine = document.createElement('div');
        errLine.className = 'err';

        var row = document.createElement('div');
        row.className = 'row';

        var go = document.createElement('button');
        go.type = 'button';
        go.textContent = '进入';
        go.addEventListener('click', tryPass);

        var close = document.createElement('button');
        close.type = 'button';
        close.className = 'ghost';
        close.textContent = '关闭';
        close.addEventListener('click', function () {
            // 复用上游的开关入口，不自己动 .shown
            document.dispatchEvent(new CustomEvent('toggle-settings'));
        });

        row.appendChild(go);
        row.appendChild(close);

        box.appendChild(title);
        box.appendChild(desc);
        box.appendChild(input);
        box.appendChild(errLine);
        box.appendChild(row);

        // 锁屏上的按键不许传到上游（body 上挂着 Escape 等全局按键处理）
        box.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                tryPass();
            }
            e.stopPropagation();
        });
        input.addEventListener('input', function () {
            if (errLine.textContent) errLine.textContent = '';
        });

        aside.insertBefore(box, aside.firstChild);
        document.addEventListener('focusin', onFocusIn, true);

        // 面板每次滑出时把焦点送到输入框（面板是 fixed 的，聚焦不会引起页面滚动）
        new MutationObserver(function () {
            if (aside.classList.contains('shown') && box && box.isConnected && input) {
                input.focus();
            }
        }).observe(aside, { attributes: true, attributeFilter: ['class'] });

        return true;
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', build, { once: true });
    } else if (!build()) {
        // 理论上 defer 脚本执行时 DOM 已解析完；万一没有，退到 DOMContentLoaded 再试一次
        document.addEventListener('DOMContentLoaded', build, { once: true });
    }
})();
