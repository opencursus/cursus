# Contributing to Cursus

Thanks for thinking about contributing. Cursus is a small, opinionated
email client — small contributions are welcome and large ones are
welcome with a heads-up first.

## Quick start

```bash
git clone https://github.com/opencursus/cursus.git
cd cursus
npm install
npm run tauri dev
```

Verify your setup with:

```bash
npx tsc --noEmit               # TypeScript strict check
cd src-tauri && cargo check    # Rust compile check
```

## Workflow

1. **Open an issue first** for non-trivial features or refactors. Avoids
   wasted work if the idea doesn't fit the project's scope.
2. **Fork** the repo and create a topic branch off `main`:
   `git checkout -b fix/imap-fetch-parens` or `feat/signature-per-account`.
3. **Make focused commits.** One logical change per commit. Use
   [Conventional Commits](https://www.conventionalcommits.org/):
   `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `test:`.
4. **Push** to your fork and open a **pull request** against `main`.
5. Fill in the PR template (what / why / test plan).

## Scope rules

This project actively **rejects** the following and PRs adding them will be
closed:

- AI features (smart reply, summaries, categorisation, writing assistance).
- Cloud sync of any kind.
- Telemetry or usage analytics.
- Calendar, tasks, or productivity bolt-ons.
- Open / click tracking pixels.

If you're not sure whether something fits, open an issue with the proposal
before writing code.

## Code style

- **TypeScript** — `strict: true` with `noUnusedLocals`,
  `noUnusedParameters`, `noUncheckedIndexedAccess`. No `any`. Named
  exports for components. Path alias `@/*` maps to `src/*`.
- **React** — function components only, Zustand for shared state, Lucide
  icons (one icon library only). Avoid prop-drilling beyond two levels.
- **Tailwind v4** — use the semantic utility classes defined in
  `src/styles/globals.css` (`bg-raised`, `text-primary`, `border-soft`,
  ...) rather than hardcoded grays.
- **Rust** — edition 2021. Errors flow through the crate-level `Error`
  enum (`thiserror` derive + `Serialize` for IPC). **Never `unwrap()`**
  in a Tauri command handler. Async via Tokio.
- **SQL** — every schema change is a new `0N_*.sql` migration in
  `src-tauri/migrations/` plus a row in `src-tauri/src/db/migrations.rs`.
  **Never edit an applied migration.** Times are `INTEGER` unix seconds
  via `unixepoch()`, not `TEXT`.
- **IPC** — every `#[tauri::command]` has a matching typed wrapper in
  `src/lib/ipc.ts`. Update both in the same commit.
- **Comments** — default is none. Add only when the *why* is non-obvious
  (hidden constraint, subtle invariant, known gotcha).

## What to work on

Issues tagged `good first issue` or `help wanted` are good entry points.
For larger ideas, please open an issue first to discuss scope.

## Reporting bugs

Open a GitHub issue using the **Bug report** template. Include:

- Cursus version (Settings → About).
- OS (Windows 10/11 build, Linux distro + version).
- Steps to reproduce, expected vs. actual.
- Logs from `cursus-files/` next to the executable, with passwords
  redacted.

For **security vulnerabilities**, do **not** open a public issue —
follow [SECURITY.md](SECURITY.md).

## Code of conduct

By participating in this project you agree to abide by the
[Code of Conduct](CODE_OF_CONDUCT.md).
