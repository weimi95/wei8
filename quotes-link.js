/* quotes-link.js — Wei8 首页引言超链接（v3.13）
 * ---------------------------------------------------------------------------
 * 需求（老板）：给首页的「引言」加一个超链接，点了在**新标签页**打开
 *   https://weimi95.github.io/ （阿伟主页）。
 *
 * 实现取舍：
 *   - 上游 insertToDom()（main.js:6091-6099）只重写 #quote / #author 两个 <p> 的
 *     textContent，**容器 #quotes_container 是 index.html 里的静态节点、从不重建**
 *     → 把 click 绑在容器上，换引言、重渲染都不会把它冲掉，一行都不用碰上游。
 *   - 不把文本包进 <a>：包了会在上游重绘文本时被冲掉（textContent 覆写），要一直
 *     重包，得不偿失。click + window.open(_blank) 对老板的诉求（点一下、新标签打开）
 *     完全等价。
 *   - 视觉提示只做最轻的两样：cursor:pointer + title 提示，不抢引言的排版。
 *   - 幂等守卫：dataset 标记 + window.__wei8QuotesLink 可观测标记（探针断言用）。
 * ---------------------------------------------------------------------------
 */
(function () {
    'use strict';

    if (window.__wei8QuotesLink) {
        return; // 防重复包含留下第二份监听
    }

    var HOME = 'https://weimi95.github.io/';

    window.__wei8QuotesLink = { bound: false, hits: 0, lastUrl: null };

    function bind() {
        var box = document.getElementById('quotes_container');
        if (!box || box.dataset.wei8Link === '1') {
            window.__wei8QuotesLink.bound = !!box;
            return !!box;
        }
        box.dataset.wei8Link = '1';
        box.style.cursor = 'pointer';
        box.title = '点击访问阿伟的主页（新标签打开）';
        box.addEventListener('click', function () {
            window.__wei8QuotesLink.hits++;
            window.__wei8QuotesLink.lastUrl = HOME;
            window.open(HOME, '_blank', 'noopener');
        });
        window.__wei8QuotesLink.bound = true;
        return true;
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bind, { once: true });
    } else {
        bind();
    }
})();
