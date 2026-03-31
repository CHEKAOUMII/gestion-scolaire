# Data Model: Enhanced Toast Variants

**Branch**: `021-enhanced-toast-variants` | **Date**: 2026-03-31
**Phase**: 1 — Design & Contracts

---

## Overview

This feature introduces no new database entities, IPC channels, or persistent state. All entities below are **ephemeral runtime objects** that exist only in the renderer process memory during a page session.

---

## Entity 1: Loading Toast Handle

The object returned by `showToast.loading(message)`. Encapsulates the live DOM reference and exposes state-transition methods.

| Field | Type | Notes |
|-------|------|-------|
| `dismissed` | boolean (private) | Guard flag — set to `true` once any terminal method is called |
| `toast` | HTMLElement (private) | Reference to the `.toast.loading` DOM node |
| `spinner` | HTMLElement (private) | The `<i>` icon element — mutated on `.success()` / `.error()` |
| `span` | HTMLElement (private) | The message `<span>` — text updated by `.success(msg)` / `.error(msg)` |
| `progressBar` | HTMLElement (private) | The `.toast-progress-bar` `<div>` — width driven by `.progress(percent)` |

### Public Handle Methods

| Method | Signature | Behavior |
|--------|-----------|----------|
| `.success(msg?)` | `(string?) → void` | Guard: no-op if dismissed. Changes icon to `fa-check-circle`, applies `.success` class, updates text if `msg` provided, sets progress bar to 100%, auto-dismisses after 3000ms, sets `dismissed = true` |
| `.error(msg?)` | `(string?) → void` | Guard: no-op if dismissed. Changes icon to `fa-exclamation-circle`, applies `.error` class, updates text if `msg` provided, removes progress bar, auto-dismisses after 5000ms, sets `dismissed = true` |
| `.progress(percent)` | `(number) → void` | Guard: no-op if dismissed. Clamps `percent` to `[0, 100]`. Sets `progressBar.style.width = clamped + '%'` |
| `.dismiss()` | `() → void` | Guard: no-op if dismissed. Immediately fades and removes toast, sets `dismissed = true` |

### State Transitions

```
[created] ──→ LOADING
LOADING   ──→ SUCCESS  (via .success())  → auto-dismiss after 3s
LOADING   ──→ ERROR    (via .error())    → auto-dismiss after 5s
LOADING   ──→ DISMISSED (via .dismiss() or close button click)
SUCCESS   ──→ DISMISSED (auto)
ERROR     ──→ DISMISSED (auto)
```

---

## Entity 2: Action Config

The second argument to `showToast.action(message, actionConfig, opts?)`. A plain object — not stored beyond the single toast's lifetime.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `label` | string | Yes | Button display text |
| `icon` | string | No | Font Awesome class (e.g., `fa-undo`). Prepended as `<i class="fas {icon}">` if present |
| `onClick` | function | Yes | Callback invoked when action button is clicked. Called once, then toast dismisses |

---

## Entity 3: Action Toast Options (`opts`)

The third (optional) argument to `showToast.action()`.

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `duration` | number | `8000` | Auto-dismiss delay in milliseconds |
| `type` | string | `'info'` | Toast styling variant: `'success'`, `'error'`, `'warning'`, `'info'` |

---

## Entity 4: Deduplication State (module-level, private)

Shared across both variants within the IIFE. Not externally accessible.

| Variable | Type | Purpose |
|----------|------|---------|
| `_lastToastMessage` | string | Last message string that was shown |
| `_lastToastTime` | number | `Date.now()` timestamp of last accepted show |

**Rule**: If `message === _lastToastMessage && Date.now() - _lastToastTime < 2000`, the call is suppressed and a no-op handle is returned.

---

## No-Op Handle

Returned by deduplicated calls to `showToast.loading()`. Satisfies the handle contract with empty functions so callers do not need null checks.

| Method | Behavior |
|--------|----------|
| `.success()` | no-op |
| `.error()` | no-op |
| `.progress()` | no-op |
| `.dismiss()` | no-op |

---

## CSS Classes (new)

| Class | Applied To | Purpose |
|-------|------------|---------|
| `.toast.loading` | Loading toast root | Blue-tinted background, primary border |
| `.toast-progress-bar` | Child `<div>` inside loading toast | Animated width bar at bottom of toast |
| `.toast-action-btn` | `<button>` inside action toast | Inline bordered action button |
| `.toast-close` | `<button>` inside loading toast | Dismiss affordance, `inset-inline-start: 6px` (RTL-safe) |
