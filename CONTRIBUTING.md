# Contributing to NPad

Thanks for helping! NPad is a local text editor, not an IDE, so please check the [out-of-scope list](README.md#-not-included-on-purpose) before proposing a feature. Coding agents are welcome as contributors. Adding AI features to the app is not a goal.

## Build

Build on the target OS and architecture. Cross-compiling isn't supported, so never copy `node_modules` between machines. You need internet access for npm, Electron, and native headers. No private registries or credentials are required.

**Common requirements:** the Node version in `.nvmrc` (24.22.1), pnpm 12.16.0 (`npm install --global pnpm@12.16.0`), and Python 3.

**Platform requirements:**
- **Windows x64:** Visual Studio C++ Build Tools, the Windows SDK, and the x64 Spectre-mitigated libraries. Inno Setup is installed automatically as a dependency.
- **Linux x64/ARM64:** Clang 19, Make, pkg-config, and the X11/XKB, libsecret, and Kerberos development libraries. To run the app you also need GTK 3, NSS, ALSA, and GBM.
- **macOS:** Xcode Command Line Tools (`xcode-select --install`).

To build and test:

```sh
pnpm install --frozen-lockfile   # native modules are built for Electron by .pnpmfile.mjs
pnpm run build-npad              # app + installer/archive
pnpm run check                   # build-tool types, unit tests, doc-link tests
pnpm run test-native-app         # CLI + open/edit/save smoke test (needs a desktop session)
pnpm run test-npad-app           # Windows only: full UI suite
```

| Output | Path (`<arch>` = `x64` or `arm64`) |
| --- | --- |
| Windows app / installer | `.build/npad/win32-x64/NPad.exe`, `.build/npad/NPadSetup-x64-<version>.exe` |
| Linux app / archive | `.build/npad/linux-<arch>/npad`, `.build/npad/NPad-linux-<arch>-<version>.tar.gz` |
| macOS app / archive | `.build/npad/darwin-<arch>/NPad.app`, `.build/npad/NPad-darwin-<arch>-<version>.zip` |

Archives come with `.sha256` files. Keep the whole output directory together, and close the app before rebuilding. `bundle-npad` builds only the bundles, and `package-npad` packages an existing bundle. The Electron download is verified against checked-in checksums. Builds are unsigned. On macOS they get only an ad-hoc signature, without Developer ID signing or notarization.

### Linux notes

On Ubuntu 24.04:

```sh
sudo apt-get install clang-19 build-essential pkg-config libx11-dev libxkbfile-dev libsecret-1-dev libkrb5-dev libgtk-3-0t64 libnss3 libasound2t64 libgbm1
export CC=clang-19 CXX=clang++-19
```

On Debian 12, use `libgtk-3-0` and `libasound2`. GCC 12 can't compile the Electron headers, so use Clang.

The archive includes a `bin/npad` launcher, `npad.desktop`, and `npad.png` for optional XDG integration. Keep sandboxing enabled and never use `--no-sandbox`. If your system doesn't allow unprivileged user namespaces, place the app in a root-owned directory and set `chrome-sandbox` to `root:root` with mode `4755`. For headless runs, use `dbus-run-session -- xvfb-run -a pnpm run test-native-app`.

### macOS notes

Open `.build/npad/darwin-<arch>/NPad.app`. Its command-line launcher is `NPad.app/Contents/Resources/app/bin/npad`. The build doesn't produce a DMG or a universal binary.

### Windows Spectre libraries

If you staged the Spectre libraries locally instead of installing them through Visual Studio, run:

```powershell
$env:NPAD_SPECTRE_LIB = (Resolve-Path ".\.build\msvc-spectre-x64").Path
$env:ForceImportBeforeCppTargets = (Resolve-Path ".\build\npad\spectre-libraries.props").Path
pnpm rebuild
```

## Where things live

| Path | Contents |
| --- | --- |
| `src/vs/workbench/contrib/npadEditor/` | NPad editing features (wired in `browser/npadEditor.contribution.ts`) |
| `build/next/npad.ts` | Feature filtering and NPad product configuration |
| `build/npad/config.json` | Entry points, runtime resources, upstream provenance |
| `build/npad/` | Bundling, Electron prep, packaging, installer; `platform.ts` owns target layouts |
| `build/npad/test/`, `build/next/test/npad.test.ts` | Regression tests |
| `extensions/` | Bundled grammars, themes, and Markdown support |

Edit the source in this repo directly; you don't need an upstream checkout. Some shared contracts keep the names of features NPad excludes, so don't remove them just because of their names. Register workers and other dynamically loaded resources explicitly in `build/npad/config.json`.

## Testing

- Run a single test file with, for example, `node --test build/npad/test/textTools.test.ts`.
- `check` doesn't type-check the whole upstream source tree.
- Packaging tests require a build first.
- Smoke tests run the packaged app with a temporary profile, connected through Playwright over CDP. `NPAD_TEST_APP` overrides the distribution directory. Pass the directory, not the executable.
- Keep the command-registration baselines current when you intentionally change actions.
- Add a regression test for each behavior change. For UI changes, describe how you checked them. Only report tests you actually ran.

## Pull requests

- Keep each change focused. Explain the problem, the behavior change, and how you tested it.
- Keep TypeScript type-safe, follow existing patterns, and keep copyright headers, license files, and third-party notices.
- Update docs when commands, settings, scope, or packaging change.
- Change dependencies with pnpm, commit the lockfile, and keep resolutions pointing at public npm. Review any new install scripts.
- Never commit credentials, personal files, build output, or installers.
- Review agent-generated changes yourself. You're responsible for what you submit.

CI also scans the files and Git history for secrets with Gitleaks 8.30.1. To run it yourself:

```sh
gitleaks git . --redact --log-opts="--all"
gitleaks dir . --redact
```

`.gitleaks.toml` excludes only specific upstream strings that were reviewed and found not to be secrets. Don't disable rules or exclude whole files to make a scan pass.

## License

By contributing, you agree that your work is licensed under the [MIT license](LICENSE). Code that comes from Code - OSS keeps its upstream notice in [LICENSE.txt](LICENSE.txt). Only submit work you have the right to contribute. There is no CLA.
