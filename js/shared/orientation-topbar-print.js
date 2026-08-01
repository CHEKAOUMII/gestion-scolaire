/**
 * orientation-topbar-print.js — Mount a page's primary print control into the
 * sticky unified top bar (.header.unified-header.dashboard-topbar).
 *
 * setupUnifiedHeader() (js/utils.js) rebuilds .header on load, so controls must
 * be (re)mounted AFTER the header is unified. This helper MOVES an existing
 * control instead of cloning it, preserving page-local listeners and state.
 *
 * Dual-export: CommonJS (Node tests) + browser globals StickyTopbarPrint and
 * OrientationTopbarPrint (the legacy orientation-compatible alias).
 * Pure DOM placement + optional one-shot click wiring — no print content logic.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.StickyTopbarPrint = api;
        root.OrientationTopbarPrint = api;
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const PRINT_BTN_ID = 'print-btn';
    const PRINT_LABEL = 'معاينة الطباعة';
    const ORIENTATION_HOST_CLASS = 'orientation-topbar-actions';
    const PAGE_HOST_CLASS = 'page-topbar-actions';

    const ORIENTATION_DEFAULTS = {
        buttonId: PRINT_BTN_ID,
        buttonSelector: '#' + PRINT_BTN_ID,
        hostClass: ORIENTATION_HOST_CLASS,
        compatibilityHostClass: PAGE_HOST_CLASS,
        boundFlag: 'orientationPrintBound',
        label: PRINT_LABEL,
        buttonClassName: 'btn btn-success ux-print-preview-btn',
        createIfMissing: true,
        cleanupDuplicates: true,
        duplicateSelector: '.ux-print-preview-btn'
    };

    function uniqueStrings(values) {
        return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()))];
    }

    function normalizeOptions(options) {
        const source = options || {};
        const hasOwn = (key) => Object.prototype.hasOwnProperty.call(source, key);
        const buttonId = hasOwn('buttonId') ? source.buttonId : ORIENTATION_DEFAULTS.buttonId;
        const buttonSelector = hasOwn('buttonSelector')
            ? source.buttonSelector
            : buttonId
              ? '#' + buttonId
              : null;
        const hostClass = hasOwn('hostClass') ? source.hostClass : ORIENTATION_DEFAULTS.hostClass;
        const compatibilityHostClass = hasOwn('compatibilityHostClass')
            ? source.compatibilityHostClass
            : ORIENTATION_DEFAULTS.compatibilityHostClass;

        return {
            buttonId,
            buttonSelector,
            hostClass,
            compatibilityHostClass,
            hostClasses: uniqueStrings([hostClass, compatibilityHostClass]),
            boundFlag: hasOwn('boundFlag') ? source.boundFlag : ORIENTATION_DEFAULTS.boundFlag,
            label: hasOwn('label') ? source.label : ORIENTATION_DEFAULTS.label,
            buttonClassName: hasOwn('buttonClassName')
                ? source.buttonClassName
                : ORIENTATION_DEFAULTS.buttonClassName,
            createIfMissing: source.createIfMissing !== false,
            createButton: typeof source.createButton === 'function' ? source.createButton : null,
            cleanupDuplicates: source.cleanupDuplicates !== false,
            duplicateSelector: hasOwn('duplicateSelector')
                ? source.duplicateSelector
                : ORIENTATION_DEFAULTS.duplicateSelector,
            duplicateIds: uniqueStrings(
                hasOwn('duplicateIds') ? source.duplicateIds || [] : buttonId ? [buttonId] : []
            ),
            duplicateLabels: uniqueStrings(
                hasOwn('duplicateLabels') ? source.duplicateLabels || [] : [
                    hasOwn('label') ? source.label : ORIENTATION_DEFAULTS.label
                ]
            )
        };
    }

    /**
     * Find the sticky unified header, but only once setupUnifiedHeader has run.
     * Returns null while the header is still pre-unified markup.
     */
    function findUnifiedHeader(doc) {
        const header =
            doc.querySelector('main.main-content > .header.dashboard-topbar') ||
            doc.querySelector('main.main-content > .header.unified-header') ||
            doc.querySelector('.header.dashboard-topbar') ||
            doc.querySelector('.header.unified-header');
        if (!header) return null;
        const ready =
            (header.dataset && header.dataset.unifiedHeader === 'true') ||
            (header.classList && header.classList.contains('dashboard-topbar'));
        return ready ? header : null;
    }

    /** Scoped actions host inside .header-right, placed before #theme-toggle. */
    function ensureActionsHost(doc, header, options) {
        const headerRight = header.querySelector('.header-right') || header;
        let actions = null;
        for (const hostClass of options.hostClasses) {
            actions = headerRight.querySelector('.' + hostClass);
            if (actions) break;
        }

        if (!actions) {
            actions = doc.createElement('div');
            actions.setAttribute('role', 'group');
            actions.setAttribute('aria-label', 'إجراءات الصفحة');
            const themeToggle = headerRight.querySelector('#theme-toggle');
            if (
                themeToggle &&
                themeToggle.parentNode === headerRight &&
                typeof headerRight.insertBefore === 'function'
            ) {
                headerRight.insertBefore(actions, themeToggle);
            } else {
                headerRight.appendChild(actions);
            }
        }

        options.hostClasses.forEach((hostClass) => {
            if (actions.classList && typeof actions.classList.add === 'function') {
                actions.classList.add(hostClass);
            }
        });
        return actions;
    }

    function createPrintButton(doc, options) {
        if (options.createButton) return options.createButton(doc, options);

        const btn = doc.createElement('button');
        btn.type = 'button';
        if (options.buttonId) btn.id = options.buttonId;
        btn.className = options.buttonClassName;
        btn.title = options.label;
        btn.setAttribute('aria-label', options.label);
        btn.innerHTML =
            '<i class="fas fa-eye" aria-hidden="true"></i><span>' + options.label + '</span>';
        return btn;
    }

    function findButton(doc, options) {
        if (options.buttonId && typeof doc.getElementById === 'function') {
            const byId = doc.getElementById(options.buttonId);
            if (byId) return byId;
        }
        if (options.buttonSelector && typeof doc.querySelector === 'function') {
            return doc.querySelector(options.buttonSelector);
        }
        return null;
    }

    function cleanupDuplicates(doc, btn, options) {
        if (!options.cleanupDuplicates || !options.duplicateSelector || !doc.querySelectorAll) return;

        doc.querySelectorAll(options.duplicateSelector).forEach((el) => {
            if (el === btn) return;
            const sameId = el.id && options.duplicateIds.includes(el.id);
            const sameLabel =
                el.getAttribute && options.duplicateLabels.includes(el.getAttribute('aria-label'));
            if ((sameId || sameLabel) && el.parentNode) el.parentNode.removeChild(el);
        });
    }

    /**
     * Ensure the configured primary print control lives in the sticky header.
     * Existing nodes are moved, never cloned. Passing onPrint is optional and
     * only adds a listener when the configured bound flag is not already set.
     *
     * @param {Document} doc
     * @param {{
     *   onPrint?: Function,
     *   buttonId?: string,
     *   buttonSelector?: string,
     *   hostClass?: string,
     *   compatibilityHostClass?: string|null,
     *   boundFlag?: string,
     *   label?: string,
     *   buttonClassName?: string,
     *   createIfMissing?: boolean,
     *   createButton?: Function,
     *   cleanupDuplicates?: boolean,
     *   duplicateSelector?: string,
     *   duplicateIds?: string[],
     *   duplicateLabels?: string[]
     * }} [options]
     * @returns {{ btn: Element|null, header: Element|null, host: Element|null, created: boolean, moved: boolean }}
     */
    function ensurePrintInTopBar(doc, options) {
        if (!doc || typeof doc.getElementById !== 'function') {
            return { btn: null, header: null, host: null, created: false, moved: false };
        }

        const config = normalizeOptions(options);
        const onPrint = options && options.onPrint;
        const header = findUnifiedHeader(doc);
        let btn = findButton(doc, config);
        let host = null;
        let created = false;
        let moved = false;

        if (header && (btn || config.createIfMissing)) {
            host = ensureActionsHost(doc, header, config);
            if (!btn && config.createIfMissing) {
                btn = createPrintButton(doc, config);
                if (btn) {
                    host.appendChild(btn);
                    created = true;
                }
            } else if (btn && !host.contains(btn)) {
                host.appendChild(btn);
                moved = true;
            }

            if (btn) cleanupDuplicates(doc, btn, config);
        }

        if (
            btn &&
            typeof onPrint === 'function' &&
            config.boundFlag &&
            btn.dataset &&
            !btn.dataset[config.boundFlag]
        ) {
            btn.addEventListener('click', onPrint);
            btn.dataset[config.boundFlag] = '1';
        }

        return { btn: btn || null, header: header || null, host: host || null, created, moved };
    }

    /**
     * Convenience: ensure placement now, and if setupUnifiedHeader() has not yet
     * rebuilt .header (both fire on DOMContentLoaded, order not guaranteed), retry
     * until the sticky header exists so the control lands in .header-right.
     * Returns the first ensurePrintInTopBar() result. Safe in non-timer envs.
     *
     * @param {Document} doc
     * @param {object} [options] Same shape as ensurePrintInTopBar options.
     * @returns {{ btn: Element|null, header: Element|null, host: Element|null, created: boolean, moved: boolean }}
     */
    function mount(doc, options) {
        const result = ensurePrintInTopBar(doc, options);
        if (result && result.btn && result.header) return result;
        if (typeof setInterval === 'function') {
            let tries = 0;
            const timer = setInterval(() => {
                const r = ensurePrintInTopBar(doc, options);
                if ((r && r.btn && r.header) || ++tries > 20) {
                    if (typeof clearInterval === 'function') clearInterval(timer);
                }
            }, 50);
        }
        return result;
    }

    /**
     * True when btn lives inside a unified sticky header and not in the
     * orientation filter form or a scrolling page-title row.
     */
    function isPrintInTopBar(doc, btn) {
        if (!doc || !btn) return false;
        const filters = doc.getElementById('orientation-filters');
        if (filters && filters.contains(btn)) return false;
        let node = btn;
        while (node) {
            if (node.classList && node.classList.contains('page-title-row')) return false;
            if (
                node.classList &&
                node.classList.contains('header') &&
                (node.classList.contains('dashboard-topbar') || node.classList.contains('unified-header'))
            ) {
                return true;
            }
            node = node.parentElement || node.parentNode;
        }
        return false;
    }

    return {
        PRINT_BTN_ID,
        PAGE_HOST_CLASS,
        ORIENTATION_HOST_CLASS,
        ensurePrintInTopBar,
        mount,
        isPrintInTopBar,
        findUnifiedHeader
    };
});
