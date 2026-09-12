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
