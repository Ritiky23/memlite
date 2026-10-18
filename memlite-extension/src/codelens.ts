import * as vscode from 'vscode';
import * as path from 'path';
import { MemoryDatabase, MemoryNode, FileActionItem, InvariantItem } from './database';

export class MemLiteCodeLensProvider implements vscode.CodeLensProvider {
    private db: MemoryDatabase;
    private onDidChangeCodeLensesEmitter: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeLenses: vscode.Event<void> = this.onDidChangeCodeLensesEmitter.event;

    constructor(db: MemoryDatabase) {
        this.db = db;
        this.db.onInvariantsChanged(() => {
            this.refresh();
        });
    }

    public refresh(): void {
        this.onDidChangeCodeLensesEmitter.fire();
    }

    public provideCodeLenses(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): vscode.CodeLens[] {
        const lenses: vscode.CodeLens[] = [];
        const text = document.getText();
        const lines = text.split('\n');

        const symbolRegex = /(?:(?:export\s+(?:default\s+)?)?(?:public|private|protected|static|async\s+)*\s*(?:def|class|function|(?:const|let|var))\s+|(?:\b(?:public|private|protected|static|async)\s+)+)([a-zA-Z0-9_]+)/g;

        const relFile = this.getCleanRelPath(document.fileName);

        // File-level safeguards banner on line 0 if file-level rules exist
        const fileInvariants = this.db.getInvariantsForFileOrSymbol(relFile, [], false);
        if (fileInvariants.length > 0) {
            const firstLineRange = new vscode.Range(0, 0, 0, Math.min(lines[0]?.length || 0, 80));
            lenses.push(new vscode.CodeLens(firstLineRange, {
                title: `🛡️ MemLite: File Safeguards (${fileInvariants.length} rule${fileInvariants.length > 1 ? 's' : ''} in ${path.basename(relFile)})`,
                command: 'memlite.explainSymbol',
                arguments: [path.basename(relFile), relFile, [], [], fileInvariants]
            }));
        }

        for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
            if (token.isCancellationRequested) break;
            const line = lines[lineIdx];
            let match;
            while ((match = symbolRegex.exec(line)) !== null) {
                const symbol = match[1];
                if (!symbol || symbol.length <= 2) continue;

                const memories = this.db.getMemoriesForSymbol(symbol);
                const fileActions = this.db.getFileActionsForSymbol(symbol);
                // Exact symbol match only: do NOT attach other functions' rules here
                const invariants = this.db.getInvariantsForFileOrSymbol(relFile, [symbol], true);

                const hasHistory = memories.length > 0 || fileActions.length > 0 || invariants.length > 0;
                if (!hasHistory) continue;

                const range = new vscode.Range(lineIdx, match.index, lineIdx, match.index + match[0].length);

                let title = `🧠 MemLite: Why this exists`;
                if (invariants.length > 0) {
                    title = `🔒 MemLite: Invariant Protected (${invariants.length} rule${invariants.length > 1 ? 's' : ''})`;
                } else if (memories.length > 0) {
                    const count = memories.length;
                    title = `🧠 MemLite: Why this exists (${count} past decision${count > 1 ? 's' : ''})`;
                } else if (fileActions.length > 0) {
                    title = `🧠 MemLite: Origin tracked (${fileActions.length} change${fileActions.length > 1 ? 's' : ''})`;
                }

                const lens = new vscode.CodeLens(range, {
                    title,
                    command: 'memlite.explainSymbol',
                    arguments: [symbol, relFile, memories, fileActions, invariants]
                });

                lenses.push(lens);
            }
        }

        return lenses;
    }

    private getCleanRelPath(filePath: string): string {
        const norm = filePath.replace(/\\/g, '/');
        const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath.replace(/\\/g, '/');
        if (wsFolder && norm.startsWith(wsFolder)) {
            return norm.substring(wsFolder.length).replace(/^\/+/, '');
        }
        return path.basename(norm);
    }
}

export class MemLiteHoverProvider implements vscode.HoverProvider {
    private db: MemoryDatabase;

    constructor(db: MemoryDatabase) {
        this.db = db;
    }

    public provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): vscode.Hover | null {
        const range = document.getWordRangeAtPosition(position);
        if (!range) return null;

        const word = document.getText(range);
        if (!word || word.length <= 2) return null;

        const relFile = this.getCleanRelPath(document.fileName);
        const memories = this.db.getMemoriesForSymbol(word);
        const fileActions = this.db.getFileActionsForSymbol(word);
        const invariants = this.db.getInvariantsForFileOrSymbol(relFile, [word], true);

        if (memories.length === 0 && fileActions.length === 0 && invariants.length === 0) {
            return null;
        }

        const md = new vscode.MarkdownString();
        md.isTrusted = true;
        md.supportHtml = true;

        md.appendMarkdown(`### 🧠 MemLite: \`${word}\`\n\n`);

        if (invariants.length > 0) {
            md.appendMarkdown(`#### 🔒 Active Safeguards & Invariants:\n`);
            invariants.forEach(inv => {
                md.appendMarkdown(`- **[${inv.ruleType}]** "${inv.content}"\n`);
            });
            md.appendMarkdown(`\n---\n`);
        }

        if (memories.length > 0) {
            md.appendMarkdown(`#### 💡 Purpose & Key Past Decisions:\n`);
            memories.slice(0, 3).forEach(m => {
                const date = m.timestamp ? new Date(m.timestamp).toLocaleDateString() : 'Past Session';
                const title = this.extractMeaningfulTitle(m.question, m.answer, word);
                md.appendMarkdown(`• **${title}** *(${date})*\n`);
                const snippet = this.extractKeySnippet(m.answer);
                if (snippet) {
                    md.appendMarkdown(`  > ${snippet}\n`);
                }
            });
            md.appendMarkdown(`\n---\n`);
        }

        if (fileActions.length > 0) {
            md.appendMarkdown(`#### 🛠️ Code Evolution:\n`);
            fileActions.slice(-2).forEach(fa => {
                md.appendMarkdown(`${this.extractActionDetails(fa, word)}\n`);
            });
            md.appendMarkdown(`\n`);
        }

        md.appendMarkdown(`*[Click CodeLens above symbol for full decision timeline & diffs]*\n`);

        return new vscode.Hover(md, range);
    }

    private extractMeaningfulTitle(question: string, answer: string, fallbackSymbol?: string): string {
        const cleanQ = (question || '').replace(/^[-*#\s]+/, '').trim();
        const isFiller = /^(?:continue|contnue|yes|no|ok|proceed|next|go ahead|do it|fix it|run|please|thanks?)\b/i.test(cleanQ) || cleanQ.length < 15;

        // 1. If user prompt is meaningful (e.g. "Add support for IST timezone in backtest.py"), use it
        if (!isFiller && cleanQ.length >= 15) {
            return cleanQ.length > 80 ? cleanQ.substring(0, 77) + '...' : cleanQ;
        }

        if (answer) {
            // 2. Extract technical action headers (e.g. "### 🔍 Root Cause of Shutdown Freeze" -> "Root Cause of Shutdown Freeze")
            const headingRegex = /(?:^|\n)#{1,4}\s*(?:[^\w\s]+\s*)?([^\n#]+)/g;
            let hMatch;
            while ((hMatch = headingRegex.exec(answer)) !== null) {
                const title = hMatch[1].replace(/^[^\w\s]+/, '').trim();
                if (title.length > 5 && !/^(?:code actions|changes|plan|steps|summary|notes|response|output|task)$/i.test(title)) {
                    return title.length > 80 ? title.substring(0, 77) + '...' : title;
                }
            }

            // 3. Extract bold summary / fix lines (e.g. "**Root Cause:** The database file was locked")
            const boldRegex = /(?:^|\n)\*\*(?:Summary|Fix|Root Cause|Goal|Solution|Decision):\*\*\s*([^\n*]+)/i;
            const bMatch = answer.match(boldRegex);
            if (bMatch && bMatch[1] && bMatch[1].trim().length > 5) {
                const bTitle = bMatch[1].trim();
                return bTitle.length > 80 ? bTitle.substring(0, 77) + '...' : bTitle;
            }

            // 4. Extract first technical sentence, skipping chatbot chatter
            const lines = answer.split('\n')
                .map(l => l.trim())
                .filter(l => l.length > 10 && !l.startsWith('#') && !l.startsWith('```'));
            for (const line of lines) {
                const cleanLine = line
                    .replace(/^(?:Sure|Here is|I have|Done|Great|Certainly|Okay|Let me|I will)\b[,\s]*/i, '')
                    .replace(/^[*\s-]+/, '')
                    .trim();
                if (cleanLine.length > 10) {
                    const firstSentence = cleanLine.split(/(?<=[.!?])\s+/)[0] || cleanLine;
                    if (firstSentence.length > 8) {
                        return firstSentence.length > 80 ? firstSentence.substring(0, 77) + '...' : firstSentence;
                    }
                }
            }
        }

        return fallbackSymbol ? `Architectural update in \`${fallbackSymbol}\`` : 'Code refinement & evolution';
    }

    private extractKeySnippet(answer: string): string | null {
        if (!answer) return null;
        const lines = answer.split('\n')
            .map(l => l.trim())
            .filter(l => l.length > 15 && !l.startsWith('#') && !l.startsWith('```') && !l.startsWith('* **Chunk'));
        
        for (const line of lines) {
            const clean = line
                .replace(/^(?:Sure|Here is|I have|Done|Great|Certainly|Okay|Let me|I will)\b[,\s]*/i, '')
                .replace(/^[-*>\s]+/, '')
                .trim();
            if (clean.length > 15 && !clean.toLowerCase().startsWith('code actions')) {
                return clean.length > 100 ? clean.substring(0, 97) + '...' : clean;
            }
        }
        return null;
    }

    private extractActionDetails(fa: FileActionItem, symbol: string): string {
        const intent = fa.intent || '';
        const isFiller = /^(?:continue|contnue|yes|no|ok|proceed|next|go ahead|do it|fix it|run|please|thanks?)\b/i.test(intent.trim()) || intent.trim().length < 15;

        let actionDesc = '';
        if (fa.diffSummary) {
            const matchCounts = fa.diffSummary.match(/([+-]\d+\s+lines?(?:,\s*[+-]\d+\s+lines?)?)/i);
            if (matchCounts) {
                actionDesc = matchCounts[1];
            } else if (fa.linesAdded || fa.linesRemoved) {
                actionDesc = `+${fa.linesAdded || 0}, -${fa.linesRemoved || 0} lines`;
            }
        }

        const dateStr = fa.timestamp ? new Date(fa.timestamp).toLocaleDateString() : '';
        const dateTag = dateStr ? ` *(${dateStr})*` : '';

        if (!isFiller && intent.length >= 15) {
            const shortIntent = intent.length > 70 ? intent.substring(0, 67) + '...' : intent;
            return `• **${shortIntent}** ${actionDesc ? `\`(${actionDesc})\`` : ''}${dateTag}`;
        }

        return `• **${fa.action === 'created' ? 'Defined' : 'Updated'} in \`${symbol}\`** ${actionDesc ? `\`(${actionDesc})\`` : ''}${dateTag}`;
    }

    private getCleanRelPath(filePath: string): string {
        const norm = filePath.replace(/\\/g, '/');
        const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath.replace(/\\/g, '/');
        if (wsFolder && norm.startsWith(wsFolder)) {
            return norm.substring(wsFolder.length).replace(/^\/+/, '');
        }
        return path.basename(norm);
    }
}
