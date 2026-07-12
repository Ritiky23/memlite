import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { MemoryDatabase } from './database';

export class TranscriptWatcher {
    private db: MemoryDatabase;
    private brainPath: string;
    private watcher: fs.FSWatcher | null = null;
    private processedLogs: Map<string, number> = new Map(); // filepath -> last processed line count

    constructor(db: MemoryDatabase) {
        this.db = db;
        // Resolve default Antigravity app data path
        const homeDir = process.env.USERPROFILE || process.env.HOME || 'C:\\Users\\lenovo';
        this.brainPath = path.join(homeDir, '.gemini', 'antigravity-ide', 'brain');
    }

    public start() {
        if (!fs.existsSync(this.brainPath)) {
            console.log(`Watcher: Brain path does not exist: ${this.brainPath}. Waiting...`);
            // Poll for folder creation if not present yet
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
        console.log(`Watcher: Monitoring chat transcripts in ${this.brainPath}`);
        try {
            this.watcher = fs.watch(this.brainPath, { recursive: true }, (eventType, filename) => {
                if (filename && filename.endsWith('transcript.jsonl')) {
                    const fullPath = path.join(this.brainPath, filename);
                    // Debounce file reads slightly to allow lock releases
                    setTimeout(() => this.processTranscriptFile(fullPath), 500);
                }
            });
        } catch (e) {
            console.error("Watcher: Failed to initialize file system watcher:", e);
        }
    }

    private processTranscriptFile(filePath: string) {
        if (!fs.existsSync(filePath)) { return; }

        // Extract conversation ID from folder structure
        // path is .../brain/<conversation-id>/.system_generated/logs/transcript.jsonl
        const parts = filePath.split(path.sep);
        const brainIndex = parts.indexOf('brain');
        let conversationId = 'default_conv';
        if (brainIndex !== -1 && brainIndex + 1 < parts.length) {
            conversationId = parts[brainIndex + 1];
        }

        // Exclude the active development pair-programming conversation
        if (conversationId === '635300cb-2b3f-450d-bc1b-f180825bd86a') {
            return;
        }

        try {
            const rawContent = fs.readFileSync(filePath, 'utf8');
            const lines = rawContent.split('\n').filter(l => l.trim().length > 0);
            
            // Loop and pair USER_INPUT with subsequent responses
            let currentQuestion: string | null = null;
            let currentStepIndex: number = -1;

            lines.forEach((line) => {
                try {
                    const logObj = JSON.parse(line);
                    
                    if (logObj.type === 'USER_INPUT' && logObj.content) {
                        currentQuestion = this.cleanPrompt(logObj.content);
                        currentStepIndex = logObj.step_index;
                    } 
                    else if (logObj.type === 'PLANNER_RESPONSE' && currentQuestion) {
                        const rawAnswer = logObj.content || '';
                        let answer = this.cleanAnswer(rawAnswer);
                        
                        // Append code modifications and executed tools
                        if (logObj.tool_calls) {
                            answer += this.extractToolContext(logObj.tool_calls);
                        }
                        
                        // Only save if the answer has actual content (skip intermediate tool-run steps)
                        if (answer.trim().length > 0) {
                            const stepKey = `${conversationId}_${currentStepIndex}`;
                            if (!this.isAlreadyIndexed(stepKey)) {
                                const activeEditor = vscode.window.activeTextEditor;
                                const fileRef = activeEditor ? activeEditor.document.fileName : undefined;
                                const project = vscode.workspace.name || "Default Project";

                                console.log(`Watcher: Indexing new Q&A from conversation: ${conversationId}, step: ${currentStepIndex}`);
                                
                                this.db.addRecord(
                                    currentQuestion,
                                    answer,
                                    project,
                                    fileRef,
                                    [stepKey, "auto-log"],
                                    conversationId,
                                    currentStepIndex
                                );
                                
                                vscode.commands.executeCommand('memlite.refreshGraphView');
                            }
                            
                            // Reset pair
                            currentQuestion = null;
                        }
                    }
                } catch (err) {
                    // Line might be half-written or corrupt, ignore
                }
            });
        } catch (e) {
            console.error(`Watcher: Error reading transcript file ${filePath}:`, e);
        }
    }

    private cleanArg(val: any): string {
        if (typeof val !== 'string') {
            return '';
        }
        let cleaned = val.trim();
        
        // If double-JSON encoded, parse it
        if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
            try {
                return JSON.parse(cleaned);
            } catch (e) {
                cleaned = cleaned.substring(1, cleaned.length - 1);
            }
        }
        
        // Fallback unescape text representations
        return cleaned
            .replace(/\\n/g, '\n')
            .replace(/\\t/g, '\t')
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, '\\')
            .trim();
    }

    private extractToolContext(toolCalls: any[]): string {
        if (!toolCalls || !Array.isArray(toolCalls) || toolCalls.length === 0) {
            return '';
        }

        let summary = '\n\n### 🛠️ Code Actions & Changes';
        let hasActions = false;

        toolCalls.forEach((tc: any) => {
            const name = tc.name || '';
            const args = tc.args || {};
            
            if (name === 'write_to_file') {
                hasActions = true;
                const rawFile = args.TargetFile || '';
                const file = path.basename(this.cleanArg(rawFile));
                const code = this.cleanArg(args.CodeContent || '');
                summary += `\n\n📄 **Created File:** \`${file}\`\n\`\`\`\n${code.substring(0, 800)}${code.length > 800 ? '\n... (truncated)' : ''}\n\`\`\``;
            } else if (name === 'replace_file_content') {
                hasActions = true;
                const rawFile = args.TargetFile || '';
                const file = path.basename(this.cleanArg(rawFile));
                const rep = this.cleanArg(args.ReplacementContent || '');
                summary += `\n\n✏️ **Modified File:** \`${file}\`\n\`\`\`diff\n${rep.substring(0, 600)}${rep.length > 600 ? '\n... (truncated)' : ''}\n\`\`\``;
            } else if (name === 'multi_replace_file_content') {
                hasActions = true;
                const rawFile = args.TargetFile || '';
                const file = path.basename(this.cleanArg(rawFile));
                summary += `\n\n✏️ **Multi-line Edit in File:** \`${file}\``;
                if (args.ReplacementChunks && Array.isArray(args.ReplacementChunks)) {
                    args.ReplacementChunks.forEach((chunk: any, i: number) => {
                        const rep = this.cleanArg(chunk.ReplacementContent || '');
                        summary += `\n* **Chunk ${i+1}:**\n\`\`\`diff\n${rep.substring(0, 300)}${rep.length > 300 ? '\n... (truncated)' : ''}\n\`\`\``;
                    });
                }
            } else if (name === 'run_command') {
                hasActions = true;
                const cmd = this.cleanArg(args.CommandLine || '');
                summary += `\n\n💻 **Executed Command:** \`${cmd}\``;
            }
        });

        return hasActions ? summary : '';
    }

    private cleanPrompt(rawPrompt: string): string {
        // Match content within <USER_REQUEST>...</USER_REQUEST>
        const requestMatch = rawPrompt.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
        if (requestMatch) {
            return requestMatch[1].trim();
        }

        // Fallback: Strip <ADDITIONAL_METADATA> blocks entirely
        let cleaned = rawPrompt.replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/g, '');
        // Strip any remaining xml-like tags
        cleaned = cleaned.replace(/<[^>]*>/g, '');
        return cleaned.trim();
    }

    private cleanAnswer(rawAnswer: string): string {
        // Strip thinking or internal system tags if any
        let cleaned = rawAnswer.replace(/<thinking>[\s\S]*?<\/thinking>/g, '');
        cleaned = cleaned.replace(/<[^>]*>/g, '');
        return cleaned.trim();
    }

    private isAlreadyIndexed(stepKey: string): boolean {
        // Query database node metadata/tags to see if this tag exists
        const graphData = this.db.getGraphData();
        return graphData.nodes.some(n => 
            n.type === 'qa' && 
            n.details && 
            n.details.tags && 
            n.details.tags.includes(stepKey)
        );
    }

    public stop() {
        if (this.watcher) {
            this.watcher.close();
            this.watcher = null;
        }
    }
}
