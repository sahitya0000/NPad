# Mermaid Markdown Features

This extension is bundled with NPad.

Adds [Mermaid.js](https://mermaid.js.org) diagram rendering to Markdown previews and the diagram editor.

## Building the webviews

Run `pnpm run build-webview` from this directory to build the webview bundles.
The webviews use minified ES modules with code splitting so Mermaid's diagram implementations and add-ons can load on demand.
NPad packages `markdown-preview-out` and `chat-webview-out`, including their emitted chunks; notebook renderer output is not shipped. The entry modules load sibling chunks using relative URLs.
