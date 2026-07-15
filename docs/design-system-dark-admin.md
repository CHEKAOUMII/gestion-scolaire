# Design System — Product Shell (White + Dark)

Source: dashboard Zen Dataflow skin promoted app-wide.  
Applied in: `css/tailwind-input.css` (`@theme` + single `[data-theme='dark']`), `js/ux-enhancements.js`, `js/shared/chart-theme.js`.

## Goals

1. **Two first-class themes** — white (light) and dark share one token architecture.
2. **One product shell** — every managed page uses the same surfaces/primary as the dashboard.
3. **Readable chrome** — muted text stays legible; sidebar inactive labels not decorative-only.
4. **Semantic color only for meaning** — success / warning / danger / gender; not rainbow KPIs.
5. **Page classes = layout only** — e.g. `.dashboard-page` density/structure, never a private palette.

---

## Theme toggle

| Piece | Value |
|-------|--------|
| Storage | `localStorage['app-theme']` → `'light'` \| `'dark'` |
| DOM | `html[data-theme="light\|dark"]` |
| JS | `js/ux-enhancements.js` → `initTheme` / `toggleTheme` |
| Meta | light `#42516a` · dark `#22262e` |

Print/PDF stays forced light (`print-system.js` + `print.css`).

---

## White / light tokens (`@theme`)

| Token | Hex | Role |
|-------|-----|------|
| `--color-secondary` | `#faf9f6` | Page background |
| `--color-surface` | `#fffefb` | Cards / panels |
| `--color-surface-alt` | `#f3f1ec` | Alt rows |
| `--color-sidebar` | `#f4f2ed` | Sidebar rail |
| `--color-text-main` | `#30323a` | Body / titles |
| `--color-text-muted` | `#656872` | Secondary copy |
| `--color-primary` | `#42516a` | Brand / links / active |
| `--color-primary-light` | `#70819d` | Hover accents |
| `--color-accent` | `#dedbd3` | Borders |
| `--glass-border` | `#e0ddd5` | Card edges |

---

## Dark tokens (`[data-theme='dark']` — single map)

| Token | Hex | Role |
|-------|-----|------|
| `--color-secondary` | `#191c23` | Page background |
| `--color-surface` | `#22262e` | Cards / panels |
| `--color-surface-alt` | `#2b3039` | Alt rows |
| `--color-sidebar` | `#1e222a` | Sidebar rail |
| `--color-text-main` | `#eeeae2` | Body / titles |
| `--color-text-muted` | `#b7b5b0` | Secondary copy |
| `--color-primary` | `#9aaaca` | Brand / links / active |
| `--color-primary-light` | `#8295b7` | Hover accents |
| `--color-accent` | `#343a45` | Borders |
| `--glass-border` | `rgba(255,255,255,0.09)` | Card edges |

### Rules

- Do **not** add competing `[data-theme='dark'] { --color-surface: … }` blocks.
- Do **not** redefine colors on `body.dashboard-page` (or other page body classes).
- Prefer `var(--color-*)` in new CSS; avoid new hardcoded hex.
- Gender may keep rose/teal; logout stays danger red.

---

## Pre-delivery checklist

- [x] White tokens = dashboard paper + slate primary (global `@theme`)
- [x] Dark tokens = dashboard cool slate (single map)
- [x] Dashboard color fork removed (layout-only `.dashboard-page`)
- [x] E2E `DARK_THEME_TOKENS` aligned
- [x] `updateThemeColor` meta aligned
- [ ] FOUC bootstrap on all managed pages (Phase 2)
- [ ] Header chrome parity (Phase 2)
- [ ] Hard-coded page CSS debt (Phases 3–4)

---

## Rebuild

```bash
npm run css:build
```

Verify: toggle white ↔ dark on dashboard, then open students-list / timetable / settings — same surface/primary tokens.
