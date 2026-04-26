<!--
Thanks for opening a pull request.

For non-trivial changes, please make sure an issue exists describing the
problem before submitting code, so the scope can be discussed first.

Fill in the sections below. Delete sections that don't apply.
-->

## What

<!-- One-paragraph description of the change. -->

## Why

<!-- The problem being solved, the user-visible benefit, or the issue
this fixes. Link to the issue with `Fixes #123` if applicable. -->

## How

<!-- Brief overview of the approach. Mention any files or modules with
non-obvious touchpoints. -->

## Test plan

<!-- Concrete steps a reviewer can run to verify the change. Include both
the happy path and any edge cases you considered. -->

- [ ] `npx tsc --noEmit` passes
- [ ] `cargo check` (or `cargo build --release`) passes
- [ ] Manual smoke test: <describe>

## Screenshots

<!-- For UI changes, before/after screenshots or a short clip. -->

## Checklist

- [ ] My change follows the conventions in `DOCUMENTATION/conventions.md`.
- [ ] I have not added any of the items on the project's **Nevers** list
      (AI, cloud sync, telemetry, calendar, tracking pixels).
- [ ] I have updated `DOCUMENTATION/` if my change affects architecture,
      data flow, or the IPC surface.
- [ ] No credentials or third-party PII appear in the diff.
