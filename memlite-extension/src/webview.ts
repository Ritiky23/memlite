import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { MemoryDatabase } from './database';

export class MemoryGraphWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'memlite-graph-view';
    private _view?: vscode.WebviewView;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _db: MemoryDatabase
    ) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

        // Set up message listeners
        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.type) {
                case 'ready':
                    this.refresh();
                    break;
                case 'deleteNode':
                    const confirm = await vscode.window.showWarningMessage(
                        "Are you sure you want to delete this memory node?",
                        "Yes, Delete",
                        "Cancel"
                    );
                    if (confirm === "Yes, Delete") {
                        this._db.deleteRecord(message.nodeId);
                        this.refresh();
                        vscode.window.showInformationMessage(`MemLite: Node deleted successfully.`);
                    }
                    break;
                case 'passContext':
                    await this.handlePassContext(message.nodeId, message.text, message.answer, message.connected);
                    break;
                case 'copyClipboard':
                    await vscode.env.clipboard.writeText(message.text);
                    vscode.window.showInformationMessage("🧠 MemLite: Copied combined context to clipboard!");
                    break;
                case 'exportContextFile':
                    await vscode.commands.executeCommand('memlite.exportContextFile', message.items);
                    break;
                case 'clearDatabase':
                    await vscode.commands.executeCommand('memlite.clearDatabase');
                    break;
            }
        });
    }

    public refresh() {
        if (this._view) {
            const data = this._db.getGraphData();
            this._view.webview.postMessage({
                type: 'updateGraph',
                data: data
            });
        }
    }

    private async handlePassContext(
        nodeId: string,
        text: string,
        answer: string,
        connected: { question: string; answer: string }[]
    ) {
        // Compile a clean context package
        let contextBlock = `--- MEMLITE CONTEXT ---\n`;
        
        if (connected && connected.length > 0) {
            contextBlock += `Related Past Conversations & Files:\n`;
            connected.forEach((c, idx) => {
                contextBlock += `[${idx + 1}] Q: "${c.question}"\n    A: "${c.answer}"\n\n`;
            });
            contextBlock += `-----------------------\n`;
        }
        
        contextBlock += `Selected Reference Q&A:\n`;
        contextBlock += `Question: "${text}"\nAnswer: "${answer}"\n`;
        contextBlock += `-----------------------`;

        // Write directly to clipboard
        await vscode.env.clipboard.writeText(contextBlock);
        
        // Show status message to notify developer
        vscode.window.showInformationMessage(
            "🧠 MemLite: Context from visual node & neighbors copied to clipboard! Paste it directly in your Copilot or Codex chat."
        );
    }

    private getHtmlForWebview(webview: vscode.Webview): string {
        const htmlPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'graph.html');
        let htmlContent = fs.readFileSync(htmlPath.fsPath, 'utf8');

        // Get resource paths
        const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'graph.css'));
        const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'graph.js'));

        // Replace placeholders
        htmlContent = htmlContent.replace('${cssUri}', cssUri.toString());
        htmlContent = htmlContent.replace('${jsUri}', jsUri.toString());

        return htmlContent;
    }
}
