import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export interface MemoryNode {
    id: string;
    question: string;
    answer: string;
    timestamp: string;
    project: string;
    fileRef?: string;
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
}

export class MemoryDatabase {
    private dbPath: string;
    private data: DatabaseSchema;

    constructor(storagePath: string) {
        if (!fs.existsSync(storagePath)) {
            fs.mkdirSync(storagePath, { recursive: true });
        }
        this.dbPath = path.join(storagePath, 'memlite_db.json');
        this.data = { nodes: [], relationships: [] };
        this.load();
    }

    private load() {
        if (fs.existsSync(this.dbPath)) {
            try {
                const raw = fs.readFileSync(this.dbPath, 'utf8');
                this.data = JSON.parse(raw);
                // Ensure array structures
                if (!this.data.nodes) { this.data.nodes = []; }
                if (!this.data.relationships) { this.data.relationships = []; }
            } catch (e) {
                console.error("Failed to load MemLite database, resetting:", e);
                this.data = { nodes: [], relationships: [] };
            }
        } else {
            this.save();
        }
    }

    public save() {
        try {
            fs.writeFileSync(this.dbPath, JSON.stringify(this.data, null, 2), 'utf8');
        } catch (e) {
            console.error("Failed to save MemLite database:", e);
        }
    }

    public addRecord(
        question: string,
        answer: string,
        project: string,
        fileRef?: string,
        manualTags: string[] = [],
        conversationId?: string,
        stepIndex?: number
    ): MemoryNode {
        const id = crypto.randomUUID();
        
        // Auto-extract tag keywords from question and answer (simple tokenizer)
        const extractedTags = this.extractTags(question + " " + answer);
        const uniqueTags = Array.from(new Set([...manualTags, ...extractedTags]))
            .map(t => t.toLowerCase())
            .filter(t => t.length > 2 && !this.isStopword(t));

        const newNode: MemoryNode = {
            id,
            question,
            answer,
            timestamp: new Date().toISOString(),
            project: project || "Default Project",
            fileRef,
            tags: uniqueTags,
            conversationId,
            stepIndex
        };

        this.data.nodes.push(newNode);

        // Auto-link to related nodes
        this.createAutoRelationships(newNode);

        this.save();
        return newNode;
    }

    private extractTags(text: string): string[] {
        // Match code concepts (words, capitalized terms, code tokens)
        const words = text.match(/[a-zA-Z]{3,20}/g) || [];
        // Look for programming keywords or specific database concepts
        const programmingKeywords = [
            "python", "react", "fastapi", "postgres", "sqlite", "javascript", "typescript",
            "rust", "git", "api", "database", "query", "server", "model", "index", "faiss",
            "node", "embeddings", "context", "allergy", "peanuts"
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
        // Link to other Q&As sharing:
        // 1. Same fileRef
        // 2. Overlapping tags
        this.data.nodes.forEach(other => {
            if (other.id === node.id) { return; }

            // Link by file reference
            if (node.fileRef && other.fileRef && node.fileRef === other.fileRef) {
                this.data.relationships.push({
                    source: node.id,
                    target: other.id,
                    type: "same_file"
                });
            }

            // Link by tag overlap (if they share 2 or more tags)
            const overlap = node.tags.filter(t => other.tags.includes(t));
            if (overlap.length >= 1) {
                this.data.relationships.push({
                    source: node.id,
                    target: other.id,
                    type: "related_topic"
                });
            }
        });
    }

    /**
     * Translates raw Q&As into visual nodes and edges for the graph UI.
     */
    public getGraphData(): { nodes: any[]; links: any[] } {
        const visualNodes: any[] = [];
        const visualLinks: any[] = [];

        // Group nodes by conversationId to build chronological links
        const convGroups: { [key: string]: MemoryNode[] } = {};

        this.data.nodes.forEach(n => {
            const cId = n.conversationId || "unknown_conv";
            if (!convGroups[cId]) {
                convGroups[cId] = [];
            }
            convGroups[cId].push(n);
        });

        // Process each conversation group
        Object.keys(convGroups).forEach((cId, chatIndex) => {
            const group = convGroups[cId];
            // Sort nodes in this group by stepIndex ascending to get chronological order
            group.sort((a, b) => (a.stepIndex ?? 0) - (b.stepIndex ?? 0));

            if (group.length === 0) return;

            // Use the first question text as a friendly title for this chat session
            const firstNode = group[0];
            let chatTitle = firstNode.question.replace(/\n/g, ' ').trim();
            if (chatTitle.length > 35) {
                chatTitle = chatTitle.substring(0, 32) + "...";
            }
            const fullTitle = `💬 "${chatTitle}"`;
            const chatLabel = `Chat ${chatIndex + 1}`;

            // Create a central Chat Session node
            const chatId = `chat_${cId}`;
            visualNodes.push({
                id: chatId,
                label: chatLabel,
                type: "chat_session",
                category: "Project", // Use Project category style (Neon Green)
                fullTitle: fullTitle
            });

            // Add the Q&A nodes with chronological visual numbers Q1, Q2, Q3...
            group.forEach((n, index) => {
                let category = "General";
                const text = (n.question + " " + n.answer).toLowerCase();
                if (n.tags.includes("preference") || text.includes("prefer") || text.includes("like") || text.includes("favorite")) {
                    category = "Preference";
                } else if (n.tags.includes("skill") || text.includes("code") || text.includes("write") || text.includes("python") || text.includes("javascript") || text.includes("rust")) {
                    category = "Skill";
                } else if (text.includes("name") || text.includes("allergic") || text.includes("allergy") || text.includes("live in")) {
                    category = "Personal";
                }

                // Simplified canvas label (e.g. Q1, Q2)
                const label = `Q${index + 1}`;

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
                        tags: n.tags,
                        conversationId: n.conversationId,
                        stepIndex: n.stepIndex
                    }
                });

                // Link each Q&A to the central Chat Session node to keep them clustered close in physics layout
                visualLinks.push({
                    source: chatId,
                    target: n.id,
                    type: "session_member"
                });
            });

            // Create sequential chronological links Q1 -> Q2 -> Q3...
            for (let i = 0; i < group.length - 1; i++) {
                visualLinks.push({
                    source: group[i].id,
                    target: group[i + 1].id,
                    type: "next_question"
                });
            }
        });

        return { nodes: visualNodes, links: visualLinks };
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
        // Remove from nodes
        this.data.nodes = this.data.nodes.filter(n => n.id !== id);
        // Remove associated relationships
        this.data.relationships = this.data.relationships.filter(r => r.source !== id && r.target !== id);
        this.save();
    }

    public clearDB() {
        this.data = { nodes: [], relationships: [] };
        this.save();
    }
}
