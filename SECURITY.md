# Security policy

## Supported versions

There are no published NPad releases yet. Security fixes are developed on the
default branch; no older release line has a support commitment. Once releases
exist, use the latest release and check its notes for security updates. NPad
does not automatically update.

## Report a vulnerability

Do not put exploit details, private documents, credentials, or personal data in
a public issue.

Report vulnerabilities privately through
[GitHub private vulnerability reporting](https://github.com/sahitya0000/NPad/security/advisories/new)
(**Security > Advisories > Report a vulnerability**). If that option is
unavailable, open an issue asking only for a private reporting channel,
without describing the vulnerability. Do not send NPad reports to the upstream
issue tracker.

Include affected versions, reproduction steps using synthetic files, impact,
and any suggested mitigation in the private report. A response-time or fix-time
guarantee is not currently offered.

## Security boundaries

- NPad is a local editor; it is not a safe-content analysis sandbox.
- Workspace Trust is disabled by design. Open only content you intend to use.
- Markdown previews and webviews retain their security controls; changes must
  not weaken Electron sandboxing or content security policies.
- Local builds are unsigned. Do not treat a checksum as proof of publisher
  identity, and do not bypass operating-system security warnings blindly.

Maintainers must enable private vulnerability reporting before public launch.
See the [publication checklist](docs/OPEN_SOURCE_READINESS.md).
