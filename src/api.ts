import { fetchPost, fetchSyncPost, IWebSocketData } from "siyuan";

export async function request(url: string, data: any) {
    let response: IWebSocketData = await fetchSyncPost(url, data);
    let res = response.code === 0 ? response.data : null;
    return res;
}

// **************************************** Notebook ****************************************

export async function lsNotebooks(): Promise<IReslsNotebooks> {
    let url = '/api/notebook/lsNotebooks';
    return request(url, '');
}

export async function openNotebook(notebook: NotebookId) {
    let url = '/api/notebook/openNotebook';
    return request(url, { notebook: notebook });
}

export async function closeNotebook(notebook: NotebookId) {
    let url = '/api/notebook/closeNotebook';
    return request(url, { notebook: notebook });
}

export async function renameNotebook(notebook: NotebookId, name: string) {
    let url = '/api/notebook/renameNotebook';
    return request(url, { notebook: notebook, name: name });
}

export async function createNotebook(name: string): Promise<Notebook> {
    let url = '/api/notebook/createNotebook';
    return request(url, { name: name });
}

export async function removeNotebook(notebook: NotebookId) {
    let url = '/api/notebook/removeNotebook';
    return request(url, { notebook: notebook });
}

export async function getNotebookConf(notebook: NotebookId): Promise<IResGetNotebookConf> {
    let data = { notebook: notebook };
    let url = '/api/notebook/getNotebookConf';
    return request(url, data);
}

// **************************************** File Tree ****************************************

export async function createDocWithMd(notebook: NotebookId, path: string, markdown: string): Promise<DocumentId> {
    let data = {
        notebook: notebook,
        path: path,
        markdown: markdown,
    };
    let url = '/api/filetree/createDocWithMd';
    return request(url, data);
}

export async function renameDoc(notebook: NotebookId, path: string, title: string): Promise<DocumentId> {
    let data = {
        doc: notebook,
        path: path,
        title: title
    };
    let url = '/api/filetree/renameDoc';
    return request(url, data);
}

export async function removeDoc(notebook: NotebookId, path: string) {
    let data = {
        notebook: notebook,
        path: path,
    };
    let url = '/api/filetree/removeDoc';
    return request(url, data);
}

export async function moveDocs(fromPaths: string[], toNotebook: NotebookId, toPath: string) {
    let data = {
        fromPaths: fromPaths,
        toNotebook: toNotebook,
        toPath: toPath
    };
    let url = '/api/filetree/moveDocs';
    return request(url, data);
}

export async function getHPathByPath(notebook: NotebookId, path: string): Promise<string> {
    let data = {
        notebook: notebook,
        path: path
    };
    let url = '/api/filetree/getHPathByPath';
    return request(url, data);
}

export async function getHPathByID(id: BlockId): Promise<string> {
    let data = {
        id: id
    };
    let url = '/api/filetree/getHPathByID';
    return request(url, data);
}

// **************************************** Block ****************************************

export async function insertBlock(
    dataType: "markdown" | "dom", data: string,
    nextID?: BlockId, previousID?: BlockId, parentID?: BlockId
): Promise<IResdoOperations[]> {
    let payload = {
        dataType: dataType,
        data: data,
        nextID: nextID,
        previousID: previousID,
        parentID: parentID
    }
    let url = '/api/block/insertBlock';
    return request(url, payload);
}

export async function prependBlock(dataType: "markdown" | "dom", data: string, parentID: BlockId | DocumentId): Promise<IResdoOperations[]> {
    let payload = {
        dataType: dataType,
        data: data,
        parentID: parentID
    }
    let url = '/api/block/prependBlock';
    return request(url, payload);
}

export async function appendBlock(dataType: "markdown" | "dom", data: string, parentID: BlockId | DocumentId): Promise<IResdoOperations[]> {
    let payload = {
        dataType: dataType,
        data: data,
        parentID: parentID
    }
    let url = '/api/block/appendBlock';
    return request(url, payload);
}

export async function updateBlock(dataType: "markdown" | "dom", data: string, id: BlockId): Promise<IResdoOperations[]> {
    let payload = {
        dataType: dataType,
        data: data,
        id: id
    }
    let url = '/api/block/updateBlock';
    return request(url, payload);
}

export async function deleteBlock(id: BlockId): Promise<IResdoOperations[]> {
    let data = { id: id }
    let url = '/api/block/deleteBlock';
    return request(url, data);
}

export async function moveBlock(id: BlockId, previousID?: PreviousID, parentID?: ParentID): Promise<IResdoOperations[]> {
    let data = {
        id: id,
        previousID: previousID,
        parentID: parentID
    }
    let url = '/api/block/moveBlock';
    return request(url, data);
}

export async function getBlockKramdown(id: BlockId): Promise<IResGetBlockKramdown> {
    let data = { id: id }
    let url = '/api/block/getBlockKramdown';
    return request(url, data);
}

export async function getChildBlocks(id: BlockId): Promise<IResGetChildBlock[]> {
    let data = { id: id }
    let url = '/api/block/getChildBlocks';
    return request(url, data);
}

// **************************************** Attributes ****************************************

export async function setBlockAttrs(id: BlockId, attrs: { [key: string]: string }) {
    let data = { id: id, attrs: attrs }
    let url = '/api/attr/setBlockAttrs';
    return request(url, data);
}

export async function getBlockAttrs(id: BlockId): Promise<{ [key: string]: string }> {
    let data = { id: id }
    let url = '/api/attr/getBlockAttrs';
    return request(url, data);
}

// **************************************** SQL ****************************************

export async function sql(sql: string): Promise<any[]> {
    let sqldata = { stmt: sql };
    let url = '/api/query/sql';
    return request(url, sqldata);
}

export async function getBlockByID(blockId: string): Promise<Block> {
    let sqlScript = `select * from blocks where id ='${blockId}'`;
    let data = await sql(sqlScript);
    return data[0];
}

// **************************************** Export ****************************************

export async function exportMdContent(id: DocumentId): Promise<IResExportMdContent> {
    let data = { id: id }
    let url = '/api/export/exportMdContent';
    return request(url, data);
}

export async function exportResources(paths: string[], name: string): Promise<IResExportResources> {
    let data = { paths: paths, name: name }
    let url = '/api/export/exportResources';
    return request(url, data);
}

// **************************************** File ****************************************

export async function getFile(path: string): Promise<any> {
    let data = { path: path }
    let url = '/api/file/getFile';
    return new Promise((resolve, _) => {
        fetchPost(url, data, (content: any) => {
            resolve(content)
        });
    });
}

export const getFileBlob = async (path: string): Promise<Blob | null> => {
    const response = await fetch('/api/file/getFile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: path })
    });
    if (!response.ok) return null;
    return await response.blob();
}

/**
 * 上传一个文件到思源的 assets 目录
 *
 * ⚠️ multipart 字段名必须是 `file[]`：内核 `kernel/model/upload.go` 读取的是
 * `form.File["file[]"]`。字段名写错时内核收不到文件，却仍返回 code=0 + 空 succMap
 * （空操作成功），调用方就会静默拿到 null，表现为图片/附件/画板全部「未能同步」。
 *
 * @param file 文件对象
 * @returns 上传成功后的资源相对路径（形如 assets/xxx.png）
 * @throws 失败时抛出带原因的 Error（调用方据此写入同步日志，不再静默失败）
 */
export async function uploadAsset(file: File): Promise<string> {
    const formData = new FormData();
    formData.append("assetsDirPath", "/assets/");
    formData.append("file[]", file, file.name);

    const headers: Record<string, string> = {};
    const token = (window as any)?.siyuan?.config?.api?.token;
    if (token) {
        headers["Authorization"] = `Token ${token}`;
    }

    let res: any;
    try {
        const response = await fetch("/api/asset/upload", {
            method: "POST",
            headers,
            body: formData,
        });
        res = await response.json();
    } catch (e) {
        throw new Error(`思源资源接口请求失败：${e instanceof Error ? e.message : String(e)}`);
    }
    if (res.code !== 0) {
        throw new Error(`思源拒绝写入资源：${res.msg || "未知错误"}`);
    }
    const succMap: IResUpload["succMap"] = res.data?.succMap || {};
    const errFiles: string[] = res.data?.errFiles || [];
    const keys = Object.keys(succMap);
    if (!keys.length) {
        // 内核「没收到文件」也会返回 code=0，必须显式报错，避免素材静默丢失
        throw new Error(`内核未接收文件（multipart 字段名需为 file[]）${errFiles.length ? "：" + errFiles.join("、") : ""}`);
    }
    if (errFiles.length) {
        console.warn("部分资源上传失败:", errFiles);
    }
    return succMap[keys[0]];
}

// **************************************** Notification ****************************************

export async function pushMsg(msg: string, timeout: number = 7000) {
    let payload = { msg: msg, timeout: timeout };
    let url = "/api/notification/pushMsg";
    return request(url, payload);
}

export async function pushErrMsg(msg: string, timeout: number = 7000) {
    let payload = { msg: msg, timeout: timeout };
    let url = "/api/notification/pushErrMsg";
    return request(url, payload);
}
