(function() {
    const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;

    // DOM Elements - Navigation & Switchers
    const tabGraph = document.getElementById('tab-graph');
    const tabTimeline = document.getElementById('tab-timeline');
    const tabBoard = document.getElementById('tab-board');
    const viewGraph = document.getElementById('view-graph');
    const viewTimeline = document.getElementById('view-timeline');
    const viewBoard = document.getElementById('view-board');
    const statMemoryCount = document.getElementById('stat-memory-count');
    const pillCartCount = document.getElementById('pill-cart-count');
    const filterPills = document.querySelectorAll('.filter-pill');

    // DOM Elements - Search
    const searchInput = document.getElementById('search-input');
    const clearSearchBtn = document.getElementById('clear-search');

    // DOM Elements - Canvas & Controls
    const canvas = document.getElementById('graph-canvas');
    const ctx = canvas.getContext('2d');
    const container = document.getElementById('canvas-container');
    const btnZoomIn = document.getElementById('btn-zoom-in');
    const btnZoomOut = document.getElementById('btn-zoom-out');
    const btnFitScreen = document.getElementById('btn-fit-screen');
    const btnResetView = document.getElementById('btn-reset-view');

    // DOM Elements - Timeline & Context Recovery Deck
    const timelineStream = document.getElementById('timeline-stream');
    const timelineSessionCounter = document.getElementById('timeline-session-counter');
    const timelineProjectFilter = document.getElementById('timeline-project-filter');
    const btnTimelineExpandAll = document.getElementById('btn-timeline-expand-all');
    const btnTimelineCollapseAll = document.getElementById('btn-timeline-collapse-all');
    const colCardsInvariants = document.getElementById('col-cards-invariants');
    const colCardsFiles = document.getElementById('col-cards-files');
    const colCardsSessions = document.getElementById('col-cards-sessions');
    const colCardsCart = document.getElementById('col-cards-cart');
    const countInvariants = document.getElementById('count-invariants');
    const countFiles = document.getElementById('count-files');
    const countSessions = document.getElementById('count-sessions');
    const countCart = document.getElementById('count-cart');
    const btnAddInvariantCol = document.getElementById('btn-add-invariant-col');
    const btnRehydrateCol = document.getElementById('btn-rehydrate-col');
    const btnRehydrateHeader = document.getElementById('btn-rehydrate-header');

    let collapsedSessionIds = new Set();
    let hasInitializedCollapse = false;
    let selectedProjectFilter = 'ALL';

    // DOM Elements - Sliding Detail Drawer
    const detailPanel = document.getElementById('detail-panel');
    const closePanelBtn = document.getElementById('close-panel');
    const detailQuestion = document.getElementById('detail-question');
    const detailAnswer = document.getElementById('detail-answer');
    const detailFile = document.getElementById('detail-file');
    const detailFileSection = document.getElementById('detail-file-section');
    const nodeBadge = document.getElementById('node-badge');
    const nodeProject = document.getElementById('node-project');
    const btnPin = document.getElementById('btn-pin');
    const btnContext = document.getElementById('btn-context');
    const btnDelete = document.getElementById('btn-delete');

    // DOM Elements - Context Cart Drawer
    const cartDrawer = document.getElementById('cart-drawer');
    const cartCountBadge = document.getElementById('cart-count-badge');
    const cartHeaderTrigger = document.getElementById('cart-header-trigger');
    const btnClearCart = document.getElementById('btn-clear-cart');
    const cartItemsList = document.getElementById('cart-items-list');
    const btnToggleCart = document.getElementById('btn-toggle-cart');
    const btnToggleCartDrawer = document.getElementById('btn-toggle-cart-drawer');
    const btnSyncWorkspace = document.getElementById('btn-sync-workspace');
    const btnCopyCart = document.getElementById('btn-copy-cart');
    const btnPruneHeader = document.getElementById('btn-prune-header');
    const tooltip = document.getElementById('graph-tooltip');

    // DOM Elements - Add Invariant Modal
    const modalAddInvariant = document.getElementById('modal-add-invariant');
    const btnCloseModalInvariant = document.getElementById('btn-close-modal-invariant');
    const btnCancelModalInvariant = document.getElementById('btn-cancel-modal-invariant');
    const btnSaveInvariant = document.getElementById('btn-save-invariant');
    const inputInvariantContent = document.getElementById('input-invariant-content');
    const selectInvariantType = document.getElementById('select-invariant-type');
    const inputInvariantScope = document.getElementById('input-invariant-scope');

    // State Variables
    let currentView = 'board'; // 'graph' | 'timeline' | 'board'
    let activeCategoryFilter = 'ALL';
    let rawNodes = [];
    let rawLinks = [];
    let rawInvariants = [];
    let rawFileActions = [];
    let visibleNodes = [];
    let visibleLinks = [];
    let transform = { x: 50, y: 60, k: 0.95 };
    let hoverNode = null;
    let selectedNode = null;
    let searchHighlightIds = new Set();
    let collapsedConversationIds = new Set();
    let pinnedNodeIds = new Set();
    let isPanning = false;
    let panStart = { x: 0, y: 0 };
    let sessionDeckLimit = 15;
    let fileDeckLimit = 30;
    let timelineSessionLimit = 5;

    // Visual configurations
    const NODE_COLORS = {
        Decision: '#00f0ff',
        Code: '#10b981',
        Session: '#3b82f6',
        Discussion: '#94a3b8',
        Invariants: '#f59e0b',
        General: '#94a3b8'
    };

    const CARD_CONFIG = {
        qaWidth: 155,
        qaHeight: 52,
        hubWidth: 130,
        hubHeight: 48,
        stepGapX: 35,
        laneGapY: 85
    };

    // Canvas Resize Handler
    function resizeCanvas() {
        const dpr = window.devicePixelRatio || 1;
        const rect = container.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.resetTransform();
        ctx.scale(dpr, dpr);
        draw();
    }
    window.addEventListener('resize', resizeCanvas);

    // Filter Node Matcher
    function isNodeMatchingFilters(node) {
        // Category Filter
        if (activeCategoryFilter === 'PINNED') {
            if (!pinnedNodeIds.has(node.id)) return false;
        } else if (activeCategoryFilter !== 'ALL') {
            if (node.type === 'qa' && node.category !== activeCategoryFilter) return false;
        }

        // Search Filter
        const query = searchInput.value.toLowerCase().trim();
        if (query.length >= 2) {
            const tokens = query.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length >= 2);
            const labelText = (node.label || '').toLowerCase();
            const fullTitle = (node.fullTitle || '').toLowerCase();
            const questionText = (node.details && node.details.question) ? node.details.question.toLowerCase() : '';
            const answerText = (node.details && node.details.answer) ? node.details.answer.toLowerCase() : '';
            const tagsText = (node.details && node.details.tags) ? node.details.tags.join(' ').toLowerCase() : '';

            const combined = `${labelText} ${fullTitle} ${questionText} ${answerText} ${tagsText}`;
            return combined.includes(query) || (tokens.length > 0 && tokens.some(t => combined.includes(t)));
        }

        return true;
    }

    // Card-Based Mind Map Layout (Compact Wrapping Tree)
    function calculateTreeLayout() {
        const conversations = {};
        const chatSessionNodes = {};
        
        rawNodes.forEach(node => {
            if (node.type === 'chat_session') {
                const cId = node.id.replace('chat_', '');
                chatSessionNodes[cId] = node;
            } else if (node.type === 'qa' && node.details) {
                const cId = node.details.conversationId;
                if (!conversations[cId]) {
                    conversations[cId] = [];
                }
                conversations[cId].push(node);
            }
        });

        const activeSessions = Object.keys(chatSessionNodes);
        
        // Performance guard: collapse older sessions by default if more than 5 exist
        if (collapsedConversationIds.size === 0 && activeSessions.length > 5) {
            activeSessions.slice(0, activeSessions.length - 5).forEach(cId => {
                collapsedConversationIds.add(cId);
            });
        }

        const startX = 40;
        let currentY = 50;

        visibleNodes = [];
        visibleLinks = [];

        activeSessions.forEach((cId) => {
            const sessionNode = chatSessionNodes[cId];
            const children = conversations[cId] || [];
            
            // Session Hub position
            sessionNode.x = startX;
            sessionNode.y = currentY;
            sessionNode.w = CARD_CONFIG.hubWidth;
            sessionNode.h = CARD_CONFIG.hubHeight;
            visibleNodes.push(sessionNode);

            const isCollapsed = collapsedConversationIds.has(cId);
            if (!isCollapsed) {
                children.sort((a, b) => (a.details.stepIndex ?? 0) - (b.details.stepIndex ?? 0));

                const maxCols = 4; // Max 4 steps per row, then wraps
                let laneRows = 1;

                children.forEach((qaNode, idx) => {
                    const colIndex = idx % maxCols;
                    const rowIndex = Math.floor(idx / maxCols);
                    laneRows = Math.max(laneRows, rowIndex + 1);

                    qaNode.w = CARD_CONFIG.qaWidth;
                    qaNode.h = CARD_CONFIG.qaHeight;
                    qaNode.x = startX + CARD_CONFIG.hubWidth + CARD_CONFIG.stepGapX + colIndex * (CARD_CONFIG.qaWidth + CARD_CONFIG.stepGapX);
                    qaNode.y = currentY + rowIndex * (CARD_CONFIG.qaHeight + 25);
                    visibleNodes.push(qaNode);

                    // Connect link from previous step
                    const prevNode = idx === 0 ? sessionNode : children[idx - 1];
                    visibleLinks.push({
                        source: prevNode.id,
                        target: qaNode.id,
                        sourceX: prevNode.x + (prevNode.w || CARD_CONFIG.qaWidth),
                        sourceY: prevNode.y + (prevNode.h || CARD_CONFIG.qaHeight) / 2,
                        targetX: qaNode.x,
                        targetY: qaNode.y + qaNode.h / 2
                    });
                });

                currentY += (laneRows * (CARD_CONFIG.qaHeight + 25)) + 40;
            } else {
                currentY += CARD_CONFIG.hubHeight + CARD_CONFIG.laneGapY;
            }
        });

        // Include explicit cognitive relationships
        (rawLinks || []).forEach(l => {
            if (['session_member', 'next_question'].includes(l.type)) return;
            const src = visibleNodes.find(n => n.id === l.source);
            const tgt = visibleNodes.find(n => n.id === l.target);
            if (src && tgt) {
                visibleLinks.push({
                    source: src.id,
                    target: tgt.id,
                    type: l.type || 'SIMILAR',
                    sourceX: src.x + src.w / 2,
                    sourceY: src.y + src.h,
                    targetX: tgt.x + tgt.w / 2,
                    targetY: tgt.y
                });
            }
        });

        if (currentView === 'graph') {
            draw();
        }
    }

    // Canvas Draw Routine
    function draw() {
        const rect = canvas.getBoundingClientRect();
        ctx.clearRect(0, 0, rect.width, rect.height);

        ctx.save();
        ctx.translate(transform.x, transform.y);
        ctx.scale(transform.k, transform.k);

        const hasActiveSearch = searchInput.value.trim().length >= 2;

        // 1. Draw Links
        visibleLinks.forEach(link => {
            const srcNode = visibleNodes.find(n => n.id === link.source);
            const tgtNode = visibleNodes.find(n => n.id === link.target);
            if (!srcNode || !tgtNode) return;

            const isSrcMatch = isNodeMatchingFilters(srcNode);
            const isTgtMatch = isNodeMatchingFilters(tgtNode);
            const isMatch = isSrcMatch && isTgtMatch;
            const isCognitive = link.type && !['session_member', 'next_question'].includes(link.type);

            ctx.save();
            ctx.beginPath();
            ctx.moveTo(link.sourceX, link.sourceY);

            const midX = (link.sourceX + link.targetX) / 2;
            ctx.bezierCurveTo(midX, link.sourceY, midX, link.targetY, link.targetX, link.targetY);

            if (isCognitive) {
                ctx.setLineDash([4, 3]);
                if (link.type === 'CAUSAL') ctx.strokeStyle = 'rgba(214, 0, 255, 0.7)';
                else if (link.type === 'ENTITY') ctx.strokeStyle = 'rgba(0, 240, 255, 0.7)';
                else if (link.type === 'SUPERSEDES') ctx.strokeStyle = 'rgba(255, 179, 0, 0.7)';
                else if (link.type === 'CO_RECALLED') ctx.strokeStyle = 'rgba(0, 255, 102, 0.7)';
                else ctx.strokeStyle = 'rgba(148, 163, 184, 0.6)';
                ctx.lineWidth = 1.6;
            } else {
                ctx.strokeStyle = isMatch ? 'rgba(0, 240, 255, 0.4)' : 'rgba(255, 255, 255, 0.08)';
                ctx.lineWidth = isMatch ? 2.0 : 1.4;
            }

            ctx.globalAlpha = hasActiveSearch && !isMatch ? 0.08 : 0.8;
            ctx.stroke();

            // Draw badge for cognitive relations
            if (isCognitive) {
                const midT_X = midX;
                const midT_Y = (link.sourceY + link.targetY) / 2;
                ctx.setLineDash([]);
                ctx.fillStyle = '#0f172a';
                ctx.beginPath();
                ctx.roundRect(midT_X - 28, midT_Y - 8, 56, 16, 4);
                ctx.fill();
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
                ctx.lineWidth = 0.8;
                ctx.stroke();

                ctx.fillStyle = '#e2e8f0';
                ctx.font = 'bold 8px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(link.type.toUpperCase(), midT_X, midT_Y);
            }

            ctx.restore();
        });

        // 2. Draw Cards
        visibleNodes.forEach(node => {
            const isMatch = isNodeMatchingFilters(node);
            const isSelected = selectedNode && selectedNode.id === node.id;
            const isHovered = hoverNode === node;
            const isPinned = pinnedNodeIds.has(node.id);

            ctx.save();
            ctx.globalAlpha = hasActiveSearch && !isMatch ? 0.12 : (isMatch ? 1.0 : 0.35);

            const x = node.x;
            const y = node.y;
            const w = node.w;
            const h = node.h;
            const radius = 6;
            const catColor = NODE_COLORS[node.category] || NODE_COLORS['General'];

            // Card Glow on Hover or Match
            if (isMatch && hasActiveSearch) {
                ctx.shadowColor = 'rgba(0, 240, 255, 0.4)';
                ctx.shadowBlur = 12;
            } else if (isSelected || isHovered) {
                ctx.shadowColor = 'rgba(0, 240, 255, 0.25)';
                ctx.shadowBlur = 8;
            }

            // Card Background Glass Fill
            ctx.beginPath();
            ctx.roundRect(x, y, w, h, radius);
            ctx.fillStyle = isSelected ? 'rgba(30, 41, 59, 0.95)' : (isHovered ? 'rgba(20, 30, 48, 0.9)' : 'rgba(15, 23, 42, 0.82)');
            ctx.fill();

            // Card Border
            ctx.strokeStyle = isSelected ? '#00f0ff' : (isPinned ? '#d600ff' : (isHovered ? 'rgba(255, 255, 255, 0.22)' : 'rgba(255, 255, 255, 0.07)'));
            ctx.lineWidth = isSelected || isPinned ? 1.6 : 1;
            ctx.stroke();

            // Reset Shadow
            ctx.shadowBlur = 0;

            if (node.type === 'chat_session') {
                // Left category indicator bar
                ctx.fillStyle = '#00ff66';
                ctx.beginPath();
                ctx.roundRect(x + 2, y + 2, 4, h - 4, [radius, 0, 0, radius]);
                ctx.fill();

                // Chat session title
                ctx.fillStyle = '#f1f5f9';
                ctx.font = 'bold 11px sans-serif';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'top';
                ctx.fillText(node.label, x + 14, y + 10);

                ctx.fillStyle = '#64748b';
                ctx.font = '10px sans-serif';
                const subtitle = (node.fullTitle || 'Chat Session').replace(/^💬\s*"/, '').replace(/"$/, '');
                const truncatedSub = subtitle.length > 14 ? subtitle.substring(0, 13) + '...' : subtitle;
                ctx.fillText(truncatedSub, x + 14, y + 26);

                // Collapse +/- bubble
                const cId = node.id.replace('chat_', '');
                const isCollapsed = collapsedConversationIds.has(cId);
                ctx.fillStyle = '#1e293b';
                ctx.beginPath();
                ctx.arc(x + w - 12, y + 14, 7, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = '#00ff66';
                ctx.lineWidth = 1;
                ctx.stroke();

                ctx.fillStyle = '#00ff66';
                ctx.font = 'bold 9px monospace';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(isCollapsed ? '+' : '−', x + w - 12, y + 14);

            } else {
                // Q&A Node Card
                // Left category indicator bar
                ctx.fillStyle = catColor;
                ctx.beginPath();
                ctx.roundRect(x + 2, y + 2, 3, h - 4, [radius, 0, 0, radius]);
                ctx.fill();

                // Step & Category Pill Header
                ctx.fillStyle = '#64748b';
                ctx.font = 'bold 9px sans-serif';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'top';
                ctx.fillText(node.label, x + 10, y + 8);

                ctx.fillStyle = catColor;
                ctx.textAlign = 'right';
                ctx.font = '8px sans-serif';
                ctx.fillText(node.category.toUpperCase(), x + w - 8, y + 8);

                // Question Title (truncated)
                ctx.fillStyle = isSelected ? '#ffffff' : '#e2e8f0';
                ctx.font = '10px sans-serif';
                ctx.textAlign = 'left';
                const qText = (node.details && node.details.question) ? node.details.question : 'Q&A Step';
                const cleanQ = qText.replace(/\n/g, ' ').trim();
                const truncatedQ = cleanQ.length > 21 ? cleanQ.substring(0, 19) + '...' : cleanQ;
                ctx.fillText(truncatedQ, x + 10, y + 22);

                // Tags Preview Footer
                if (node.details && node.details.tags && node.details.tags.length > 0) {
                    ctx.fillStyle = '#64748b';
                    ctx.font = '8px sans-serif';
                    const tagStr = '#' + node.details.tags.slice(0, 2).join(' #');
                    ctx.fillText(tagStr, x + 10, y + 36);
                }

                // Pinned Cart Indicator
                if (isPinned) {
                    ctx.fillStyle = '#d600ff';
                    ctx.beginPath();
                    ctx.arc(x + w - 8, y + h - 8, 3, 0, Math.PI * 2);
                    ctx.fill();
                }
            }

            ctx.restore();
        });

        ctx.restore();
    }

    // Coordinates mapping
    function getTransformedCoords(e) {
        const rect = canvas.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left - transform.x) / transform.k,
            y: (e.clientY - rect.top - transform.y) / transform.k
        };
    }

    // Canvas Mouse & Interaction Handlers
    canvas.addEventListener('mousedown', e => {
        const coords = getTransformedCoords(e);
        
        const clickedNode = visibleNodes.find(node => {
            return coords.x >= node.x && coords.x <= node.x + node.w &&
                   coords.y >= node.y && coords.y <= node.y + node.h;
        });

        if (clickedNode) {
            if (clickedNode.type === 'chat_session') {
                const convId = clickedNode.id.replace('chat_', '');
                if (collapsedConversationIds.has(convId)) {
                    collapsedConversationIds.delete(convId);
                } else {
                    collapsedConversationIds.add(convId);
                }
                calculateTreeLayout();
            }
            selectNode(clickedNode);
        } else {
            isPanning = true;
            panStart.x = e.clientX - transform.x;
            panStart.y = e.clientY - transform.y;
        }
    });

    canvas.addEventListener('mousemove', e => {
        const coords = getTransformedCoords(e);

        if (isPanning) {
            transform.x = e.clientX - panStart.x;
            transform.y = e.clientY - panStart.y;
            draw();
            return;
        }

        const prevHover = hoverNode;
        hoverNode = visibleNodes.find(node => {
            return coords.x >= node.x && coords.x <= node.x + node.w &&
                   coords.y >= node.y && coords.y <= node.y + node.h;
        });
        
        if (prevHover !== hoverNode) {
            canvas.style.cursor = hoverNode ? 'pointer' : (isPanning ? 'grabbing' : 'grab');
            draw();
        }

        if (hoverNode) {
            if (hoverNode.type === 'chat_session') {
                tooltip.innerHTML = `<strong>Chat Session</strong><br/>${hoverNode.fullTitle || hoverNode.label}`;
            } else {
                const titleText = hoverNode.details && hoverNode.details.question ? hoverNode.details.question : 'Q&A Step';
                const cleanText = titleText.replace(/</g, '&lt;').replace(/>/g, '&gt;');
                tooltip.innerHTML = `<strong>${hoverNode.label} [${hoverNode.category}]</strong><br/>${cleanText}`;
            }
            tooltip.style.left = `${e.clientX + 14}px`;
            tooltip.style.top = `${e.clientY + 14}px`;
            tooltip.classList.remove('hidden');
            tooltip.classList.add('visible');
        } else {
            tooltip.classList.add('hidden');
            tooltip.classList.remove('visible');
        }
    });

    window.addEventListener('mouseup', () => { isPanning = false; });

    canvas.addEventListener('wheel', e => {
        e.preventDefault();
        const zoomFactor = Math.exp((e.deltaY < 0 ? 1 : -1) * 0.08);
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        transform.x = mouseX - (mouseX - transform.x) * zoomFactor;
        transform.y = mouseY - (mouseY - transform.y) * zoomFactor;
        transform.k *= zoomFactor;
        transform.k = Math.max(0.3, Math.min(transform.k, 3));
        draw();
    });

    // Zoom Helpers
    btnZoomIn.addEventListener('click', () => {
        transform.k = Math.min(transform.k * 1.25, 3);
        draw();
    });

    btnZoomOut.addEventListener('click', () => {
        transform.k = Math.max(transform.k / 1.25, 0.3);
        draw();
    });

    btnResetView.addEventListener('click', () => {
        transform = { x: 50, y: 60, k: 0.95 };
        draw();
    });

    btnFitScreen.addEventListener('click', fitToScreen);

    function fitToScreen() {
        if (visibleNodes.length === 0) return;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        visibleNodes.forEach(n => {
            minX = Math.min(minX, n.x);
            minY = Math.min(minY, n.y);
            maxX = Math.max(maxX, n.x + n.w);
            maxY = Math.max(maxY, n.y + n.h);
        });

        const rect = canvas.getBoundingClientRect();
        const padding = 60;
        const contentW = maxX - minX;
        const contentH = maxY - minY;

        if (contentW > 0 && contentH > 0) {
            const scaleX = (rect.width - padding * 2) / contentW;
            const scaleY = (rect.height - padding * 2) / contentH;
            transform.k = Math.max(0.35, Math.min(Math.min(scaleX, scaleY), 1.2));
            transform.x = (rect.width - contentW * transform.k) / 2 - minX * transform.k;
            transform.y = (rect.height - contentH * transform.k) / 2 - minY * transform.k;
            draw();
        }
    }

    // Node Selection & Detail Drawer Logic
    function selectNode(node) {
        selectedNode = node;
        draw();
        
        if (node.type === 'qa' && node.details) {
            detailQuestion.innerText = node.details.question;
            detailAnswer.innerText = node.details.answer;
            nodeBadge.className = 'badge qa';
            nodeBadge.innerText = node.category || 'Q&A';
            nodeProject.innerText = node.details.project || 'memlite';
            
            // Render Referenced & Modified Files
            const files = Array.isArray(node.details.filesTouched) ? node.details.filesTouched : [];
            const fileRef = node.details.fileRef;
            const allFiles = Array.from(new Set([...(fileRef ? [fileRef] : []), ...files])).filter(Boolean);

            if (allFiles.length > 0) {
                detailFileSection.classList.remove('hidden');
                detailFile.className = 'file-chips-container';
                detailFile.innerHTML = allFiles.map(f => {
                    const norm = f.replace(/\\/g, '/');
                    const basename = norm.split('/').pop() || norm;
                    return `<span class="file-chip" title="${escapeHtml(norm)}">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
                        <span>${escapeHtml(basename)}</span>
                    </span>`;
                }).join('');
            } else {
                detailFileSection.classList.add('hidden');
                detailFile.innerHTML = '';
            }
            
            const pinLabel = btnPin.querySelector('.btn-label');
            if (pinnedNodeIds.has(node.id)) {
                btnPin.classList.add('pinned');
                if (pinLabel) pinLabel.innerText = 'Pinned';
            } else {
                btnPin.classList.remove('pinned');
                if (pinLabel) pinLabel.innerText = 'Pin to Cart';
            }
            btnPin.style.display = 'inline-flex';
            btnContext.style.display = 'inline-flex';
            btnDelete.style.display = 'inline-flex';
            detailPanel.classList.remove('hidden');
        } else if (node.type === 'chat_session') {
            detailQuestion.innerText = node.fullTitle || node.label;
            detailAnswer.innerText = "This node represents a conversation session. Click to toggle its steps in the mind map.";
            nodeBadge.className = 'badge project';
            nodeBadge.innerText = 'Chat Session';
            nodeProject.innerText = 'Workspace';
            detailFileSection.classList.add('hidden');
            detailFile.innerHTML = '';
            
            btnContext.style.display = 'none';
            btnDelete.style.display = 'none';
            btnPin.style.display = 'none';
            detailPanel.classList.remove('hidden');
        } else {
            hidePanel();
        }
    }

    function hidePanel() {
        selectedNode = null;
        detailPanel.classList.add('hidden');
        draw();
    }
    closePanelBtn.addEventListener('click', hidePanel);

    // Context Cart Actions
    function updateCartUI() {
        const count = pinnedNodeIds.size;
        if (cartCountBadge) {
            cartCountBadge.innerText = count === 1 ? '1 item' : `${count} items`;
            if (count > 0) {
                cartCountBadge.classList.add('has-items');
            } else {
                cartCountBadge.classList.remove('has-items');
            }
        }
        if (pillCartCount) pillCartCount.innerText = count;
        cartItemsList.innerHTML = '';

        if (count === 0) {
            cartItemsList.innerHTML = '<li class="cart-item-empty">No items staged in context cart. Pin items from the canvas or recovery deck.</li>';
            return;
        }

        pinnedNodeIds.forEach(id => {
            const node = rawNodes.find(n => n.id === id);
            if (!node) return;

            const li = document.createElement('li');
            li.className = 'cart-item';

            const badge = document.createElement('span');
            badge.className = 'cart-item-badge';
            badge.innerText = node.type === 'qa' ? 'QA' : 'Item';
            li.appendChild(badge);

            const span = document.createElement('span');
            span.className = 'cart-item-text';
            const qTitle = (node.details && node.details.question) ? node.details.question : node.label;
            span.innerText = qTitle;
            span.title = qTitle;
            li.appendChild(span);

            const removeBtn = document.createElement('button');
            removeBtn.className = 'cart-item-remove';
            removeBtn.title = 'Remove item from cart';
            removeBtn.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                pinnedNodeIds.delete(id);
                updateCartUI();
                draw();
                renderTimeline();
                renderBoard();
                if (selectedNode && selectedNode.id === id) selectNode(selectedNode);
            });
            li.appendChild(removeBtn);
            cartItemsList.appendChild(li);
        });
    }

    btnPin.addEventListener('click', () => {
        if (!selectedNode || selectedNode.type !== 'qa') return;
        const pinLabel = btnPin.querySelector('.btn-label');
        if (pinnedNodeIds.has(selectedNode.id)) {
            pinnedNodeIds.delete(selectedNode.id);
            btnPin.classList.remove('pinned');
            if (pinLabel) pinLabel.innerText = 'Pin to Cart';
        } else {
            pinnedNodeIds.add(selectedNode.id);
            btnPin.classList.add('pinned');
            if (pinLabel) pinLabel.innerText = 'Pinned';
            cartDrawer.classList.remove('collapsed');
        }
        updateCartUI();
        draw();
        renderTimeline();
        renderBoard();
    });

    btnToggleCart.addEventListener('click', (e) => {
        e.stopPropagation();
        cartDrawer.classList.toggle('collapsed');
    });

    if (cartHeaderTrigger) {
        cartHeaderTrigger.addEventListener('click', (e) => {
            if (e.target.closest('#btn-clear-cart') || e.target.closest('#btn-toggle-cart')) return;
            cartDrawer.classList.toggle('collapsed');
        });
    }

    if (btnClearCart) {
        btnClearCart.addEventListener('click', (e) => {
            e.stopPropagation();
            if (pinnedNodeIds.size === 0) return;
            pinnedNodeIds.clear();
            updateCartUI();
            draw();
            renderTimeline();
            renderBoard();
            if (selectedNode) selectNode(selectedNode);
        });
    }

    btnToggleCartDrawer.addEventListener('click', () => {
        cartDrawer.classList.toggle('collapsed');
    });

    btnSyncWorkspace.addEventListener('click', () => {
        if (pinnedNodeIds.size === 0) return;
        const items = Array.from(pinnedNodeIds).map(id => {
            const node = rawNodes.find(n => n.id === id);
            return { question: node.details.question, answer: node.details.answer };
        });
        if (vscode) {
            vscode.postMessage({ type: 'exportContextFile', items: items });
        }
    });

    btnCopyCart.addEventListener('click', () => {
        if (pinnedNodeIds.size === 0) return;
        let compiledMarkdown = `# 🧠 Compiled Chat Context\n\n`;
        Array.from(pinnedNodeIds).forEach((id, index) => {
            const node = rawNodes.find(n => n.id === id);
            if (!node) return;
            compiledMarkdown += `## [Step ${index + 1}] ${node.details.question}\n${node.details.answer}\n\n---\n\n`;
        });
        if (vscode) {
            vscode.postMessage({ type: 'copyClipboard', text: compiledMarkdown });
        }
    });

    btnContext.addEventListener('click', () => {
        if (!selectedNode || selectedNode.type !== 'qa') return;
        const connectedQAs = [];
        const cId = selectedNode.details.conversationId;
        rawNodes.forEach(node => {
            if (node.type === 'qa' && node.id !== selectedNode.id && node.details && node.details.conversationId === cId) {
                connectedQAs.push({ question: node.details.question, answer: node.details.answer });
            }
        });
        if (vscode) {
            vscode.postMessage({
                type: 'passContext',
                nodeId: selectedNode.id,
                text: selectedNode.details.question,
                answer: selectedNode.details.answer,
                connected: connectedQAs
            });
        }
    });

    btnDelete.addEventListener('click', () => {
        if (!selectedNode) return;
        if (vscode) {
            vscode.postMessage({ type: 'deleteNode', nodeId: selectedNode.id });
            hidePanel();
        }
    });

    function formatSessionDate(isoString) {
        if (!isoString) return null;
        try {
            const date = new Date(isoString);
            if (isNaN(date.getTime())) return null;
            const now = new Date();
            const diffMs = now.getTime() - date.getTime();
            const diffMins = Math.floor(diffMs / 60000);
            const diffHours = Math.floor(diffMs / 3600000);
            const diffDays = Math.floor(diffMs / 86400000);

            let relative = '';
            if (diffMins < 1) relative = 'Just now';
            else if (diffMins < 60) relative = `${diffMins}m ago`;
            else if (diffHours < 24) relative = `${diffHours}h ago`;
            else if (diffDays < 7) relative = `${diffDays}d ago`;
            else {
                const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                relative = `${date.getDate()} ${months[date.getMonth()]}`;
            }

            const hours = String(date.getHours()).padStart(2, '0');
            const mins = String(date.getMinutes()).padStart(2, '0');
            const exact = `${date.toLocaleDateString()} ${hours}:${mins}`;
            return { relative, exact };
        } catch (e) {
            return null;
        }
    }

    // VIEW 2: Timeline Stream Rendering
    function renderTimeline() {
        if (currentView !== 'timeline') return; // Performance: lazy render only when timeline is active
        timelineStream.innerHTML = '';
        const conversations = {};
        rawNodes.forEach(n => {
            if (n.type === 'qa' && n.details) {
                const cId = n.details.conversationId || 'general';
                if (!conversations[cId]) conversations[cId] = [];
                conversations[cId].push(n);
            }
        });

        const activeSessions = Object.keys(conversations);

        // Calculate session counts per project
        const projectCounts = {};
        activeSessions.forEach(cId => {
            const rawItems = conversations[cId] || [];
            const firstStep = rawItems[0];
            const sessionNode = rawNodes.find(n => n.id === `chat_${cId}` || (n.type === 'chat_session' && n.id.includes(cId)));
            const proj = (sessionNode && sessionNode.details && sessionNode.details.project) || (firstStep && firstStep.details && firstStep.details.project) || 'General';
            projectCounts[proj] = (projectCounts[proj] || 0) + 1;
        });

        // Populate Project Filter Dropdown
        if (timelineProjectFilter) {
            const projects = Object.keys(projectCounts).sort();
            const currentFilter = selectedProjectFilter;
            timelineProjectFilter.innerHTML = `<option value="ALL">📁 All Projects (${activeSessions.length})</option>` +
                projects.map(p => `<option value="${escapeHtml(p)}" ${currentFilter === p ? 'selected' : ''}>📁 ${escapeHtml(p)} (${projectCounts[p]})</option>`).join('');
            
            if (currentFilter !== 'ALL' && !projectCounts[currentFilter]) {
                selectedProjectFilter = 'ALL';
                timelineProjectFilter.value = 'ALL';
            }
        }

        // Filter sessions by selected project
        const filteredSessionIds = activeSessions.filter(cId => {
            if (selectedProjectFilter === 'ALL') return true;
            const rawItems = conversations[cId] || [];
            const firstStep = rawItems[0];
            const sessionNode = rawNodes.find(n => n.id === `chat_${cId}` || (n.type === 'chat_session' && n.id.includes(cId)));
            const proj = (sessionNode && sessionNode.details && sessionNode.details.project) || (firstStep && firstStep.details && firstStep.details.project) || 'General';
            return proj === selectedProjectFilter;
        });

        if (timelineSessionCounter) {
            const countText = selectedProjectFilter === 'ALL' 
                ? `${activeSessions.length} session${activeSessions.length === 1 ? '' : 's'}`
                : `${filteredSessionIds.length} of ${activeSessions.length} sessions (${selectedProjectFilter})`;
            timelineSessionCounter.innerText = countText;
        }

        if (filteredSessionIds.length === 0) {
            timelineStream.innerHTML = '<div style="text-align: center; color: #64748b; padding: 40px 0;">No memories recorded for this project.</div>';
            return;
        }

        // Initialize default collapse state: keep first 2 sessions expanded, collapse older sessions if many
        if (!hasInitializedCollapse) {
            hasInitializedCollapse = true;
            if (activeSessions.length > 2) {
                activeSessions.slice(2).forEach(id => collapsedSessionIds.add(id));
            }
        }

        // Bounded rendering: show latest timelineSessionLimit sessions to keep DOM ultra-light
        const displayedSessionIds = filteredSessionIds.slice(0, timelineSessionLimit);

        displayedSessionIds.forEach((cId) => {
            const sIdx = activeSessions.indexOf(cId);
            const sessionNode = rawNodes.find(n => n.id === `chat_${cId}` || (n.type === 'chat_session' && n.id.includes(cId)));
            
            const rawItems = conversations[cId] || [];
            const firstStep = rawItems[0];
            const project = (sessionNode && sessionNode.details && sessionNode.details.project) || (firstStep && firstStep.details && firstStep.details.project) || 'General';
            const customTitle = (sessionNode && sessionNode.details && sessionNode.details.customTitle) || '';
            const sessionNumber = (sessionNode && sessionNode.details && sessionNode.details.sessionNumber) || (activeSessions.length - sIdx);
            const defaultLabel = `Session ${sessionNumber}`;
            const displayTitle = customTitle || defaultLabel;
            
            // Latest timestamp
            const latestTs = (sessionNode && sessionNode.details && sessionNode.details.timestamp) || (rawItems.length > 0 ? rawItems[rawItems.length - 1].timestamp : '');
            const timeObj = formatSessionDate(latestTs);

            const isCollapsed = collapsedSessionIds.has(cId);

            // Show latest steps at the top of the session
            const items = rawItems.filter(n => isNodeMatchingFilters(n)).slice().reverse();
            if (items.length === 0) return;

            const groupDiv = document.createElement('div');
            groupDiv.className = `timeline-session-group ${isCollapsed ? 'collapsed' : ''}`;

            const header = document.createElement('div');
            header.className = 'timeline-session-header';
            header.title = 'Click to expand / collapse session steps';

            const timeHtml = timeObj ? `<span class="session-time-pill" title="${escapeHtml(timeObj.exact)}">🕒 ${escapeHtml(timeObj.relative)}</span>` : '';

            header.innerHTML = `
                <div class="session-header-left">
                    <span class="session-chevron">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"></polyline></svg>
                    </span>
                    <span class="session-project-pill" title="Project: ${escapeHtml(project)}">📁 ${escapeHtml(project)}</span>
                    <div class="session-title-wrap" id="title-wrap-${cId}">
                        <span class="session-title-text" title="Click edit icon or double-click to rename">${escapeHtml(displayTitle)}</span>
                        <button class="session-edit-btn" title="Rename session & project" data-cid="${cId}">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                        </button>
                    </div>
                    <span class="session-steps-tag">${items.length} steps</span>
                </div>
                <div class="session-header-right">
                    ${timeHtml}
                </div>
            `;

            // Toggle collapse when clicking header (except when clicking edit button or input)
            header.addEventListener('click', (e) => {
                if (e.target.closest('.session-edit-btn') || e.target.closest('.session-edit-form')) {
                    return;
                }
                if (collapsedSessionIds.has(cId)) {
                    collapsedSessionIds.delete(cId);
                    groupDiv.classList.remove('collapsed');
                } else {
                    collapsedSessionIds.add(cId);
                    groupDiv.classList.add('collapsed');
                }
            });

            // Inline Edit Handler
            const editBtn = header.querySelector('.session-edit-btn');
            const titleWrap = header.querySelector(`#title-wrap-${cId}`);

            const startEditing = (e) => {
                e.stopPropagation();
                const currentName = customTitle || defaultLabel;
                titleWrap.innerHTML = `
                    <form class="session-edit-form" id="form-rename-${cId}">
                        <input type="text" class="session-edit-input" value="${escapeHtml(currentName)}" placeholder="Session name..." maxlength="60" autofocus />
                        <input type="text" class="session-edit-input" id="input-proj-${cId}" value="${escapeHtml(project)}" placeholder="Project..." style="width: 85px; color: #38bdf8; border-color: #38bdf8;" maxlength="30" />
                        <button type="submit" class="session-save-btn" title="Save">✓</button>
                        <button type="button" class="session-cancel-btn" title="Cancel">✕</button>
                    </form>
                `;
                const form = titleWrap.querySelector(`#form-rename-${cId}`);
                const input = form.querySelector('.session-edit-input');
                const projInput = form.querySelector(`#input-proj-${cId}`);
                const cancelBtn = form.querySelector('.session-cancel-btn');

                input.focus();
                input.select();

                form.addEventListener('submit', (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    const newTitle = input.value.trim();
                    const newProject = projInput ? projInput.value.trim() : undefined;
                    if (vscode) {
                        vscode.postMessage({
                            type: 'renameSession',
                            conversationId: cId,
                            newTitle: newTitle,
                            newProject: newProject
                        });
                    }
                });

                cancelBtn.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    renderTimeline();
                });

                input.addEventListener('keydown', (ev) => {
                    if (ev.key === 'Escape') {
                        ev.stopPropagation();
                        renderTimeline();
                    }
                });
            };

            if (editBtn) editBtn.addEventListener('click', startEditing);
            const titleText = header.querySelector('.session-title-text');
            if (titleText) titleText.addEventListener('dblclick', startEditing);

            groupDiv.appendChild(header);

            // Session Body containing the step cards
            const bodyDiv = document.createElement('div');
            bodyDiv.className = 'timeline-session-body';

            items.forEach(node => {
                const card = document.createElement('div');
                card.className = 'timeline-card';
                card.addEventListener('click', () => selectNode(node));

                const catColor = NODE_COLORS[node.category] || NODE_COLORS['General'];
                const isPinned = pinnedNodeIds.has(node.id);

                card.innerHTML = `
                    <div class="card-top">
                        <span class="card-step-badge">${node.label}</span>
                        <span class="badge" style="background: rgba(255,255,255,0.06); color: ${catColor}; border: 1px solid ${catColor}44;">${node.category}</span>
                    </div>
                    <div class="card-question">${escapeHtml(node.details.question)}</div>
                    <div class="card-answer">${escapeHtml(node.details.answer)}</div>
                    <div class="card-footer">
                        <div class="card-tags">
                            ${(node.details.tags || []).map(t => `<span class="tag-pill">#${escapeHtml(t)}</span>`).join('')}
                        </div>
                        <button class="action-btn" style="padding: 3px 8px; font-size: 10px;" onclick="event.stopPropagation(); window.togglePinNode('${node.id}')">
                            ${isPinned ? '📌 Pinned' : '📌 Pin'}
                        </button>
                    </div>
                `;
                bodyDiv.appendChild(card);
            });

            groupDiv.appendChild(bodyDiv);
            timelineStream.appendChild(groupDiv);
        });

        if (activeSessions.length > timelineSessionLimit) {
            const moreSessionsDiv = document.createElement('div');
            moreSessionsDiv.style.textAlign = 'center';
            moreSessionsDiv.style.padding = '16px 0';
            moreSessionsDiv.innerHTML = `<button class="action-btn" id="btn-load-more-timeline" style="padding: 8px 16px; font-size: 11px;">Load Earlier Sessions (${activeSessions.length - timelineSessionLimit} remaining)</button>`;
            moreSessionsDiv.querySelector('#btn-load-more-timeline').addEventListener('click', () => {
                timelineSessionLimit += 10;
                renderTimeline();
            });
            timelineStream.appendChild(moreSessionsDiv);
        }
    }

    if (btnTimelineExpandAll) {
        btnTimelineExpandAll.addEventListener('click', () => {
            collapsedSessionIds.clear();
            renderTimeline();
        });
    }

    if (btnTimelineCollapseAll) {
        btnTimelineCollapseAll.addEventListener('click', () => {
            rawNodes.forEach(n => {
                if (n.type === 'qa' && n.details && n.details.conversationId) {
                    collapsedSessionIds.add(n.details.conversationId);
                }
            });
            renderTimeline();
        });
    }

    if (timelineProjectFilter) {
        timelineProjectFilter.addEventListener('change', (e) => {
            selectedProjectFilter = e.target.value;
            renderTimeline();
        });
    }

    // VIEW 3: Category Board Rendering
    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // VIEW 3: Context Recovery Deck Rendering
    function renderBoard() {
        if (currentView !== 'board') return; // Performance: lazy render only when board is active

        // 1. Column 1: Invariants & Rules (Tier 0)
        colCardsInvariants.innerHTML = '';
        const activeInvariants = rawInvariants.filter(r => r.status === 'ACTIVE');
        countInvariants.innerText = activeInvariants.length;

        if (activeInvariants.length === 0) {
            colCardsInvariants.innerHTML = `
                <div style="color: #64748b; font-style: italic; font-size: 11px; padding: 24px 12px; text-align: center; border: 1px dashed rgba(255,255,255,0.06); border-radius: 6px; margin: 6px 0;">
                    No active constraints.<br>
                    <span style="font-size: 10px; opacity: 0.8;">Click "+ Rule" above to register an un-breakable Tier 0 rule.</span>
                </div>
            `;
        } else {
            activeInvariants.forEach(inv => {
                const card = document.createElement('div');
                card.className = 'deck-card invariant-card';

                const scopeBadge = inv.scope && inv.scope !== 'global' 
                    ? `<span class="step-pill" style="font-size: 8px;">${escapeHtml(inv.scope)}</span>` 
                    : '';
                const typeLabel = (inv.ruleType || 'RULE').replace(/_/g, ' ');

                card.innerHTML = `
                    <div class="card-meta-row">
                        <span class="mono-badge">${escapeHtml(typeLabel)}</span>
                        <button class="revoke-btn" onclick="event.stopPropagation(); window.revokeInvariant('${inv.id}')" title="Revoke rule to avoid prompt deadlocks">
                            Revoke
                        </button>
                    </div>
                    <div class="invariant-content">${escapeHtml(inv.content)}</div>
                    <div class="card-sub-row">
                        ${scopeBadge}
                        <span style="font-family: monospace; color: #475569;">id:${inv.id}</span>
                    </div>
                `;
                colCardsInvariants.appendChild(card);
            });
        }

        // 2. Column 2: Causal File Timeline (Tier 1 & 2)
        colCardsFiles.innerHTML = '';
        countFiles.innerText = rawFileActions.length;

        if (rawFileActions.length === 0) {
            colCardsFiles.innerHTML = `
                <div style="color: #64748b; font-style: italic; font-size: 11px; padding: 24px 12px; text-align: center; border: 1px dashed rgba(255,255,255,0.06); border-radius: 6px; margin: 6px 0;">
                    No file modifications tracked yet.
                </div>
            `;
        } else {
            // Paginated file modifications
            const recentFiles = rawFileActions.slice(-fileDeckLimit).reverse();
            recentFiles.forEach(fa => {
                const card = document.createElement('div');
                card.className = 'deck-card file-card';

                const normPath = (fa.filePath || '').replace(/\\/g, '/');
                const parts = normPath.split('/');
                const fileName = parts.pop() || normPath;
                const dirPath = parts.slice(-2).join('/');

                const isLarge = fa.diffSummary && fa.diffSummary.startsWith('[LARGE DIFF');
                let diffBlock = '';
                if (isLarge) {
                    diffBlock = `<div class="diff-breadcrumb-box">${escapeHtml(fa.diffSummary)}</div>`;
                } else if (fa.diffSummary && fa.diffSummary.trim().length > 0) {
                    const lines = fa.diffSummary.trim().split('\n').slice(0, 6);
                    const styledLines = lines.map(l => {
                        const escaped = escapeHtml(l);
                        if (l.startsWith('+') && !l.startsWith('+++')) {
                            return `<span style="color: #4ade80;">${escaped}</span>`;
                        } else if (l.startsWith('-') && !l.startsWith('---')) {
                            return `<span style="color: #f87171;">${escaped}</span>`;
                        }
                        return `<span style="color: #64748b;">${escaped}</span>`;
                    }).join('\n');
                    diffBlock = `<pre class="diff-preview-box">${styledLines}</pre>`;
                }

                card.innerHTML = `
                    <div class="card-meta-row">
                        <span class="step-pill">Step ${fa.stepIndex}</span>
                        <span class="action-tag action-${fa.action}">${fa.action.toUpperCase()}</span>
                    </div>
                    <div class="file-name-row">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: #94a3b8; flex-shrink: 0;"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
                        <span class="file-basename">${escapeHtml(fileName)}</span>
                    </div>
                    ${dirPath ? `<div class="file-dirname">${escapeHtml(dirPath)}/</div>` : ''}
                    ${fa.intent ? `<div class="file-intent">"${escapeHtml(fa.intent)}"</div>` : ''}
                    ${diffBlock}
                    <div class="card-sub-row">
                        <span style="font-family: monospace;">sha:${fa.fileHashAfter}</span>
                        <span>+${fa.linesAdded} / -${fa.linesRemoved}</span>
                    </div>
                `;
                colCardsFiles.appendChild(card);
            });

            if (rawFileActions.length > fileDeckLimit) {
                const moreFilesDiv = document.createElement('div');
                moreFilesDiv.style.textAlign = 'center';
                moreFilesDiv.style.padding = '8px 0';
                moreFilesDiv.innerHTML = `<button class="action-btn" id="btn-load-more-files" style="width: 100%; font-size: 11px; padding: 6px;">Show Older Modifications (${rawFileActions.length - fileDeckLimit} remaining)</button>`;
                moreFilesDiv.querySelector('#btn-load-more-files').addEventListener('click', () => {
                    fileDeckLimit += 30;
                    renderBoard();
                });
                colCardsFiles.appendChild(moreFilesDiv);
            }
        }

        // 3. Column 3: Chronological Sessions
        colCardsSessions.innerHTML = '';
        const sessionNodes = rawNodes.filter(n => n.type === 'chat_session');
        countSessions.innerText = sessionNodes.length;

        if (sessionNodes.length === 0) {
            colCardsSessions.innerHTML = `
                <div style="color: #64748b; font-style: italic; font-size: 11px; padding: 24px 12px; text-align: center; border: 1px dashed rgba(255,255,255,0.06); border-radius: 6px; margin: 6px 0;">
                    No active chat sessions.
                </div>
            `;
        } else {
            const displayedSessions = sessionNodes.slice(0, sessionDeckLimit);
            displayedSessions.forEach((s) => {
                const originalIndex = sessionNodes.indexOf(s);
                const card = document.createElement('div');
                card.className = 'deck-card session-card';
                card.addEventListener('click', () => {
                    selectNode(s);
                    setView('graph');
                });

                const memberCount = rawLinks.filter(l => l.source === s.id && l.type === 'session_member').length;
                let title = (s.fullTitle || s.label || '').replace(/^💬\s*"/, '').replace(/"$/, '');
                const proj = (s.details && s.details.project) || 'General';
                const timeObj = formatSessionDate(s.details && s.details.timestamp);

                card.innerHTML = `
                    <div class="card-meta-row">
                        <span class="session-project-pill" style="font-size: 8px; padding: 0 5px;">📁 ${escapeHtml(proj)}</span>
                        <span class="session-number">${escapeHtml(s.label || ('Session ' + (sessionNodes.length - originalIndex)))}</span>
                        <span class="session-steps-tag">${memberCount} steps</span>
                    </div>
                    <div class="session-title">${escapeHtml(title)}</div>
                    ${timeObj ? `<div style="font-size: 9px; color: #64748b; margin-top: 4px;" title="${escapeHtml(timeObj.exact)}">🕒 ${escapeHtml(timeObj.relative)}</div>` : ''}
                `;
                colCardsSessions.appendChild(card);
            });

            if (sessionNodes.length > sessionDeckLimit) {
                const moreSessionsDiv = document.createElement('div');
                moreSessionsDiv.style.textAlign = 'center';
                moreSessionsDiv.style.padding = '8px 0';
                moreSessionsDiv.innerHTML = `<button class="action-btn" id="btn-load-more-sessions" style="width: 100%; font-size: 11px; padding: 6px;">Show Earlier Sessions (${sessionNodes.length - sessionDeckLimit} remaining)</button>`;
                moreSessionsDiv.querySelector('#btn-load-more-sessions').addEventListener('click', () => {
                    sessionDeckLimit += 20;
                    renderBoard();
                });
                colCardsSessions.appendChild(moreSessionsDiv);
            }
        }

        // 4. Column 4: Context Cart (Active Working Set)
        colCardsCart.innerHTML = '';
        const cartNodes = rawNodes.filter(n => pinnedNodeIds.has(n.id));
        countCart.innerText = cartNodes.length;

        if (cartNodes.length === 0) {
            colCardsCart.innerHTML = `
                <div style="color: #64748b; font-style: italic; font-size: 11px; padding: 24px 12px; text-align: center; border: 1px dashed rgba(255,255,255,0.06); border-radius: 6px; margin: 6px 0;">
                    Cart is empty.<br>
                    <span style="font-size: 10px; opacity: 0.8;">Pin nodes across Canvas or Timeline to stage them for agent injection.</span>
                </div>
            `;
        } else {
            cartNodes.forEach(node => {
                const card = document.createElement('div');
                card.className = 'deck-card';
                card.addEventListener('click', () => selectNode(node));

                card.innerHTML = `
                    <div class="card-meta-row">
                        <span class="step-pill">${escapeHtml(node.label)}</span>
                        <button class="revoke-btn" onclick="event.stopPropagation(); window.togglePinNode('${node.id}')">
                            Remove
                        </button>
                    </div>
                    <div style="font-size: 11px; color: #f1f5f9; margin-top: 3px;">${escapeHtml(node.details ? node.details.question : '')}</div>
                `;
                colCardsCart.appendChild(card);
            });
        }
    }

    window.revokeInvariant = function(id) {
        if (vscode) {
            vscode.postMessage({
                type: 'revokeInvariant',
                ruleId: id,
                reason: 'Revoked via Recovery Deck'
            });
        }
    };

    window.togglePinNode = function(id) {
        if (pinnedNodeIds.has(id)) {
            pinnedNodeIds.delete(id);
        } else {
            pinnedNodeIds.add(id);
        }
        updateCartUI();
        draw();
        renderTimeline();
        renderBoard();
        if (selectedNode && selectedNode.id === id) selectNode(selectedNode);
    };

    // Rehydrate Agent Triggers
    function triggerRehydrate() {
        if (vscode) {
            vscode.postMessage({ type: 'rehydrateAgent' });
        }
    }

    if (btnPruneHeader) {
        btnPruneHeader.addEventListener('click', () => {
            if (vscode) {
                vscode.postMessage({ type: 'pruneForeign' });
            }
        });
    }

    if (btnRehydrateHeader) btnRehydrateHeader.addEventListener('click', triggerRehydrate);
    if (btnRehydrateCol) btnRehydrateCol.addEventListener('click', triggerRehydrate);

    // Invariant Modal Actions
    if (btnAddInvariantCol) {
        btnAddInvariantCol.addEventListener('click', () => {
            modalAddInvariant.classList.remove('hidden');
            inputInvariantContent.focus();
        });
    }

    function closeInvariantModal() {
        modalAddInvariant.classList.add('hidden');
        inputInvariantContent.value = '';
        inputInvariantScope.value = 'global';
    }

    if (btnCloseModalInvariant) btnCloseModalInvariant.addEventListener('click', closeInvariantModal);
    if (btnCancelModalInvariant) btnCancelModalInvariant.addEventListener('click', closeInvariantModal);

    if (btnSaveInvariant) {
        btnSaveInvariant.addEventListener('click', () => {
            const content = inputInvariantContent.value.trim();
            const ruleType = selectInvariantType.value;
            const scope = inputInvariantScope.value.trim() || 'global';

            if (!content) {
                inputInvariantContent.focus();
                return;
            }

            if (vscode) {
                vscode.postMessage({
                    type: 'addInvariant',
                    content,
                    ruleType,
                    scope
                });
            }
            closeInvariantModal();
        });
    }

    // View Switching
    function setView(viewName) {
        currentView = viewName;
        tabGraph.classList.toggle('active', viewName === 'graph');
        tabTimeline.classList.toggle('active', viewName === 'timeline');
        tabBoard.classList.toggle('active', viewName === 'board');

        viewGraph.classList.toggle('active', viewName === 'graph');
        viewTimeline.classList.toggle('active', viewName === 'timeline');
        viewBoard.classList.toggle('active', viewName === 'board');

        if (viewName === 'graph') {
            resizeCanvas();
        } else if (viewName === 'timeline') {
            renderTimeline();
        } else if (viewName === 'board') {
            renderBoard();
        }
    }

    tabGraph.addEventListener('click', () => setView('graph'));
    tabTimeline.addEventListener('click', () => setView('timeline'));
    tabBoard.addEventListener('click', () => setView('board'));

    // Category Filter Pills
    filterPills.forEach(pill => {
        pill.addEventListener('click', () => {
            filterPills.forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            activeCategoryFilter = pill.dataset.category;
            if (currentView === 'graph') draw();
            if (currentView === 'timeline') renderTimeline();
            if (currentView === 'board') renderBoard();
        });
    });

    // Search Input Listener
    searchInput.addEventListener('input', () => {
        if (currentView === 'graph') draw();
        if (currentView === 'timeline') renderTimeline();
        if (currentView === 'board') renderBoard();
    });

    clearSearchBtn.addEventListener('click', () => {
        searchInput.value = '';
        if (currentView === 'graph') draw();
        if (currentView === 'timeline') renderTimeline();
        if (currentView === 'board') renderBoard();
    });

    // Listen to messages from TS Extension Host
    window.addEventListener('message', event => {
        const msg = event.data;
        if (msg.type === 'updateGraph') {
            rawNodes = msg.data.nodes || [];
            rawLinks = msg.data.links || [];
            rawInvariants = msg.data.invariants || [];
            rawFileActions = msg.data.fileActions || [];
            
            const qaCount = rawNodes.filter(n => n.type === 'qa').length;
            statMemoryCount.innerText = `${qaCount} items`;

            const validIds = new Set(rawNodes.map(n => n.id));
            pinnedNodeIds = new Set(Array.from(pinnedNodeIds).filter(id => validIds.has(id)));
            updateCartUI();

            calculateTreeLayout();
            if (currentView === 'timeline') renderTimeline();
            if (currentView === 'board') renderBoard();

            if (selectedNode) {
                const currentSelection = rawNodes.find(n => n.id === selectedNode.id);
                if (currentSelection) {
                    selectNode(currentSelection);
                } else {
                    hidePanel();
                }
            }
        }
    });

    // Initialize Layout & View
    setView('board');
    if (vscode) {
        vscode.postMessage({ type: 'ready' });
    }
})();
