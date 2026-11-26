# NPad

A lightweight standalone text editor with native Windows, Linux, and macOS build paths. No external checkout, submodule, or linked `node_modules` is required. Windows x64 and Linux x64 have been built locally; macOS and ARM64 targets still require validation on their native CI runners.

Windows x64 and the extracted Linux x64 archive passed CLI/native-module and basic GUI editing/saving checks. Linux GUI validation used Ubuntu 24.04 WSLg with sandboxing enabled.

NPad has its own installation, Windows file associations, taskbar identity, and user data (`%APPDATA%\NPad`, `%USERPROFILE%\.npad` and `%USERPROFILE%\.npad-shared`). The title bar and empty-editor landing page show **NPad**, alongside the existing notepad logo. On the landing page, the logo and name use a subtle monochrome watermark treatment, with stronger visibility in high-contrast themes. A luminance stencil preserves the notebook rules, code symbol and pencil details rather than flattening the logo to a solid silhouette. App and title-bar icons retain their full colors.

Build paths, command IDs, settings, and runtime feature flags use the NPad name throughout. Settings and editor commands use the `npad.*` namespace. Earlier names are not retained as compatibility aliases: update custom settings and keybindings to the NPad names. Saved files and application data directories are unchanged, but bookmarks stored under an earlier namespace are not migrated.

NPad is an independent derivative of [Code - OSS](https://github.com/microsoft/vscode), not an official Microsoft product. The desktop app does not include an AI agent; agentic development support is for contributors.

## Downloads

Installers and archives are published on [GitHub Releases](https://github.com/sahitya0000/NPad/releases) when available; they are not committed to the repository. Report bugs and request features through [GitHub Issues](https://github.com/sahitya0000/NPad/issues).

## Contributing and release readiness

- [Contributor guide](CONTRIBUTING.md): setup, architecture, checks, and pull requests.
- [Agent instructions](AGENTS.md): repository-scoped guidance for coding agents.
- [Security policy](SECURITY.md) and [community conduct](CODE_OF_CONDUCT.md).
- [Open-source publication checklist](docs/OPEN_SOURCE_READINESS.md): completed preparation and manual publication gates.

## Build

Use Node **24.22.1** and **pnpm 12.16.0** (pinned in the repository), with Python 3 and native build tools:

- **Windows x64:** Visual Studio C++ Build Tools, the Windows SDK, and matching Spectre-mitigated x64 libraries. Inno Setup is installed as a build dependency.
- **Linux x64/ARM64:** Clang 19, Make, pkg-config, X11/XKB, Secret Service, and Kerberos development libraries. GTK 3, NSS, ALSA, and GBM runtime libraries are needed to run Electron.
- **macOS x64/Apple Silicon:** Xcode Command Line Tools (`xcode-select --install`), including Clang and the macOS SDK. The build also uses the system `plutil`, `sips`, `iconutil`, `codesign`, and `ditto` tools.

Build on the target operating system using a Node installation matching its architecture. Do not copy `node_modules` between platforms or cross-compile by changing an architecture environment variable. The build downloads the matching pinned Electron runtime and verifies it against checked-in checksums.

Install Node using your preferred version manager and install the pinned package manager with `npm install --global pnpm@12.16.0`. The lockfile uses registry-neutral resolutions (public npm by default); no Microsoft package-feed credentials are required.

```powershell
pnpm install --frozen-lockfile
pnpm run build-npad
pnpm run typecheck
pnpm test
pnpm run test-native-app
```

`test-native-app` checks the CLI, native-module loading, and opening/editing/saving with the platform's keyboard shortcut. Run it in a graphical desktop session. On Windows, also run `pnpm run test-npad-app`, the larger **Windows-oriented** UI suite; it is not a claim of equivalent Linux/macOS coverage. Both accept `NPAD_TEST_APP` as an alternate **distribution directory**, not an executable or macOS app path.

`pnpm run check` combines build-script type checking, unit tests, and documentation checks for local links and script runners. Command-registration tests protect the 54 editing tools and 26 context actions directly, without depending on historical research reports. Build first: packaging tests require real output. The type check covers the build tooling, not the entire retained upstream source tree. CI defines native Windows, Linux x64/ARM64, and macOS Intel/Apple Silicon jobs; successful public-runner builds remain a release gate.

Outputs (`<arch>` is `x64` or `arm64`; version follows `package.json`):

- Runnable application: `.build\npad\win32-x64\NPad.exe`
- Installer: `.build\npad\NPadSetup-x64-1.146.0.exe`
- Linux executable: `.build/npad/linux-<arch>/npad`
- Linux archive and checksum: `.build/npad/NPad-linux-<arch>-1.146.0.tar.gz[.sha256]`
- macOS application: `.build/npad/darwin-<arch>/NPad.app`
- macOS archive and checksum: `.build/npad/NPad-darwin-<arch>-1.146.0.zip[.sha256]`

```powershell
& ".\.build\npad\win32-x64\NPad.exe"
```

Keep the whole distribution directory (or macOS app bundle) together. Close that copy before rebuilding. Windows/Linux binaries are unsigned; macOS bundles receive only a local ad-hoc signature so modified binaries can run, **not** a trusted Developer ID signature or notarization. Public macOS distribution needs maintainer signing/notarization and Gatekeeper testing. No signing credentials are needed for a local build.

`pnpm run bundle-npad` builds intermediate bundles only; `pnpm run package-npad` packages an existing bundle and prepared native Electron runtime. `build-npad` also creates the platform's installer/archive.

### Linux

For Ubuntu 24.04, install prerequisites and select Clang before restoring:

```bash
sudo apt-get update
sudo apt-get install clang-19 build-essential pkg-config libx11-dev libxkbfile-dev libsecret-1-dev libkrb5-dev libgtk-3-0t64 libnss3 libasound2t64 libgbm1
export CC=clang-19 CXX=clang++-19
pnpm install --frozen-lockfile
pnpm run build-npad
./.build/npad/linux-x64/npad
./.build/npad/linux-x64/bin/npad --version
```

Debian 12 uses `libgtk-3-0` and `libasound2` instead of the `t64` package names. Its GCC 12 fails on the pinned Electron headers; use Clang 19. Adjust the distribution directory to `linux-arm64` on ARM64.

The archive includes a `bin/npad` command-line launcher, `npad.desktop`, and `npad.png`. For desktop integration, install the launcher in your PATH and the icon/desktop entry in the standard XDG directories, or adapt `Exec` and `Icon` to absolute installed paths. This portable archive does not install system-wide or change default file associations.

Run as a regular user with Electron sandboxing enabled. If the host cannot use unprivileged user namespaces, an administrator must place the distribution in a root-owned location not writable by other users, then set its `chrome-sandbox` helper to owner `root:root` and mode `4755`. Do not work around sandbox errors with `--no-sandbox`. Restricted containers may still forbid the namespaces Chromium requires.

Headless native CI uses `dbus-run-session -- xvfb-run -a pnpm run test-native-app` with `xvfb`, `xauth`, and `dbus-x11` installed.

### macOS

Use the common install/build commands above in a native Terminal session, then open `.build/npad/darwin-arm64/NPad.app` (or `darwin-x64` on Intel). Its command-line launcher is `NPad.app/Contents/Resources/app/bin/npad`; it also supports a symlink from a directory in your PATH. The ZIP preserves the app's framework symlinks and executable permissions. No DMG, universal binary, trusted signing, or notarization is produced.

### Windows Spectre libraries

If Spectre libraries are staged locally instead of installed in Visual Studio, point MSBuild at the matching toolset's x64 library directory before installing/rebuilding native dependencies:

```powershell
$env:NPAD_SPECTRE_LIB = (Resolve-Path ".\.build\msvc-spectre-x64").Path
$env:ForceImportBeforeCppTargets = (Resolve-Path ".\build\npad\spectre-libraries.props").Path
pnpm rebuild
```

## Scope

Retained: local files and single-folder editing, file/folder find and replace, syntax grammars, snippets, word completion, text comparison, accessibility, recovery, local history, Markdown previews, Mermaid, math, webviews, and custom editors.

Omitted: AI/Copilot, remote development, integrated browser, debugger, notebooks, test runner, terminals, tasks, SCM, Marketplace/user-installed extensions, semantic language servers/refactoring, sync/accounts, profile management, multi-root workspaces, timeline, telemetry/experiments, onboarding, Outline, Problems, and Output panels. Shared contracts and services remain where editing and previews depend on them; a directory named after an omitted feature is not necessarily unused.

Normal launches do not reopen the previous folder; explicit file/folder arguments and unsaved recovery remain supported. NPad uses separate data directories. Help > Report Issue creates a local Markdown draft rather than sending reports upstream. There is no automatic updater.

An otherwise empty window starts with one new untitled editing tab. Opening an existing file closes only that startup tab, and only if it has never been edited. Edited startup tabs (including text later undone), other new tabs, and restored documents are preserved. Launching directly with a file opens that file without an extra empty tab. Closing all tabs still shows the NPad landing page.

Word Wrap is enabled by default for new and opened text documents. Toggle it with **View > Word Wrap** or change `editor.wordWrap` in Settings; explicit user and workspace preferences are preserved.

Closing a window or choosing **File > Exit** with unsaved changes asks you to **Save / Save All**, **Don't Save**, or **Cancel**, and warns that changes will be lost without saving. Canceling Save As or a failed save keeps NPad open. Don't Save discards those changes, including their recovery backups; it does not overwrite saved files. Background recovery remains available for unexpected termination and window reloads, but does not replace this explicit close confirmation. Normal editing auto-save remains unchanged.

Workspace Trust/Restricted Mode is disabled for NPad at the service level, including when existing user settings enable it. Files and folders open without a Trust prompt; trust commands and preferences are hidden. This does not disable Electron sandboxing or change other preview/security controls. Only open content you intend to use.

The installer supports per-user or all-users installation, optional shortcuts and Explorer entries, and registration for the text/source extensions supplied by the bundled grammars. It never overwrites Windows' protected default-app choices. Choose defaults in Windows Settings.

## Formatting

**Format Document** and **Format Selection** support **JSON and JSON with Comments (JSONC)**. Use the Edit menu, editor right-click menu, or command palette. Windows shortcuts are **Shift+Alt+F** and **Ctrl+K, Ctrl+F**, respectively. Selection formatting supports multiple selections; without a selection, the standard shortcut formats the current line.

Formatting edits whitespace without parsing and reserializing values: number spelling/precision, property order, duplicate keys, string escapes, and the BOM are preserved. JSONC also preserves comments and trailing commas; strict JSON rejects them. Indentation and line endings follow the editor settings. Selection formatting leaves text outside the exact selection offsets untouched, including whitespace insertions at selection boundaries.

The whole document must be valid, even when formatting selected text. Limits are **1 MiB of UTF-8 input**, **128 nesting levels**, and a conservative **4 MiB potential-output/complexity budget**. Invalid or oversized input produces a visible warning without partial edits. Formatting supports undo, read-only guards, and cancellation when the document changes.

Formatting is manual by default; existing opt-in format-on-save/paste settings remain available. A stale default-formatter preference from an unavailable extension does not block the built-in formatter. Other languages show an explicit unsupported-format notification, not an extension-install prompt. No language server, extension download, or new package dependency is required.

## File comparison

Use **File > Compare**:

- **Compare Two Files...** chooses the original and modified local text files in two successive dialogs, including files in different folders.
- **Compare Active File With...** uses the existing quick picker to choose another file.
- **Compare Active File with Saved** compares the on-disk file with its current, possibly unsaved buffer.

You can also right-click a file tab and choose **Compare with File...**, then select the other file in the quick picker. The comparison uses the tab you right-clicked, even when another tab is active. Cancelling the picker leaves your editors unchanged.

The existing diff editor shows the original on the left and modified text on the right, with difference highlights and navigation. Comparisons use open buffers when files already have unsaved edits. Opening a comparison never saves or writes either file; editing/saving the modified side remains an explicit user action. Same-file selections and operational failures are reported visibly, and cancelling a picker opens no comparison.

This is text-file comparison, not folder/binary comparison, merge tooling, or source-control integration.

## Spell checking

English spelling is checked **automatically only in `.txt` and `.md` files** (case-insensitive extensions). Eligibility follows the filename, not the selected language mode. Source code, JSON, HTML, logs, other extensions and unsaved untitled documents are not checked automatically. You can still run **Check Spelling (English)** manually in any text editor; for other file types, editing clears stale highlights without starting another check.

Words inside `CaseExample`, `caseExample`, `case_example`, `CASE_EXAMPLE`, acronym-prefixed names and names containing digits or hyphens are checked separately. Only misspelled components receive blue wavy underlines. Place the caret in an underlined component and use **Spelling Suggestions...** (`Ctrl+.`) to replace it, ignore it for this session, or add it to your personal dictionary. Corrections preserve surrounding identifier text, separators and component casing, support undo, and never save automatically. This is a local text correction, not a semantic rename of other references. The shortcut opens NPad's spelling picker without restoring the excluded IDE code-action framework.

Checking is **on by default**. In Settings, search for `npad.spelling.enabled` and turn it off to stop checking in all documents, clear their underlines and release the spelling worker. Re-enabling it resumes automatic checks in existing and newly opened `.txt` and `.md` files only. You can also set `"npad.spelling.enabled": false` in user settings.

Checks are debounced after edits and start after the editor is restored, so initial file display does not wait for the dictionary. **Edit > Spelling > Check Spelling (English)** refreshes the current document immediately; **Clear Spelling Highlights** pauses that document until you run Check Spelling, reopen it, or toggle the enabled setting. The English Hunspell dictionary and engine are bundled and loaded in a worker only when an eligible document needs checking; no text, dictionary request, or personal word is sent to a server.

Limits: **256 KiB UTF-8 text**, **20,000 eligible word components**, **200 underlines**, and **eight suggestions** per component. Suggestions for components over 32 characters are omitted, but ignoring/adding remains available. URLs, email addresses, numeric-only content and non-ASCII word tokens are skipped. Code, comments, strings and Markdown code blocks are included; technical words absent from the English dictionary may need to be accepted in your personal dictionary. Binary/image previews are not text documents. This is English spelling, not grammar checking or compiler diagnostics. Invalid personal dictionaries and limits/failures are reported visibly.

Personal accepted words persist in local user settings as `npad.spelling.userWords` (up to 2,000 words, each 2-64 ASCII letters with optional apostrophes). Edit that setting to remove words. Dictionary and engine licenses are included in the packaged third-party notices.

## First-file startup

The renderer preloads the workbench module while its bootstrap and window configuration initialize. Preloading fetches/parses the module without evaluating it before localization and product globals are ready. Disabling workspace trust also avoids the associated trust checks.

Measure the current packaged application with sequential fresh-process/fresh-profile launches (close other NPad instances first):

```powershell
pnpm run benchmark-startup 5 .build\npad\startup-benchmark.json
```

The JSON contains elapsed times and renderer performance marks. Each run uses an isolated temporary profile and cleans it up afterward. Timing stops when the requested file text is visible and includes Playwright attachment overhead. OS disk caches are not flushed; compare runs on the same host rather than treating historical measurements as a speed guarantee.

## Editing tools

NPad's 54 editing tools appear in compact File, Edit, and View menus and under **NPad:** in the command palette. The 26 additional context-menu registrations reuse existing actions where possible. Their source identities and command IDs are covered by regression tests. Similar commands do not imply complete Notepad++ parity, and no third-party plugin runtime is included.

- **Edit > Insert:** local short/long date/time, customized date/time, and a character/Unicode picker. Custom date tokens are `YYYY MM DD HH mm ss SSS`; use `[brackets]` for literal text. The character picker includes common characters and accepts any valid Unicode scalar, such as `U+03A9` or `U+1F600`.
- **Edit > Text Operations:** adjacent-duplicate removal; empty/whitespace-only line removal; leading/both-side trimming; trimming and joining; redaction; column editing; and numeric/length sorts. Line operations apply to selected whole lines, or the document when there is no selection. Edits are undoable.
- Numeric sorting accepts signed whole numbers or comma/dot decimal fractions without floating-point precision loss. It is stable; invalid numeric lines stay at the end in their original order in either direction. Thousands separators and exponent notation are not accepted as numbers. Length sorting counts Unicode code points.
- Column editing inserts text or exact integer sequences across multiple/rectangular selections, or at the starting column of each selected line. Short lines are padded as needed. Each operation is limited to 10,000 rows.
- Redaction offers blocks or bullets in a picker instead of a Shift-only option. **It is visible redaction, not secure erasure**: undo, local history, backups, and original files can retain the original text.
- **Edit > Copy to Clipboard:** current filename/directory and all open local filenames/paths. Unsaved documents are omitted from path lists; duplicate resources are listed once.

### Navigation and display

- **Edit > Bookmarks:** toggle, next/previous (wrapping), clear, copy/cut bookmarked lines, and remove bookmarked/non-bookmarked lines. Per-file bookmarks follow edits and persist in workspace storage. Destructive bulk operations show a preview and confirmation and support one-step text undo.
- **Edit > Highlights:** Mark Text, five styles for all literal case-sensitive occurrences or the selected text/current word, and per-style/all clearing. Every individual style entry shows a matching color box, including the clearing submenu and Mark Text's style picker. These are session decorations that follow edits, not language analysis. Newly typed occurrences require running the command again. The limit is 10,000 highlights per document.
- **View > Appearance > Show End of Line** (`npad.showEndOfLine`) displays LF/CRLF markers only for visible lines, without creating decorations for the entire file.
- **View > Document Summary:** Unicode character count, whitespace-delimited word count, lines, UTF-8 buffer bytes, encoded disk size, encoding, line endings, and unsaved state. Buffer bytes and disk bytes can differ.

### File tools

- **File > Save a Copy As:** writes a separate copy using the source encoding without changing the active document identity or dirty state. The original file and destinations with unsaved edits cannot be overwritten by this command.
- **File > Print:** opens a plain-text preview in a sandboxed, script-disabled window. Use that window's **File > Print** or `Ctrl+P` for the system print dialog, including installed PDF printers. Source text is escaped and is never executed as HTML. Preview is limited to 8 MiB.
- **View > Monitoring (tail -f):** opt-in, read-only log following for saved local files up to 8 MiB. Reloads are coalesced, follow the end, and support truncation and replacement/rotation at the same path. Unsaved buffers are never discarded; monitoring stops if the buffer becomes dirty or loading fails. Toggle the command again to stop and restore the preceding read-only state. No monitor runs at startup by default.

### Editor right-click menus

- **Highlights:** all five styles for all occurrences or one selection/word, per-style clearing, and clear all. Matching color boxes work in both the menu bar and isolated editor context menus. These actions also work in read-only files.
- **Delete**, **Convert Case > UPPERCASE / lowercase**, and **Base64** appear only for a writable nonempty selection. **Select All** works without a selection and in read-only files. Comment toggles reuse existing language-aware handlers and are hidden for read-only files.
- **Base64 > Encode / Decode (UTF-8):** explicit local text conversion, with one undo step across multiple selections. Encoding accepts up to 1 MiB total UTF-8 bytes; decoding accepts up to 2 MiB total encoded input (including ASCII spaces, tabs, CR/LF), producing at most 1 MiB UTF-8 text. Standard alphabet and padding are required; noncanonical padding bits, invalid UTF-8, and binary control characters other than tab/CR/LF are rejected. BOMs are preserved. Every selection is validated before any edit; errors notify without partially changing the document. These are built-ins, not MIME Tools.
- **Copy As > Copy with Syntax Highlighting:** reuses rich copy with plain-text and HTML clipboard output. It does not bundle NppExport or promise identical all-format/RTF output.
- **Copy Link Address:** appears only when the caret is on an already-detected link and all selections are empty. It copies the detected target without resolving through providers, fetching it, or opening a browser. Ordinary Copy is retained instead of being replaced.

Right-click inside selected text preserves the selection; outside it, normal editor caret/selection behavior applies. Deferred anchor-selection, selected-path opening, arbitrary line hiding, network search, and separate block-uncomment commands were not added. No plugin runtime or package dependency was introduced.

## Extraction and size

The extraction follows the NPad esbuild input graph, adds explicitly URL-loaded resources, Electron sandbox preloads, and curated bundled extensions, and retains licenses and API declarations. Initially 3,664 of the upstream tree's 13,584 source files were retained (about 73% fewer). Upstream repository history, CI, server/remote/CLI projects, unrelated extensions, and upstream build outputs were not copied. Required generated source contracts and editor assets are retained so the standalone build does not need upstream generators. The standalone build is NPad-only; it does not install or compile the full upstream workspace.

`build\npad\config.json` records entry points, runtime resources, and source provenance. `out-npad\npad-build.json` records the inputs and external imports of each fresh build. Packaging follows the actual external-package dependency closure, including nested versions, and excludes source maps, tests, native build intermediates/headers, other-platform search binaries, unused notebook/chat renderers, extension source/build scripts, and development dependencies. Shared Mermaid diagram-editor code is retained even where upstream names it after chat. Electron remains the largest fixed runtime cost; source reduction is not the same as executable-size reduction.

On the extraction machine, the runnable Windows x64 directory decreased from **701 MiB to 533 MiB** (about **24% smaller**). This measures the complete unpacked app, not just its executable or the compressed installer.

The original checkout is not modified. To maintain this repository, edit the retained source directly and rebuild here. New dynamically loaded workers/resources must be added explicitly to the NPad build configuration. Run the unit tests after bundling and the packaged-app smoke suite after packaging.

## License

NPad is released under the [MIT license](LICENSE).

NPad is derived from Code - OSS. Those sources keep their original Microsoft copyright headers and are covered by the upstream MIT license in [LICENSE.txt](LICENSE.txt). The MIT terms require that notice to be kept. See [ThirdPartyNotices.txt](ThirdPartyNotices.txt) for third-party notices. Bundled dependencies and extensions keep their own license files. Packaged builds include all three notice files.
