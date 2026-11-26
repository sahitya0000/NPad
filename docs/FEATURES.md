# NPad features

All of NPad's 54 editing tools are in the File, Edit, and View menus and under **NPad:** in the Command Palette. Context menus add 26 more entries, reusing existing actions where possible. Settings and commands use the `npad.*` namespace. Names from earlier builds are not kept as aliases, and bookmarks stored under an old namespace are not migrated.

## Everyday behavior

- **Startup:** An empty window opens one untitled tab. Opening a file closes that tab only if it was never edited. Launching with a file opens just that file. NPad doesn't reopen the previous folder, but unsaved-work recovery still works.
- **Word wrap** is on by default. Turn it off with **View > Word Wrap** or the `editor.wordWrap` setting.
- **Closing with unsaved changes** gives you three choices: **Save / Save All**, **Don't Save**, or **Cancel**. Don't Save also removes the recovery backups for those changes.
- **Workspace Trust is disabled**, so files open without a trust prompt. Electron sandboxing and preview security still apply. Only open content you trust.
- **Report Issue** creates a local Markdown draft. NPad sends nothing anywhere and has no auto-updater.
- **Data locations:** `%APPDATA%\NPad`, `%USERPROFILE%\.npad`, and `%USERPROFILE%\.npad-shared`. These are separate from VS Code's.
- **Windows installer:** You can install for your user or for all users. It can add shortcuts, Explorer entries, and file associations for supported text and source types. It never overrides your default-app choices.

Kept from VS Code: local file and single-folder editing, folder-wide find and replace, grammars, snippets, word completion, accessibility, local history, Markdown previews with Mermaid and math, webviews, and custom editors.

## JSON formatting

**Format Document** (`Shift+Alt+F`) and **Format Selection** (`Ctrl+K Ctrl+F`) work on JSON and JSONC.

- The formatter changes only whitespace. Number spelling, key order, duplicate keys, escapes, and any BOM stay the same. JSONC keeps comments and trailing commas.
- Indentation and line endings follow your editor settings. Formatting a selection works with multiple selections and leaves text outside them alone.
- The whole document must be valid, up to 1 MiB, 128 nesting levels, and a 4 MiB output budget. Invalid or oversized input shows a warning and makes no edits.
- For other languages, NPad shows a "not supported" message instead of prompting you to install an extension.

## File comparison

There are three commands under **File > Compare**:

- **Compare Two Files...** picks two files, which can be in different folders.
- **Compare Active File With...** picks another file to compare against the current one.
- **Compare Active File with Saved** shows unsaved edits against the copy on disk.

You can also right-click a tab and choose **Compare with File...**. Comparisons use open buffers and never save anything. File comparison covers text files only: no folders, binary files, merging, or source control.

## Spell checking

- English spelling is checked automatically, but only in `.txt` and `.md` files, based on the filename. You can run **Edit > Spelling > Check Spelling (English)** manually in any file.
- Identifiers such as `camelCase`, `snake_case`, and `ACRONYMName` are split, and each part is checked separately. Misspelled parts get a blue underline.
- `Ctrl+.` opens suggestions. You can replace the word, ignore it for the session, or add it to your dictionary. Replacements only change local text and never rename references.
- Turn checking off with `npad.spelling.enabled`. Added words are stored in `npad.spelling.userWords`, which holds up to 2,000 ASCII words.
- The Hunspell dictionary is bundled and runs in a background worker, completely offline. Limits are 256 KiB of text, 20,000 words, 200 underlines, and 8 suggestions per word. URLs, email addresses, numbers, and non-ASCII words are skipped.

## Editing tools

**Edit > Insert**
- Short, long, or custom date/time. Custom formats use `YYYY MM DD HH mm ss SSS` and `[literal]` text.
- Any Unicode character, including by code point (for example `U+1F600`).

**Edit > Text Operations**
These apply to the selected lines, or the whole document if nothing is selected, and can be undone.
- Remove duplicate or blank lines, trim whitespace, and join lines.
- Sort numerically (stable, exact decimals, invalid lines moved to the end) or by line length.
- Column editing inserts text or number sequences across up to 10,000 rows.
- Redact text with blocks or bullets. Redaction only changes what you see: undo, local history, and backups still contain the original text.

**Edit > Copy to Clipboard**
- Copy the current file's name or folder, or the paths of all open files.

**Edit > Bookmarks**
- Toggle bookmarks and jump to the next or previous one.
- Copy, cut, or remove bookmarked lines, with a preview first.
- Bookmarks follow your edits and are saved per file.

**Edit > Highlights**
- Mark all occurrences of a word or selection in one of five colors, up to 10,000 per document.
- Highlights last for the session only.

**View**
- **Show End of Line** shows LF and CRLF markers.
- **Document Summary** shows characters, words, lines, bytes, encoding, and line endings.
- **Monitoring (tail -f)** follows a saved log file up to 8 MiB in read-only mode. It handles truncation and log rotation and stops if you edit the file.

**File**
- **Save a Copy As** writes a copy without switching to it.
- **Print** opens a sandboxed plain-text preview, up to 8 MiB, where you print with the system dialog or save to PDF.

**Right-click menu**
- Highlights, Delete, Convert Case, and Select All.
- Toggle Comment, using the existing language-aware handler.
- **Base64** encode and decode UTF-8, up to 1 MiB of output. Input is fully validated before any edit.
- **Copy with Syntax Highlighting** copies both HTML and plain text.
- **Copy Link Address** copies a detected link without opening or fetching it.

These tools cover common Notepad++ tasks but don't aim for full parity, and NPad doesn't support plugins.

## Startup performance

The workbench module preloads while the window starts. To measure fresh launches of the packaged app with isolated profiles, close any open NPad windows and run:

```sh
pnpm run benchmark-startup 5 .build/npad/startup-benchmark.json
```

Only compare results from the same machine.
