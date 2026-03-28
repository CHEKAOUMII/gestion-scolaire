# About Page Design

## Overview

Standalone `about.html` page accessible to all users, displayed in the sidebar under the Settings section. Shows app info, activation status with inline activation capability, and contact information.

## Sections

### 1. App Info
- App name: برنامج التدبير المدرسي
- Short description (2-3 lines): integrated school management system for Moroccan high schools
- Version number (read dynamically via IPC from `app.getVersion()`)

### 2. Activation Status
- Visual status card with color coding:
  - Green: active (مفعّل)
  - Yellow/orange: trial (تجريبي) with remaining days
  - Red: expired/not activated (غير مفعّل)
- Plan name (basic/pro/business) and device count (used/available)

### 3. Activation Form (conditional)
- Shown only when app is not activated or in trial mode
- License key input + device name input + activate button
- Uses existing `window.api.licensing.activateLicense()` and `window.api.licensing.getActivationStatus()`

### 4. Contact Information
- Phone number (hardcoded)
- Email address (hardcoded)
- Clear icons for each contact method

### 5. External Links
- Support/product page link
- Social media links if applicable

## Files to Create/Modify

| File | Action | Details |
|------|--------|---------|
| `about.html` | Create | New page following settings page pattern |
| `js/sidebar.js` | Modify | Add "حول التطبيق" link in Settings section |
| `preload.js` | Modify | Add IPC channel for app version (if not existing) |
| `main/ipc/system.js` | Modify | Add handler returning `app.getVersion()` |

## What We Don't Need
- No separate JS file — logic is simple enough for inline script
- No new DB tables — uses existing `getPublicActivationStatus()` and `activateLicense()`
- No role guard — page is accessible to all users
