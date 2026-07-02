import { Dialog, showMessage } from "siyuan";
import { lsNotebooks, sql } from "../api";
import PromiseLimitPool from "./promise-pool";

interface BatchExportContext {
    plugin: any;
    options: ExportOptions;
    fetchDocContent: (docId: string) => Promise<{ content: string; title: string; hPath: string }>;
    exportToPdf: (docId: string, options: ExportOptions) => Promise<void>;
}

interface DocNode {
    id: string;
    title: string;
    hPath: string;
    selected: boolean;
}

export async function showBatchExportDialog(ctx: BatchExportContext): Promise<void> {
    const { plugin, options, exportToPdf } = ctx;
    const i18n = plugin.i18n;

    const docs: DocNode[] = [];
    let dialog: Dialog;

    try {
        const notebooks = await lsNotebooks();
        if (!notebooks || !notebooks.notebooks) {
            showError(plugin, "No notebooks found");
            return;
        }

        for (const nb of notebooks.notebooks) {
            const rows = await sql(
                "SELECT id, hpath, content FROM blocks WHERE box = '" + nb.id + "' AND type = 'd' AND parent_id IS NULL ORDER BY hpath ASC"
            );
            if (rows) {
                for (const row of rows) {
                    const hPath = row.hpath || "";
                    const title = hPath.split("/").pop() || row.id;
                    docs.push({
                        id: row.id,
                        title: title,
                        hPath: hPath,
                        selected: false,
                    });
                }
            }
        }
    } catch (e) {
        console.error("Failed to list documents:", e);
        showError(plugin, "Failed to list documents");
        return;
    }

    if (docs.length === 0) {
        showError(plugin, "No documents found");
        return;
    }

    let selectedCount = 0;
    const updateCount = () => {
        const countEl = dialog.element.querySelector(".batch-export__count");
        if (countEl) {
            countEl.textContent = selectedCount + "/" + docs.length;
        }
    };

    const dialogContent = document.createElement("div");
    dialogContent.innerHTML = `
        <div style="padding: 16px;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
                <span style="font-size:16px;font-weight:500;">${i18n.selectDocs}</span>
                <span class="batch-export__count" style="font-size:14px;color:var(--b3-theme-on-surface-light);">0/${docs.length}</span>
            </div>
            <div style="margin-bottom:12px;display:flex;gap:8px;">
                <button class="b3-button b3-button--outline batch-select-all">${i18n.selectAll || "Select All"}</button>
                <button class="b3-button b3-button--outline batch-deselect-all">${i18n.deselectAll || "Deselect All"}</button>
            </div>
            <div class="plugin-doc-export__batch-list" style="max-height:400px;overflow-y:auto;border:1px solid var(--b3-theme-surface);border-radius:4px;">
                ${docs.map((doc, idx) => `
                    <div class="plugin-doc-export__batch-item" data-index="${idx}">
                        <input type="checkbox" class="batch-checkbox" data-index="${idx}">
                        <span class="doc-title">${doc.hPath || doc.title}</span>
                    </div>
                `).join("")}
            </div>
            <div class="plugin-doc-export__progress" style="display:none;">
                <div class="plugin-doc-export__progress-bar">
                    <div class="plugin-doc-export__progress-fill" style="width:0%"></div>
                </div>
                <div class="plugin-doc-export__progress-text" style="margin-top:4px;font-size:12px;color:var(--b3-theme-on-surface-light);"></div>
            </div>
            <div style="display:flex;gap:8px;margin-top:12px;justify-content:flex-end;">
                <button class="b3-button b3-button--outline batch-cancel">${i18n.cancel || "Cancel"}</button>
                <button class="b3-button b3-button--text batch-export-btn" disabled>${i18n.batchExport}</button>
            </div>
        </div>
    `;

    dialog = new Dialog({
        title: i18n.batchExportTitle || "Batch Export PDF",
        content: dialogContent,
        width: "560px",
    });

    const element = dialog.element;

    element.querySelectorAll(".batch-checkbox").forEach((cb) => {
        cb.addEventListener("change", (e) => {
            const target = e.target as HTMLInputElement;
            const idx = parseInt(target.dataset.index || "0");
            docs[idx].selected = target.checked;
            const item = target.closest(".plugin-doc-export__batch-item") as HTMLElement;
            if (item) {
                item.style.background = target.checked ? "var(--b3-theme-primary-lightest, rgba(66,133,244,0.08))" : "";
            }
            selectedCount = docs.filter(d => d.selected).length;
            updateCount();
            const btn = element.querySelector(".batch-export-btn") as HTMLButtonElement;
            btn.disabled = selectedCount === 0;
        });
    });

    element.querySelector(".batch-select-all")?.addEventListener("click", () => {
        docs.forEach((doc, idx) => {
            doc.selected = true;
            const cb = element.querySelector(`.batch-checkbox[data-index="${idx}"]`) as HTMLInputElement;
            if (cb) cb.checked = true;
            const item = cb?.closest(".plugin-doc-export__batch-item") as HTMLElement;
            if (item) item.style.background = "var(--b3-theme-primary-lightest, rgba(66,133,244,0.08))";
        });
        selectedCount = docs.length;
        updateCount();
        const btn = element.querySelector(".batch-export-btn") as HTMLButtonElement;
        btn.disabled = false;
    });

    element.querySelector(".batch-deselect-all")?.addEventListener("click", () => {
        docs.forEach((doc, idx) => {
            doc.selected = false;
            const cb = element.querySelector(`.batch-checkbox[data-index="${idx}"]`) as HTMLInputElement;
            if (cb) cb.checked = false;
            const item = cb?.closest(".plugin-doc-export__batch-item") as HTMLElement;
            if (item) item.style.background = "";
        });
        selectedCount = 0;
        updateCount();
        const btn = element.querySelector(".batch-export-btn") as HTMLButtonElement;
        btn.disabled = true;
    });

    element.querySelector(".batch-cancel")?.addEventListener("click", () => {
        dialog.destroy();
    });

    element.querySelector(".batch-export-btn")?.addEventListener("click", async () => {
        const selectedDocs = docs.filter(d => d.selected);
        if (selectedDocs.length === 0) return;

        const exportBtn = element.querySelector(".batch-export-btn") as HTMLButtonElement;
        const cancelBtn = element.querySelector(".batch-cancel") as HTMLButtonElement;
        const progressEl = element.querySelector(".plugin-doc-export__progress") as HTMLElement;
        const progressFill = element.querySelector(".plugin-doc-export__progress-fill") as HTMLElement;
        const progressText = element.querySelector(".plugin-doc-export__progress-text") as HTMLElement;

        exportBtn.disabled = true;
        cancelBtn.disabled = true;
        progressEl.style.display = "block";

        let completed = 0;
        const total = selectedDocs.length;
        const errors: string[] = [];

        const updateProgress = () => {
            const pct = Math.round((completed / total) * 100);
            progressFill.style.width = pct + "%";
            progressText.textContent = i18n.exportProgress.replace("{current}", String(completed)).replace("{total}", String(total));
        };

        updateProgress();

        const pool = new PromiseLimitPool(3);

        for (const doc of selectedDocs) {
            pool.add(async () => {
                try {
                    await exportToPdf(doc.id, options);
                    completed++;
                    updateProgress();
                } catch (e) {
                    console.error("Failed to export:", doc.title, e);
                    errors.push(doc.title);
                    completed++;
                    updateProgress();
                }
            });
        }

        await pool.awaitAll();

        progressText.textContent = errors.length > 0
            ? i18n.exportFailed.replace("{count}", String(errors.length)) + ": " + errors.join(", ")
            : i18n.exportSuccess.replace("{count}", String(total));

        setTimeout(() => {
            dialog.destroy();
        }, 3000);
    });
}

function showError(plugin: any, msg: string) {
    console.error(msg);
    showMessage(msg, 5000);
}
