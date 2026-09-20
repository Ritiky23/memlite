import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { MemoryDatabase } from './database';
import { stageContextToChat, getCurrentWorkspaceProject } from './extension';

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
                case 'addRecord':
                    this._db.addRecord(
                        message.question,
                        message.answer || '',
                        message.project || 'General',
                        message.fileRef,
                        message.tags || [],
                        message.conversationId || `manual_${Date.now()}`,
                        1
                    );
                    this.refresh();
                    vscode.window.showInformationMessage(`🧠 MemLite: Memory added successfully!`);
                    break;
                case 'exportContextFile':
                    await vscode.commands.executeCommand('memlite.exportContextFile', message.items);
                    break;
                case 'createRelation':
                    this._db.addRelationship(message.source, message.target, message.relationType || 'SIMILAR');
                    this.refresh();
                    vscode.window.showInformationMessage(`🧠 MemLite: Linked nodes as ${message.relationType || 'SIMILAR'}`);
                    break;
                case 'deleteRelation':
                    this._db.deleteRelationship(message.source, message.target);
                    this.refresh();
                    vscode.window.showInformationMessage(`🧠 MemLite: Relation removed`);
                    break;
                case 'addInvariant':
                    this._db.addInvariant(message.content, message.ruleType, message.scope);
                    this.refresh();
                    vscode.window.showInformationMessage(`🔒 MemLite: Invariant Rule added!`);
                    break;
                case 'revokeInvariant':
                    this._db.revokeInvariant(message.ruleId, message.reason);
                    this.refresh();
                    vscode.window.showInformationMessage(`🔓 MemLite: Invariant Rule revoked!`);
                    break;
                case 'renameSession':
                    if (message.conversationId) {
                        this._db.renameSession(message.conversationId, message.newTitle, message.newProject);
                        this.refresh();
                    }
                    break;
                case 'rehydrateAgent':
                    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
                    const capsule = this._db.generateRehydrateCapsule(root);
                    const contextPath = path.join(root, '.memlite_context.md');
                    try {
                        fs.writeFileSync(contextPath, capsule, 'utf8');
                        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(contextPath));
                        await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside, false);
                        await stageContextToChat(capsule, "⚡ MemLite");
                    } catch (e) {
                        vscode.window.showErrorMessage(`MemLite: Failed to write context capsule: ${e}`);
                    }
                    break;
                case 'clearDatabase':
                    await vscode.commands.executeCommand('memlite.clearDatabase');
                    break;
                case 'pruneForeign':
                    await vscode.commands.executeCommand('memlite.pruneForeignMemories');
                    break;
            }
        });
    }


    public refresh() {
        if (this._view) {
            const data = this._db.getGraphData();
            this._view.webview.postMessage({
                type: 'updateGraph',
                data: data,
                currentProject: getCurrentWorkspaceProject()
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

        await stageContextToChat(contextBlock, "🧠 MemLite");
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
