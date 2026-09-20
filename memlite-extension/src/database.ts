import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as os from 'os';

export interface InvariantItem {
    id: string;
    ruleType: "NEGATIVE_CONSTRAINT" | "ARCHITECTURAL_DECISION" | "PREFERENCE";
    content: string;
    scope: string; // "global" | "file:<path>"
    status: "ACTIVE" | "SUPERSEDED" | "REVOKED";
    supersededBy?: string;
    revokedReason?: string;
    createdAt: string;
}

export interface FileActionItem {
    id: string;
    stepIndex: number;
    filePath: string;
    action: "created" | "modified" | "deleted";
    fileHashAfter: string;
    intent: string;
    diffSummary: string;
    linesAdded: number;
    linesRemoved: number;
    timestamp: string;
}

export interface MemoryNode {
    id: string;
    question: string;
    answer: string;
    timestamp: string;
    project: string;
    fileRef?: string;
    filesTouched?: string[];
    contextType?: "decision" | "code_change" | "milestone" | "discussion";
    tags: string[];
    conversationId?: string;
    stepIndex?: number;
}

export interface Relationship {
    source: string;
    target: string;
    type: string;
}

export interface DatabaseSchema {
    nodes: MemoryNode[];
    relationships: Relationship[];
    invariants: InvariantItem[];
    fileActions: FileActionItem[];
    sessionTitles?: Record<string, string>;
    sessionProjects?: Record<string, string>;
}

export class MemoryDatabase {
    private dbPath: string;
    private data: DatabaseSchema;
    private indexedSteps: Set<string> = new Set();
    private stepNodeMap: Map<string, MemoryNode> = new Map();
    private idNodeMap: Map<string, MemoryNode> = new Map();
    private fileRefNodesMap: Map<string, MemoryNode[]> = new Map();
    private saveTimeout: NodeJS.Timeout | null = null;

    constructor(storagePath: string) {
        if (!fs.existsSync(storagePath)) {
            fs.mkdirSync(storagePath, { recursive: true });
        }
        this.dbPath = path.join(storagePath, 'memlite_db.json');
        this.data = { nodes: [], relationships: [], invariants: [], fileActions: [], sessionTitles: {}, sessionProjects: {} };
        this.load();
    }

    private safeJsonParse(raw: string): any {
        try {
            return JSON.parse(raw);
        } catch (e) {
            try {
                const cleaned = raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
                return JSON.parse(cleaned);
            } catch (e2) {
                console.error("Safe JSON parse error:", e2);
                return null;
            }
        }
    }

    private load() {
        if (fs.existsSync(this.dbPath)) {
            let loaded = false;
            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    const raw = fs.readFileSync(this.dbPath, 'utf8');
                    if (raw.trim().length > 0) {
                        const parsed = this.safeJsonParse(raw);
                        if (parsed) {
                            this.data = parsed;
                            loaded = true;
                            break;
                        }
                    }
                } catch (e) {
                    if (attempt < 2) {
                        const start = Date.now();
                        while (Date.now() - start < 50) {}
                    }
                }
            }
            if (!loaded) {
                const bakPath = this.dbPath + '.bak';
                if (fs.existsSync(bakPath)) {
                    try {
                        const rawBak = fs.readFileSync(bakPath, 'utf8');
                        const parsedBak = this.safeJsonParse(rawBak);
                        if (parsedBak) {
                            this.data = parsedBak;
                            loaded = true;
                        }
                    } catch (_) {}
                }
            }
            if (!loaded) {
                this.data = { nodes: [], relationships: [], invariants: [], fileActions: [], sessionTitles: {}, sessionProjects: {} };
            }
            if (!this.data.nodes) { this.data.nodes = []; }
            if (!this.data.relationships) { this.data.relationships = []; }
            if (!this.data.invariants) { this.data.invariants = []; }
            if (!this.data.fileActions) { this.data.fileActions = []; }
            if (!this.data.sessionTitles) { this.data.sessionTitles = {}; }
            if (!this.data.sessionProjects) { this.data.sessionProjects = {}; }
        } else {
            this.save(true);
        }

        this.sanitizeDatabase();

        this.indexedSteps.clear();
        this.stepNodeMap.clear();
        this.idNodeMap.clear();
        this.fileRefNodesMap.clear();

        this.data.nodes.forEach(n => {
            if (n.id) {
                this.idNodeMap.set(n.id, n);
            }
            if (n.conversationId && n.stepIndex !== undefined) {
                const stepKey = `${n.conversationId}_${n.stepIndex}`;
                this.indexedSteps.add(stepKey);
                this.stepNodeMap.set(stepKey, n);
            }
            if (n.tags) {
                n.tags.forEach(t => {
                    if (t.includes('_')) {
                        this.indexedSteps.add(t);
                        if (!this.stepNodeMap.has(t)) {
                            this.stepNodeMap.set(t, n);
                        }
                    }
                });
            }
            if (n.fileRef) {
                const existing = this.fileRefNodesMap.get(n.fileRef) || [];
                existing.push(n);
                this.fileRefNodesMap.set(n.fileRef, existing);
            }
            if (n.conversationId && this.data.sessionProjects && this.data.sessionProjects[n.conversationId]) {
                n.project = this.data.sessionProjects[n.conversationId];
            }
        });
    }

    private sanitizeDatabase() {
        if (!this.data.nodes || !Array.isArray(this.data.nodes)) return;

        const convGroups: { [cId: string]: MemoryNode[] } = {};
        this.data.nodes.forEach(n => {
            // Clean bogus fileRef if node touched no files and fileRef looks like IDE active editor leak
            if (n.fileRef) {
                if (n.fileRef.startsWith('original_') || 
                    ((!n.filesTouched || n.filesTouched.length === 0) && n.fileRef.includes('memlite-extension'))) {
                    n.fileRef = undefined;
                }
            }

            const cId = n.conversationId || 'unknown';
            if (!convGroups[cId]) convGroups[cId] = [];
            convGroups[cId].push(n);
        });

        // Re-evaluate sessionProjects for sessions without custom user titles
        Object.keys(convGroups).forEach(cId => {
            const hasUserTitle = this.data.sessionTitles && this.data.sessionTitles[cId];
            if (hasUserTitle) return; // Respect user customizations

            const group = convGroups[cId];
            const projectVotes: { [p: string]: number } = {};

            for (const n of group) {
                const detected = this.correctProject(n);
                if (detected && detected !== 'General' && detected !== 'Default Project') {
                    projectVotes[detected] = (projectVotes[detected] || 0) + 1;
                }
            }

            const sorted = Object.entries(projectVotes).sort((a, b) => b[1] - a[1]);
            const existing = this.data.sessionProjects?.[cId];
            const finalProject = sorted.length > 0 
                ? sorted[0][0] 
                : (existing && existing !== 'Default Project' ? existing : 'General');

            if (!this.data.sessionProjects) this.data.sessionProjects = {};
            this.data.sessionProjects[cId] = finalProject;
            group.forEach(n => {
                n.project = finalProject;
            });
        });

        // Sync historical timestamps and accurate project detection from brain directory
        try {
            const homeDir = os.homedir() || process.env.USERPROFILE || process.env.HOME || '';
            const brainPath = path.join(homeDir, '.gemini', 'antigravity-ide', 'brain');
            if (fs.existsSync(brainPath)) {
                Object.keys(convGroups).forEach(cId => {
                    const tPath = path.join(brainPath, cId, '.system_generated', 'logs', 'transcript.jsonl');
                    if (fs.existsSync(tPath)) {
                        try {
                            const rawContent = fs.readFileSync(tPath, 'utf8');
                            const lines = rawContent.split('\n').filter(l => l.trim().length > 0);
                            if (lines.length > 0) {
                                try {
                                    const obj = JSON.parse(lines[0]);
                                    if (obj.created_at) {
                                        convGroups[cId].forEach(n => {
                                            n.timestamp = obj.created_at;
                                        });
                                    }
                                } catch (_) {}

                                // Check if we can determine a better project from transcript lines if not customized by user
                                const hasUserTitle = this.data.sessionTitles && this.data.sessionTitles[cId];
                                if (!hasUserTitle) {
                                    const detected = this.detectProjectFromTranscriptLines(lines);
                                    if (detected && detected !== 'General' && detected !== 'Default Project') {
                                        if (!this.data.sessionProjects) this.data.sessionProjects = {};
                                        this.data.sessionProjects[cId] = detected;
                                        convGroups[cId].forEach(n => {
                                            n.project = detected;
                                        });
                                    }
                                }
                            }
                        } catch (_) {}
                    }
                });
            }
        } catch (_) {}
    }

    public getSessionProject(conversationId: string): string | undefined {
        return this.data.sessionProjects ? this.data.sessionProjects[conversationId] : undefined;
    }

    public correctProject(node: MemoryNode): string {
        // IMPORTANT: Do NOT read from sessionProjects cache here — caller decides that.
        // This function ONLY uses file paths and text signatures for detection.
        const textToScan = [
            node.fileRef || '',
            ...(node.filesTouched || []),
            // Only scan short answer/question snippets to avoid false positives from conversation context
            (node.answer || '').substring(0, 500),
            node.question || ''
        ].join(' ').replace(/\\/g, '/');

        // High-confidence workspace signatures (path-based only)
        if (textToScan.includes('godseye_frontend/client') || textToScan.includes('/client/src') || textToScan.includes('/client/')) {
            return 'client';
        }
        if (textToScan.includes('My_Dream/memlite') || textToScan.includes('/memlite-extension') || textToScan.includes('/memlite/')) {
            return 'memlite';
        }
        if (textToScan.includes('CM/optimus') || textToScan.includes('/optimus/')) {
            return 'optimus';
        }

        const blacklist = new Set([
            'c', 'd', 'e', 'cm', 'users', 'lenovo', 'appdata', 'local', 'programs', 'microsoft',
            'windows', 'antigravity-ide', 'antigravity', 'gemini', 'brain', 'system_generated',
            'logs', '.system_generated', 'scratch', 'dashboard', 'audit', 'botconfigs', 'build',
            'out', 'dist', 'node_modules', 'public', 'src', 'components', 'hooks', 'pages', 'tests',
            'media', 'temp', 'tmp', 'general', 'default project', 'workspace', 'home'
        ]);

        // Only detect from absolute paths in file refs (highest confidence)
        const filePaths = [node.fileRef || '', ...(node.filesTouched || [])].join(' ').replace(/\\/g, '/');
        const m = filePaths.matchAll(/([a-zA-Z]:\/[a-zA-Z0-9_\-./]+)/g);
        for (const match of m) {
            const parts = match[1].split('/').filter(Boolean);
            for (let i = parts.length - 1; i >= 0; i--) {
                const seg = parts[i].trim();
                const low = seg.toLowerCase();
                const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg);
                if (!seg.includes('.') && !seg.includes(':') && seg.length > 2 && !blacklist.has(low) && !isUuid) {
                    return seg === 'memlite-extension' ? 'memlite' : seg;
                }
            }
        }

        // No path-based signals found — return General (do NOT fall back to node.project)
        return "General";
    }

    // Update the auto-detected project for a session (will not override user-renamed sessions)
    public updateAutoDetectedProject(conversationId: string, project: string): boolean {
        if (!conversationId || !project || project === 'General' || project === 'Default Project') return false;
        if (!this.data.sessionProjects) this.data.sessionProjects = {};
        // Never override a user-set custom title's associated project
        const hasUserTitle = this.data.sessionTitles && this.data.sessionTitles[conversationId];
        if (hasUserTitle) return false;
        const existing = this.data.sessionProjects[conversationId];
        if (existing !== project) {
            this.data.sessionProjects[conversationId] = project;
            // Also update all nodes in this session
            this.data.nodes.forEach(n => {
                if (n.conversationId === conversationId) {
                    n.project = project;
                }
            });
            return true;
        }
        return false;
    }

    public detectProjectFromTranscriptLines(lines: string[]): string {
        const blacklist = new Set([
            'c', 'd', 'e', 'cm', 'users', 'lenovo', 'appdata', 'local', 'programs', 'microsoft',
            'windows', 'antigravity-ide', 'antigravity', 'gemini', 'brain', 'system_generated',
            'logs', '.system_generated', 'scratch', 'dashboard', 'audit', 'botconfigs', 'build',
            'out', 'dist', 'node_modules', 'public', 'src', 'components', 'hooks', 'pages', 'tests',
            'media', 'temp', 'tmp', 'general', 'default project', 'workspace', 'home'
        ]);

        const extractFromText = (text: string): string | null => {
            if (!text) return null;
            const norm = text.replace(/\\/g, '/');
            if (norm.includes('godseye_frontend/client') || norm.includes('/client/src') || norm.includes('/client/')) return 'client';
            if (norm.includes('My_Dream/memlite') || norm.includes('/memlite-extension') || norm.includes('/memlite/')) return 'memlite';
            if (norm.includes('CM/optimus') || norm.includes('/optimus/') || norm.includes('optimus')) return 'optimus';

            const matches = norm.matchAll(/([a-zA-Z]:\/[a-zA-Z0-9_\-./]+)/g);
            for (const match of matches) {
                const parts = match[1].split('/').filter(Boolean);
                for (let i = parts.length - 1; i >= 0; i--) {
                    const seg = parts[i].trim();
                    const low = seg.toLowerCase();
                    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg);
                    if (!seg.includes('.') && !seg.includes(':') && seg.length > 2 && !blacklist.has(low) && !isUuid) {
                        return seg === 'memlite-extension' ? 'memlite' : seg;
                    }
                }
            }
            return null;
        };

        // 1. Check Active Document, workspace URI mappings in initial lines
        for (let i = 0; i < Math.min(lines.length, 5); i++) {
            try {
                const obj = JSON.parse(lines[i]);
                const content = obj.content || '';
                if (content) {
                    const mDoc = content.match(/Active Document:\s*([^\r\n]+)/i);
                    if (mDoc) {
                        const rawDoc = mDoc[1].replace(/\(LANGUAGE_[^)]+\)/, '').trim();
                        const found = extractFromText(rawDoc);
                        if (found) return found;
                    }
                    const mWs = content.match(/([a-zA-Z]:[\\/][^\r\n\t\s<>]+)\s*->/);
                    if (mWs) {
                        const found = extractFromText(mWs[1].trim());
                        if (found) return found;
                    }
                }
            } catch (_) {}
        }

        // 2. Check tool calls and general lines
        const checkIndices = new Set<number>();
        for (let i = 0; i < Math.min(lines.length, 40); i++) checkIndices.add(i);
        for (let i = Math.max(0, lines.length - 15); i < lines.length; i++) checkIndices.add(i);

        for (const idx of checkIndices) {
            const line = lines[idx];
            let text = '';
            try {
                const obj = JSON.parse(line);
                text = (obj.content || '') + ' ' + (obj.tool_calls ? JSON.stringify(obj.tool_calls) : '');
            } catch (_) {
                text = line;
            }

            const found = extractFromText(text);
            if (found) return found;
        }

        return "General";
    }

    public save(immediate: boolean = false) {
        if (immediate) {
            if (this.saveTimeout) {
                clearTimeout(this.saveTimeout);
                this.saveTimeout = null;
            }
            this.writeDatabaseToDisk();
            return;
        }

        if (!this.saveTimeout) {
            this.saveTimeout = setTimeout(() => {
                this.saveTimeout = null;
                this.writeDatabaseToDisk();
            }, 500);
        }
    }

    public flush() {
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
            this.saveTimeout = null;
            this.writeDatabaseToDisk();
        }
    }

    private writeDatabaseToDisk() {
        try {
            const dir = path.dirname(this.dbPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            const tempPath = `${this.dbPath}.${process.pid}.${Date.now()}.${Math.random().toString(36).substring(2, 8)}.tmp`;
            const content = JSON.stringify(this.data, null, 2);
            fs.writeFileSync(tempPath, content, 'utf8');
            try {
                fs.renameSync(tempPath, this.dbPath);
            } catch (renameErr) {
                fs.copyFileSync(tempPath, this.dbPath);
                try { fs.unlinkSync(tempPath); } catch (_) {}
            }
            try {
                fs.copyFileSync(this.dbPath, this.dbPath + '.bak');
            } catch (_) {}
        } catch (e) {
            console.error("Failed to save MemLite database:", e);
        }
    }

    public upsertRecord(
        question: string,
        answer: string,
        project: string,
        fileRef?: string,
        manualTags: string[] = [],
        conversationId?: string,
        stepIndex?: number,
        filesTouched?: string[],
        contextType?: "decision" | "code_change" | "milestone" | "discussion",
        recordTimestamp?: string
    ): { node: MemoryNode; isNew: boolean; isUpdated: boolean } {
        const extractedTags = this.extractTags(question + " " + answer);
        const uniqueTags = Array.from(new Set([...manualTags, ...extractedTags]))
            .map(t => t.toLowerCase())
            .filter(t => t.length > 2 && !this.isStopword(t));

        // Determine context type cleanly
        if (!contextType) {
            if (filesTouched && filesTouched.length > 0) {
                contextType = "code_change";
            } else if (uniqueTags.includes("decision") || uniqueTags.includes("rule")) {
                contextType = "decision";
            } else {
                contextType = "discussion";
            }
        }

        const stepKey = (conversationId && stepIndex !== undefined) ? `${conversationId}_${stepIndex}` : null;
        
        let existingNode: MemoryNode | undefined;
        if (stepKey) {
            existingNode = this.stepNodeMap.get(stepKey);
        }

        if (existingNode) {
            const currentFiles = (existingNode.filesTouched || []).slice().sort().join(',');
            const newFiles = (filesTouched || []).slice().sort().join(',');
            
            // Check if project needs correction (wrong auto-detection from previous scan)
            const hasNoUserRename = !this.data.sessionTitles?.[conversationId || ''];
            const projectNeedsUpdate = project && project !== 'General' && project !== 'Default Project' &&
                                       project !== existingNode.project && hasNoUserRename;

            const isChanged = existingNode.answer !== answer || 
                              existingNode.question !== question ||
                              currentFiles !== newFiles ||
                              !!projectNeedsUpdate;
            
            if (isChanged) {
                existingNode.question = question;
                existingNode.answer = answer;
                if (recordTimestamp) {
                    existingNode.timestamp = recordTimestamp;
                }
                if (projectNeedsUpdate) {
                    // Correct the wrong project
                    existingNode.project = project;
                    if (conversationId) {
                        if (!this.data.sessionProjects) this.data.sessionProjects = {};
                        this.data.sessionProjects[conversationId] = project;
                    }
                } else if (project && project !== "Default Project" && project !== "General") {
                    existingNode.project = project;
                } else if (!existingNode.project) {
                    existingNode.project = "Default Project";
                }
                if (fileRef) existingNode.fileRef = fileRef;
                existingNode.filesTouched = Array.from(new Set([...(existingNode.filesTouched || []), ...(filesTouched || [])]));
                existingNode.contextType = contextType;
                existingNode.tags = Array.from(new Set([...existingNode.tags, ...uniqueTags]));
                this.save(false);
                return { node: existingNode, isNew: false, isUpdated: true };
            }
            if (recordTimestamp && (!existingNode.timestamp || existingNode.timestamp > recordTimestamp)) {
                existingNode.timestamp = recordTimestamp;
            }
            return { node: existingNode, isNew: false, isUpdated: false };
        }

        const id = crypto.randomUUID();
        const newNode: MemoryNode = {
            id,
            question,
            answer,
            timestamp: recordTimestamp || new Date().toISOString(),
            project: project || "Default Project",
            fileRef,
            filesTouched: filesTouched || [],
            contextType,
            tags: uniqueTags,
            conversationId,
            stepIndex
        };

        this.data.nodes.push(newNode);
        this.idNodeMap.set(id, newNode);
        if (stepKey) {
            this.indexedSteps.add(stepKey);
            this.stepNodeMap.set(stepKey, newNode);
        }
        manualTags.forEach(t => {
            if (t.includes('_')) {
                this.indexedSteps.add(t);
                if (!this.stepNodeMap.has(t)) {
                    this.stepNodeMap.set(t, newNode);
                }
            }
        });
        if (fileRef) {
            const list = this.fileRefNodesMap.get(fileRef) || [];
            list.push(newNode);
            this.fileRefNodesMap.set(fileRef, list);
        }
        this.createAutoRelationships(newNode);
        this.save(false);
        return { node: newNode, isNew: true, isUpdated: false };
    }

    public addRecord(
        question: string,
        answer: string,
        project: string,
        fileRef?: string,
        manualTags: string[] = [],
        conversationId?: string,
        stepIndex?: number,
        filesTouched?: string[],
        contextType?: "decision" | "code_change" | "milestone" | "discussion"
    ): MemoryNode {
        return this.upsertRecord(
            question,
            answer,
            project,
            fileRef,
            manualTags,
            conversationId,
            stepIndex,
            filesTouched,
            contextType
        ).node;
    }

    public hasStep(stepKey: string): boolean {
        return this.indexedSteps.has(stepKey);
    }

    // --- Invariants (Tier 0) Methods ---
    public addInvariant(
        content: string,
        ruleType: "NEGATIVE_CONSTRAINT" | "ARCHITECTURAL_DECISION" | "PREFERENCE" = "NEGATIVE_CONSTRAINT",
        scope: string = "global",
        supersedesId?: string
    ): InvariantItem {
        const id = crypto.randomUUID().substring(0, 8);
        const newRule: InvariantItem = {
            id,
            ruleType,
            content: content.trim(),
            scope: scope || "global",
            status: "ACTIVE",
            createdAt: new Date().toISOString()
        };

        if (supersedesId) {
            const old = this.data.invariants.find(r => r.id === supersedesId);
            if (old) {
                old.status = "SUPERSEDED";
                old.supersededBy = id;
            }
        }

        this.data.invariants.push(newRule);
        this.save();
        return newRule;
    }

    public revokeInvariant(ruleId: string, reason: string = ""): InvariantItem | null {
        const rule = this.data.invariants.find(r => r.id === ruleId);
        if (!rule) return null;
        rule.status = "REVOKED";
        rule.revokedReason = reason;
        this.save();
        return rule;
    }

    public getActiveInvariants(scope?: string): InvariantItem[] {
        return this.data.invariants.filter(r => {
            if (r.status !== "ACTIVE") return false;
            if (scope && r.scope !== "global" && r.scope !== scope) return false;
            return true;
        });
    }

    public renameSession(conversationId: string, newTitle?: string, newProject?: string) {
        if (!this.data.sessionTitles) {
            this.data.sessionTitles = {};
        }
        if (!this.data.sessionProjects) {
            this.data.sessionProjects = {};
        }

        if (newTitle !== undefined) {
            const trimmed = newTitle.trim();
            if (trimmed) {
                this.data.sessionTitles[conversationId] = trimmed;
            } else {
                delete this.data.sessionTitles[conversationId];
            }
        }

        if (newProject !== undefined) {
            const trimmedProj = newProject.trim();
            if (trimmedProj) {
                this.data.sessionProjects[conversationId] = trimmedProj;
                this.data.nodes.forEach(n => {
                    if (n.conversationId === conversationId) {
                        n.project = trimmedProj;
                    }
                });
            } else {
                delete this.data.sessionProjects[conversationId];
            }
        }
        this.save(true);
    }

    public mergeFrom(sourceDbPath: string): number {
        try {
            if (!fs.existsSync(sourceDbPath)) return 0;
            const raw = fs.readFileSync(sourceDbPath, 'utf8');
            const parsed = JSON.parse(raw);
            let mergedCount = 0;

            if (parsed.nodes && Array.isArray(parsed.nodes)) {
                parsed.nodes.forEach((n: MemoryNode) => {
                    const stepKey = (n.conversationId && n.stepIndex !== undefined) ? `${n.conversationId}_${n.stepIndex}` : null;
                    const exists = this.data.nodes.some(existing => 
                        (n.conversationId && existing.conversationId === n.conversationId && existing.stepIndex === n.stepIndex) ||
                        existing.id === n.id
                    );
                    if (!exists) {
                        this.data.nodes.push(n);
                        if (stepKey) this.indexedSteps.add(stepKey);
                        mergedCount++;
                    }
                });
            }

            if (parsed.sessionTitles && typeof parsed.sessionTitles === 'object') {
                this.data.sessionTitles = { ...parsed.sessionTitles, ...this.data.sessionTitles };
            }
            if (parsed.sessionProjects && typeof parsed.sessionProjects === 'object') {
                this.data.sessionProjects = { ...parsed.sessionProjects, ...this.data.sessionProjects };
            }
            if (parsed.invariants && Array.isArray(parsed.invariants)) {
                parsed.invariants.forEach((inv: InvariantItem) => {
                    if (!this.data.invariants.some(i => i.id === inv.id)) {
                        this.data.invariants.push(inv);
                    }
                });
            }
            if (parsed.fileActions && Array.isArray(parsed.fileActions)) {
                parsed.fileActions.forEach((fa: FileActionItem) => {
                    if (!this.data.fileActions.some(f => f.id === fa.id)) {
                        this.data.fileActions.push(fa);
                    }
                });
            }

            if (mergedCount > 0) {
                this.save();
            }
            return mergedCount;
        } catch (e) {
            console.error(`Failed to merge database from ${sourceDbPath}:`, e);
            return 0;
        }
    }

    // --- File Provenance (Tier 1 & 2) Methods ---
    public recordFileAction(actionItem: FileActionItem) {
        const existingIdx = this.data.fileActions.findIndex(fa => fa.id === actionItem.id);
        if (existingIdx !== -1) {
            this.data.fileActions[existingIdx] = actionItem;
        } else {
            this.data.fileActions.push(actionItem);
        }
    }

    public checkFileFreshness(workspaceRoot: string): { stale: { file: string; warning: string }[]; freshCount: number } {
        const stale: { file: string; warning: string }[] = [];
        let freshCount = 0;

        // Group by normalized file path to get latest recorded hash
        const latestByFile: { [normKey: string]: { originalPath: string; action: FileActionItem } } = {};
        this.data.fileActions.forEach(fa => {
            const normKey = fa.filePath.replace(/\\/g, '/').toLowerCase();
            latestByFile[normKey] = { originalPath: fa.filePath, action: fa };
        });

        Object.keys(latestByFile).forEach(normKey => {
            const { originalPath, action } = latestByFile[normKey];
            const cleanRelPath = originalPath.replace(/\\/g, '/');
            const absPath = path.isAbsolute(originalPath) 
                ? originalPath 
                : path.join(workspaceRoot, originalPath);

            if (!fs.existsSync(absPath)) {
                stale.push({ file: cleanRelPath, warning: `⚠️ MISSING: '${cleanRelPath}' deleted on disk.` });
                return;
            }
            try {
                const rawContent = fs.readFileSync(absPath, 'utf8');
                const normalized = rawContent.replace(/\r\n/g, '\n').trim();
                const currentHash = crypto.createHash('sha256').update(normalized, 'utf8').digest('hex').substring(0, 16);
                if (currentHash !== action.fileHashAfter) {
                    stale.push({ file: cleanRelPath, warning: `⚠️ STALE: '${cleanRelPath}' modified on disk since step ${action.stepIndex}.` });
                } else {
                    freshCount++;
                }
            } catch (e) {
                // Ignore inaccessible files
            }
        });

        return { stale, freshCount };
    }

    public generateRehydrateCapsule(workspaceRoot?: string): string {
        let md = `# ⚡ MEMLITE AGENT RECOVERY CAPSULE\nGenerated: ${new Date().toISOString()}\n\n`;

        // Tier 0: Invariants
        const activeInvariants = this.getActiveInvariants();
        md += `## 🔒 Tier 0: Invariants & Constraints (Verbatim Contract)\n`;
        if (activeInvariants.length === 0) {
            md += `No active constraints registered.\n\n`;
        } else {
            activeInvariants.forEach(inv => {
                const scopeBadge = inv.scope !== "global" ? ` (${inv.scope})` : "";
                md += `- [${inv.ruleType}] ${inv.content}${scopeBadge} [id:${inv.id}]\n`;
            });
            md += `\n`;
        }

        // Tier 1: Causal File Provenance (Last 5 actions)
        const recentActions = this.data.fileActions.slice(-5);
        md += `## ⚡ Tier 1: Causal File Provenance (Recent Action Timeline)\n`;
        if (recentActions.length === 0) {
            md += `No recent file modifications recorded.\n\n`;
        } else {
            recentActions.forEach(fa => {
                md += `- Step ${fa.stepIndex} | \`${fa.filePath}\` [${fa.action.toUpperCase()}] (SHA: ${fa.fileHashAfter})\n`;
                md += `  Intent: "${fa.intent}"\n`;
                if (fa.diffSummary.startsWith("[LARGE DIFF")) {
                    md += `  ${fa.diffSummary}\n`;
                } else {
                    const firstLines = fa.diffSummary.split('\n').slice(0, 5).join('\n    ');
                    md += `  Diff:\n    ${firstLines}\n`;
                }
            });
            md += `\n`;
        }

        // Tier 2: Freshness Reality Check
        if (workspaceRoot && fs.existsSync(workspaceRoot)) {
            const freshness = this.checkFileFreshness(workspaceRoot);
            md += `## 🛡️ Tier 2: Disk Reality Check (Freshness Verification)\n`;
            if (freshness.stale.length === 0) {
                md += `✅ All ${freshness.freshCount} tracked workspace files match recorded memory hashes.\n\n`;
            } else {
                freshness.stale.forEach(s => {
                    md += `- ${s.warning} Inspect disk before editing.\n`;
                });
                md += `\n`;
            }
        }

        return md;
    }

    private extractTags(text: string): string[] {
        const words = text.match(/[a-zA-Z]{3,20}/g) || [];
        const programmingKeywords = [
            "python", "react", "fastapi", "postgres", "sqlite", "javascript", "typescript",
            "rust", "git", "api", "database", "query", "server", "model", "index", "faiss",
            "node", "embeddings", "decision", "rule", "architecture"
        ];
        return words.filter(word => {
            const lowWord = word.toLowerCase();
            return programmingKeywords.includes(lowWord) || (word[0] === word[0].toUpperCase() && word.length > 3);
        });
    }

    private isStopword(word: string): boolean {
        const stopwords = ["the", "and", "a", "for", "with", "that", "this", "from", "you", "your", "what", "how", "why"];
        return stopwords.includes(word);
    }

    private createAutoRelationships(node: MemoryNode) {
        if (!node.fileRef) return;
        const matching = (this.fileRefNodesMap.get(node.fileRef) || []).filter(other => other.id !== node.id);
        matching.slice(-5).forEach(other => {
            this.data.relationships.push({
                source: node.id,
                target: other.id,
                type: "same_file"
            });
        });
    }

    public getGraphData(): { nodes: any[]; links: any[]; invariants: InvariantItem[]; fileActions: FileActionItem[] } {
        const visualNodes: any[] = [];
        const visualLinks: any[] = [];

        const convGroups: { [convId: string]: MemoryNode[] } = {};
        this.data.nodes.forEach(n => {
            const cId = n.conversationId || "general_session";
            if (!convGroups[cId]) {
                convGroups[cId] = [];
            }
            convGroups[cId].push(n);
        });

        // Sort conversations by latest activity/timestamp descending (newest on top)
        const sortedConvIds = Object.keys(convGroups).sort((a, b) => {
            const nodesA = convGroups[a];
            const nodesB = convGroups[b];
            const timeA = nodesA.reduce((max, n) => (n.timestamp && n.timestamp > max) ? n.timestamp : max, '');
            const timeB = nodesB.reduce((max, n) => (n.timestamp && n.timestamp > max) ? n.timestamp : max, '');
            return timeB.localeCompare(timeA);
        });

        sortedConvIds.forEach((cId, chatIndex) => {
            const group = convGroups[cId];
            group.sort((a, b) => (a.stepIndex ?? 0) - (b.stepIndex ?? 0));
            if (group.length === 0) return;

            const firstNode = group[0];
            const hasUserTitle = this.data.sessionTitles?.[cId];
            const cachedProject = this.data.sessionProjects?.[cId];
            let project: string | undefined = hasUserTitle ? cachedProject : undefined;

            // Always run path-based vote detection (correctProject now ONLY uses file paths, not node.project)
            if (!project || project === 'General' || project === 'Default Project') {
                const projectVotes: { [p: string]: number } = {};
                for (const n of group) {
                    const detected = this.correctProject(n);
                    if (detected && detected !== 'General' && detected !== 'Default Project') {
                        projectVotes[detected] = (projectVotes[detected] || 0) + 1;
                    }
                }
                const sortedVotes = Object.entries(projectVotes).sort((a, b) => b[1] - a[1]);
                if (sortedVotes.length > 0) {
                    project = sortedVotes[0][0];
                }
            }

            // If still no project from file paths, use the cached value (could be from transcript workspace detection)
            if (!project || project === 'General' || project === 'Default Project') {
                project = cachedProject || 'General';
            }

            // Update the cache whenever we have a confident project (without overriding user renames)
            if (project && project !== 'General' && project !== 'Default Project' && !hasUserTitle) {
                if (!this.data.sessionProjects) this.data.sessionProjects = {};
                if (this.data.sessionProjects[cId] !== project) {
                    this.data.sessionProjects[cId] = project;
                }
            }

            group.forEach(n => {
                n.project = project;
            });
            const latestTimestamp = group.reduce((max, n) => (n.timestamp && n.timestamp > max) ? n.timestamp : max, firstNode.timestamp || '');
            const sessionNum = sortedConvIds.length - chatIndex;
            const customTitle = this.data.sessionTitles ? this.data.sessionTitles[cId] : undefined;
            const chatLabel = customTitle ? `Session ${sessionNum}: ${customTitle}` : `Session ${sessionNum}`;

            let chatTitle = customTitle || firstNode.question.replace(/\n/g, ' ').trim();
            if (!customTitle && chatTitle.length > 40) {
                chatTitle = chatTitle.substring(0, 37) + "...";
            }
            const fullTitle = `💬 "${chatTitle}"`;
            const chatId = `chat_${cId}`;

            visualNodes.push({
                id: chatId,
                label: chatLabel,
                type: "chat_session",
                category: "Session",
                fullTitle: fullTitle,
                details: {
                    conversationId: cId,
                    project: project,
                    sessionNumber: sessionNum,
                    customTitle: customTitle,
                    timestamp: latestTimestamp,
                    stepCount: group.length
                } as any
            });

            group.forEach((n, index) => {
                // Extract files from answer if filesTouched is empty (backfill for older sessions)
                const extractedFilesFromAnswer: string[] = [];
                if (n.answer) {
                    const linkMatches = n.answer.matchAll(/\[([a-zA-Z0-9_\-./\\]+\.[a-zA-Z0-9]+)\]\(file:\/\/\/[^)]*\)/g);
                    for (const m of linkMatches) {
                        extractedFilesFromAnswer.push(m[1]);
                    }
                    const codeActionMatches = n.answer.matchAll(/\*\*(?:Modified|Created) File:\*\*\s*`([^`]+)`/g);
                    for (const m of codeActionMatches) {
                        extractedFilesFromAnswer.push(m[1]);
                    }
                    const multiEditMatches = n.answer.matchAll(/\*\*Multi-line Edit in File:\*\*\s*`([^`]+)`/g);
                    for (const m of multiEditMatches) {
                        extractedFilesFromAnswer.push(m[1]);
                    }
                }

                const combinedFilesTouched = Array.from(new Set([
                    ...(n.filesTouched || []),
                    ...extractedFilesFromAnswer
                ]));

                // Category is clean and context-driven
                let category = "Discussion";
                if (n.contextType === "decision" || n.tags.includes("decision") || n.tags.includes("rule")) {
                    category = "Decision";
                } else if (n.contextType === "code_change" || combinedFilesTouched.length > 0) {
                    category = "Code";
                }

                const label = `S${index + 1}`;

                visualNodes.push({
                    id: n.id,
                    label: label,
                    type: "qa",
                    category: category,
                    details: {
                        question: n.question,
                        answer: n.answer,
                        timestamp: n.timestamp,
                        project: n.project,
                        fileRef: n.fileRef,
                        filesTouched: combinedFilesTouched,
                        contextType: n.contextType,
                        tags: n.tags,
                        conversationId: n.conversationId,
                        stepIndex: n.stepIndex
                    }
                });

                visualLinks.push({
                    source: chatId,
                    target: n.id,
                    type: "session_member"
                });
            });

            for (let i = 0; i < group.length - 1; i++) {
                visualLinks.push({
                    source: group[i].id,
                    target: group[i + 1].id,
                    type: "next_step"
                });
            }
        });

        this.data.relationships.forEach(r => {
            visualLinks.push({
                source: r.source,
                target: r.target,
                type: r.type || "SIMILAR"
            });
        });

        return {
            nodes: visualNodes,
            links: visualLinks,
            invariants: this.data.invariants,
            fileActions: this.data.fileActions
        };
    }

    public exportDB(targetPath: string): boolean {
        try {
            fs.copyFileSync(this.dbPath, targetPath);
            return true;
        } catch (e) {
            console.error("Export failed:", e);
            return false;
        }
    }

    public importDB(sourcePath: string): boolean {
        try {
            const raw = fs.readFileSync(sourcePath, 'utf8');
            const parsed = JSON.parse(raw);
            if (parsed.nodes && parsed.relationships) {
                fs.copyFileSync(sourcePath, this.dbPath);
                this.load();
                return true;
            }
            return false;
        } catch (e) {
            console.error("Import failed:", e);
            return false;
        }
    }

    public deleteRecord(id: string) {
        this.data.nodes = this.data.nodes.filter(n => n.id !== id);
        this.data.relationships = this.data.relationships.filter(r => r.source !== id && r.target !== id);
        this.save();
    }

    public addRelationship(source: string, target: string, type: string = "SIMILAR") {
        const exists = this.data.relationships.some(r => 
            (r.source === source && r.target === target) ||
            (r.source === target && r.target === source)
        );
        if (!exists) {
            this.data.relationships.push({ source, target, type });
            this.save();
        }
    }

    public deleteRelationship(source: string, target: string) {
        this.data.relationships = this.data.relationships.filter(r => 
            !( (r.source === source && r.target === target) || (r.source === target && r.target === source) )
        );
        this.save();
    }

    public pruneForeignRecords(workspaceRoot?: string): { removedNodes: number; removedActions: number } {
        if (!workspaceRoot) return { removedNodes: 0, removedActions: 0 };
        const normRoot = workspaceRoot.replace(/\\/g, '/').toLowerCase();

        const isInsideWorkspace = (p?: string) => {
            if (!p) return false;
            const normP = p.replace(/\\/g, '/').toLowerCase();
            return normP.startsWith(normRoot) || (!normP.includes(':') && !normP.startsWith('/'));
        };

        const initialActionsCount = this.data.fileActions.length;
        this.data.fileActions = this.data.fileActions.filter(fa => isInsideWorkspace(fa.filePath));
        const removedActions = initialActionsCount - this.data.fileActions.length;

        const initialNodesCount = this.data.nodes.length;
        this.data.nodes = this.data.nodes.filter(n => {
            if (n.fileRef && !isInsideWorkspace(n.fileRef)) {
                return false;
            }
            if (n.filesTouched && n.filesTouched.length > 0) {
                const anyInWorkspace = n.filesTouched.some(f => isInsideWorkspace(f));
                if (!anyInWorkspace) return false;
            }
            return true;
        });
        const removedNodes = initialNodesCount - this.data.nodes.length;

        // Clean orphaned relationships
        const validNodeIds = new Set(this.data.nodes.map(n => n.id));
        this.data.relationships = this.data.relationships.filter(
            r => validNodeIds.has(r.source) && validNodeIds.has(r.target)
        );

        // Refresh indexedSteps
        this.indexedSteps.clear();
        this.data.nodes.forEach(n => {
            if (n.conversationId && n.stepIndex !== undefined) {
                this.indexedSteps.add(`${n.conversationId}_${n.stepIndex}`);
            }
            if (n.tags) {
                n.tags.forEach(t => {
                    if (t.includes('_')) this.indexedSteps.add(t);
                });
            }
        });

        if (removedNodes > 0 || removedActions > 0) {
            this.save();
        }
        return { removedNodes, removedActions };
    }

    public clearDB() {
        this.data = { nodes: [], relationships: [], invariants: [], fileActions: [] };
        this.indexedSteps.clear();
        this.save();
    }
}
