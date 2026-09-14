import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { MemoryDatabase, FileActionItem } from './database';

export class TranscriptWatcher {
    private db: MemoryDatabase;
    private workspaceRoot?: string;
    private brainPath: string;
    private watcher: fs.FSWatcher | null = null;
    private processedLogs: Map<string, number> = new Map(); // filepath -> last processed line count

    constructor(db: MemoryDatabase, workspaceRoot?: string) {
        this.db = db;
        this.workspaceRoot = workspaceRoot;
        const homeDir = process.env.USERPROFILE || process.env.HOME || 'C:\\Users\\lenovo';
        this.brainPath = path.join(homeDir, '.gemini', 'antigravity-ide', 'brain');
    }

    public start() {
        if (!fs.existsSync(this.brainPath)) {
            console.log(`Watcher: Brain path does not exist: ${this.brainPath}. Waiting...`);
            const timer = setInterval(() => {
                if (fs.existsSync(this.brainPath)) {
                    clearInterval(timer);
                    this.startWatching();
                }
            }, 10000);
            return;
        }
        this.startWatching();
    }

    private startWatching() {
        console.log(`MemLite Watcher: Monitoring transcripts at ${this.brainPath}`);
        this.scanExistingLogs();

        try {
            this.watcher = fs.watch(this.brainPath, { recursive: true }, (eventType, filename) => {
                if (!filename) return;
                const normName = filename.replace(/\\/g, '/');
                if (normName.endsWith('transcript.jsonl')) {
                    const fullPath = path.join(this.brainPath, filename);
                    this.processTranscriptFile(fullPath);
                }
            });
        } catch (e) {
            console.error("MemLite Watcher: Failed to setup recursive directory watcher:", e);
        }
    }

    private scanExistingLogs() {
        try {
            if (!fs.existsSync(this.brainPath)) return;
            const convDirs = fs.readdirSync(this.brainPath, { withFileTypes: true })
                .filter(d => d.isDirectory())
                .map(d => path.join(this.brainPath, d.name));

            const candidateFiles: { filePath: string; mtime: number }[] = [];
            for (const cDir of convDirs) {
                const possible = [
                    path.join(cDir, '.system_generated', 'logs', 'transcript.jsonl'),
                    path.join(cDir, 'transcript.jsonl')
                ];
                for (const p of possible) {
                    if (fs.existsSync(p)) {
                        try {
                            const stat = fs.statSync(p);
                            candidateFiles.push({ filePath: p, mtime: stat.mtimeMs });
                        } catch (e) {}
                    }
                }
            }

            // Sort by most recent mtime descending
            candidateFiles.sort((a, b) => b.mtime - a.mtime);

            // Bounded scan: only top 5 recent transcripts to avoid freezing/lagging on startup
            const toScan = candidateFiles.slice(0, 5);
            let anyNewRecords = false;
            for (const item of toScan) {
                const added = this.processTranscriptFile(item.filePath, false);
                if (added) anyNewRecords = true;
            }

            if (anyNewRecords) {
                vscode.commands.executeCommand('memlite.refreshGraphView');
            }
        } catch (e) {
            console.error("Watcher: Error during bounded log scan:", e);
        }
    }

    private processTranscriptFile(filePath: string, triggerRefresh: boolean = true): boolean {
        let addedAny = false;
        try {
            if (!fs.existsSync(filePath)) return false;
            const content = fs.readFileSync(filePath, 'utf8');
            const lines = content.split('\n').filter(l => l.trim().length > 0);

            const lastIndex = this.processedLogs.get(filePath) || 0;
            if (lines.length <= lastIndex) return false;

            // Extract conversation ID from path
            const parts = filePath.split(path.sep);
            const brainIndex = parts.indexOf('brain');
            const conversationId = (brainIndex !== -1 && parts.length > brainIndex + 1)
                ? parts[brainIndex + 1]
                : path.basename(path.dirname(path.dirname(filePath)));

            let currentQuestion: string | null = null;
            let currentStepIndex: number = 0;

            lines.slice(lastIndex).forEach((line) => {
                try {
                    const logObj = JSON.parse(line);
                    
                    if (logObj.type === 'USER_INPUT' && logObj.content) {
                        currentQuestion = this.cleanPrompt(logObj.content);
                        currentStepIndex = logObj.step_index;
                    } 
                    else if (logObj.type === 'PLANNER_RESPONSE' && currentQuestion) {
                        const rawAnswer = logObj.content || '';
                        let answer = this.cleanAnswer(rawAnswer);
                        
                        // Extract tools, file modifications, and diff breadcrumbs
                        const toolInfo = this.extractToolContextAndActions(
                            logObj.tool_calls,
                            currentQuestion,
                            currentStepIndex
                        );

                        if (toolInfo.summary) {
                            answer += toolInfo.summary;
                        }
                        
                        // Only save if the answer has actual content (skip intermediate tool-run steps)
                        if (answer.trim().length > 0) {
                            const stepKey = `${conversationId}_${currentStepIndex}`;
                            // Fast O(1) step lookup: never run getGraphData() in a loop!
                            if (!this.db.hasStep(stepKey) && this.isMemoryWorthy(currentQuestion)) {
                                const activeEditor = vscode.window.activeTextEditor;
                                const fileRef = activeEditor ? activeEditor.document.fileName : undefined;
                                const project = vscode.workspace.name || "Default Project";

                                console.log(`Watcher: Indexing step ${currentStepIndex} from conversation ${conversationId}`);
                                
                                this.db.addRecord(
                                    currentQuestion,
                                    answer,
                                    project,
                                    fileRef,
                                    [stepKey, "auto-log"],
                                    conversationId,
                                    currentStepIndex,
                                    toolInfo.filesTouched,
                                    toolInfo.filesTouched.length > 0 ? "code_change" : "discussion"
                                );
                                
                                addedAny = true;
                            }
                            
                            // Reset pair
                            currentQuestion = null;
                        }
                    }
                } catch (err) {
                    // Ignore transient malformed line
                }
            });

            this.processedLogs.set(filePath, lines.length);
            if (addedAny && triggerRefresh) {
                vscode.commands.executeCommand('memlite.refreshGraphView');
            }
        } catch (e) {
            console.error(`Watcher: Error reading transcript file ${filePath}:`, e);
        }
        return addedAny;
    }

    private cleanArg(val: any): string {
        if (typeof val !== 'string') return '';
        let cleaned = val.trim();
        if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
            try {
                return JSON.parse(cleaned);
            } catch (e) {
                cleaned = cleaned.substring(1, cleaned.length - 1);
            }
        }
        return cleaned
            .replace(/\\n/g, '\n')
            .replace(/\\t/g, '\t')
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, '\\')
            .trim();
    }

    private generateDiffSummary(diffText: string, maxLines: number = 20, isRawCode: boolean = false): { summary: string; added: number; removed: number } {
        const lines = diffText.trim().split('\n');
        const hasDiffMarkers = !isRawCode && lines.some(l => (l.startsWith('+') && !l.startsWith('+++')) || (l.startsWith('-') && !l.startsWith('---')));

        let added = 0;
        let removed = 0;
        if (hasDiffMarkers) {
            added = lines.filter(l => l.startsWith('+') && !l.startsWith('+++')).length;
            removed = lines.filter(l => l.startsWith('-') && !l.startsWith('---')).length;
        } else {
            added = lines.length;
            removed = 0;
        }

        if (lines.length <= maxLines && hasDiffMarkers) {
            return { summary: diffText.trim(), added, removed };
        }

        // Extract symbols to create high-signal Semantic Breadcrumb
        const symbolRegex = /(?:def\s+|class\s+|function\s+|export\s+(?:default\s+)?(?:class|function|const|let|var|interface|type)\s+)([a-zA-Z0-9_]+)/g;
        const symbols = new Set<string>();
        for (const l of lines) {
            if (!hasDiffMarkers || l.startsWith('+') || l.startsWith('-')) {
                let match;
                while ((match = symbolRegex.exec(l)) !== null) {
                    symbols.add(match[1]);
                }
            }
        }

        const symList = Array.from(symbols).slice(0, 5);
        const symStr = symList.length > 0 ? `{${symList.join(', ')}}` : '{general logic}';

        if (lines.length <= maxLines && !hasDiffMarkers) {
            return { summary: diffText.trim(), added, removed };
        }

        const label = hasDiffMarkers ? 'LARGE DIFF' : 'FILE CONTENT';
        const breadcrumb = `[${label}: +${added} lines, -${removed} lines across ${lines.length} total lines. Key modified symbols: ${symStr}. Inspect file directly on disk.]`;

        return { summary: breadcrumb, added, removed };
    }

    private computeHash(text: string): string {
        const normalized = text.replace(/\r\n/g, '\n').trim();
        return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex').substring(0, 16);
    }

    private isInsideWorkspace(targetPath: string): boolean {
        if (!targetPath) return false;
        if (!this.workspaceRoot) return true;
        const normRoot = this.workspaceRoot.replace(/\\/g, '/').toLowerCase();
        const normTarget = targetPath.replace(/\\/g, '/').toLowerCase();
        return normTarget.startsWith(normRoot) || (!normTarget.includes(':') && !normTarget.startsWith('/'));
    }

    private extractToolContextAndActions(
        toolCalls: any[],
        currentQuestion: string,
        stepIndex: number
    ): { summary: string; filesTouched: string[] } {
        if (!toolCalls || !Array.isArray(toolCalls) || toolCalls.length === 0) {
            return { summary: '', filesTouched: [] };
        }

        let summary = '\n\n### 🛠️ Code Actions & Changes';
        let hasActions = false;
        const filesTouchedSet = new Set<string>();

        toolCalls.forEach((tc: any) => {
            const name = tc.name || '';
            const args = tc.args || {};
            
            if (name === 'write_to_file') {
                const rawFile = this.cleanArg(args.TargetFile || '');
                if (rawFile && this.isInsideWorkspace(rawFile)) {
                    hasActions = true;
                    const file = path.basename(rawFile);
                    const code = this.cleanArg(args.CodeContent || '');
                    const relFile = rawFile.replace(/\\/g, '/');
                    filesTouchedSet.add(relFile);

                    const { summary: diffSummary, added, removed } = this.generateDiffSummary(code, 20, true);
                    const fileHash = this.computeHash(code);

                    this.db.recordFileAction({
                        id: `${stepIndex}_${this.computeHash(relFile)}`,
                        stepIndex,
                        filePath: relFile,
                        action: 'created',
                        fileHashAfter: fileHash,
                        intent: currentQuestion,
                        diffSummary,
                        linesAdded: added,
                        linesRemoved: removed,
                        timestamp: new Date().toISOString()
                    });

                    summary += `\n\n📄 **Created File:** \`${file}\` (SHA: \`${fileHash}\`)\n\`\`\`\n${code.substring(0, 500)}${code.length > 500 ? '\n... (truncated)' : ''}\n\`\`\``;
                }
            } else if (name === 'replace_file_content') {
                const rawFile = this.cleanArg(args.TargetFile || '');
                if (rawFile && this.isInsideWorkspace(rawFile)) {
                    hasActions = true;
                    const file = path.basename(rawFile);
                    const rep = this.cleanArg(args.ReplacementContent || '');
                    const relFile = rawFile.replace(/\\/g, '/');
                    filesTouchedSet.add(relFile);

                    const { summary: diffSummary, added, removed } = this.generateDiffSummary(rep);
                    const fileHash = this.computeHash(rep);

                    this.db.recordFileAction({
                        id: `${stepIndex}_${this.computeHash(relFile)}`,
                        stepIndex,
                        filePath: relFile,
                        action: 'modified',
                        fileHashAfter: fileHash,
                        intent: currentQuestion,
                        diffSummary,
                        linesAdded: added,
                        linesRemoved: removed,
                        timestamp: new Date().toISOString()
                    });

                    if (diffSummary.startsWith('[LARGE DIFF')) {
                        summary += `\n\n✏️ **Modified File:** \`${file}\`\n${diffSummary}`;
                    } else {
                        summary += `\n\n✏️ **Modified File:** \`${file}\`\n\`\`\`diff\n${rep.substring(0, 500)}${rep.length > 500 ? '\n... (truncated)' : ''}\n\`\`\``;
                    }
                }
            } else if (name === 'multi_replace_file_content') {
                const rawFile = this.cleanArg(args.TargetFile || '');
                if (rawFile && this.isInsideWorkspace(rawFile)) {
                    hasActions = true;
                    const file = path.basename(rawFile);
                    const relFile = rawFile.replace(/\\/g, '/');
                    filesTouchedSet.add(relFile);

                    summary += `\n\n✏️ **Multi-line Edit in File:** \`${file}\``;
                    if (args.ReplacementChunks && Array.isArray(args.ReplacementChunks)) {
                        args.ReplacementChunks.forEach((chunk: any, i: number) => {
                            const rep = this.cleanArg(chunk.ReplacementContent || '');
                            const { summary: diffSummary } = this.generateDiffSummary(rep);
                            summary += `\n* **Chunk ${i+1}:** ${diffSummary}`;
                        });
                    }
                }
            } else if (name === 'run_command') {
                hasActions = true;
                const cmd = this.cleanArg(args.CommandLine || '');
                summary += `\n\n💻 **Executed Command:** \`${cmd}\``;
            }
        });

        return {
            summary: hasActions ? summary : '',
            filesTouched: Array.from(filesTouchedSet)
        };
    }

    private cleanPrompt(rawPrompt: string): string {
        const requestMatch = rawPrompt.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
        if (requestMatch) {
            return requestMatch[1].trim();
        }
        let cleaned = rawPrompt.replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/g, '');
        cleaned = cleaned.replace(/<[^>]*>/g, '');
        return cleaned.trim();
    }

    private cleanAnswer(rawAnswer: string): string {
        let cleaned = rawAnswer.replace(/<thinking>[\s\S]*?<\/thinking>/g, '');
        cleaned = cleaned.replace(/<[^>]*>/g, '');
        return cleaned.trim();
    }

    private isMemoryWorthy(prompt: string): boolean {
        const text = prompt.trim().toLowerCase();
        // Ignore single-word confirmations
        const trivialClicks = ["ok", "okay", "yes", "no", "thanks", "thank you", "cancel", "stop"];
        const cleaned = text.replace(/[^a-z0-9\s]/g, '').trim();
        if (trivialClicks.includes(cleaned)) return false;
        return cleaned.length > 2;
    }

    public stop() {
        if (this.watcher) {
            this.watcher.close();
            this.watcher = null;
        }
    }
}
