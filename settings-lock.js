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
 *   - v3.12（老板需求）：密码可在设置面板里更改 —— 存 localStorage['wei8-lock-pass']，
 *     未设置时回落到默认常量 PASS。改动入口 = 面板顶部「锁屏密码」区块，
 *     **必须先输入当前密码**才能改（防身边人顺手改掉密码绕过锁）。
 *     密码只存本机、不进 Gist 同步；忘掉后进不去设置，数据可从 Gist 备份恢复。
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

    var PASS = '2026'; // ← 默认密码（明文；站点公开，见上方强度说明）
    var PASS_KEY = 'wei8-lock-pass'; // 用户改过的密码存这里；没改过就用默认 PASS
    var UNLOCK_HOURS = 12; // ← 解锁后免输时长（小时）
    var KEY = 'wei8-settings-unlock';

    var ROOT = document.documentElement;

    // 取当前生效密码：用户设置过的优先，否则默认
    function getPass() {
        try {
            var v = localStorage.getItem(PASS_KEY);
            return v !== null && v !== '' ? v : PASS;
        } catch (e) {
            return PASS;
        }
    }

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

    // 启动公共段（v3.15）：密码区块挂载 + 幂等重挂，锁不锁屏都要跑
    function bootPass() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function () {
                buildPassSection();
                watchPassSection();
            }, { once: true });
        } else {
            buildPassSection();
            watchPassSection();
        }
    }

    if (readUntil() > Date.now()) {
        // 仍在免输窗口内：锁不生效，但「更改密码」入口照常提供（老板 v3.12 需求）
        bootPass();
        return;
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
        if (v === getPass()) {
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
        document.addEventListener('DOMContentLoaded', function () {
            buildPassSection();
            watchPassSection();
            build();
        }, { once: true });
    } else {
        buildPassSection();
        watchPassSection();
        if (!build()) {
            // 理论上 defer 脚本执行时 DOM 已解析完；万一没有，退到 DOMContentLoaded 再试一次
            document.addEventListener('DOMContentLoaded', build, { once: true });
        }
    }

    // ==================== v3.12 设置面板「锁屏密码」区块 ====================
    // 位置（v3.15 起老板定稿）：「设置管理」区块（#settings-management_title）的**区块内
    // 顶部** —— 跟同步/导入导出等管理功能放一栏，不再单独占一栏。找不到该锚点时回落
    // 到 v3.12 的旧位置（#general_title 之前），防上游改版后区块凭空消失。
    // 皮肤复用上游类（.settings-title / .param / .wrapper / .param-btn），
    // 表单自身的样式由本脚本注入第二个 <style>（与锁屏同思路：安全相关 UI 不依赖外部 CSS）。
    // ★ 中文标签绝不能挂上游的 i18n 类（那个钩子会改写/清空自建节点文本）。
    // ★ 锁屏期间本区块被 #wei8-lock 遮罩盖住（absolute inset:0 z-index:999），点不到
    //   —— 必须先过锁，再加上「保存」要验当前密码，双重防止身边人改密码。
    // ★ v3.15 幂等重挂：上游某些路径（如语言切换重渲染）理论上可能动到面板 DOM，
    //   MutationObserver 盯着 aside，区块一旦不在就立刻补回（buildPassSection 幂等）。
    var PASS_CSS = [
        '#wei8-pass-form { display: none; flex-direction: column; gap: .5em; margin-top: .55em; }',
        '#wei8-pass-form.open { display: flex; }',
        '#wei8-pass-form input {',
        '  font: inherit; font-size: .95em; padding: .5em .7em; border-radius: 10px; outline: none;',
        '  border: 1px solid var(--color-border, #c8c7cc);',
        '  background: var(--color-input, #eaeaee); color: var(--color-text, #222);',
        '  letter-spacing: .18em;',
        '}',
        '#wei8-pass-form input::placeholder { letter-spacing: normal; opacity: .6; }',
        '.wei8-pass-row { display: flex; gap: .6em; }',
        '.wei8-pass-row button {',
        '  font: inherit; font-size: .9em; padding: .45em 1.15em; border: 0; cursor: pointer;',
        '  border-radius: 999px; background: rgb(var(--accent-color, 41 144 255) / .15);',
        '  color: rgb(var(--accent-color, 41 144 255));',
        '}',
        '.wei8-pass-row button.ghost { background: none; color: var(--color-light-text, #5a5858); }',
        '.wei8-pass-msg { min-height: 1.1em; font-size: .85em; }',
        '.wei8-pass-msg.bad { color: rgb(var(--danger-color, 230 75 67)); }',
        '.wei8-pass-msg.good { color: rgb(var(--color-green, 80 200 120)); }',
        '.wei8-pass-note { font-size: .8em; line-height: 1.5; opacity: .7; margin-top: .15em; }',
    ].join('\n');

    function mkPassInput(placeholder) {
        var i = document.createElement('input');
        i.type = 'password';
        i.autocomplete = 'off';
        i.maxLength = 16;
        i.placeholder = placeholder;
        i.setAttribute('aria-label', placeholder);
        return i;
    }

    function buildPassSection() {
        var aside = document.getElementById('settings');
        // v3.15：首选「设置管理」栏内顶部；找不到再回落旧的通用栏锚点
        var anchor = document.getElementById('settings-management_title') ||
            document.getElementById('general_title');
        if (!aside || !anchor) return false;
        if (document.getElementById('wei8-pass-section')) return true; // 幂等

        var style = document.createElement('style');
        style.id = 'wei8-pass-style';
        style.textContent = PASS_CSS;
        (document.head || ROOT).appendChild(style);

        var section = document.createElement('div');
        section.id = 'wei8-pass-section';

        var title = document.createElement('div');
        title.className = 'settings-title';
        var h2 = document.createElement('h2');
        h2.textContent = '锁屏';
        title.appendChild(h2);

        var param = document.createElement('div');
        param.className = 'param';

        var wrapper = document.createElement('div');
        wrapper.className = 'wrapper';

        var label = document.createElement('span');
        label.textContent = '锁屏密码';

        var toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'param-btn';
        toggle.textContent = '更改密码';

        wrapper.appendChild(label);
        wrapper.appendChild(toggle);

        var form = document.createElement('div');
        form.id = 'wei8-pass-form';

        var cur = mkPassInput('当前密码');
        var next = mkPassInput('新密码（至少 4 位）');
        var again = mkPassInput('再输一遍新密码');

        var msg = document.createElement('div');
        msg.className = 'wei8-pass-msg';

        var note = document.createElement('div');
        note.className = 'wei8-pass-note';
        note.textContent =
            '密码只保存在本机浏览器、不上云不同步。改过后请记牢：忘了将进不去设置（数据可用 Gist 备份恢复）。';

        var row = document.createElement('div');
        row.className = 'wei8-pass-row';

        var save = document.createElement('button');
        save.type = 'button';
        save.textContent = '保存';

        var cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'ghost';
        cancel.textContent = '取消';

        row.appendChild(save);
        row.appendChild(cancel);

        form.appendChild(cur);
        form.appendChild(next);
        form.appendChild(again);
        form.appendChild(msg);
        form.appendChild(row);
        form.appendChild(note);

        param.appendChild(wrapper);
        param.appendChild(form);

        section.appendChild(title);
        section.appendChild(param);

        function resetForm() {
            form.classList.remove('open');
            [cur, next, again].forEach(function (i) { i.value = ''; });
            msg.textContent = '';
            msg.className = 'wei8-pass-msg';
        }

        toggle.addEventListener('click', function () {
            var open = !form.classList.contains('open');
            form.classList.toggle('open', open);
            if (open) {
                cur.focus();
            } else {
                resetForm();
            }
        });

        cancel.addEventListener('click', resetForm);

        save.addEventListener('click', function () {
            var c = (cur.value || '').trim();
            var n = (next.value || '').trim();
            var a = (again.value || '').trim();
            msg.textContent = '';
            msg.className = 'wei8-pass-msg';
            if (c !== getPass()) {
                msg.textContent = '当前密码不对';
                msg.className = 'wei8-pass-msg bad';
                cur.value = '';
                cur.focus();
                return;
            }
            if (n.length < 4) {
                msg.textContent = '新密码至少 4 位';
                msg.className = 'wei8-pass-msg bad';
                next.focus();
                return;
            }
            if (n !== a) {
                msg.textContent = '两次新密码不一致';
                msg.className = 'wei8-pass-msg bad';
                again.focus();
                return;
            }
            try {
                localStorage.setItem(PASS_KEY, n);
            } catch (e) {
                msg.textContent = '保存失败（浏览器存储不可用）';
                msg.className = 'wei8-pass-msg bad';
                return;
            }
            window.__wei8Lock.passSet = true; // 可观测标记（探针断言用）
            msg.textContent = '密码已更新，下次解锁生效';
            msg.className = 'wei8-pass-msg good';
            [cur, next, again].forEach(function (i) { i.value = ''; });
            // 收起表单但保留成功提示几秒的做法太复杂；这里直接保留展开状态 + 成功文案
        });

        // v3.15：「设置管理」栏内顶部 = 标题元素的下一个兄弟位；旧锚点（general_title）
        // 则是插在它**前面**（v3.12 行为不变）。
        if (anchor.id === 'settings-management_title') {
            anchor.parentNode.insertBefore(section, anchor.nextSibling);
        } else {
            anchor.parentNode.insertBefore(section, anchor);
        }
        return true;
    }

    // v3.15 幂等重挂：区块一旦从面板里消失（任何上游 DOM 变动），立刻补回。
    // observer 回调里插入 section 会再触发一次回调 → buildPassSection 幂等守卫直接
    // return true，不会死循环。
    function watchPassSection() {
        var aside = document.getElementById('settings');
        if (!aside || typeof MutationObserver === 'undefined') return;
        new MutationObserver(function () {
            if (!document.getElementById('wei8-pass-section')) {
                buildPassSection();
            }
        }).observe(aside, { childList: true, subtree: true });
    }
})();
