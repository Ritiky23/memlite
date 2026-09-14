import sys
import os
import json
import logging
from typing import Dict, Any, Optional
from memlite.memory import Memory
from memlite.invariants import InvariantsLedger
from memlite.provenance import ProvenanceTracker

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s", stream=sys.stderr)
logger = logging.getLogger("memlite-mcp")

class MemLiteMCPServer:
    """
    Standard Model Context Protocol (MCP) server for MemLite with Cognitive Knowledge Graph.
    Communicates via JSON-RPC 2.0 over standard I/O (stdin/stdout).
    Compatible with Claude Desktop, Cursor, Antigravity, and other MCP clients.
    """
    def __init__(self, user_id: str = "default_user", db_path: Optional[str] = None):
        kwargs = {}
        if db_path:
            kwargs["db_path"] = db_path
        self.memory = Memory(user_id=user_id, **kwargs)
        self.user_id = user_id

        # Determine storage directory for invariants and provenance
        actual_db = getattr(self.memory.storage, "db_path", "memlite.db")
        base_dir = os.path.dirname(os.path.abspath(actual_db))
        self.invariants = InvariantsLedger(os.path.join(base_dir, "invariants.json"))
        self.provenance = ProvenanceTracker(os.path.join(base_dir, "provenance.json"))

    def get_tools_manifest(self) -> list:
        return [
            {
                "name": "add_memory",
                "description": "Store a user fact, preference, project detail, or context into cognitive long-term memory.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "content": {
                            "type": "string",
                            "description": "The memory content or fact to store."
                        },
                        "category": {
                            "type": "string",
                            "enum": ["Preference", "Personal", "Skill", "Project", "Temporary", "General"],
                            "description": "Category for the memory."
                        },
                        "importance": {
                            "type": "number",
                            "description": "Importance score between 0.0 and 1.0 (defaults to 0.5)."
                        },
                        "tags": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Optional tags associated with this memory."
                        },
                        "session_id": {
                            "type": "string",
                            "description": "Optional session identifier for chronological flow."
                        },
                        "update_existing": {
                            "type": "boolean",
                            "description": "If True, supersedes conflicting or older memories and creates a SUPERSEDES edge."
                        }
                    },
                    "required": ["content"]
                }
            },
            {
                "name": "search_memory",
                "description": "Search long-term memories using hybrid semantic vector, keyword search, and cognitive spreading activation.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Search query or question."
                        },
                        "k": {
                            "type": "integer",
                            "description": "Number of memories to return (default: 5)."
                        },
                        "category": {
                            "type": "string",
                            "description": "Filter by specific category."
                        },
                        "graph_hops": {
                            "type": "integer",
                            "description": "Max associative hops across knowledge graph (default: 1)."
                        },
                        "dedup": {
                            "type": "boolean",
                            "description": "Prune redundant/duplicate memories."
                        }
                    },
                    "required": ["query"]
                }
            },
            {
                "name": "link_memories",
                "description": "Create an explicit cognitive relation edge between two memories (e.g. SIMILAR, ENTITY, CAUSAL, PRECEDES, SUPERSEDES).",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "source_id": {
                            "type": "string",
                            "description": "ID of the source memory."
                        },
                        "target_id": {
                            "type": "string",
                            "description": "ID of the target memory."
                        },
                        "relation_type": {
                            "type": "string",
                            "enum": ["SIMILAR", "ENTITY", "TEMPORAL", "CAUSAL", "CONTRADICTS", "SUPERSEDES", "DERIVED_FROM", "PRECEDES", "FOLLOWS", "CO_RECALLED"],
                            "description": "Type of cognitive relationship."
                        },
                        "weight": {
                            "type": "number",
                            "description": "Edge weight (default: 1.0)."
                        },
                        "confidence": {
                            "type": "number",
                            "description": "Edge confidence (default: 1.0)."
                        }
                    },
                    "required": ["source_id", "target_id"]
                }
            },
            {
                "name": "unlink_memories",
                "description": "Remove relation edges between two memories.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "source_id": {
                            "type": "string",
                            "description": "ID of the source memory."
                        },
                        "target_id": {
                            "type": "string",
                            "description": "ID of the target memory."
                        }
                    },
                    "required": ["source_id", "target_id"]
                }
            },
            {
                "name": "get_memory_graph",
                "description": "Get the full associative knowledge graph (nodes and edges) for visualizer or multi-hop analysis.",
                "inputSchema": {
                    "type": "object",
                    "properties": {}
                }
            },
            {
                "name": "list_memories",
                "description": "List all active memories for the user.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "category": {
                            "type": "string",
                            "description": "Filter by category."
                        },
                        "include_archived": {
                            "type": "boolean",
                            "description": "Whether to include archived decayed memories."
                        }
                    }
                }
            },
            {
                "name": "delete_memory",
                "description": "Delete a memory item by ID.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "memory_id": {
                            "type": "string",
                            "description": "ID of the memory to delete."
                        }
                    },
                    "required": ["memory_id"]
                }
            },
            {
                "name": "memory_stats",
                "description": "Get statistics about the user's stored memories and cognitive relations.",
                "inputSchema": {
                    "type": "object",
                    "properties": {}
                }
            },
            {
                "name": "get_rehydrate_capsule",
                "description": "Retrieve high-priority Tier 0 (Invariants), Tier 1 (Causal File Provenance), and Tier 2 (Disk Reality Check) context capsule (<600 tokens) to recover lost agent context.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "workspace_root": {
                            "type": "string",
                            "description": "Path to active workspace root for file reality checking."
                        },
                        "last_n_steps": {
                            "type": "integer",
                            "description": "Number of recent causal action steps to include (default: 3)."
                        }
                    }
                }
            },
            {
                "name": "add_invariant",
                "description": "Register an unalterable Tier 0 invariant rule or negative constraint (e.g. 'Never use PyTorch').",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "content": {
                            "type": "string",
                            "description": "The exact verbatim text of the rule."
                        },
                        "rule_type": {
                            "type": "string",
                            "enum": ["NEGATIVE_CONSTRAINT", "ARCHITECTURAL_DECISION", "PREFERENCE"],
                            "description": "Type of invariant."
                        },
                        "scope": {
                            "type": "string",
                            "description": "Scope of the rule (e.g. 'global' or 'file:setup.py'). Default: global."
                        },
                        "supersedes_id": {
                            "type": "string",
                            "description": "Optional ID of an older rule this invariant supersedes."
                        }
                    },
                    "required": ["content"]
                }
            },
            {
                "name": "revoke_invariant",
                "description": "Revoke an existing invariant rule when requirements change to prevent prompt deadlocks.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "rule_id": {
                            "type": "string",
                            "description": "ID of the rule to revoke."
                        },
                        "reason": {
                            "type": "string",
                            "description": "Reason for revoking the rule."
                        }
                    },
                    "required": ["rule_id"]
                }
            },
            {
                "name": "supersede_invariant",
                "description": "Replace an older invariant rule with an updated rule.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "old_id": {
                            "type": "string",
                            "description": "ID of the old rule to supersede."
                        },
                        "new_content": {
                            "type": "string",
                            "description": "Verbatim text of the new rule."
                        },
                        "rule_type": {
                            "type": "string",
                            "description": "Rule type (default: NEGATIVE_CONSTRAINT)."
                        },
                        "scope": {
                            "type": "string",
                            "description": "Scope (default: global)."
                        }
                    },
                    "required": ["old_id", "new_content"]
                }
            },
            {
                "name": "check_workspace_freshness",
                "description": "Perform an instant SHA-256 disk reality check on all tracked files to detect stale memory.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "workspace_root": {
                            "type": "string",
                            "description": "Path to workspace root."
                        }
                    },
                    "required": ["workspace_root"]
                }
            },
            {
                "name": "record_file_action",
                "description": "Record a file creation/modification with diff snippet or large-diff semantic breadcrumbs and SHA-256 hash.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "file_path": {
                            "type": "string",
                            "description": "Path of the modified file."
                        },
                        "action": {
                            "type": "string",
                            "description": "created, modified, or deleted."
                        },
                        "diff_text": {
                            "type": "string",
                            "description": "Unified diff or code content."
                        },
                        "intent": {
                            "type": "string",
                            "description": "User intent or goal behind the change."
                        },
                        "step_index": {
                            "type": "integer",
                            "description": "Chronological step number."
                        }
                    },
                    "required": ["file_path", "action", "diff_text", "intent", "step_index"]
                }
            }
        ]

    def handle_call_tool(self, name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        if name == "add_memory":
            item = self.memory.add(
                content=arguments["content"],
                category=arguments.get("category"),
                importance=arguments.get("importance"),
                tags=arguments.get("tags"),
                session_id=arguments.get("session_id"),
                update_existing=arguments.get("update_existing", False)
            )
            return {
                "content": [
                    {
                        "type": "text",
                        "text": f"Successfully stored memory (id: {item.id}, category: {item.category}, importance: {item.importance})"
                    }
                ]
            }
        elif name == "search_memory":
            res = self.memory.search(
                query=arguments["query"],
                k=arguments.get("k", 5),
                category=arguments.get("category"),
                graph_hops=arguments.get("graph_hops", 1),
                dedup=arguments.get("dedup", False)
            )
            return {
                "content": [
                    {
                        "type": "text",
                        "text": json.dumps(res, indent=2)
                    }
                ]
            }
        elif name == "link_memories":
            rel = self.memory.link(
                source_id=arguments["source_id"],
                target_id=arguments["target_id"],
                relation_type=arguments.get("relation_type", "SIMILAR"),
                weight=arguments.get("weight", 1.0),
                confidence=arguments.get("confidence", 1.0)
            )
            return {
                "content": [
                    {
                        "type": "text",
                        "text": f"Linked memory {rel.source_id} -> {rel.target_id} with relation {rel.relation_type}"
                    }
                ]
            }
        elif name == "unlink_memories":
            success = self.memory.unlink(
                source_id=arguments["source_id"],
                target_id=arguments["target_id"]
            )
            return {
                "content": [
                    {
                        "type": "text",
                        "text": f"Unlinked memories {arguments['source_id']} <-> {arguments['target_id']} (success: {success})"
                    }
                ]
            }
        elif name == "get_memory_graph":
            graph = self.memory.get_graph()
            return {
                "content": [
                    {
                        "type": "text",
                        "text": json.dumps(graph, indent=2)
                    }
                ]
            }
        elif name == "list_memories":
            items = self.memory.get_all(
                include_archived=arguments.get("include_archived", False),
                category=arguments.get("category")
            )
            mem_list = [{"id": m.id, "content": m.content, "category": m.category, "tags": m.tags, "importance": m.importance} for m in items]
            return {
                "content": [
                    {
                        "type": "text",
                        "text": json.dumps(mem_list, indent=2)
                    }
                ]
            }
        elif name == "delete_memory":
            self.memory.delete(arguments["memory_id"])
            return {
                "content": [
                    {
                        "type": "text",
                        "text": f"Deleted memory {arguments['memory_id']}"
                    }
                ]
            }
        elif name == "get_rehydrate_capsule":
            root = arguments.get("workspace_root") or os.getcwd()
            steps = arguments.get("last_n_steps", 3)
            t0 = self.invariants.format_tier0_capsule()
            t1 = self.provenance.format_tier1_provenance(last_n_steps=steps)
            t2 = self.provenance.format_tier2_freshness(root)
            capsule = f"# ⚡ MEMLITE AGENT RECOVERY CAPSULE\n\n{t0}\n{t1}\n{t2}"
            return {
                "content": [
                    {
                        "type": "text",
                        "text": capsule
                    }
                ]
            }
        elif name == "add_invariant":
            rule = self.invariants.add_rule(
                content=arguments["content"],
                rule_type=arguments.get("rule_type", "NEGATIVE_CONSTRAINT"),
                scope=arguments.get("scope", "global"),
                supersedes_id=arguments.get("supersedes_id")
            )
            return {
                "content": [
                    {
                        "type": "text",
                        "text": f"Registered Tier 0 Invariant (id: {rule.id}, type: {rule.rule_type}): '{rule.content}'"
                    }
                ]
            }
        elif name == "revoke_invariant":
            rule = self.invariants.revoke_rule(
                rule_id=arguments["rule_id"],
                reason=arguments.get("reason", "")
            )
            if not rule:
                raise ValueError(f"Rule ID '{arguments['rule_id']}' not found.")
            return {
                "content": [
                    {
                        "type": "text",
                        "text": f"Revoked Invariant (id: {rule.id}): '{rule.content}' (reason: {rule.revoked_reason})"
                    }
                ]
            }
        elif name == "supersede_invariant":
            new_rule = self.invariants.supersede_rule(
                old_id=arguments["old_id"],
                new_content=arguments["new_content"],
                rule_type=arguments.get("rule_type", "NEGATIVE_CONSTRAINT"),
                scope=arguments.get("scope", "global")
            )
            return {
                "content": [
                    {
                        "type": "text",
                        "text": f"Superseded rule {arguments['old_id']} -> new rule (id: {new_rule.id}): '{new_rule.content}'"
                    }
                ]
            }
        elif name == "check_workspace_freshness":
            res = self.provenance.verify_freshness(arguments["workspace_root"])
            return {
                "content": [
                    {
                        "type": "text",
                        "text": json.dumps(res, indent=2)
                    }
                ]
            }
        elif name == "record_file_action":
            rec = self.provenance.record_action(
                file_path=arguments["file_path"],
                action=arguments["action"],
                diff_text=arguments["diff_text"],
                intent=arguments["intent"],
                step_index=arguments["step_index"]
            )
            return {
                "content": [
                    {
                        "type": "text",
                        "text": f"Recorded file action on {rec.file_path} (step {rec.step_index}, SHA: {rec.file_hash_after})"
                    }
                ]
            }
        else:
            raise ValueError(f"Unknown tool: {name}")

    def run_stdio(self):
        """Main stdio loop processing JSON-RPC messages."""
        logger.info("MemLite MCP Server started on stdio.")
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
                req_id = msg.get("id")
                method = msg.get("method")
                params = msg.get("params", {})

                if method == "tools/list":
                    response = {
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "result": {
                            "tools": self.get_tools_manifest()
                        }
                    }
                elif method == "tools/call":
                    tool_name = params.get("name")
                    arguments = params.get("arguments", {})
                    try:
                        tool_res = self.handle_call_tool(tool_name, arguments)
                        response = {
                            "jsonrpc": "2.0",
                            "id": req_id,
                            "result": tool_res
                        }
                    except Exception as err:
                        response = {
                            "jsonrpc": "2.0",
                            "id": req_id,
                            "error": {
                                "code": -32603,
                                "message": str(err)
                            }
                        }
                elif method == "initialize":
                    response = {
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "result": {
                            "protocolVersion": "2024-11-05",
                            "capabilities": {
                                "tools": {}
                            },
                            "serverInfo": {
                                "name": "memlite-mcp-server",
                                "version": "0.3.0"
                            }
                        }
                    }
                else:
                    response = {
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "error": {
                            "code": -32601,
                            "message": f"Method not found: {method}"
                        }
                    }

                sys.stdout.write(json.dumps(response) + "\n")
                sys.stdout.flush()

            except Exception as e:
                logger.error(f"Error handling MCP request: {e}")
                err_resp = {
                    "jsonrpc": "2.0",
                    "id": None,
                    "error": {
                        "code": -32700,
                        "message": f"Parse error: {str(e)}"
                    }
                }
                sys.stdout.write(json.dumps(err_resp) + "\n")
                sys.stdout.flush()

def main():
    import argparse
    parser = argparse.ArgumentParser(description="MemLite MCP Server")
    parser.add_argument("--user-id", default="default_user", help="Default user ID for memories")
    parser.add_argument("--db-path", default=None, help="Custom SQLite DB path")
    args = parser.parse_args()

    server = MemLiteMCPServer(user_id=args.user_id, db_path=args.db_path)
    server.run_stdio()

if __name__ == "__main__":
    main()
