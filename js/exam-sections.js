/*
 * Exam Sections - Shared exam-center section layer
 * طبقة أقسام مشتركة لصفحات مركز الامتحان
 */
(function () {
    'use strict';

    const SECTION_REGISTRY = Object.freeze({
        inputs: Object.freeze({
            key: 'inputs',
            title: 'المدخلات',
            desc: 'المعطيات الأساسية التي تُبنى عليها عملية الامتحان',
            icon: 'fa-keyboard',
            colorVar: 'var(--color-primary)'
        }),
        settings: Object.freeze({
            key: 'settings',
            title: 'الإعدادات',
            desc: 'قواعد الضبط والتهيئة قبل المعالجة',
            icon: 'fa-sliders',
            colorVar: 'var(--color-warning)'
        }),
        production: Object.freeze({
            key: 'production',
            title: 'الإنتاج',
            desc: 'المخرجات النهائية للطباعة والتتبع',
            icon: 'fa-print',
            colorVar: 'var(--color-success)'
        })
    });

    let activeSectionKey = null;

    function normalizeConfig(cfg) {
        const config = cfg || {};
        return {
            tablistSelector: config.tablistSelector,
            tabSelector: config.tabSelector,
            order: Array.isArray(config.order) ? config.order : ['settings', 'inputs', 'production'],
            map: config.map || {},
            ensureAria: config.ensureAria === true,
            navLabel: config.navLabel || 'أقسام مركز الامتحان'
        };
    }

    function getTabKey(tab) {
        return tab?.dataset?.tab || '';
    }

    function findPanel(tabKey, tab) {
        const controls = tab?.getAttribute('aria-controls');
        if (controls) {
            const controlledPanel = document.getElementById(controls);
            if (controlledPanel) return controlledPanel;
        }
        return document.getElementById('panel-' + tabKey);
    }

    function isTabActive(tab) {
        return tab?.classList?.contains('active') || tab?.getAttribute('aria-selected') === 'true';
    }

    function ensureAriaForTabs(tabs) {
        let firstActiveTab = tabs.find(isTabActive) || tabs[0] || null;

        tabs.forEach((tab) => {
            const tabKey = getTabKey(tab);
            if (!tabKey) return;

            if (!tab.id) tab.id = 'tab-btn-' + tabKey;
            if (!tab.hasAttribute('role')) tab.setAttribute('role', 'tab');
            if (!tab.hasAttribute('aria-controls')) tab.setAttribute('aria-controls', 'panel-' + tabKey);
            if (!tab.hasAttribute('aria-selected'))
                tab.setAttribute('aria-selected', tab === firstActiveTab ? 'true' : 'false');

            const panel = findPanel(tabKey, tab);
            if (panel) {
                if (!panel.hasAttribute('role')) panel.setAttribute('role', 'tabpanel');
                if (!panel.hasAttribute('aria-labelledby')) panel.setAttribute('aria-labelledby', tab.id);
            }
        });
    }

    function buildOrderedKeys(config) {
        const seen = new Set();
        const keys = [];

        config.order.forEach((key) => {
            if (!SECTION_REGISTRY[key]) {
                console.warn('[ExamSections] Unknown section in order:', key);
                return;
            }
            if (!seen.has(key)) {
                seen.add(key);
                keys.push(key);
            }
        });

        Object.values(config.map).forEach((key) => {
            if (!SECTION_REGISTRY[key]) {
                console.warn('[ExamSections] Unknown mapped section:', key);
                return;
            }
            if (!seen.has(key)) {
                seen.add(key);
                keys.push(key);
            }
        });

        return keys;
    }

    function createSectionNavButton(section) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'exam-section-nav-btn';
        button.dataset.section = section.key;
        button.style.setProperty('--exam-section-color', section.colorVar);
        button.innerHTML = `
            <span class="exam-section-nav-icon" aria-hidden="true"><i class="fas ${section.icon}"></i></span>
            <span class="exam-section-nav-text">
                <span class="exam-section-nav-title">${section.title}</span>
                <span class="exam-section-nav-desc">${section.desc}</span>
            </span>
            <span class="exam-section-nav-current" aria-hidden="true"><i class="fas fa-check-circle"></i></span>
        `;
        button.setAttribute('aria-label', section.title + ' — ' + section.desc);
        return button;
    }

    function createSectionGroup(section, tablistLabel) {
        const group = document.createElement('section');
        group.className = 'exam-section-group';
        group.dataset.section = section.key;
        group.style.setProperty('--exam-section-color', section.colorVar);

        const header = document.createElement('div');
        header.className = 'exam-section-header';
        header.innerHTML = `
            <h2><i class="fas ${section.icon}" aria-hidden="true"></i><span>${section.title}</span></h2>
            <p>${section.desc}</p>
        `;

        const tabs = document.createElement('div');
        tabs.className = 'exam-section-tabs';
        tabs.setAttribute('role', 'tablist');
        tabs.setAttribute('aria-label', `${tablistLabel} — ${section.title}`);
        tabs.dataset.section = section.key;

        group.append(header, tabs);
        return { group, tabs };
    }

    function getFocusableTabs(tabs) {
        return tabs.filter((tab) => !tab.disabled && !tab.hidden && !tab.closest('[hidden]'));
    }

    function syncTabsState(tabs, sectionButtons, sectionGroups, tabToSection) {
        const activeTab =
            tabs.find((tab) => tab.classList.contains('active')) ||
            tabs.find((tab) => tab.getAttribute('aria-selected') === 'true') ||
            tabs[0] ||
            null;
        const activeKey = activeTab ? tabToSection.get(activeTab) : null;
        activeSectionKey = activeKey || null;

        tabs.forEach((tab) => {
            const isActive = tab === activeTab;
            tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
            tab.setAttribute('tabindex', isActive ? '0' : '-1');
        });

        sectionButtons.forEach((button, key) => {
            const isActive = key === activeSectionKey;
            button.classList.toggle('active', isActive);
            if (isActive) button.setAttribute('aria-current', 'true');
            else button.removeAttribute('aria-current');
        });

        sectionGroups.forEach((group, key) => {
            group.classList.toggle('active', key === activeSectionKey);
        });
    }

    function initKeyboardNavigation(tabs, sync) {
        tabs.forEach((tab) => {
            tab.addEventListener('keydown', (event) => {
                const visibleTabs = getFocusableTabs(tabs);
                if (!visibleTabs.length) return;

                const currentIndex = Math.max(0, visibleTabs.indexOf(tab));
                let nextIndex = null;

                switch (event.key) {
                    case 'ArrowRight':
                        nextIndex = (currentIndex - 1 + visibleTabs.length) % visibleTabs.length;
                        break;
                    case 'ArrowLeft':
                        nextIndex = (currentIndex + 1) % visibleTabs.length;
                        break;
                    case 'Home':
                        nextIndex = 0;
                        break;
                    case 'End':
                        nextIndex = visibleTabs.length - 1;
                        break;
                    case 'Enter':
                    case ' ':
                        event.preventDefault();
                        tab.click();
                        sync();
                        return;
                    default:
                        return;
                }

                event.preventDefault();
                const nextTab = visibleTabs[nextIndex];
                if (nextTab) {
                    tabs.forEach((item) => item.setAttribute('tabindex', item === nextTab ? '0' : '-1'));
                    nextTab.focus();
                }
            });
        });
    }

    function init(cfg) {
        const config = normalizeConfig(cfg);
        if (!config.tablistSelector || !config.tabSelector) {
            console.warn('[ExamSections] Missing tablistSelector or tabSelector.');
            return window.ExamSections;
        }

        const tablist = document.querySelector(config.tablistSelector);
        if (!tablist) {
            console.warn('[ExamSections] Tablist not found:', config.tablistSelector);
            return window.ExamSections;
        }

        if (tablist.dataset.examSectionsInitialized === 'true') {
            return window.ExamSections;
        }

        const tabs = Array.from(tablist.querySelectorAll(config.tabSelector));
        if (!tabs.length) {
            console.warn('[ExamSections] No tabs found for selector:', config.tabSelector);
            return window.ExamSections;
        }

        if (config.ensureAria) ensureAriaForTabs(tabs);

        const orderedKeys = buildOrderedKeys(config);
        const nav = document.createElement('nav');
        nav.className = 'exam-section-nav';
        nav.setAttribute('aria-label', config.navLabel);

        const sections = document.createElement('div');
        sections.className = 'exam-section-groups';

        const sectionButtons = new Map();
        const sectionGroups = new Map();
        const sectionTablists = new Map();
        const tabToSection = new Map();

        orderedKeys.forEach((key) => {
            const section = SECTION_REGISTRY[key];
            const button = createSectionNavButton(section);
            const { group, tabs: sectionTabs } = createSectionGroup(section, config.navLabel);
            sectionButtons.set(key, button);
            sectionGroups.set(key, group);
            sectionTablists.set(key, sectionTabs);
            nav.appendChild(button);
            sections.appendChild(group);
        });

        tabs.forEach((tab) => {
            const tabKey = getTabKey(tab);
            const sectionKey = config.map[tabKey];
            if (!sectionKey) {
                console.warn('[ExamSections] Unmapped tab skipped:', tabKey || tab);
                return;
            }
            const targetTablist = sectionTablists.get(sectionKey);
            if (!targetTablist) {
                console.warn('[ExamSections] Section target not found for tab:', tabKey, sectionKey);
                return;
            }
            targetTablist.appendChild(tab);
            tabToSection.set(tab, sectionKey);
        });

        Object.keys(config.map).forEach((tabKey) => {
            if (!tabs.some((tab) => getTabKey(tab) === tabKey)) {
                console.warn('[ExamSections] Mapped tab does not exist:', tabKey);
            }
        });

        Array.from(sectionTablists.entries()).forEach(([key, sectionTabs]) => {
            const group = sectionGroups.get(key);
            const button = sectionButtons.get(key);
            if (!sectionTabs.children.length) {
                group.hidden = true;
                button.hidden = true;
            }
        });

        const extraElements = Array.from(tablist.children).filter(
            (child) => child !== nav && child !== sections && !child.classList.contains('exam-section-group')
        );
        const actions = document.createElement('div');
        actions.className = 'exam-section-actions';
        extraElements.forEach((child) => actions.appendChild(child));

        tablist.classList.add('exam-sections-root');
        tablist.dataset.examSectionsInitialized = 'true';
        if (tablist.hasAttribute('role')) {
            tablist.dataset.originalRole = tablist.getAttribute('role') || '';
            tablist.setAttribute('role', 'group');
        }
        tablist.setAttribute('aria-label', config.navLabel);
        tablist.append(nav, sections);
        if (actions.children.length) tablist.appendChild(actions);

        const sync = () => syncTabsState(tabs, sectionButtons, sectionGroups, tabToSection);

        tabs.forEach((tab) => {
            tab.addEventListener('click', () => window.setTimeout(sync, 0));
        });

        sectionButtons.forEach((button, key) => {
            button.addEventListener('click', () => {
                const firstTab = tabs.find((tab) => tabToSection.get(tab) === key);
                if (firstTab) {
                    firstTab.click();
                    firstTab.focus({ preventScroll: true });
                    window.setTimeout(sync, 0);
                }
            });
        });

        initKeyboardNavigation(tabs, sync);
        sync();

        return window.ExamSections;
    }

    function getActiveSection() {
        return activeSectionKey;
    }

    window.ExamSections = {
        registry: SECTION_REGISTRY,
        init,
        getActiveSection
    };
})();
