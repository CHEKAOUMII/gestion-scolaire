# Changelog

All notable changes to this project will be documented in this file.

## 1.0.23 - 2026-03-29

### Added

- Added shared design context in `.impeccable.md` and `.github/copilot-instructions.md` to guide future UI work.

### Changed

- Hardened accessibility across admin flows with better dialog focus handling, disclosure semantics, file-picker announcements, sortable table headers, and stronger ARIA state exposure.
- Improved responsive behavior by replacing fixed sidebar-offset assumptions, adding mobile drawer behavior, and making dense tables and forms safer on narrow screens.
- Normalized the design system by consolidating semantic color tokens, aligning page chrome, and removing many hard-coded colors from generated and detail UI.
- Optimized frontend loading by minifying the shared CSS output, reducing remote and duplicate script usage, and standardizing deferred script loading on key routes.
- Extracted reusable UI helpers for pagination, button content, select options, and several data-heavy renderers to reduce inline handlers and large HTML-string rendering.
- Quieted and polished admin surfaces to better match a trustworthy, calm, official school-administration product tone.
