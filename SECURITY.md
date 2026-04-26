# Security policy

Cursus is a desktop email client. It handles IMAP and SMTP credentials,
OS keychain entries, message content, and attachments. We take security
issues seriously.

## Reporting a vulnerability

**Do not open a public GitHub issue.** Instead, send a private report to:

> **security@opencursus.app**

Include:

- Affected version (Settings → About) or commit hash.
- OS and version.
- A description of the vulnerability and its impact.
- Steps to reproduce or a proof of concept (please do not include real
  credentials or third-party PII).
- Any suggested mitigation.

You can expect:

- An acknowledgement within **3 working days**.
- A status update within **7 working days** with our triage assessment.
- A fix or mitigation plan published in a security advisory once the
  issue is resolved.

We treat coordinated disclosure as the default. If you publish details
before a fix is available, we may not be able to credit you in the
advisory.

## Supported versions

Until v1.0 ships, only the **latest released version** is supported.
After v1.0, we will publish a support window in this document.

## Scope

In scope:

- The Cursus desktop application (Rust backend, React frontend, packaged
  binaries on GitHub Releases).
- Any official build script or installer published from this repository.

Out of scope:

- Vulnerabilities in third-party dependencies for which a fix is already
  available upstream — please report those upstream and let us know so
  we can bump the version.
- Email server-side issues at IMAP/SMTP providers.
- Phishing or social-engineering attacks against users that don't exploit
  a flaw in Cursus itself.

## Coordinated disclosure

Please give us a reasonable window to ship a fix before any public
disclosure. We aim to publish a security advisory and a fix in the same
release.
