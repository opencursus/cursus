# Cursus

A fast, private desktop email client for Windows and Linux. Multi-account
IMAP, SMTP/Resend sending, FTS5 search, keyboard-first. **No AI, no cloud,
no tracking.**

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-24C8DB.svg)](https://tauri.app)

> **Status:** v0.1 — feature-complete for daily use; pre-release polish in progress.

## Features

- **Multi-account IMAP** with SSL or STARTTLS, real folder sync, server-side
  flag changes (`star`, `mark-read`, `archive`, `trash`) propagated via
  `UID STORE` / `UID MOVE`.
- **Two sending paths** per account: SMTP (lettre) or **Resend** API,
  including Resend templates picker in the composer.
- **Spark-inspired three-pane UI** with light, dark, and true-black themes,
  category tabs (All / People / Newsletters / Notifications), and a
  drag-resizable middle pane.
- **Composer** with TipTap (rich text), HTML-escaped quoting, attachments
  in and out, drafts auto-saved every 3 seconds and resumed on reopen.
- **Undo send** (0 / 5 / 10 / 30 s) and confirm-before-send guards.
- **Full-text search** (SQLite FTS5, trigram tokenizer, `Ctrl+K`).
- **Bulk actions** (checkbox + shift-click range), **keyboard shortcuts**
  for full inbox triage without the mouse, **context menu** on rows.
- **Desktop notifications** + **Windows taskbar unread badge**.
- **System tray** with show/quit + **launch at login** + **close to tray**
  + **single-instance**.
- **OS keychain** for secrets (Windows Credential Manager / macOS Keychain
  / libsecret on Linux).
- **Remote-images policy** (never / ask / always + per-message allow).
- **Portable** — DB, drafts, search index, sent log live in a `cursus-files/`
  folder next to the executable. Zero registry pollution.

## Out of scope (on purpose)

No AI features, no cloud sync, no telemetry, no analytics, no calendar,
no task extraction, no tracking pixels. Stripped on purpose.

## Download

Pre-built binaries will be published on
[GitHub Releases](https://github.com/opencursus/cursus/releases)
once v0.1 ships. The landing page at
[opencursus.app](https://opencursus.app) will host download buttons for
Windows and Linux.

## Build from source

Prerequisites:

- Node.js 20+
- Rust stable (via [rustup](https://rustup.rs))
- Tauri 2 system dependencies — see
  [tauri.app/start/prerequisites](https://tauri.app/start/prerequisites/)

```bash
git clone https://github.com/opencursus/cursus.git
cd cursus
npm install
npm run tauri dev          # development run
npm run tauri build        # production bundle (.exe / .msi / .AppImage / .deb)
```

The release executable is at `src-tauri/target/release/Cursus.exe` (Windows)
or `src-tauri/target/release/Cursus` (Linux). Installers land under
`src-tauri/target/release/bundle/`.

## Stack

Tauri 2 · Rust (async-imap, lettre, mail-parser, keyring) · React 19 ·
TypeScript · Tailwind v4 · SQLite (FTS5) · Zustand.

## Contributing

PRs welcome — bug fixes, features, accessibility, translations, packaging
work. Read [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow.

For security issues, please **don't** open a public issue — see
[SECURITY.md](SECURITY.md).

## License

Apache-2.0. See [LICENSE](LICENSE).
