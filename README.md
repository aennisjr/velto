# Velto

Velto is a local-first desktop text library and canned response app built for fast retrieval, reusable snippets, and template-driven communication.

## Product focus

- local-first storage with SQLite
- keyboard-first quick search and copy workflow
- clean, lightweight library management
- dynamic template generation with `%variable%` placeholders
- Windows-first desktop shell with future portability in mind

## Using Velto

### Install

Run `VeltoSetup.exe`. Velto installs for your Windows account only, so you don't need administrator rights. An "Installing Velto…" window appears briefly. When it closes, Velto opens and confirms the installation, then shows where to find it and lists your shortcuts. Velto adds shortcuts to the Start menu and the desktop. After you close the window, Velto keeps running in the system tray so the shortcuts keep working.

### Open Quick Search

Press **Ctrl+Shift+Space** from any app to open Quick Search. Type to find saved text, then use **Up/Down** to select a result and **Enter** to copy it to the clipboard. Press **Esc** to close the window. If another app already uses the shortcut, open Velto from its system-tray icon or change the shortcut in **Settings**.

### Save something quickly

Press **Ctrl+Alt+N** to open Quick Capture. Enter or paste text, optionally add a title, tags, and a category, then press **Ctrl+Enter** to save. If you leave the title empty, Velto uses the first line of the text. Press **Esc** to close Quick Capture.

### Create and use templates

In the library, choose **New entry** and write text with placeholders such as `Hello %name%`. Placeholder names must start with a letter or underscore and may contain letters, numbers, and underscores (for example, `%customer_name%`). Velto detects placeholders as you type; you can also check **Treat as a template** to make an entry usable as a template without placeholders.

Open **Variable settings** to customize each placeholder's label and default value, choose a field type (text, multi-line text, date, number, or dropdown), and set whether it is required. For dropdowns, enter options separated by commas. Required placeholders must have a value before the result can be copied; optional placeholders can be left blank. Repeated uses of the same placeholder share one value.

Save the entry, then choose **Use Template** from the entry or select it in Quick Search. Fill in the fields and review the preview before copying. The saved template stays unchanged. To copy its placeholders literally, use **Copy raw** from the entry.

To save related text such as an email subject, choose **Add field** below the content and enter a name and value. Each field can be copied separately. Fields support the same placeholders as the main content, and a shared placeholder needs to be filled in only once. Additional fields are included in search, duplication, backups, and exports.

### View code snippets

Open an entry and use the **Syntax highlighting** menu below its content to choose a language. The choice is saved with that entry; new and existing entries default to **Plain text**. Highlighting changes only how content is displayed—editing and copying continue to use the original text.

### Organize and manage your library

Use the library to search and browse entries, create or edit saved text, and mark useful entries as favorites. Add tags and categories while editing an entry; select a category or tag in the sidebar to filter the list. Choose **Select** above the entry list to select multiple entries, then choose **Delete selected** and confirm to remove them together. Use **Settings** to manage categories and tags, configure global shortcuts, and control automatic backups.

Tags are deleted automatically when no entries use them. Archived entries retain their tags and are included in the tag usage counts in Settings.

Search stays within the selected view, tag, or category. The library displays at most 5,000 entries or 50 search matches; Quick Search displays at most 12 entries before typing or 50 matches. When results are cut off, refine the search to find other entries.

### Back up or move your library

Open **Settings** and choose **Back up now** to create a backup. To move your library to another computer, use **Export library** on the original computer, then **Import library** on the new one. Review the import preview and select how to handle entries that already exist.

## Development

Install dependencies with `npm install`, then start the desktop app and Vite development server with `npm run dev`.

Useful checks:

- `npm run typecheck` — TypeScript validation
- `npm run lint` — ESLint checks
- `npm test` — unit tests
- `npm run test:e2e` — build and run the Electron end-to-end tests
- `npm run test:upgrade` — package the current tree and a baseline release, then confirm a library created by the baseline opens intact (see below)
- `npm run build` — compile the main process, preload, and renderer

## Windows release

Run `npm run make` on Windows to build the Squirrel.Windows installer. The installer and its update package are written under `out/make/squirrel.windows/x64`; the unpacked application is under `out/velto-win32-x64`.

The installer is per-user. Velto stores its SQLite library and automatic backups in Electron's per-user `userData` directory, outside the installed application directory, so replacing the app during an update does not replace the library. Back up or export the library before testing an installer upgrade.

Before a release, run `npm run test:upgrade` to check that existing libraries survive the upgrade. It packages the newest `v*` tag (or the first commit when there are no tags) and the current tree, creates a varied library with the old build, then opens it with the new build and checks entries, templates, tags, categories, settings, search, and database integrity. Pass `--from <git ref>` to choose another baseline, or `--skip-build` to reuse the current `out/` build. Baseline builds are cached in `.upgrade-cache/`. Each run uses a temporary data folder, so an installed copy of Velto is not affected.

Bump `version` in `package.json` for every release: Squirrel only offers an update with a higher version, and the upgrade test warns when the version has not changed. Tag each release (for example, `git tag v0.1.5`) so the next upgrade test starts from it.

The test does not run the installer itself. Installer installation and in-place upgrade should still be verified on a clean Windows test account before distributing a release.

## Folder structure

- `src/main` — Electron main process and app lifecycle
- `src/preload` — safe API bridge for the renderer
- `src/renderer` — React interface and UI assets
- `src/shared` — shared types and validation helpers
- `src/database` — schema and migration definitions
- `tests` — integration and unit coverage
- `docs` — architecture and roadmap notes

## License

Copyright (C) 2026 Velto contributors.

This project is licensed under the GNU General Public License, version 3 or (at your option) any later version. See [LICENSE](LICENSE).
