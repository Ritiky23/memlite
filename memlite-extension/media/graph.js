(function() {
    const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;

    // Canvas DOM elements
    const canvas = document.getElementById('graph-canvas');
    const ctx = canvas.getContext('2d');
    const container = document.getElementById('canvas-container');

    // UI elements
    const searchInput = document.getElementById('search-input');
    const clearSearchBtn = document.getElementById('clear-search');
    const detailPanel = document.getElementById('detail-panel');
    const closePanelBtn = document.getElementById('close-panel');
    const detailQuestion = document.getElementById('detail-question');
    const detailAnswer = document.getElementById('detail-answer');
    const detailFile = document.getElementById('detail-file');
    const nodeBadge = document.getElementById('node-badge');
    const nodeProject = document.getElementById('node-project');
    const btnContext = document.getElementById('btn-context');
    const btnDelete = document.getElementById('btn-delete');
    
    // Pinned Cart elements
    const btnPin = document.getElementById('btn-pin');
    const cartDrawer = document.getElementById('cart-drawer');
    const cartCount = document.getElementById('cart-count');
    const cartItemsList = document.getElementById('cart-items-list');
    const btnToggleCart = document.getElementById('btn-toggle-cart');
    const btnSyncWorkspace = document.getElementById('btn-sync-workspace');
    const btnCopyCart = document.getElementById('btn-copy-cart');
    const tooltip = document.getElementById('graph-tooltip');

    // State Variables
    let rawNodes = [];
    let rawLinks = [];
    let visibleNodes = [];
    let visibleLinks = [];
    let transform = { x: 40, y: 80, k: 0.95 }; // Coordinates offset
    let hoverNode = null;
    let selectedNode = null;
    let searchHighlightIds = new Set();
    let collapsedConversationIds = new Set(); // Stores collapsed conversation IDs
    let pinnedNodeIds = new Set(); // Stores pinned node IDs inside Context Cart
    let isPanning = false;
    let panStart = { x: 0, y: 0 };

    // High DPI Canvas Configuration (Sharp Text and Lines)
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

    // Visual configurations
    const NODE_STYLES = {
        Preference: { color: '#00f0ff', radius: 9, glow: 'rgba(0, 240, 255, 0.45)' },
        Personal: { color: '#d600ff', radius: 9, glow: 'rgba(214, 0, 255, 0.45)' },
        Skill: { color: '#ffb300', radius: 9, glow: 'rgba(255, 179, 0, 0.45)' },
        General: { color: '#8e9fae', radius: 9, glow: 'rgba(142, 159, 174, 0.45)' },
        Project: { color: '#00ff66', radius: 13, glow: 'rgba(0, 255, 102, 0.45)' }
    };

    // Calculate static, organized Mind Map Tree Layout positions (No physics simulation needed)
    function calculateTreeLayout() {
        // Group nodes by conversationId
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
        
        // Configuration metrics for spacing
        const stepWidth = 180;  // Spaced out horizontally
        const laneHeight = 130; // Spaced out vertically
        const startX = 60;
        const startY = 60;

        visibleNodes = [];
        visibleLinks = [];

        activeSessions.forEach((cId, laneIndex) => {
            const sessionNode = chatSessionNodes[cId];
            const children = conversations[cId] || [];
            
            // Layout session node
            sessionNode.x = startX;
            sessionNode.y = startY + laneIndex * laneHeight;
            visibleNodes.push(sessionNode);

            const isCollapsed = collapsedConversationIds.has(cId);
            if (!isCollapsed) {
                // Sort children chronologically (Step Index)
                children.sort((a, b) => (a.details.stepIndex ?? 0) - (b.details.stepIndex ?? 0));

                children.forEach((qaNode, stepIndex) => {
                    qaNode.x = startX + (stepIndex + 1) * stepWidth;
                    qaNode.y = sessionNode.y;
                    visibleNodes.push(qaNode);

                    // Connect links between QAs
                    const prevNode = stepIndex === 0 ? sessionNode : children[stepIndex - 1];
                    visibleLinks.push({
                        source: prevNode.id,
                        target: qaNode.id,
                        sourceX: prevNode.x,
                        sourceY: prevNode.y,
                        targetX: qaNode.x,
                        targetY: qaNode.y
                    });
                });
            }
        });

        draw();
    }

    // Main Draw Routine
    function draw() {
        const rect = canvas.getBoundingClientRect();
        ctx.clearRect(0, 0, rect.width, rect.height);

        ctx.save();
        // Apply coordinate system translations
        ctx.translate(transform.x, transform.y);
        ctx.scale(transform.k, transform.k);

        // 1. Draw elegant connection links (Bezier curves)
        visibleLinks.forEach(link => {
            ctx.beginPath();
            ctx.moveTo(link.sourceX, link.sourceY);
            
            // Draw a smooth curved cubic Bezier connection
            const midX = (link.sourceX + link.targetX) / 2;
            ctx.bezierCurveTo(midX, link.sourceY, midX, link.targetY, link.targetX, link.targetY);
            
            const sourceNode = visibleNodes.find(n => n.id === link.source);
            const targetNode = visibleNodes.find(n => n.id === link.target);
            
            const isFaded = selectedNode && 
                            selectedNode.id !== link.source && 
                            selectedNode.id !== link.target;
            
            ctx.globalAlpha = isFaded ? 0.15 : 0.7;
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
            ctx.lineWidth = 2.2;
            ctx.stroke();
        });

        ctx.globalAlpha = 1.0;

        // 2. Draw Nodes
        visibleNodes.forEach(node => {
            const style = NODE_STYLES[node.category] || NODE_STYLES['General'];
            
            const isSearchResult = searchHighlightIds.has(node.id);
            const isSelected = selectedNode && selectedNode.id === node.id;
            const isFaded = selectedNode && selectedNode.id !== node.id && 
                            !visibleLinks.some(l => (l.source === selectedNode.id && l.target === node.id) || (l.target === selectedNode.id && l.source === node.id));

            ctx.save();
            ctx.globalAlpha = isFaded ? (isSearchResult ? 0.8 : 0.25) : 1.0;

            // Highlight ring on hover or selection
            if (isSearchResult || isSelected || hoverNode === node) {
                ctx.beginPath();
                ctx.arc(node.x, node.y, style.radius + (isSearchResult ? 6 : 4), 0, Math.PI * 2);
                ctx.fillStyle = style.glow;
                ctx.fill();
            }

            // Pinned Cart Magenta double ring
            if (pinnedNodeIds.has(node.id)) {
                ctx.beginPath();
                ctx.arc(node.x, node.y, style.radius + 5, 0, Math.PI * 2);
                ctx.strokeStyle = '#d600ff';
                ctx.lineWidth = 1.6;
                ctx.stroke();
            }

            // Center Circle Node
            ctx.beginPath();
            ctx.arc(node.x, node.y, style.radius, 0, Math.PI * 2);
            ctx.fillStyle = style.color;
            ctx.fill();

            // Label text drawing
            ctx.fillStyle = isSelected ? '#ffffff' : '#94a3b8';
            ctx.font = isSelected ? 'bold 11px sans-serif' : '10px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';

            // Clean Node Labels to avoid text clutter/overlap
            ctx.fillText(node.label, node.x, node.y + style.radius + 7);

            // Collapse indicator (+) for collapsed chat session nodes
            if (node.type === 'chat_session') {
                const cId = node.id.replace('chat_', '');
                const isCollapsed = collapsedConversationIds.has(cId);
                
                ctx.fillStyle = '#1e293b';
                ctx.beginPath();
                ctx.arc(node.x + 9, node.y - 9, 6, 0, Math.PI * 2);
                ctx.fill();

                ctx.strokeStyle = '#00ff66';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.arc(node.x + 9, node.y - 9, 6, 0, Math.PI * 2);
                ctx.stroke();

                ctx.fillStyle = '#00ff66';
                ctx.font = 'bold 8px monospace';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(isCollapsed ? '+' : '-', node.x + 9, node.y - 9);
            }

            ctx.restore();
        });

        ctx.restore();
    }

    // Translate coordinates mapping
    function getTransformedCoords(e) {
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        return {
            x: (mouseX - transform.x) / transform.k,
            y: (mouseY - transform.y) / transform.k
        };
    }

    // Drag, Pan and Selection Handlers
    canvas.addEventListener('mousedown', e => {
        const coords = getTransformedCoords(e);
        
        // Find clicked node
        const clickedNode = visibleNodes.find(node => {
            const style = NODE_STYLES[node.category] || { radius: 8 };
            const dx = node.x - coords.x;
            const dy = node.y - coords.y;
            return dx * dx + dy * dy < (style.radius + 6) * (style.radius + 6);
        });

        if (clickedNode) {
            if (clickedNode.type === 'chat_session') {
                // Check if user clicked the collapse plus/minus bubble coordinate bounds
                const dx = coords.x - (clickedNode.x + 9);
                const dy = coords.y - (clickedNode.y - 9);
                const clickToggle = (dx * dx + dy * dy <= 80);

                if (clickToggle) {
                    const convId = clickedNode.id.replace('chat_', '');
                    if (collapsedConversationIds.has(convId)) {
                        collapsedConversationIds.delete(convId);
                    } else {
                        collapsedConversationIds.add(convId);
                    }
                    calculateTreeLayout();
                    return;
                }
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

        // Manage hover cursor state
        const prevHover = hoverNode;
        hoverNode = visibleNodes.find(node => {
            const style = NODE_STYLES[node.category] || { radius: 8 };
            const dx = node.x - coords.x;
            const dy = node.y - coords.y;
            return dx * dx + dy * dy < (style.radius + 6) * (style.radius + 6);
        });
        
        if (prevHover !== hoverNode) {
            canvas.style.cursor = hoverNode ? 'pointer' : (isPanning ? 'grabbing' : 'grab');
            draw();
        }

        // Tooltip display logic
        if (hoverNode) {
            if (hoverNode.type === 'chat_session') {
                const text = hoverNode.fullTitle || hoverNode.label;
                tooltip.innerHTML = `<strong>Chat Session Hub</strong><br/>${text.replace(/^💬\s*"/, '').replace(/"$/, '')}`;
            } else {
                const titleText = hoverNode.details && hoverNode.details.question ? hoverNode.details.question : 'Q&A Step';
                const cleanText = titleText.replace(/</g, '&lt;').replace(/>/g, '&gt;');
                tooltip.innerHTML = `<strong>${hoverNode.label}</strong><br/>${cleanText}`;
            }
            tooltip.style.left = `${e.clientX + 15}px`;
            tooltip.style.top = `${e.clientY + 15}px`;
            tooltip.classList.remove('hidden');
            tooltip.classList.add('visible');
        } else {
            tooltip.classList.add('hidden');
            tooltip.classList.remove('visible');
        }
    });

    window.addEventListener('mouseup', () => {
        isPanning = false;
    });

    canvas.addEventListener('wheel', e => {
        e.preventDefault();
        const zoomIntensity = 0.08;
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const wheel = e.deltaY < 0 ? 1 : -1;
        const zoomFactor = Math.exp(wheel * zoomIntensity);

        transform.x = mouseX - (mouseX - transform.x) * zoomFactor;
        transform.y = mouseY - (mouseY - transform.y) * zoomFactor;
        transform.k *= zoomFactor;
        transform.k = Math.max(0.2, Math.min(transform.k, 4));
        draw();
    });

    function selectNode(node) {
        selectedNode = node;
        draw();
        
        if (node.type === 'qa' && node.details) {
            detailQuestion.innerText = node.details.question;
            detailAnswer.innerText = node.details.answer;
            nodeBadge.className = 'badge qa';
            nodeBadge.innerText = 'Q&A';
            nodeProject.innerText = node.details.project || 'memlite';
            detailFile.innerText = node.details.fileRef ? `References: ${node.details.fileRef}` : '';
            
            // Context Cart button state toggle
            if (pinnedNodeIds.has(node.id)) {
                btnPin.classList.add('pinned');
                btnPin.querySelector('span').innerText = '📌 Pinned';
            } else {
                btnPin.classList.remove('pinned');
                btnPin.querySelector('span').innerText = '📌 Pin to Cart';
            }
            btnPin.style.display = 'block';
            btnContext.style.display = 'block';
            btnDelete.style.display = 'block';
            detailPanel.classList.remove('hidden');
        } else if (node.type === 'chat_session') {
            detailQuestion.innerText = node.fullTitle || node.label;
            detailAnswer.innerText = "This node represents a conversation session. Click its plus/minus bubble directly to expand or collapse its sequential questions.";
            nodeBadge.className = 'badge project';
            nodeBadge.innerText = 'Chat Session';
            nodeProject.innerText = 'Workspace';
            detailFile.innerText = '';
            
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
        cartCount.innerText = pinnedNodeIds.size;
        cartItemsList.innerHTML = '';

        if (pinnedNodeIds.size === 0) {
            cartItemsList.innerHTML = '<li class="cart-item" style="color: #64748b; font-style: italic; border: none; background: transparent; justify-content: center;">No items in cart</li>';
            return;
        }

        pinnedNodeIds.forEach(id => {
            const node = rawNodes.find(n => n.id === id);
            if (!node) return;

            const li = document.createElement('li');
            li.className = 'cart-item';

            const span = document.createElement('span');
            span.className = 'cart-item-text';
            span.innerText = node.label;
            li.appendChild(span);

            const removeBtn = document.createElement('button');
            removeBtn.className = 'cart-item-remove';
            removeBtn.innerHTML = '&times;';
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                pinnedNodeIds.delete(id);
                updateCartUI();
                draw();
                if (selectedNode && selectedNode.id === id) {
                    selectNode(selectedNode);
                }
            });
            li.appendChild(removeBtn);

            cartItemsList.appendChild(li);
        });
    }

    btnPin.addEventListener('click', () => {
        if (!selectedNode || selectedNode.type !== 'qa') return;

        if (pinnedNodeIds.has(selectedNode.id)) {
            pinnedNodeIds.delete(selectedNode.id);
            btnPin.classList.remove('pinned');
            btnPin.querySelector('span').innerText = '📌 Pin to Cart';
        } else {
            pinnedNodeIds.add(selectedNode.id);
            btnPin.classList.add('pinned');
            btnPin.querySelector('span').innerText = '📌 Pinned';
            
            // Expand cart drawer
            cartDrawer.classList.remove('collapsed');
            btnToggleCart.innerText = '▼';
        }
        
        updateCartUI();
        draw();
    });

    function toggleCartDrawer() {
        const collapsed = cartDrawer.classList.toggle('collapsed');
        btnToggleCart.innerText = collapsed ? '▲' : '▼';
    }

    btnToggleCart.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleCartDrawer();
    });

    document.querySelector('.cart-header').addEventListener('click', toggleCartDrawer);

    btnSyncWorkspace.addEventListener('click', () => {
        if (pinnedNodeIds.size === 0) return;

        const items = Array.from(pinnedNodeIds).map(id => {
            const node = rawNodes.find(n => n.id === id);
            return {
                question: node.details.question,
                answer: node.details.answer
            };
        });

        if (vscode) {
            vscode.postMessage({
                type: 'exportContextFile',
                items: items
            });
        }
    });

    btnCopyCart.addEventListener('click', () => {
        if (pinnedNodeIds.size === 0) return;

        let compiledMarkdown = `# 🧠 Compiled Chat Context\n\n`;
        Array.from(pinnedNodeIds).forEach((id, index) => {
            const node = rawNodes.find(n => n.id === id);
            if (!node) return;
            compiledMarkdown += `## [Step ${index + 1}] Question: ${node.details.question}\n`;
            compiledMarkdown += `Answer:\n${node.details.answer}\n\n`;
            compiledMarkdown += `---\n\n`;
        });

        if (vscode) {
            vscode.postMessage({
                type: 'copyClipboard',
                text: compiledMarkdown
            });
        }
    });

    btnContext.addEventListener('click', () => {
        if (!selectedNode || selectedNode.type !== 'qa') return;

        // Gather all other Q&As in the same conversation thread
        const connectedQAs = [];
        const cId = selectedNode.details.conversationId;
        
        rawNodes.forEach(node => {
            if (node.type === 'qa' && node.id !== selectedNode.id && node.details && node.details.conversationId === cId) {
                connectedQAs.push({
                    question: node.details.question,
                    answer: node.details.answer
                });
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
            vscode.postMessage({
                type: 'deleteNode',
                nodeId: selectedNode.id
            });
            hidePanel();
        }
    });

    // Real-time search query filtering
    searchInput.addEventListener('input', e => {
        const query = e.target.value.toLowerCase().trim();
        searchHighlightIds.clear();
        
        if (query.length > 1) {
            rawNodes.forEach(node => {
                const labelText = node.label.toLowerCase();
                const questionText = (node.details && node.details.question) ? node.details.question.toLowerCase() : '';
                const answerText = (node.details && node.details.answer) ? node.details.answer.toLowerCase() : '';

                if (labelText.includes(query) || questionText.includes(query) || answerText.includes(query)) {
                    searchHighlightIds.add(node.id);
                    
                    // Auto-expand parent Chat Session if Q&A matches query
                    if (node.type === 'qa' && node.details && node.details.conversationId) {
                        collapsedConversationIds.delete(node.details.conversationId);
                    }
                }
            });
            calculateTreeLayout();
        }
        draw();
    });

    clearSearchBtn.addEventListener('click', () => {
        searchInput.value = '';
        searchHighlightIds.clear();
        draw();
    });

    // Listen to messages from TS Extension Host
    window.addEventListener('message', event => {
        const msg = event.data;
        if (msg.type === 'updateGraph') {
            rawNodes = msg.data.nodes || [];
            rawLinks = msg.data.links || [];
            
            // Verify pinned node IDs still exist in active memories
            const validIds = new Set(rawNodes.map(n => n.id));
            pinnedNodeIds = new Set(Array.from(pinnedNodeIds).filter(id => validIds.has(id)));
            updateCartUI();

            calculateTreeLayout();
            if (selectedNode) {
                const currentSelection = visibleNodes.find(n => n.id === selectedNode.id);
                if (currentSelection) {
                    selectNode(currentSelection);
                } else {
                    hidePanel();
                }
            }
        }
    });

    // Initialize layout and notify ready state
    resizeCanvas();
    if (vscode) {
        vscode.postMessage({ type: 'ready' });
    }
})();
