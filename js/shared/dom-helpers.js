/**
 * Shared DOM helpers (SOLID WP6).
 * Classic-script module: attaches to window.PencilShared and bare globals for compatibility.
 */
(function (global) {
    'use strict';

    const PencilShared = global.PencilShared || (global.PencilShared = {});

    function escapeHtml(text) {
        if (text === null || text === undefined) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function setButtonContent(button, { icon, text, spin = false } = {}) {
        if (!button) return;

        button.replaceChildren();

        if (icon) {
            const iconEl = global.document.createElement('i');
            iconEl.className = `fas ${icon}${spin ? ' fa-spin' : ''}`;
            iconEl.setAttribute('aria-hidden', 'true');
            button.appendChild(iconEl);
        }

        if (text) {
            const textNode = global.document.createTextNode(`${icon ? ' ' : ''}${text}`);
            button.appendChild(textNode);
        }
    }

    function setSelectOptions(select, options, { placeholder = '', getValue, getLabel } = {}) {
        if (!select) return;

        select.replaceChildren();

        if (placeholder) {
            const placeholderOption = global.document.createElement('option');
            placeholderOption.value = '';
            placeholderOption.textContent = placeholder;
            select.appendChild(placeholderOption);
        }

        (options || []).forEach((option, index) => {
            const optionEl = global.document.createElement('option');
            optionEl.value = typeof getValue === 'function' ? getValue(option, index) : option;
            optionEl.textContent = typeof getLabel === 'function' ? getLabel(option, index) : option;
            select.appendChild(optionEl);
        });
    }

    PencilShared.escapeHtml = escapeHtml;
    PencilShared.setButtonContent = setButtonContent;
    PencilShared.setSelectOptions = setSelectOptions;

    // Bare globals (classic multi-page app convention)
    global.escapeHtml = escapeHtml;
    global.setButtonContent = setButtonContent;
    global.setSelectOptions = setSelectOptions;
})(typeof window !== 'undefined' ? window : globalThis);
