# Tools for SiYuan Docker

**English** | [简体中文](./README_zh_CN.md)

1. Export documents to PDF
2. Print documents
3. Sync Feishu (Lark) knowledge base into SiYuan (Feishu → SiYuan, one-way)

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
