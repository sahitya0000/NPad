# Maintaining NPad

Notes for repository maintainers.

## Provenance

NPad was extracted from Code - OSS by following the NPad esbuild input graph. It keeps 3,664 of the upstream tree's 13,584 source files, plus required resources, sandbox preloads, curated extensions, licenses, and generated contracts. The original source commit and upstream baseline are recorded in `build/npad/config.json`. Each build writes its inputs and external imports to `out-npad/npad-build.json`.

Packaging includes only the runtime dependencies the app actually uses. It leaves out source maps, tests, native build intermediates, other-platform binaries, and dev dependencies. The unpacked Windows x64 app is 533 MiB, down from 701 MiB. Electron accounts for most of that size.

## Secret scanning

Gitleaks's first scan produced 30 findings. All of them were upstream strings that aren't secrets: public telemetry IDs, keyboard shortcuts, a protocol-example token, and a key-format regex. `.gitleaks.toml` allows only those exact strings in those exact files. A test API key was still detected after the exclusions, which confirms the default rules remain active. Automated scanning doesn't replace a human review of what gets published.

## Before going public

- [ ] Confirm you have the right to publish all code, assets (especially the NPad logo), and docs.
- [ ] Review license obligations for the packaged dependencies, including grammars, themes, fonts, dictionaries, and native binaries.
- [ ] Review the working tree for private or internal-only material, then rerun the secret scan on the final commit. Rotate any credential that was ever exposed; deleting it isn't enough.
- [ ] Enable private vulnerability reporting, secret scanning with push protection, Dependabot alerts and security updates, and code scanning.
- [ ] Choose a private contact for conduct reports and add it to [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md).
- [ ] Run every CI job from a clean GitHub checkout. Installation from public npm hasn't been verified yet, because the preparation machine used a package mirror.
- [ ] Protect `main`: require pull requests, reviews, and passing CI, and block force pushes and branch deletion.
- [ ] Make the repository public. Don't promise support response times you can't meet.

## Releasing

1. Start from a reviewed commit with green CI. Bump `version` in `package.json` deliberately, then tag the commit.
2. Download the CI artifacts and verify their SHA-256 checksums. Never commit signing keys.
3. On a disposable machine, test installing, uninstalling, and file associations on Windows, plus the Linux archives (including sandbox setup). Before calling macOS builds normal downloads, test them on real Macs with Developer ID signing and notarization.
4. Make sure no personal files, logs, or signing material are included, and that the Electron and third-party notices are present.
5. Publish release notes, binaries, and checksums with `gh release create`. Don't commit installers to Git; `/release/` is ignored, and GitHub rejects files over 100 MB.

macOS and ARM64 builds have not been validated on real hardware yet.
