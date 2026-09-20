import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
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
        const homeDir = os.homedir() || process.env.USERPROFILE || process.env.HOME || '';
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
        // Defer heavy log scanning to background so extension activation and webview rendering are instant
        setTimeout(() => {
            this.scanExistingLogs();
        }, 200);

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

            // Scan top 50 most recent transcripts on startup for fast, comprehensive startup
            const toScan = candidateFiles.slice(0, 50);
            let anyNewRecords = false;
            for (const item of toScan) {
                const added = this.processTranscriptFile(item.filePath, false);
                if (added) anyNewRecords = true;
            }

            if (anyNewRecords) {
                this.db.save(true);
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
            if (lines.length <= lastIndex && this.processedLogs.has(filePath)) return false;

            // Extract conversation ID from path
            const parts = filePath.split(path.sep);
            const brainIndex = parts.indexOf('brain');
            const conversationId = (brainIndex !== -1 && parts.length > brainIndex + 1)
                ? parts[brainIndex + 1]
                : path.basename(path.dirname(path.dirname(filePath)));

            // Aggregate transcript lines into complete conversation turns
            interface ConversationTurn {
                stepIndex: number;
                question: string;
                textResponses: string[];
                toolCalls: any[];
                timestamp?: string;
            }

            const turns: ConversationTurn[] = [];
            let currentTurn: ConversationTurn | null = null;

            for (const line of lines) {
                try {
                    const logObj = JSON.parse(line);
                    
                    if (logObj.type === 'USER_INPUT' && logObj.content) {
                        const cleanedQuestion = this.cleanPrompt(logObj.content);
                        if (this.isMemoryWorthy(cleanedQuestion)) {
                            currentTurn = {
                                stepIndex: logObj.step_index ?? 0,
                                question: cleanedQuestion,
                                textResponses: [],
                                toolCalls: [],
                                timestamp: logObj.created_at || undefined
                            };
                            turns.push(currentTurn);
                        } else {
                            currentTurn = null;
                        }
                    } 
                    else if (currentTurn && logObj.type === 'PLANNER_RESPONSE') {
                        if (logObj.content) {
                            const cleaned = this.cleanAnswer(logObj.content);
                            if (cleaned.length > 0) {
                                currentTurn.textResponses.push(cleaned);
                            }
                        }
                        if (logObj.tool_calls && Array.isArray(logObj.tool_calls) && logObj.tool_calls.length > 0) {
                            currentTurn.toolCalls.push(...logObj.tool_calls);
                        }
                    }
                } catch (err) {
                    // Ignore transient malformed line
                }
            }

            // Determine conversation-level project from transcript content & tool calls
            const allTurnToolCalls = turns.flatMap(t => t.toolCalls);
            let detectedProject = this.detectProjectName(lines, allTurnToolCalls);

            // If no project from tool calls / active document / file paths (e.g. casual chat or questions):
            if (!detectedProject || detectedProject === 'General' || detectedProject === 'Default Project') {
                const existingCached = this.db.getSessionProject(conversationId);
                const localProj = this.getLocalWorkspaceProject();
                const isFocused = vscode.window.state.focused;

                if (existingCached && existingCached !== 'General' && existingCached !== 'Default Project') {
                    detectedProject = existingCached;
                } else if (isFocused && localProj !== 'General') {
                    detectedProject = localProj;
                } else {
                    detectedProject = 'General';
                }
            }

            // Correct stale cached project if we now have a better signal
            if (detectedProject && detectedProject !== 'General' && detectedProject !== 'Default Project') {
                this.db.updateAutoDetectedProject(conversationId, detectedProject);
            }

            // Process every turn and record/update into database
            for (const turn of turns) {
                const toolInfo = this.extractToolContextAndActions(
                    turn.toolCalls,
                    turn.question,
                    turn.stepIndex
                );

                const mainAnswer = turn.textResponses.join('\n\n').trim();
                let fullAnswer = mainAnswer;
                if (toolInfo.summary) {
                    fullAnswer = fullAnswer ? `${fullAnswer}${toolInfo.summary}` : toolInfo.summary.trim();
                }

                if (fullAnswer.trim().length === 0) {
                    continue;
                }

                const stepKey = `${conversationId}_${turn.stepIndex}`;
                // Only associate fileRef if a file was actually touched or referenced in this turn
                const fileRef = toolInfo.filesTouched[0] || undefined;
                
                // If this turn specifically touched files, detect turn-level project, else use conversation-level project
                const turnProject = toolInfo.filesTouched.length > 0 
                    ? this.detectProjectName([], turn.toolCalls, detectedProject)
                    : detectedProject;

                const result = this.db.upsertRecord(
                    turn.question,
                    fullAnswer,
                    turnProject,
                    fileRef,
                    [stepKey, "auto-log"],
                    conversationId,
                    turn.stepIndex,
                    toolInfo.filesTouched,
                    toolInfo.filesTouched.length > 0 ? "code_change" : "discussion",
                    turn.timestamp
                );

                if (result.isNew || result.isUpdated) {
                    console.log(`Watcher: ${result.isNew ? 'Indexed' : 'Updated'} step ${turn.stepIndex} from conversation ${conversationId} (${toolInfo.filesTouched.length} files touched)`);
                    addedAny = true;
                }
            }

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
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
            .replace(/\\n/g, '\n')
            .replace(/\\t/g, '\t')
            .replace(/\\"/g, '"')
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

    public getLocalWorkspaceProject(): string {
        if (!this.workspaceRoot) return 'General';
        const res = this.extractProjectAndRelPath(this.workspaceRoot);
        if (res.project && res.project !== 'General') {
            return res.project;
        }
        const base = path.basename(this.workspaceRoot.replace(/\\/g, '/'));
        return base || 'General';
    }

    private isUserWorkspaceFile(targetPath: string): boolean {
        if (!targetPath) return false;
        const norm = targetPath.replace(/\\/g, '/').toLowerCase();
        if (norm.includes('.gemini/antigravity-ide/brain') || 
            norm.includes('appdata/local') || 
            norm.includes('node_modules')) {
            return false;
        }
        return true;
    }

    private extractProjectAndRelPath(rawPath: string): { project: string; relPath: string } {
        if (!rawPath || typeof rawPath !== 'string') return { project: 'General', relPath: '' };
        const norm = rawPath.replace(/\\/g, '/');

        const blacklist = new Set([
            'c', 'd', 'e', 'cm', 'users', 'lenovo', 'appdata', 'local', 'programs', 'microsoft',
            'windows', 'antigravity-ide', 'antigravity', 'gemini', 'brain', 'system_generated',
            'logs', '.system_generated', 'scratch', 'temp', 'tmp', 'home', 'projects', 'workspace', 'my_dream'
        ]);

        if (norm.includes('godseye_frontend/client') || norm.includes('/client/src') || norm.includes('/client/')) {
            const idx = norm.indexOf('client');
            const after = norm.substring(idx + 'client'.length).replace(/^\/+/, '');
            return { project: 'client', relPath: after || 'client' };
        }
        if (norm.includes('My_Dream/memlite') || norm.includes('/memlite-extension') || norm.includes('/memlite/')) {
            const idx = norm.indexOf('memlite');
            const after = norm.substring(idx + 'memlite'.length).replace(/^\/+/, '');
            return { project: 'memlite', relPath: after || 'memlite' };
        }
        if (norm.includes('CM/optimus') || norm.includes('/optimus/') || norm.includes('optimus')) {
            const idx = norm.indexOf('optimus');
            const after = norm.substring(idx + 'optimus'.length).replace(/^\/+/, '');
            return { project: 'optimus', relPath: after || 'optimus' };
        }

        const m = norm.match(/^[a-zA-Z]:\/(.+)$/);
        if (m) {
            const parts = m[1].split('/').filter(Boolean);
            for (let i = 0; i < parts.length; i++) {
                const seg = parts[i];
                const low = seg.toLowerCase();
                if (!blacklist.has(low) && !/^[0-9a-f]{8}-[0-9a-f]{4}/.test(low) && !seg.includes('.')) {
                    const proj = seg === 'memlite-extension' ? 'memlite' : seg;
                    const rel = parts.slice(i + 1).join('/');
                    return { project: proj, relPath: rel || proj };
                }
            }
        }

        return { project: 'General', relPath: path.basename(norm) };
    }

    private getRelativePath(targetPath: string): string {
        return this.extractProjectAndRelPath(targetPath).relPath;
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

        toolCalls.forEach((tc: any, actionIdx: number) => {
            const name = tc.name || '';
            const args = tc.args || {};
            
            if (name === 'write_to_file' || name === 'create_file') {
                const rawFile = this.cleanArg(args.TargetFile || args.path || args.file_path || '');
                if (rawFile && this.isUserWorkspaceFile(rawFile)) {
                    hasActions = true;
                    const { relPath: relFile } = this.extractProjectAndRelPath(rawFile);
                    const code = this.cleanArg(args.CodeContent || args.content || args.file_text || '');
                    filesTouchedSet.add(relFile);

                    const { summary: diffSummary, added, removed } = this.generateDiffSummary(code, 20, true);
                    const fileHash = this.computeHash(code);

                    this.db.recordFileAction({
                        id: `${stepIndex}_${actionIdx}_${this.computeHash(relFile)}`,
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

                    summary += `\n\n📄 **Created File:** \`${relFile}\` (SHA: \`${fileHash}\`)\n\`\`\`\n${code.substring(0, 500)}${code.length > 500 ? '\n... (truncated)' : ''}\n\`\`\``;
                }
            } else if (name === 'replace_file_content' || name === 'edit_file' || name === 'apply_diff' || name === 'apply_patch') {
                const rawFile = this.cleanArg(args.TargetFile || args.path || args.file_path || '');
                if (rawFile && this.isUserWorkspaceFile(rawFile)) {
                    hasActions = true;
                    const { relPath: relFile } = this.extractProjectAndRelPath(rawFile);
                    const rep = this.cleanArg(args.ReplacementContent || args.replacement || args.content || '');
                    filesTouchedSet.add(relFile);

                    const { summary: diffSummary, added, removed } = this.generateDiffSummary(rep);
                    const fileHash = this.computeHash(rep);

                    this.db.recordFileAction({
                        id: `${stepIndex}_${actionIdx}_${this.computeHash(relFile)}`,
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
                        summary += `\n\n✏️ **Modified File:** \`${relFile}\`\n${diffSummary}`;
                    } else {
                        summary += `\n\n✏️ **Modified File:** \`${relFile}\`\n\`\`\`diff\n${rep.substring(0, 500)}${rep.length > 500 ? '\n... (truncated)' : ''}\n\`\`\``;
                    }
                }
            } else if (name === 'multi_replace_file_content') {
                const rawFile = this.cleanArg(args.TargetFile || args.path || args.file_path || '');
                if (rawFile && this.isUserWorkspaceFile(rawFile)) {
                    hasActions = true;
                    const { relPath: relFile } = this.extractProjectAndRelPath(rawFile);
                    filesTouchedSet.add(relFile);

                    summary += `\n\n✏️ **Multi-line Edit in File:** \`${relFile}\``;
                    let totalAdded = 0;
                    let totalRemoved = 0;
                    let combinedRep = '';
                    if (args.ReplacementChunks && Array.isArray(args.ReplacementChunks)) {
                        args.ReplacementChunks.forEach((chunk: any, i: number) => {
                            const rep = this.cleanArg(chunk.ReplacementContent || '');
                            combinedRep += rep + '\n';
                            const { summary: diffSummary, added, removed } = this.generateDiffSummary(rep);
                            totalAdded += added;
                            totalRemoved += removed;
                            summary += `\n* **Chunk ${i+1}:** ${diffSummary}`;
                        });
                    }
                    const fileHash = this.computeHash(combinedRep);
                    this.db.recordFileAction({
                        id: `${stepIndex}_${actionIdx}_${this.computeHash(relFile)}`,
                        stepIndex,
                        filePath: relFile,
                        action: 'modified',
                        fileHashAfter: fileHash,
                        intent: currentQuestion,
                        diffSummary: `Multi-line edit across ${args.ReplacementChunks?.length || 1} chunks`,
                        linesAdded: totalAdded,
                        linesRemoved: totalRemoved,
                        timestamp: new Date().toISOString()
                    });
                }
            } else if (name === 'run_command' || name === 'execute_command' || name === 'run_shell_command') {
                hasActions = true;
                const cmd = this.cleanArg(args.CommandLine || args.command || '');
                summary += `\n\n💻 **Executed Command:** \`${cmd}\``;
            }
        });

        return {
            summary: hasActions ? summary : '',
            filesTouched: Array.from(filesTouchedSet)
        };
    }

    private cleanPrompt(rawPrompt: string): string {
        let text = rawPrompt;
        const requestMatch = rawPrompt.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
        if (requestMatch) {
            text = requestMatch[1];
        } else {
            text = text.replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/g, '');
            text = text.replace(/<USER_SETTINGS_CHANGE>[\s\S]*?<\/USER_SETTINGS_CHANGE>/g, '');
            text = text.replace(/<conversation_summaries>[\s\S]*?<\/conversation_summaries>/g, '');
        }

        // Strip injected MemLite context blocks to prevent recursive context loop pollution
        text = text.replace(/--- MEMLITE CONTEXT ---[\s\S]*?-----------------------/g, '');
        text = text.replace(/Related Past Conversations(?: & Files)?:[\s\S]*?-----------------------/g, '');
        text = text.replace(/Selected Reference Q&A:[\s\S]*?-----------------------/g, '');
        text = text.replace(/# 🧠 MemLite: Compiled Chat Context Reference[\s\S]*?(?:---\s*\n*|$)/g, '');
        text = text.replace(/# ⚡ MEMLITE AGENT RECOVERY CAPSULE[\s\S]*?(?:---\s*\n*|$)/g, '');

        return text.trim();
    }

    private cleanAnswer(rawAnswer: string): string {
        let cleaned = rawAnswer.replace(/<thinking>[\s\S]*?<\/thinking>/g, '');
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

    private detectProjectName(lines: string[], toolCalls: any[], defaultName?: string): string {
        const extractFromPath = (rawPath: string): string | null => {
            if (!rawPath || typeof rawPath !== 'string') return null;
            const res = this.extractProjectAndRelPath(rawPath);
            return (res.project && res.project !== 'General') ? res.project : null;
        };

        // 1. Highest priority: Check tool calls for absolute project paths
        if (Array.isArray(toolCalls)) {
            for (const tc of toolCalls) {
                const args = tc.args || tc.parameters || {};
                const candidates = [
                    args.Cwd,
                    args.TargetFile,
                    args.SearchPath,
                    args.AbsolutePath,
                    args.DirectoryPath,
                    args.CommandLine,
                    args.filePath
                ];
                for (const cand of candidates) {
                    if (typeof cand === 'string') {
                        const found = extractFromPath(cand);
                        if (found) return found;
                    }
                }
            }
        }

        // 2. Second priority: Check Active Document and Workspace Mapping in USER_INPUT / SYSTEM metadata
        if (Array.isArray(lines) && lines.length > 0) {
            for (let i = 0; i < Math.min(lines.length, 5); i++) {
                try {
                    const obj = JSON.parse(lines[i]);
                    const content = obj.content || '';
                    if (content) {
                        // Check Active Document
                        const mDoc = content.match(/Active Document:\s*([^\r\n]+)/i);
                        if (mDoc) {
                            const rawDoc = mDoc[1].replace(/\(LANGUAGE_[^)]+\)/, '').trim();
                            const found = extractFromPath(rawDoc);
                            if (found) return found;
                        }

                        // Check Workspace mapping in <user_information> (e.g. d:\CM\optimus -> Ritiky23/optimus)
                        const mWs = content.match(/([a-zA-Z]:[\\/][^\r\n\t\s<>]+)\s*->/);
                        if (mWs) {
                            const found = extractFromPath(mWs[1].trim());
                            if (found) return found;
                        }

                        // Check Other open documents list
                        const mOther = content.match(/-\s*([a-zA-Z]:[\\/][^\r\n\t\s()]+\.[a-zA-Z0-9]+)/);
                        if (mOther) {
                            const found = extractFromPath(mOther[1].trim());
                            if (found) return found;
                        }
                    }
                } catch (_) {}
            }
        }

        // 3. Third priority: Check assistant answers and clean user requests (NEVER check entire ADDITIONAL_METADATA)
        if (Array.isArray(lines) && lines.length > 0) {
            for (let i = 0; i < lines.length; i++) {
                try {
                    const obj = JSON.parse(lines[i]);
                    // Check tool calls inside line if present
                    if (obj.tool_calls && Array.isArray(obj.tool_calls)) {
                        for (const tc of obj.tool_calls) {
                            const args = tc.args || tc.parameters || {};
                            for (const k of Object.keys(args)) {
                                if (typeof args[k] === 'string') {
                                    const found = extractFromPath(args[k]);
                                    if (found) return found;
                                }
                            }
                        }
                    }
                    // Check clean user prompt or planner response content
                    if (obj.type === 'USER_INPUT' && obj.content) {
                        const cleanP = this.cleanPrompt(obj.content);
                        const found = extractFromPath(cleanP);
                        if (found) return found;
                    } else if (obj.type === 'PLANNER_RESPONSE' && obj.content) {
                        const cleanA = this.cleanAnswer(obj.content);
                        const found = extractFromPath(cleanA);
                        if (found) return found;
                    }
                } catch (_) {}
            }
        }

        if (defaultName && defaultName !== 'General' && defaultName !== 'Default Project') {
            return defaultName === 'memlite-extension' ? 'memlite' : defaultName;
        }

        return "General";
    }

    public stop() {
        if (this.watcher) {
            this.watcher.close();
            this.watcher = null;
        }
    }
}
