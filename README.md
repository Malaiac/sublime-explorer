# Sublime Explorer

A file explorer for macOS that works like Windows Explorer — because apparently nobody else has built one.

**Tree view on the left. Folder contents on the right. Drag & drop. That's it.**

Built out of frustration after testing 15+ file managers on macOS and finding that every single one thinks "dual-pane" means "two identical directory listings side by side" instead of "tree + content view like every OS has done since 1995".

![Sublime Explorer](https://img.shields.io/badge/platform-macOS-lightgrey) ![License](https://img.shields.io/badge/license-MIT-blue)

## Features

- **Tree + Content view** — directory tree on the left, folder contents on the right (like Windows Explorer)
- **Drag & drop** — between tree and content, between content items, to/from favorites
- **Address bar** with autocomplete (Tab to complete, arrows to navigate suggestions)
- **Preview panel** — file metadata, image thumbnails, markdown rendering with warm Sublime-inspired theme, text preview
- **Favorites** — pin directories to the top of the tree (drag a folder or right-click → Add to favorites)
- **Clipboard bar** — see what you're about to paste at all times
- **System zone warning** — visual indicator when browsing /Library, /System, etc.
- **File watcher** — auto-refresh when files change on disk
- **Multi-window** support
- **Snap** — Cmd+Left/Right for split screen

## Install

### Quick (macOS, Apple Silicon)

Download the latest `.dmg` from [Releases](https://github.com/malaiac/sublime-explorer/releases), open it, drag to Applications.

### From source

```bash
git clone https://github.com/malaiac/sublime-explorer.git
cd sublime-explorer
npm install
npm start

# Optional: global command
npm link
sublime-explorer

# Optional: build .app / .dmg
npm run build
# Output in dist/
```

**Requirements:** Node.js 18+

## Keyboard Shortcuts

### Navigation

| Shortcut | Action |
|----------|--------|
| `Backspace` | Parent directory |
| `Enter` | Open file / enter directory |
| `Arrow ↑↓` | Navigate items |
| `Arrow ←` | Focus tree / collapse tree node |
| `Arrow →` | Focus content / expand tree node / enter directory |
| `Tab` | Switch focus between tree and content |
| `Home` / `End` | First / last item |
| Letters | Jump to matching item (cycles on repeat) |
| `Alt+←` / `Alt+→` | History back / forward |
| `Cmd+L` | Focus address bar |
| `Cmd+↑` | Maximize window |
| `Cmd+←` / `Cmd+→` | Snap left / right |

### File Operations

| Shortcut | Action |
|----------|--------|
| `Cmd+C` | Copy |
| `Cmd+X` | Cut |
| `Cmd+V` | Paste |
| `Cmd+A` | Select all |
| `Delete` | Move to trash |
| `Shift+Delete` | Permanent delete |
| `F2` | Rename |
| `Cmd+Shift+N` | New folder |
| `F5` / `Cmd+R` | Refresh |

### Preview

| Shortcut | Action |
|----------|--------|
| `Cmd+F` | Search in preview |
| `Enter` / `Shift+Enter` | Next / previous search result |
| `A+` / `A-` buttons | Increase / decrease font size |
| Double-click path | Copy full path to clipboard |

### Window

| Shortcut | Action |
|----------|--------|
| `Cmd+N` | New window |
| `Cmd+W` | Close window |

## Context Menu

Right-click on files/folders or empty space for:
- Open / Copy / Cut / Paste
- Rename / New folder / Delete
- Add to favorites / Remove from favorites
- Open in Terminal (iTerm)
- Reveal in Finder

## Drag & Drop

- **Default drag** = move
- **Option + drag** = copy
- Drop on tree nodes, content folders, or favorites

## Tech

- Electron + vanilla JS
- No frameworks, no build step, no bundler
- ~1000 lines of JS, ~300 lines of CSS
- `fs.watch` for live updates
- `marked` for markdown rendering

## Why

macOS Finder is fine for casual use but painful for power users coming from Windows. After testing QSpace, Marta, muCommander, Path Finder, ForkLift, Commander One, Double Commander, Nimble Commander, XtraFinder, Transmit, Crax Commander, and more — none of them implement the basic tree+content layout that Windows Explorer has had for 30 years.

So we built our own.

## Name

Named after [Sublime Text](https://www.sublimetext.com/), the greatest code editor ever made. The preview panel borrows its warm color palette as a small tribute.

## License

MIT
