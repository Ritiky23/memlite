import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { MemoryDatabase } from './database';
import { TranscriptWatcher } from './watcher';
import { MemoryGraphWebviewProvider } from './webview';

let watcher: TranscriptWatcher | null = null;
let activePanel: vscode.WebviewPanel | undefined = undefined;

export function activate(context: vscode.ExtensionContext) {
    console.log('MemLite: Extension is now active!');

    // Unified master storage in ~/.memlite so ALL windows, workspaces & IDEs share one central database
    const homeDir = os.homedir() || process.env.USERPROFILE || process.env.HOME || '';
    const masterDbPath = path.join(homeDir, '.memlite');
    if (!fs.existsSync(masterDbPath)) {
        try { fs.mkdirSync(masterDbPath, { recursive: true }); } catch (e) {}
    }
    const db = new MemoryDatabase(masterDbPath);

    // Auto-migrate from any previous workspace-isolated or globalStorage databases
    try {
        if (context.globalStorageUri && fs.existsSync(context.globalStorageUri.fsPath)) {
            const legacyGlobal = path.join(context.globalStorageUri.fsPath, 'memlite_db.json');
            if (fs.existsSync(legacyGlobal)) {
                db.mergeFrom(legacyGlobal);
            }
        }
        if (context.storageUri && fs.existsSync(context.storageUri.fsPath)) {
            const localDbPath = path.join(context.storageUri.fsPath, 'memlite_db.json');
            if (fs.existsSync(localDbPath)) {
                db.mergeFrom(localDbPath);
            }
        }

        const appDataRoot = path.dirname(context.globalStorageUri.fsPath);
        const wsStorageRoot = path.join(appDataRoot, '..', 'workspaceStorage');
        if (fs.existsSync(wsStorageRoot)) {
            const wsFolders = fs.readdirSync(wsStorageRoot);
            for (const folder of wsFolders) {
                const possible = path.join(wsStorageRoot, folder, 'memlite.memlite-extension', 'memlite_db.json');
                if (fs.existsSync(possible)) {
                    db.mergeFrom(possible);
                }
            }
        }
    } catch (e) {
        console.error("MemLite: Error during storage migration:", e);
    }

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    // Initialize and start log watcher
    watcher = new TranscriptWatcher(db, workspaceRoot);
    watcher.start();

    // Register sidebar Webview View
    const provider = new MemoryGraphWebviewProvider(context.extensionUri, db);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            MemoryGraphWebviewProvider.viewType,
            provider
        )
    );

    // Command to refresh the visualizer graph
    context.subscriptions.push(
        vscode.commands.registerCommand('memlite.refreshGraphView', () => {
            provider.refresh();
            if (activePanel) {
                activePanel.webview.postMessage({
                    type: 'updateGraph',
                    data: db.getGraphData()
                });
            }
        })
    );

    // Command to open the visual graph inside a large editor tab (Wow experience)
    context.subscriptions.push(
        vscode.commands.registerCommand('memlite.showGraph', () => {
            const panel = vscode.window.createWebviewPanel(
                'memliteLargeGraph',
                '🧠 MemLite Neural Map',
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    localResourceRoots: [context.extensionUri]
                }
            );

            activePanel = panel;
            panel.onDidDispose(() => {
                if (activePanel === panel) {
                    activePanel = undefined;
                }
            });

            // Re-use same HTML provider logic
            const htmlPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'graph.html');
            let htmlContent = fs.readFileSync(htmlPath.fsPath, 'utf8');
            const cssUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'graph.css'));
            const jsUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'graph.js'));
            htmlContent = htmlContent.replace('${cssUri}', cssUri.toString());
            htmlContent = htmlContent.replace('${jsUri}', jsUri.toString());
            
            panel.webview.html = htmlContent;

            // Handle communication in the large webview tab
            panel.webview.onDidReceiveMessage(async (message) => {
                switch (message.type) {
                    case 'ready':
                        panel.webview.postMessage({
                            type: 'updateGraph',
                            data: db.getGraphData()
                        });
                        break;
                    case 'deleteNode':
                        const confirm = await vscode.window.showWarningMessage(
                            "Are you sure you want to delete this memory node?",
                            "Yes, Delete",
                            "Cancel"
                        );
                        if (confirm === "Yes, Delete") {
                            db.deleteRecord(message.nodeId);
                            panel.webview.postMessage({
                                type: 'updateGraph',
                                data: db.getGraphData()
                            });
                            provider.refresh();
                            vscode.window.showInformationMessage(`MemLite: Node deleted.`);
                        }
                        break;
                    case 'passContext':
                        const promptContext = compileContextBlock(message.text, message.answer, message.connected);
                        await stageContextToChat(promptContext, "🧠 MemLite");
                        break;
                    case 'copyClipboard':
                        await vscode.env.clipboard.writeText(message.text);
                        vscode.window.showInformationMessage("🧠 MemLite: Copied combined context to clipboard!");
                        break;
                    case 'exportContextFile':
                        await vscode.commands.executeCommand('memlite.exportContextFile', message.items);
                        break;
                    case 'addInvariant':
                        db.addInvariant(message.content, message.ruleType, message.scope);
                        provider.refresh();
                        panel.webview.postMessage({ type: 'updateGraph', data: db.getGraphData() });
                        vscode.window.showInformationMessage(`🔒 MemLite: Invariant Rule added!`);
                        break;
                    case 'revokeInvariant':
                        db.revokeInvariant(message.ruleId, message.reason);
                        provider.refresh();
                        panel.webview.postMessage({ type: 'updateGraph', data: db.getGraphData() });
                        vscode.window.showInformationMessage(`🔓 MemLite: Invariant Rule revoked!`);
                        break;
                    case 'rehydrateAgent':
                        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
                        const capsule = db.generateRehydrateCapsule(root);
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
        })
    );

    // Command: Export Memory Database
    context.subscriptions.push(
        vscode.commands.registerCommand('memlite.exportDatabase', async () => {
            const fileUri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(path.join(process.cwd(), 'memlite-backup.json')),
                filters: { 'JSON Files': ['json'] },
                title: 'Export MemLite Memory File'
            });

            if (fileUri) {
                const success = db.exportDB(fileUri.fsPath);
                if (success) {
                    vscode.window.showInformationMessage(`MemLite: Memory exported to ${path.basename(fileUri.fsPath)}`);
                } else {
                    vscode.window.showErrorMessage('MemLite: Database export failed.');
                }
            }
        })
    );

    // Command: Import Memory Database
    context.subscriptions.push(
        vscode.commands.registerCommand('memlite.importDatabase', async () => {
            const fileUri = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                filters: { 'JSON Files': ['json'] },
                title: 'Import MemLite Memory File'
            });

            if (fileUri && fileUri.length > 0) {
                const success = db.importDB(fileUri[0].fsPath);
                if (success) {
                    provider.refresh();
                    vscode.window.showInformationMessage('MemLite: Memory database restored successfully!');
                } else {
                    vscode.window.showErrorMessage('MemLite: Import failed. Please verify memory schema JSON.');
                }
            }
        })
    );

    // Command: Clear Database
    context.subscriptions.push(
        vscode.commands.registerCommand('memlite.clearDatabase', async () => {
            const choice = await vscode.window.showWarningMessage(
                'CAUTION: Are you sure you want to permanently clear all MemLite memories?',
                'Yes, delete everything',
                'Cancel'
            );

            if (choice === 'Yes, delete everything') {
                db.clearDB();
                provider.refresh();
                if (activePanel) {
                    activePanel.webview.postMessage({ type: 'updateGraph', data: db.getGraphData() });
                }
                vscode.window.showInformationMessage('MemLite: All memories cleared.');
            }
        })
    );

    // Command: Prune Foreign & Stale Project Memories
    context.subscriptions.push(
        vscode.commands.registerCommand('memlite.pruneForeignMemories', () => {
            const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!root) {
                vscode.window.showWarningMessage('MemLite: No active workspace folder found.');
                return;
            }
            const { removedNodes, removedActions } = db.pruneForeignRecords(root);
            provider.refresh();
            if (activePanel) {
                activePanel.webview.postMessage({ type: 'updateGraph', data: db.getGraphData() });
            }
            vscode.window.showInformationMessage(`MemLite: Pruned ${removedNodes} foreign memories and ${removedActions} foreign file actions.`);
        })
    );

    // Command: Export compiled context items to a workspace Markdown file (.memlite_context.md)
    context.subscriptions.push(
        vscode.commands.registerCommand('memlite.exportContextFile', async (items: any[]) => {
            await handleExportContextFile(items);
        })
    );
}

function compileContextBlock(text: string, answer: string, connected: { question: string; answer: string }[]): string {
    let block = `--- MEMLITE CONTEXT ---\n`;
    if (connected && connected.length > 0) {
        block += `Related Past Conversations:\n`;
        connected.forEach((c, idx) => {
            block += `[${idx + 1}] Q: "${c.question}"\n    A: "${c.answer}"\n\n`;
        });
        block += `-----------------------\n`;
    }
    block += `Selected Reference Q&A:\n`;
    block += `Question: "${text}"\nAnswer: "${answer}"\n`;
    block += `-----------------------`;
    return block;
}

async function handleExportContextFile(items: any[]) {
    if (!items || items.length === 0) {
        vscode.window.showWarningMessage("MemLite: Context cart is empty. Pin some nodes first!");
        return;
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage("MemLite: No active workspace folder. Open a folder to write `.memlite_context.md`.");
        return;
    }
    const rootPath = workspaceFolders[0].uri.fsPath;
    const contextFilePath = path.join(rootPath, '.memlite_context.md');

    // Compile beautiful markdown reference
    let md = `# 🧠 MemLite: Compiled Chat Context Reference\n\n`;
    md += `This file contains the context, code snippets, and Q&A steps you compiled from your previous conversations.\n`;
    md += `**Reference this file in your current Copilot/Codex/Gemini prompt** (e.g. type \`#file:.memlite_context.md\` or drag this file in) to pass the entire context instantly.\n\n`;
    md += `---\n\n`;

    items.forEach((item, index) => {
        const title = item.question.replace(/\n/g, ' ').substring(0, 50).trim();
        md += `## 💬 Step ${index + 1}: ${title}${item.question.length > 50 ? '...' : ''}\n`;
        md += `* **Question:** ${item.question}\n`;
        md += `* **Answer & Code Changes:**\n\n${item.answer}\n\n`;
        md += `---\n\n`;
    });

    try {
        fs.writeFileSync(contextFilePath, md, 'utf8');

        // Add to gitignore automatically to keep git logs clean
        const gitignorePath = path.join(rootPath, '.gitignore');
        if (fs.existsSync(gitignorePath)) {
            let gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
            if (!gitignoreContent.includes('.memlite_context.md')) {
                const suffix = gitignoreContent.endsWith('\n') ? '' : '\n';
                fs.appendFileSync(gitignorePath, `${suffix}.memlite_context.md\n`, 'utf8');
            }
        }

        // Open the document side-by-side
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(contextFilePath));
        await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside, false);
        vscode.window.showInformationMessage("🧠 MemLite: Workspace `.memlite_context.md` successfully updated!");
    } catch (e) {
        vscode.window.showErrorMessage(`MemLite: Failed to write context file: ${e}`);
    }
}

export async function stageContextToChat(contextText: string, notificationPrefix: string = "🧠 MemLite") {
    // 1. Always write to clipboard for instant Ctrl+V / Cmd+V
    await vscode.env.clipboard.writeText(contextText);

    let stagedDirectly = false;
    try {
        // Try opening VS Code / Copilot / Gemini chat view with query staged
        await vscode.commands.executeCommand('workbench.action.chat.open', { query: contextText });
        stagedDirectly = true;
    } catch (e1) {
        try {
            await vscode.commands.executeCommand('workbench.action.quickchat.open', { query: contextText });
            stagedDirectly = true;
        } catch (e2) {
            // Fallback: clipboard ready
        }
    }

    if (stagedDirectly) {
        vscode.window.showInformationMessage(
            `${notificationPrefix}: Staged context directly to AI Chatbox & copied to clipboard!`
        );
    } else {
        vscode.window.showInformationMessage(
            `${notificationPrefix}: Context copied to clipboard! Paste (Ctrl+V) directly into your AI chat.`
        );
    }
}

export function deactivate() {
    if (watcher) {
        watcher.stop();
    }
    console.log('MemLite: Extension is deactivated.');
}
