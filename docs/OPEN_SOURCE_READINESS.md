# Open-source publication checklist

This is the release checklist, not a legal or security certification. The
repository has been prepared locally; publishing it or changing its visibility
requires explicit maintainer action.

## Implemented in this checkout

- [x] Retain the upstream MIT license, copyright headers, third-party notices,
  and extraction provenance in `build/npad/config.json`.
- [x] Document the supported Windows x64 build and pinned Node/pnpm versions.
- [x] Remove 604 Microsoft mirror tarball URLs in favor of registry-neutral
  resolutions (public npm by default), preserving locked versions and hashes.
- [x] Add contributor guidance, community conduct, security policy, issue forms,
  and a pull-request checklist.
- [x] Add Windows CI for frozen installation, build-tool type checking, unit and
  documentation-link tests, application/installer build, and packaged-app smoke tests.
- [x] Prepare unsigned installer artifacts and SHA-256 checksums in CI without
  automatically publishing releases or granting workflow write permissions.
- [x] Add dependency-update configuration and ignore local credentials/logs.
- [x] Add checksum-verified Gitleaks history scanning to CI, with narrow
  exclusions for inspected upstream examples and non-secret identifiers.
- [x] Add concise root `AGENTS.md` instructions with architecture, scope,
  integration boundaries, and verification commands.
- [x] Choose the GitHub repository (`sahitya0000/NPad`, default branch `main`)
  and add its repository, issues, and homepage URLs to the root package metadata.
- [x] Keep the project `LICENSE` as the repository license, retain the upstream
  Code - OSS notice in `LICENSE.txt`, and ship both in packaged builds.
- [x] Import the prepared source as a fresh snapshot; earlier local Git history
  is not published.
- [x] Keep installers out of Git (`/release/` is ignored). Publish them as
  GitHub Release assets instead; GitHub rejects files over 100 MB.
- [x] Add `CODEOWNERS` and route security reports from the issue chooser to
  private vulnerability reporting.
- [x] Add `pnpm run check` as a repeatable local/agent validation entrypoint.
- [x] Add native Linux x64/ARM64 archives and macOS Intel/Apple Silicon app/ZIP
  packaging, host-aware tests, and native CI jobs. This is build infrastructure,
  not certification of every target; macOS and ARM64 still need native validation.

## Local verification

Windows x64 and Linux x64 applications have been built locally and passed
CLI/native-module and GUI opening/editing/saving smoke checks. The extracted
Linux archive was tested in Ubuntu 24.04 WSLg with sandboxing enabled.
macOS and ARM64 still require native-runner validation. Direct access to public npm is
blocked by TLS/network policy on the preparation machine; installation used its
preconfigured package mirror with the registry-neutral lockfile. A public
GitHub-runner install remains a publication gate.

`pnpm run check` validates build-tool types, unit/packaging regressions, local
documentation links, and script runners. Editing/context command inventories
are tested directly instead of depending on removed historical HTML/CSV reports.
Build before running checks and run the packaged-app smoke suites separately.
Workflow syntax is checked with actionlint; local results do not replace clean
public-runner validation.

Gitleaks scanned all 34 local commits. Its 30 initial findings were inspected
and matched existing upstream non-secret content: public telemetry identifiers,
keyboard shortcuts, a protocol-example token, and a key-format detection
expression. History and working-tree scans then passed, and a synthetic API-key
canary was correctly detected to confirm default rules remain active. The
configuration excludes only those specific patterns in their specific files,
plus generated dependencies/build outputs. This does not certify the repository
free of all sensitive information.

## Required before making the repository public

- [ ] Confirm authorization to publish all code, assets (especially the NPad
  logo), documentation, and Git history. Check employer/third-party ownership
  where applicable. Existing open-source headers alone are not authorization
  for independently added material.
- [ ] Review license obligations for the actual packaged dependency closure,
  including bundled grammars, themes, fonts, dictionaries, and native binaries.
  Preserve required notices. The inherited notices are not a complete license
  audit of newly introduced material.
- [ ] Complete human review of the entire Git history and working tree for
  private information, internal-only material, and accidentally committed
  binaries; rerun the automated credential scan on the final publication commit.
  Automated secret scanning does not replace human provenance/privacy review.
  Rotate any exposed credentials before publication; do not merely delete them.
- [ ] Choose a private conduct-reporting contact; enable GitHub
  private vulnerability reporting and test the reporting route in `SECURITY.md`.
- [ ] Enable GitHub secret scanning/push protection, Dependabot alerts/security
  updates, and an appropriate code-scanning setup where supported.
- [ ] Enable Actions and run all native jobs from a clean GitHub checkout.
  Confirm the runner has native prerequisites; review the first dependency
  update PR because the repository uses pnpm 12.
- [ ] Protect the default branch: require pull requests, review, and required native
  CI check; block force pushes and deletion. Require code-owner review once
  additional maintainers are added to `CODEOWNERS`.
- [ ] Review public repository settings, issue/discussion moderation, and support
  expectations. Do not advertise a support SLA that cannot be met.

## Before each binary release

- [ ] Use a reviewed commit with green Windows CI, update the version deliberately,
  and tag that commit. The inherited `1.146.0` version is not a release promise.
- [ ] Download the matching CI artifact and verify its SHA-256 checksum. Decide
  whether releases remain explicitly unsigned or configure a real code-signing
  identity; never commit signing keys.
- [ ] Test installation/uninstallation and file associations on a disposable
  Windows machine/VM. Automated app smoke tests do not install the application
  or validate OS registration.
- [ ] Review packaging notices and known limitations; publish release notes,
  installer, checksum, and source tag on GitHub Releases. Release assets should
  not be committed into Git.
- [ ] Confirm there are no personal documents, logs, or signing material in the
  release. Preserve Electron's license files and all packaged notices.
- [ ] Validate Linux x64/ARM64 archives on supported desktop distributions,
  including sandbox setup and optional XDG desktop integration.
- [ ] Validate macOS Intel/Apple Silicon app/ZIP builds on real Macs. Choose
  trusted Developer ID signing/notarization before presenting them as normal
  downloadable releases; ad-hoc signatures are local-build signatures only.

## Publication procedure

After the checks above, push the reviewed `main` branch to
`https://github.com/sahitya0000/NPad` and verify Actions before changing
visibility to public or announcing the project. Upload installers and their
SHA-256 checksums as GitHub Release assets (for example with
`gh release create`). Changing visibility and creating releases are
deliberate maintainer actions.

Agent support is repository-scoped and works from `AGENTS.md`; no personal MCP
configuration, cloud credentials, or custom agent installation is required.
