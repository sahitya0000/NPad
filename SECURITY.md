# Security policy

## Reporting a vulnerability

Report vulnerabilities **privately** through [GitHub private vulnerability reporting](https://github.com/sahitya0000/NPad/security/advisories/new). Include:
- the affected version
- reproduction steps using synthetic files
- the impact
- any suggested fix

Never put exploit details, credentials, or personal data in a public issue. If private reporting isn't available, open an issue that asks only for a private channel. Don't send NPad reports to the VS Code tracker.

Fixes are made on `main` and shipped in the next release. Use the latest release; NPad doesn't update automatically. We can't promise a response or fix time.

## Security boundaries

- NPad is a local editor, not a sandbox for analyzing untrusted content. Workspace Trust is disabled, so only open files you trust.
- Changes must not weaken Electron sandboxing or the content security policies of Markdown previews and webviews.
- Builds are unsigned. A checksum confirms a file is intact but doesn't prove who published it. Don't dismiss OS security warnings without thinking.
