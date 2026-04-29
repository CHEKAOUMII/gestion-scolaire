# Remove Device Linking System — Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Remove the entire device-linking/OTP subsystem, leaving Firebase Auth + schoolId as the sole sync gatekeeper.

**Architecture:** Remove 3 layers: backend IPC (linking.js, main/linking/), sync engine (revocations, heartbeat), and frontend UI (device panel). Keep getDeviceHash() for sync row-ID namespacing. Extract institution setup into a slim new module.

**Tech Stack:** Electron, better-sqlite3, Firebase, vanilla JS

---

## 15 Tasks — see conversation context for full details
