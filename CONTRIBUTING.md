# Contributing to NPad

NPad is a native Windows, Linux, and macOS local text editor. Read the
[scope](README.md#scope) before proposing a feature. Development agents are
welcome; adding AI features to the shipped application is not the goal.

## Set up

1. Use Windows x64, Linux x64/ARM64, or macOS Intel/Apple Silicon, Git, and
   the Node version in `.nvmrc` matching your host architecture.
2. Install the pnpm version in `package.json`:
   `npm install --global pnpm@12.16.0`.
3. Install Python 3 and the [native prerequisites](README.md#build).
   Windows needs MSVC/SDK/Spectre libraries; Linux needs Clang 19 and
   development libraries; macOS needs Xcode Command Line Tools.
4. Run `pnpm install --frozen-lockfile`. Native modules are compiled for the
   pinned Electron runtime by `.pnpmfile.mjs`; do not rebuild them for host Node.
5. Run `pnpm run build-npad`, then `pnpm run test-native-app` in a desktop
   session. On Windows, also run `pnpm run test-npad-app`.

Windows x64 and Linux x64 builds have been exercised locally; macOS and ARM64
validation awaits native CI. Cross-compilation is not supported. Never share
`node_modules` or prepared Electron runtimes between hosts. Internet access is
needed for npm packages, Electron, and native headers. No private registries or credentials are required.
Do not install packages from a fork without reviewing its install scripts.

## Find the right code

- `src/vs/workbench/contrib/npadEditor/`: NPad editing features and contributions.
- `build/next/npad.ts`: feature filtering and NPad product configuration.
- `build/npad/config.json`: entrypoints, runtime resources, and upstream provenance.
- `build/npad/`: bundling, Electron preparation, packaging, and installer.
- `build/npad/test/` and `build/next/test/npad.test.ts`: regression coverage.
- `extensions/`: curated built-in grammars, themes, and Markdown functionality.

Edit retained source directly; a full upstream checkout is not needed.
Some shared contracts retain names of features NPad excludes. Do not remove them
solely because of their names. Explicitly register dynamically loaded resources
and workers in the build configuration.

## Validate a change

```powershell
pnpm run build-npad
pnpm run check
pnpm run test-native-app
```

For a narrow iteration, run the relevant Node test file, for example:

```powershell
node --test build/npad/test/textTools.test.ts
```

`check` covers build-tool types, the unit suite, and local documentation/script links.
It is not a full upstream-source type check. Packaged-app smoke tests require the
built app and launch it with isolated temporary data, not your personal profile.
Close the packaged app before rebuilding. See [build outputs](README.md#build).
Also run `pnpm run test-npad-app` on Windows; the native suite uses platform shortcuts.
Keep command-registration baselines current when deliberately changing actions.
Historical research reports are not required to run tests.

Add a regression test for behavior changes. For visible changes, exercise the
affected UI and describe that validation in the pull request. Never claim a
test passed if you did not run it; include environmental blockers.

## Pull requests and issues

- Use the issue forms in this repository for reproducible bugs and focused
  feature proposals. Follow [SECURITY.md](SECURITY.md) for private reporting.
- Keep changes focused. Explain the problem, behavior changes, and tests.
- Preserve TypeScript type safety, existing tabs/localization patterns, copyright
  headers, license files, and third-party notices.
- Update documentation when changing commands, scope, settings, or packaging.
- Change dependencies with pnpm, commit the lockfile, and keep registry-neutral
  resolutions that work with public npm. Review newly required native build scripts.
- Do not commit credentials, personal files, generated bundles, or installers.
- Review agent-generated changes yourself; authors remain responsible for their
  correctness, provenance, and safety.

CI also scans Git history with Gitleaks 8.30.1:

```powershell
gitleaks git . --redact --log-opts="--all"
gitleaks dir . --redact
```

Install the scanner separately if running it locally. Keep findings redacted.
The checked-in configuration narrowly excludes inspected upstream non-secrets;
do not disable a rule or broadly exclude source files to make a scan pass.

Contributions are provided under the repository's [MIT license](LICENSE).
Code derived from Code - OSS also keeps its upstream notice in [LICENSE.txt](LICENSE.txt).
Only submit material you have the right to contribute. No separate contributor
license agreement is configured.
