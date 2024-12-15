import * as vscode from 'vscode';
import { FileExplorerProvider, JupyterContentProvider } from './FileExplorer';
const fs = require('fs');

export async function activate(context: vscode.ExtensionContext) {
    const fileExplorerProvider = new FileExplorerProvider();
    const jupyterContentProvider = new JupyterContentProvider(fileExplorerProvider);
    const treeView = vscode.window.createTreeView('jupyterFileExplorer', { treeDataProvider: fileExplorerProvider });
    const refreshCommand = vscode.commands.registerCommand('jupyterFileExplorer.refresh', () => {
        fileExplorerProvider.refresh();
    });


    
    context.subscriptions.push(refreshCommand);

    treeView.onDidChangeVisibility(e => {
        if (e.visible) {
            fileExplorerProvider.refresh();
        }
    });

    let connectDisposable = vscode.commands.registerCommand('extension.connectJupyter', async () => {
        await connectToJupyter(fileExplorerProvider, jupyterContentProvider);
    });

    let openFileDisposable = vscode.commands.registerCommand('jupyterFileExplorer.openFile', (filePath: string) => {
        fileExplorerProvider.openFile(filePath);
    });

    // Register the FileSystemProvider
    context.subscriptions.push(vscode.workspace.registerFileSystemProvider('jupyter-remote', fileExplorerProvider, { 
        isCaseSensitive: true
    }));

    const sendToCommand = vscode.commands.registerCommand('extension.sendToJupyter', (uri: vscode.Uri) => {
        // 여기서 선택한 파일을 처리하는 로직을 작성
        vscode.window.showInformationMessage(`Sending file: ${uri.fsPath}`);
        
        // 예를 들어, 파일을 다른 시스템으로 전송하거나, 특정 작업을 수행할 수 있습니다.
        //const content = new Uint8Array(); // Provide appropriate content
        let content: Uint8Array;
        try {
            content = fs.readFileSync(uri.fsPath);
        } catch (error) {
            if (error instanceof Error) {
                vscode.window.showErrorMessage(`Failed to read file: ${error.message}`);
            } else {
                vscode.window.showErrorMessage('Failed to read file: Unknown error');
            }
            return;
        }
        const options = { create: true, overwrite: true }; // Set options as needed
        fileExplorerProvider.writeFile(uri, content, options);
    });


    context.subscriptions.push(connectDisposable, openFileDisposable);
    context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('jupyter-remote', jupyterContentProvider));
    context.subscriptions.push(sendToCommand);

    // Automatically attempt to connect to Jupyter on activation
    await connectToJupyter(fileExplorerProvider, jupyterContentProvider);
}

async function connectToJupyter(fileExplorerProvider: FileExplorerProvider, jupyterContentProvider: JupyterContentProvider) {
    const config = vscode.workspace.getConfiguration('jupyterFileExplorer');
    const defaultUrl = config.get<string>('defaultServerUrl') || '';
    const defaultToken = config.get<string>('defaultToken') || '';
    const defaultRemotePath = config.get<string>('defaultRemotePath') || './';

    let url = defaultUrl;
    let token = defaultToken;
    let remotePath = defaultRemotePath;

    if (!defaultUrl) {
        url = await vscode.window.showInputBox({ 
            prompt: 'Enter Jupyter Server URL',
            value: defaultUrl,
            placeHolder: 'https://example.com/jupyter'
        }) || '';
    }

    if (!defaultToken) {
        token = await vscode.window.showInputBox({ 
            prompt: 'Enter Jupyter Token', 
            ignoreFocusOut: true, 
            password: true, 
            value: defaultToken
        }) || '';
    }

    if (!defaultRemotePath) {
        remotePath = await vscode.window.showInputBox({ 
            prompt: 'Enter Remote Path (leave empty for root)', 
            value: defaultRemotePath
        }) || './';
    }

    if (url && token) {
        await fileExplorerProvider.setConnection(url, token, remotePath || '/');
        const axiosInstance = fileExplorerProvider.getAxiosInstance();
        if (axiosInstance) {
            jupyterContentProvider.setAxiosInstance(axiosInstance);
            vscode.window.showInformationMessage('Connected to Jupyter Server.');
        } else {
            vscode.window.showErrorMessage('Failed to create Axios instance.');
        }
    } else {
        vscode.window.showErrorMessage('Jupyter Server URL and Token are required.');
    }
}

export function deactivate() {}
