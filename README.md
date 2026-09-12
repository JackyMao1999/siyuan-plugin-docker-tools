# Tools for SiYuan Docker

1. Export documents to PDF
2. Print documents
3. Sync Feishu (Lark) knowledge base into SiYuan (Feishu → SiYuan, one-way)

## Feishu Knowledge Base Sync

Import documents from Feishu Wiki / Feishu Drive into SiYuan as native documents. One-way sync only (Feishu → SiYuan).

### Features

- Sync from **Feishu Wiki**: browse knowledge spaces, recursively import sub-documents and keep the hierarchy.
- Sync from **Feishu Drive**: browse "My Space" or any folder.
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
| Drive · "My Space" | ✅ | Default of the "Drive" source, including subfolders |
| Wiki knowledge base | ✅ | Switch the source to "Feishu Wiki" — lists all spaces the identity has joined |
| All accessible content | ✅ | Source "Search accessible docs" — **empty keyword** lists all Wiki spaces (no search API call) |
| Keyword search | ⚠️ user identity recommended | A keyword calls Feishu's search API, which is **user-scoped**; the app identity often returns 0 results. Requires `search:docs:read` |
| Shared space / specific folder | ⚠️ Manual | There is no "list all shared spaces" API; paste the folder link or `folder_token` into "Folder token / link" |
| "My Documents Library" | ❌ | Personal page-tree module (beta), a separate module from "My Space"; no public Open API |

### Setup

1. Create a "Custom App" on the [Feishu Open Platform](https://open.feishu.cn/app) and get the **App ID** / **App Secret**.
2. Grant the following scopes:
   - `wiki:wiki:readonly`
   - `docx:document:readonly`
   - `drive:drive:readonly`
   - `docs:document:readonly` (only for legacy docs)
3. Share the target Wiki space / document with the app (add the bot as a collaborator).
4. Open the plugin **Settings** in SiYuan, fill in `Feishu App ID` / `Feishu App Secret`, and choose the domain (feishu.cn or Lark).
5. Click the plugin icon in the top bar → **Feishu Knowledge Base Sync**, or use the command / shortcut `Ctrl+Alt+F`.
6. Pick a source, space, target notebook and root path, check the folders/documents to import, then click **Start Sync**.

> 💡 Not sure how to configure? Open the plugin **Settings** and click **"Open Help / Setup Guide"** (or top bar menu → "Help") to search step-by-step setup instructions and the required Feishu scopes (with one-click copy).

> Requests are relayed through the SiYuan kernel `forwardProxy` API to bypass CORS; all requests use your own app credentials and are never sent to any third party.
