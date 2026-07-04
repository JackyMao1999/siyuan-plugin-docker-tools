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
    const endpoint = '/api/file/getFile'
    let response = await fetch(endpoint, {
        method: 'POST',
        body: JSON.stringify({ path: path })
    });
    if (!response.ok) {
        return null;
    }
    let data = await response.blob();
    return data;
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
