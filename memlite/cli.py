import argparse
import sys
import json
from memlite.memory import Memory
from memlite.mcp_server import MemLiteMCPServer

def main():
    parser = argparse.ArgumentParser(
        prog="memlite",
        description="MemLite — Local-first Cognitive Memory Engine for AI Applications"
    )
    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    # Command: add
    add_parser = subparsers.add_parser("add", help="Add a new memory")
    add_parser.add_argument("content", type=str, help="Memory text content")
    add_parser.add_argument("--user", type=str, default="default_user", help="User ID")
    add_parser.add_argument("--category", type=str, default=None, help="Memory category")
    add_parser.add_argument("--importance", type=float, default=None, help="Importance score (0.0 to 1.0)")
    add_parser.add_argument("--tags", type=str, default=None, help="Comma-separated list of tags")
    add_parser.add_argument("--session-id", type=str, default=None, help="Session ID for chronological threading")
    add_parser.add_argument("--update-existing", action="store_true", help="Supersede older conflicting memories")

    # Command: search
    search_parser = subparsers.add_parser("search", help="Search memories using hybrid retrieval & cognitive graph")
    search_parser.add_argument("query", type=str, help="Search query")
    search_parser.add_argument("--user", type=str, default="default_user", help="User ID")
    search_parser.add_argument("-k", type=int, default=5, help="Number of results")
    search_parser.add_argument("--category", type=str, default=None, help="Category filter")
    search_parser.add_argument("--hops", type=int, default=1, help="Max cognitive graph hops (default: 1)")
    search_parser.add_argument("--dedup", action="store_true", help="Eliminate redundant memories")

    # Command: link
    link_parser = subparsers.add_parser("link", help="Link two memories with a cognitive relation")
    link_parser.add_argument("source_id", type=str, help="Source memory ID")
    link_parser.add_argument("target_id", type=str, help="Target memory ID")
    link_parser.add_argument("--relation", type=str, default="SIMILAR", help="Relation type (e.g. SIMILAR, ENTITY, CAUSAL, PRECEDES)")
    link_parser.add_argument("--weight", type=float, default=1.0, help="Relation weight")
    link_parser.add_argument("--confidence", type=float, default=1.0, help="Confidence score")
    link_parser.add_argument("--user", type=str, default="default_user", help="User ID")

    # Command: unlink
    unlink_parser = subparsers.add_parser("unlink", help="Remove relation between two memories")
    unlink_parser.add_argument("source_id", type=str, help="Source memory ID")
    unlink_parser.add_argument("target_id", type=str, help="Target memory ID")
    unlink_parser.add_argument("--user", type=str, default="default_user", help="User ID")

    # Command: graph
    graph_parser = subparsers.add_parser("graph", help="Display cognitive knowledge graph")
    graph_parser.add_argument("--user", type=str, default="default_user", help="User ID")
    graph_parser.add_argument("--format", choices=["summary", "json"], default="summary", help="Output format")

    # Command: list
    list_parser = subparsers.add_parser("list", help="List stored memories")
    list_parser.add_argument("--user", type=str, default="default_user", help="User ID")
    list_parser.add_argument("--category", type=str, default=None, help="Category filter")
    list_parser.add_argument("--archived", action="store_true", help="Include archived memories")

    # Command: stats
    stats_parser = subparsers.add_parser("stats", help="Show memory database statistics")
    stats_parser.add_argument("--user", type=str, default="default_user", help="User ID")

    # Command: cleanup
    cleanup_parser = subparsers.add_parser("cleanup", help="Run decay cleanup to archive forgotten memories")
    cleanup_parser.add_argument("--user", type=str, default="default_user", help="User ID")

    # Command: mcp
    mcp_parser = subparsers.add_parser("mcp", help="Run MemLite Model Context Protocol (MCP) server")
    mcp_parser.add_argument("--user", type=str, default="default_user", help="User ID")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    if args.command == "mcp":
        server = MemLiteMCPServer(user_id=args.user)
        server.run_stdio()
        return

    mem = Memory(user_id=args.user)

    if args.command == "add":
        tags = [t.strip() for t in args.tags.split(",")] if args.tags else None
        item = mem.add(
            content=args.content,
            category=args.category,
            importance=args.importance,
            tags=tags,
            session_id=args.session_id,
            update_existing=args.update_existing
        )
        print(f"[OK] Memory added (ID: {item.id})")
        print(f"     Category: {item.category} | Importance: {item.importance}")
        if item.tags:
            print(f"     Tags: {', '.join(item.tags)}")
        if item.anchors:
            anchors_summary = []
            if item.anchors.who: anchors_summary.append(f"Who: {', '.join(item.anchors.who)}")
            if item.anchors.where: anchors_summary.append(f"Where: {', '.join(item.anchors.where)}")
            if item.anchors.when: anchors_summary.append(f"When: {', '.join(item.anchors.when)}")
            if item.anchors.what: anchors_summary.append(f"What: {', '.join(item.anchors.what)}")
            if anchors_summary:
                print(f"     Anchors: {' | '.join(anchors_summary)}")

    elif args.command == "search":
        res = mem.search(
            query=args.query,
            k=args.k,
            category=args.category,
            graph_hops=args.hops,
            dedup=args.dedup
        )
        print(f"\nSearch results for: \"{args.query}\" (Confidence: {res['confidence']}):\n")
        for i, detail in enumerate(res.get("details", []), start=1):
            hop_str = f" [Hop {detail['hop_distance']} via {detail['via_relation']}]" if detail.get("hop_distance", 0) > 0 else ""
            print(f"{i}. {detail['content']}{hop_str}")
            print(f"   [Score: {detail['score']:.3f} | Sim: {detail['similarity']:.3f} | KW: {detail['keyword_score']:.3f} | Graph: {detail.get('graph_score', 0):.3f} | Cat: {detail['category']}]")

    elif args.command == "link":
        rel = mem.link(
            source_id=args.source_id,
            target_id=args.target_id,
            relation_type=args.relation,
            weight=args.weight,
            confidence=args.confidence
        )
        print(f"[OK] Linked memory {rel.source_id} -> {rel.target_id} ({rel.relation_type.value if hasattr(rel.relation_type, 'value') else rel.relation_type})")

    elif args.command == "unlink":
        ok = mem.unlink(source_id=args.source_id, target_id=args.target_id)
        if ok:
            print(f"[OK] Removed relations between {args.source_id} and {args.target_id}")
        else:
            print(f"[WARN] No relations found between {args.source_id} and {args.target_id}")

    elif args.command == "graph":
        g = mem.get_graph()
        if args.format == "json":
            print(json.dumps(g, indent=2))
        else:
            print(f"\nCognitive Knowledge Graph for '{args.user}':")
            print(f"Nodes: {len(g['nodes'])} memories | Edges: {len(g['edges'])} relations\n")
            if g['edges']:
                print("Active Relations:")
                for e in g['edges']:
                    print(f"  {e['source']} --[{e['relation_type']} (w={e['weight']:.2f}, fired={e['activation_count']}x)]--> {e['target']}")
            else:
                print("No relation edges created yet.")

    elif args.command == "list":
        items = mem.get_all(
            include_archived=args.archived,
            category=args.category
        )
        print(f"\nStored memories for user '{args.user}' ({len(items)} items):\n")
        for it in items:
            archived_flag = " [ARCHIVED]" if it.is_archived else ""
            print(f"- [{it.category}] {it.content}{archived_flag} (ID: {it.id})")
            if it.tags:
                print(f"  Tags: {', '.join(it.tags)}")

    elif args.command == "stats":
        st = mem.stats()
        print("\nMemLite Memory Statistics:")
        print(json.dumps(st, indent=2))

    elif args.command == "cleanup":
        archived_count = mem.cleanup()
        print(f"[OK] Cleanup completed. Archived {archived_count} decayed memory items.")

if __name__ == "__main__":
    main()
