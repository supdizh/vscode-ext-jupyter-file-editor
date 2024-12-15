import * as vscode from 'vscode';
import axios, { AxiosInstance } from 'axios';
import path = require('path');
const fs = require('fs');

export class FileExplorerProvider implements vscode.TreeDataProvider<FileItem>, vscode.FileSystemProvider {
    private _onDidChangeTreeData: vscode.EventEmitter<FileItem | undefined | null> = new vscode.EventEmitter<FileItem | undefined | null>();
    readonly onDidChangeTreeData: vscode.Event<FileItem | undefined | null> = this._onDidChangeTreeData.event;

    private jupyterServerUrl: string = '';
    private jupyterToken: string = '';
    private remotePath: string = '/';
    private currentPath: string ='';
    private axiosInstance: AxiosInstance | null = null;

    private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._emitter.event;
    

    constructor() {
        
    }

    async setConnection(url: string, token: string, remotePath: string) {
        this.jupyterServerUrl = url;
        this.jupyterToken = token;
        this.remotePath = remotePath;
        this.setupAxiosInstance();
        this.refresh();
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: FileItem): vscode.TreeItem {
        return element;
    }

    public setupAxiosInstance() {
        this.axiosInstance = axios.create({
            baseURL: this.jupyterServerUrl,
            headers: {
                'Authorization': `token ${this.jupyterToken}`
            }
        });
    }

    async getChildren(element?: FileItem): Promise<FileItem[]> {

        if (!this.axiosInstance) {
            vscode.window.showErrorMessage('Not connected to Jupyter Server.');
            return [];
        }

        const currentPath = element ? element.uri : this.remotePath;
        this.currentPath = currentPath;
        const apiUrl = `api/contents/${currentPath}`;

        try {
            const response = await this.axiosInstance.get(apiUrl);
            return response.data.content.map((item: any) => new FileItem(item.name, item.type === 'directory', item.path));
        } catch (error) {
            let errorMessage = `Failed to fetch file list from Jupyter Server. API URL: ${apiUrl}`;
            if (axios.isAxiosError(error)) {
                errorMessage += ` Error: ${error.message}`;
                if (error.response) {
                    errorMessage += ` Status: ${error.response.status}`;
                    errorMessage += ` Data: ${JSON.stringify(error.response.data)}`;
                }
            } else {
                errorMessage += ` ${error}`;
            }
            console.error(errorMessage);
            vscode.window.showErrorMessage(errorMessage);
            return [];
        }
    }

    async openFile(filePath: string) {
        if (!this.axiosInstance) {
            vscode.window.showErrorMessage('Not connected to Jupyter Server.');
            return;
        }

        try {
            const fileName = filePath.split('/').pop() || 'untitled';
            const content = await this.fetchFileContent(filePath);

            vscode.window.showInformationMessage( content );

            const workspaceFolder = vscode.workspace.workspaceFolders?.[0].uri.fsPath;

            if (!workspaceFolder) {
                vscode.window.showErrorMessage('Workspace folder is undefined. Please set your workspace');
                return;
            }

            const localFilePath = `${workspaceFolder}${path.sep}${fileName}`;

            //const dirPath = path.dirname(localFilePath);
            //if (!fs.existsSync(dirPath)) {
            //   fs.mkdirSync(dirPath, { recursive: true });
            //}

            if (fs.existsSync(localFilePath)) {
                const overwrite = await vscode.window.showWarningMessage(
                    `File ${localFilePath} already exists. Do you want to overwrite it?`,
                    { modal: true },
                    'Yes', 'No'
                );

                if (overwrite !== 'Yes') {
                    vscode.window.showInformationMessage('File open operation cancelled.');
                    return;
                }
            }

            const contentToWrite = typeof content === 'object' ? JSON.stringify(content, null, 2) : content;

            fs.writeFileSync(localFilePath, contentToWrite);

            // Open the document with the custom URI
            const document = await vscode.workspace.openTextDocument(localFilePath);
            vscode.Uri.parse(`vscode-notebook-cell:${localFilePath}`);
            
            await vscode.window.showTextDocument(document);

            // Set the file name and language
            await vscode.languages.setTextDocumentLanguage(document, this.getLanguageId(fileName));

        } catch (error) {
            let errorMessage = 'Failed to open file.';
            if (error instanceof Error) {
                errorMessage += ` Error: ${error.message}`;
            }
            vscode.window.showErrorMessage(errorMessage);
        }
    }

    private async fetchFileContent(filePath: string): Promise<string> {
        if (!this.axiosInstance) {
            throw new Error('Not connected to Jupyter Server.');
        }

        const apiUrl = `api/contents/${filePath}`;
        try {
            const response = await this.axiosInstance.get(apiUrl);
            return response.data['content'];
            
        } catch (error) {
            console.error('Failed to fetch file content:', error);
            throw new Error('Failed to fetch file content from Jupyter Server.');
        }
    }

    private getLanguageId(fileName: string): string {
        const extension = fileName.split('.').pop()?.toLowerCase();
        switch (extension) {
            case 'py':
                return 'python';
            case 'js':
                return 'javascript';
            case 'ts':
                return 'typescript';
            // Add more mappings as needed
            default:
                return 'plaintext';
        }
    }

    public async saveFileToJupyter(filePath: string, content: string) {
        if (!this.axiosInstance) {
            vscode.window.showErrorMessage('Not connected to Jupyter Server.');
            return;
        }

        try {
            let normalizedFilePath: string;
            if (this.currentPath) {
                normalizedFilePath = `${this.currentPath}/${path.basename(filePath).replace(/\\/g, '/')}`;
            } else {
                normalizedFilePath = `${this.remotePath}/${path.basename(filePath).replace(/\\/g, '/')}`;
            }
            
            const apiUrl = `${this.jupyterServerUrl}/api/contents/${normalizedFilePath}?token=${this.jupyterToken}`;

            try {
                // Check if the file already exists
                await this.axiosInstance.get(apiUrl);
                // If the file exists, ask the user if they want to overwrite it
                const overwrite = await vscode.window.showWarningMessage(
                    `File ${normalizedFilePath} already exists on the Jupyter Server. Do you want to overwrite it?`,
                    { modal: true },
                    'Yes', 'No'
                );

                if (overwrite !== 'Yes') {
                    vscode.window.showInformationMessage('File save operation cancelled.');
                    return;
                }
            } catch (error) {
                if (axios.isAxiosError(error) && error.response?.status !== 404) {
                    throw error;
                }
                // If the error is 404, it means the file does not exist, so we can proceed
            }

            vscode.window.showInformationMessage(`File saved to Jupyter Server. Path: ${filePath}, API URL: ${apiUrl}, Content: ${content}`);
            await this.axiosInstance.put(apiUrl, {
                content,
                type: 'file',
                format: 'text'
            });

            this.refresh();
            
        } catch (error) {
            let errorMessage = 'Failed to save file to Jupyter Server.';
            if (axios.isAxiosError(error)) {
                errorMessage += ` Error: ${error.message}`;
                if (error.response) {
                    errorMessage += ` Status: ${error.response.status}`;
                    errorMessage += ` Data: ${JSON.stringify(error.response.data)}`;
                }
            } else {
                errorMessage += ` ${error}`;
            }
            vscode.window.showErrorMessage(errorMessage);
        }
    }

    public getAxiosInstance(): AxiosInstance | null {
        return this.axiosInstance;
    }

    watch(uri: vscode.Uri, options: { recursive: boolean; excludes: string[]; }): vscode.Disposable {
        return new vscode.Disposable(() => {});
    }

    stat(uri: vscode.Uri): vscode.FileStat {
        return {
            type: vscode.FileType.File,
            ctime: Date.now(),
            mtime: Date.now(),
            size: 0
        };
    }

    readDirectory(uri: vscode.Uri): [string, vscode.FileType][] | Thenable<[string, vscode.FileType][]> {
        throw vscode.FileSystemError.NoPermissions();
    }

    createDirectory(uri: vscode.Uri): void | Thenable<void> {
        throw vscode.FileSystemError.NoPermissions();
    }

    async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        const content = await this.fetchFileContent(uri.path.slice(1));
        return Buffer.from(content);
    }

    async writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean; overwrite: boolean; }): Promise<void> {
        await this.saveFileToJupyter(uri.path.slice(1), content.toString());
        this._emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
    }

    delete(uri: vscode.Uri, options: { recursive: boolean; }): void | Thenable<void> {
        throw vscode.FileSystemError.NoPermissions();
    }

    rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean; }): void | Thenable<void> {
        throw vscode.FileSystemError.NoPermissions();
    }
}

class FileItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsible: boolean,
        public readonly uri: string
    ) {
        super(label, collapsible ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
        this.tooltip = this.label;
        this.description = this.uri;

        if (!collapsible) {
            this.command = {
                command: 'jupyterFileExplorer.openFile',
                title: 'Open File',
                arguments: [this.uri]
            };
        }
    }
}

export class JupyterContentProvider implements vscode.TextDocumentContentProvider {
    private axiosInstance: AxiosInstance | null = null;

    constructor(private fileExplorerProvider: FileExplorerProvider) {}

    setAxiosInstance(axiosInstance: AxiosInstance) {
        this.axiosInstance = axiosInstance;
    }

    async provideTextDocumentContent(uri: vscode.Uri, token: vscode.CancellationToken): Promise<string> {
        if (!this.axiosInstance) {
            throw new Error('Not connected to Jupyter Server.');
        }

        const filePath = uri.path;
        const apiUrl = `api/contents${filePath}`;

        try {
            const response = await this.axiosInstance.get(apiUrl);
            return response.data.content;
        } catch (error) {
            console.error('Failed to fetch file content:', error);
            throw new Error('Failed to fetch file content from Jupyter Server.');
        }
    }
}
