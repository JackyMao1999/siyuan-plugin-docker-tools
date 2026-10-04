# Tools for SiYuan Docker

**English** | [简体中文](./README_zh_CN.md)

1. Export documents to PDF
2. Print documents
3. Sync Feishu (Lark) knowledge base into SiYuan (Feishu → SiYuan, one-way)
4. Sync browser bookmarks (Chrome / Edge / Firefox / Safari) into a SiYuan database

## Feishu Knowledge Base Sync

Import documents from Feishu Wiki / Feishu Drive into SiYuan as native documents. One-way sync only (Feishu → SiYuan).

### Features

- Three sources: **Feishu Wiki**, **Storage (Drive)**, **Specific link**.
- Sync from **Feishu Wiki**: browse knowledge spaces, recursively import sub-documents and keep the hierarchy.
- Sync from **Feishu Storage (Drive)**: browse the cloud-space root or a specific folder.
- **Specific link**: paste a doc `/docx/`, legacy doc `/docs/`, Wiki `/wiki/` or folder `/folder/` link to parse and sync it.
- **Incremental sync**: skip documents whose Feishu edit time has not changed.
- **Asset localization**: download images/attachments and store them in the SiYuan asset folder.
- Choose the target notebook and root path; already-synced documents are updated in place instead of duplicated.

### Identity: app vs user

| Identity | What you can see | Notes |
| --- | --- | --- |
| **App (bot) identity** (default) | Only Wiki/docs **shared with the app** | Drive "My Space" belongs to the app and is usually empty |
| **User identity** (recommended) | **Your own** Drive files and the Wikis you can access | Requires a one-time OAuth authorization |

To switch: Settings → `Feishu Identity` = User identity, set `OAuth Redirect URL` to exactly the
same value as configured in the Feishu app console (Security Settings → Redirect URL), then click
`Open Authorization / Manage` → authorize in the browser → paste the full callback URL back into the
dialog → `Finish`. See the built-in **Help** (search "user identity") for details.

### What can be listed (Open API limits)

| Location | Supported | Notes |
| --- | --- | --- |
| Storage · cloud-space root | ✅ | "Storage (Drive)" source; leave it empty to browse the official cloud-space root |
| Wiki knowledge base | ✅ | "Feishu Wiki" source — lists all spaces the identity has joined |
| Any document / folder | ✅ | "Specific link" source: paste a `/docx/`, `/wiki/` or `/folder/` link |
| Shared space | ⚠️ link required | There is no "list shared spaces" API; paste the folder's browser link into "Specific link" or "Folder token / link" |
| "My Documents Library" | ❌ | Personal page-tree module (beta), a separate module from "My Space"; no public Open API |

### Setup

1. Create a "Custom App" on the [Feishu Open Platform](https://open.feishu.cn/app) and get the **App ID** / **App Secret**.
2. Grant the following scopes (**Permission management → API permissions**) and **publish a version** afterwards:

   **App (bot) identity**
   - `wiki:wiki:readonly`
   - `docx:document:readonly`
   - `drive:drive:readonly`
   - optional: `board:whiteboard:node:read` (export boards / mermaid diagrams as images)
   - optional: `docs:document.content:read` (legacy docs, plain text only)

   **User identity** (requires an extra OAuth authorization; the plugin requests these scopes)
   - `wiki:wiki:readonly` `docx:document:readonly` `drive:drive:readonly` (same three, but read with your own account)
   - `board:whiteboard:node:read` (boards / mermaid export)
   - `offline_access` (refresh_token for automatic renewal)
   - ⚠️ With user identity, granting a scope in the console is not enough: **new scopes require re-authorization**,
     otherwise the API returns `99991679`. To sync **legacy docs** with user identity, add
     `docs:document.content:read` manually to the "scope" field in the authorization dialog.
3. Share the target Wiki space / document with the app (add the bot as a collaborator).
4. Open the plugin **Settings** in SiYuan, fill in `Feishu App ID` / `Feishu App Secret`, and choose the domain (feishu.cn or Lark).
5. Click the plugin icon in the top bar → **Feishu Knowledge Base Sync**, or use the command / shortcut `Ctrl+Alt+F`.
6. Pick a source, space, target notebook and root path, check the folders/documents to import, then click **Start Sync**.

> 💡 Not sure how to configure? Open the plugin **Settings** and click **"Open Help / Setup Guide"** (or top bar menu → "Help") to search step-by-step setup instructions and the required Feishu scopes (with one-click copy).

> Requests are relayed through the SiYuan kernel `forwardProxy` API to bypass CORS; all requests use your own app credentials and are never sent to any third party.

## Browser Bookmarks Sync

Import bookmarks exported from Chrome / Edge / Firefox / Safari into a SiYuan **database block**; every bookmark becomes a detached row, with incremental re-sync.

### Features

- Reads the Netscape bookmark HTML that all browsers produce via "Export bookmarks"; add files by picker or drag & drop, multiple sources in one run.
- Dropped files are **auto-copied into the workspace at `/data/bookmarks/`** and reloaded next time the dialog opens — no paths to type, even on Docker.
- Writes rows into a **database block** with columns: Name (primary key, first column), Link (URL column), Tags (multi-select, **auto-classified by site content** into Tools / Netdisk / Resources / Work / E-books / Blog / Dev / Fun / Forum / AI / Music — edit `data/bookmarks/tag-rules.json` to customize; bookmark folder paths are added as extra tags, and the domain is used when nothing matches), Description.
- The target database is picked from a dropdown listing all databases (hit "Refresh" after creating one).
- **Incremental sync**: content hash per bookmark; unchanged rows are skipped, changed rows are updated in place — no duplicate rows. The same URL from multiple browsers merges into one row.
- **One-click "Tidy columns"** (runs automatically before each sync, idempotent): creates missing columns, renames the primary key to "Name" and moves it first, converts SiYuan's built-in single-select template column ("Tags" / "Single select") to multi-select in place (values kept), drops leftover empty single-select clones and the legacy "Source" column, and orders columns Name → Link → Tags → Description.
- **Description fetching**: when the export carries no note, the plugin can fetch each page's `<meta description>` through the kernel network proxy (cached per URL; failures never overwrite). JS-shell pages without any meta fall back to the **bookmark title**, so the Description column stays filled.
- Optional **remove vanished bookmarks**: rows whose bookmark no longer exists in the source get deleted (off by default; only rows created by the sync are removed).
- Parsing runs entirely in the frontend, so it works on **Docker / browser / mobile**.

### Setup

1. **Export bookmarks** to an HTML file from your browser's bookmark manager (see the built-in Help for each browser's entry point).
2. Top-bar plugin icon → **Browser Bookmarks Sync** (shortcut `Ctrl+Alt+B`):
   - drop or pick the exported HTML and check the folders to import (it auto-loads next time);
   - choose the target database from the dropdown (create one first via `/database` in any document if needed);
   - review the field mapping — an incomplete column structure is tidied automatically when you start syncing (or hit "**Tidy columns**" manually: primary key renamed and moved first, built-in single-select converted to multi-select, stray empty columns removed).
3. Click **Start sync**. Later, re-export and drop the file once — incremental update only touches changed rows. Tick "Fetch page description" to auto-fill the Description column from each page's meta description.

> 💡 Why can't the plugin read browser data directly? Plugins run inside the browser sandbox without filesystem access, so Chrome's `Bookmarks` JSON and Firefox's `places.sqlite` are unreachable — "Export bookmarks to HTML" is the only channel every browser provides. The plugin keeps an automatic copy of each dropped file in the workspace (visible in your Docker volume under `data/bookmarks/`), so no path configuration is ever needed.

> One-way import (browser → SiYuan) only; exporting a SiYuan database back to a bookmarks HTML and scheduled auto-sync are planned for later versions.
