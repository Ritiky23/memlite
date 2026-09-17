import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

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
}

export class MemoryDatabase {
    private dbPath: string;
    private data: DatabaseSchema;
    private indexedSteps: Set<string> = new Set();

    constructor(storagePath: string) {
        if (!fs.existsSync(storagePath)) {
            fs.mkdirSync(storagePath, { recursive: true });
        }
        this.dbPath = path.join(storagePath, 'memlite_db.json');
        this.data = { nodes: [], relationships: [], invariants: [], fileActions: [] };
        this.load();
    }

    private load() {
        if (fs.existsSync(this.dbPath)) {
            try {
                const raw = fs.readFileSync(this.dbPath, 'utf8');
                this.data = JSON.parse(raw);
                if (!this.data.nodes) { this.data.nodes = []; }
                if (!this.data.relationships) { this.data.relationships = []; }
                if (!this.data.invariants) { this.data.invariants = []; }
                if (!this.data.fileActions) { this.data.fileActions = []; }
            } catch (e) {
                console.error("Failed to load MemLite database, resetting:", e);
                this.data = { nodes: [], relationships: [], invariants: [], fileActions: [] };
            }
        } else {
            this.save();
        }

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
    }

    public save() {
        try {
            fs.writeFileSync(this.dbPath, JSON.stringify(this.data, null, 2), 'utf8');
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
        contextType?: "decision" | "code_change" | "milestone" | "discussion"
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
            existingNode = this.data.nodes.find(n => 
                (n.conversationId === conversationId && n.stepIndex === stepIndex) ||
                (n.tags && n.tags.includes(stepKey))
            );
        }

        if (existingNode) {
            const currentFiles = (existingNode.filesTouched || []).slice().sort().join(',');
            const newFiles = (filesTouched || []).slice().sort().join(',');
            const isChanged = existingNode.answer !== answer || 
                              existingNode.question !== question ||
                              currentFiles !== newFiles;
            
            if (isChanged) {
                existingNode.question = question;
                existingNode.answer = answer;
                existingNode.timestamp = new Date().toISOString();
                existingNode.project = project || existingNode.project || "Default Project";
                if (fileRef) existingNode.fileRef = fileRef;
                existingNode.filesTouched = Array.from(new Set([...(existingNode.filesTouched || []), ...(filesTouched || [])]));
                existingNode.contextType = contextType;
                existingNode.tags = Array.from(new Set([...existingNode.tags, ...uniqueTags]));
                this.save();
                return { node: existingNode, isNew: false, isUpdated: true };
            }
            return { node: existingNode, isNew: false, isUpdated: false };
        }

        const id = crypto.randomUUID();
        const newNode: MemoryNode = {
            id,
            question,
            answer,
            timestamp: new Date().toISOString(),
            project: project || "Default Project",
            fileRef,
            filesTouched: filesTouched || [],
            contextType,
            tags: uniqueTags,
            conversationId,
            stepIndex
        };

        this.data.nodes.push(newNode);
        if (stepKey) {
            this.indexedSteps.add(stepKey);
        }
        manualTags.forEach(t => {
            if (t.includes('_')) this.indexedSteps.add(t);
        });
        this.createAutoRelationships(newNode);
        this.save();
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

    // --- File Provenance (Tier 1 & 2) Methods ---
    public recordFileAction(actionItem: FileActionItem) {
        const existingIdx = this.data.fileActions.findIndex(fa => fa.id === actionItem.id);
        if (existingIdx !== -1) {
            this.data.fileActions[existingIdx] = actionItem;
        } else {
            this.data.fileActions.push(actionItem);
        }
        this.save();
    }

    public checkFileFreshness(workspaceRoot: string): { stale: { file: string; warning: string }[]; freshCount: number } {
        const stale: { file: string; warning: string }[] = [];
        let freshCount = 0;

        // Group by file path to get latest recorded hash
        const latestByFile: { [path: string]: FileActionItem } = {};
        this.data.fileActions.forEach(fa => {
            latestByFile[fa.filePath] = fa;
        });

        Object.keys(latestByFile).forEach(relPath => {
            const absPath = path.isAbsolute(relPath) ? relPath : path.join(workspaceRoot, relPath);
            if (!fs.existsSync(absPath)) {
                stale.push({ file: relPath, warning: `⚠️ MISSING: '${relPath}' deleted on disk.` });
                return;
            }
            try {
                const rawContent = fs.readFileSync(absPath, 'utf8');
                const normalized = rawContent.replace(/\r\n/g, '\n').trim();
                const currentHash = crypto.createHash('sha256').update(normalized, 'utf8').digest('hex').substring(0, 16);
                if (currentHash !== latestByFile[relPath].fileHashAfter) {
                    stale.push({ file: relPath, warning: `⚠️ STALE: '${relPath}' modified on disk since step ${latestByFile[relPath].stepIndex}.` });
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
        this.data.nodes.forEach(other => {
            if (other.id === node.id) { return; }
            if (node.fileRef && other.fileRef && node.fileRef === other.fileRef) {
                this.data.relationships.push({
                    source: node.id,
                    target: other.id,
                    type: "same_file"
                });
            }
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

        Object.keys(convGroups).forEach((cId, chatIndex) => {
            const group = convGroups[cId];
            group.sort((a, b) => (a.stepIndex ?? 0) - (b.stepIndex ?? 0));
            if (group.length === 0) return;

            const firstNode = group[0];
            let chatTitle = firstNode.question.replace(/\n/g, ' ').trim();
            if (chatTitle.length > 35) {
                chatTitle = chatTitle.substring(0, 32) + "...";
            }
            const fullTitle = `💬 "${chatTitle}"`;
            const chatLabel = `Session ${chatIndex + 1}`;
            const chatId = `chat_${cId}`;

            visualNodes.push({
                id: chatId,
                label: chatLabel,
                type: "chat_session",
                category: "Session",
                fullTitle: fullTitle
            });

            group.forEach((n, index) => {
                // Category is clean and context-driven (NO FAKE SKILLS REGEX!)
                let category = "Discussion";
                if (n.contextType === "decision" || n.tags.includes("decision") || n.tags.includes("rule")) {
                    category = "Decision";
                } else if (n.contextType === "code_change" || (n.filesTouched && n.filesTouched.length > 0)) {
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
                        filesTouched: n.filesTouched || [],
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
