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

Releases are GitHub Releases with a `v<version>` tag, the platform packages, and one `SHA256SUMS.txt`. The examples below use `1.147.0`; replace it with the version you're releasing. Never commit installers, archives, or signing keys to Git. `/release/` is ignored.

### 1. Prepare the release commit

1. Make sure `main` has every change you want and that nothing is pending in open pull requests.
2. Pick the new version. `version` in [package.json](../package.json) is the only source: it sets the app version, the installer version, and every package file name. Bump it in a pull request, and don't reuse a version that has already been released.
3. Merge the pull request, then confirm the commit you're releasing:

   ```sh
   git switch main
   git pull --ff-only
   git log --oneline -1
   ```

### 2. Build each platform

Each package must be built on its own OS and architecture (see [CONTRIBUTING.md](../CONTRIBUTING.md#build)). Build from a clean checkout of the release commit, not a working copy with local changes.

| Package | Build on | File |
| --- | --- | --- |
| Windows x64 | Windows x64 | `.build/npad/NPadSetup-x64-<version>.exe` |
| Linux x64 | Ubuntu 24.04 x64. WSL 2 works. | `.build/npad/NPad-linux-x64-<version>.tar.gz` (+ `.sha256`) |
| Linux ARM64 | Ubuntu 24.04 ARM64 | `.build/npad/NPad-linux-arm64-<version>.tar.gz` (+ `.sha256`) |
| macOS Intel / Apple Silicon | A Mac of that architecture | `.build/npad/NPad-darwin-<arch>-<version>.zip` (+ `.sha256`) |

**Option A: CI.** Every push to `main` runs [ci.yml](../.github/workflows/ci.yml), which builds and tests all five targets and uploads the unsigned packages as workflow artifacts (`NPad-<platform>-<arch>-unsigned`). Wait for a green run on the release commit, then download them:

```sh
gh run list --branch main --limit 5
gh run download <run-id> --dir release
```

Each artifact downloads into its own subfolder. Move the packages and their `.sha256` files up into `release/`, and verify each one with `sha256sum -c` before going further.

**Option B: local builds.** Use these when CI isn't available. Run the same steps CI runs, and keep the logs.

Windows (PowerShell):

```powershell
pnpm install --frozen-lockfile
pnpm run build-npad
pnpm run check
pnpm run test-native-app
pnpm run test-npad-app
```

If the install fails with `MSB8040: Spectre-mitigated libraries are required`, install or stage them as described in [CONTRIBUTING.md](../CONTRIBUTING.md#windows-spectre-libraries).

Linux (bash, as a normal user, not root):

```sh
export CC=clang-19 CXX=clang++-19
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run build-npad
sudo chown root:root .build/npad/linux-x64/chrome-sandbox
sudo chmod 4755 .build/npad/linux-x64/chrome-sandbox
export XDG_RUNTIME_DIR="$(mktemp -d)"
dbus-run-session -- xvfb-run -a pnpm run test-native-app
pnpm test
pnpm run test-docs
```

For a WSL build, clone into the Linux file system (for example `~/npad`) instead of building under `/mnt/c` or `/mnt/d`. Building there is slower, and the Windows-side `node_modules` can't be reused.

Don't release a package whose build or tests failed, and don't skip a failing check to get a build out.

### 3. Check the packages

1. Each archive must match its `.sha256` file (`sha256sum -c <file>.sha256`).
2. Check that the Electron license (`LICENSE`), `LICENSES.chromium.html`, and `resources/app/ThirdPartyNotices.txt` are in the packaged app.
3. Search the unpacked app for things that must not ship: your user name, home-directory paths, private registry URLs, tokens, logs, and personal documents. Native modules normally contain the build directory path, so build from a neutral path such as `~/npad` or `D:\build\npad`.
4. On a disposable Windows machine, such as a VM or Windows Sandbox, run `build/npad/test/installer.ps1`. It installs into a temporary folder, checks shell commands and file associations, runs the UI suite against the installed app, and uninstalls. Don't run it on a machine where NPad is already installed.
5. On Linux, extract the archive on a clean machine, run `linux-x64/bin/npad`, and check that it starts with sandboxing enabled.
6. Before listing macOS builds as normal downloads, test them on real Macs. Developer ID signing and notarization aren't set up, so macOS will block them by default.

### 4. Write the checksum file

Put all release files in one folder, then write a single `SHA256SUMS.txt` that lists every package:

```sh
cd release
sha256sum NPadSetup-x64-1.147.0.exe NPad-linux-*-1.147.0.tar.gz NPad-darwin-*-1.147.0.zip > SHA256SUMS.txt
```

On Windows only:

```powershell
Get-ChildItem NPad* -Exclude *.sha256 | ForEach-Object {
	"$((Get-FileHash $_ -Algorithm SHA256).Hash.ToLowerInvariant())  $($_.Name)"
} | Set-Content SHA256SUMS.txt -Encoding ascii
```

### 5. Tag and publish

1. Create an annotated tag on the release commit and push it:

   ```sh
   git tag -a v1.147.0 -m "NPad 1.147.0"
   git push origin v1.147.0
   ```

2. Write release notes in a file such as `notes.md`. Include:
   - The highlights and fixes since the previous release.
   - A download table with every package that's included. Say which platforms are missing.
   - Linux sandbox setup: extract the archive, run `bin/npad`, and fall back to the root-owned `chrome-sandbox` if needed.
   - How to verify downloads (`Get-FileHash` on Windows, `sha256sum -c --ignore-missing SHA256SUMS.txt` on Linux), plus the hashes.
   - That builds are unsigned, so SmartScreen and Gatekeeper may warn, and that NPad doesn't update itself.
   - The commit, toolchain (Node, pnpm, Electron), and which tests passed on which platform.

3. Create the release. `--verify-tag` stops it from creating a tag that you didn't push:

   ```sh
   gh release create v1.147.0 release/NPadSetup-x64-1.147.0.exe release/NPad-linux-x64-1.147.0.tar.gz release/NPad-linux-x64-1.147.0.tar.gz.sha256 release/SHA256SUMS.txt --title "NPad 1.147.0" --notes-file notes.md --verify-tag --latest
   ```

   GitHub accepts release files up to 2 GiB each.

4. To add a platform later, upload it with the new checksum file and update the notes:

   ```sh
   gh release upload v1.147.0 NPad-darwin-arm64-1.147.0.zip NPad-darwin-arm64-1.147.0.zip.sha256 SHA256SUMS.txt --clobber
   gh release edit v1.147.0 --notes-file notes.md
   ```

### 6. Verify the published release

1. Download it back into an empty folder and check every hash:

   ```sh
   gh release download v1.147.0 --dir verify
   cd verify && sha256sum -c SHA256SUMS.txt
   ```

2. Check that the release page shows the right tag, is marked **Latest**, and isn't a draft or pre-release.
3. If the [README](../README.md) download table no longer matches what was published, update it.

If a published package turns out to be broken, delete that file from the release and say so in the notes. Fix it in a new patch version instead of replacing the file under the same version.

macOS and ARM64 builds have not been validated on real hardware yet.
