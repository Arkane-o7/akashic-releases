"""Live extension probes, imported exclusively from the installed app payload.

Input fixtures are intentionally synthetic. MCP traffic, dispatch, discovery,
configuration and skill filesystem operations are real; no functions are mocked.
"""
import json
import os
from pathlib import Path
import sys
import traceback

if sys.argv[1:2] == ["--stdio"]:
    import anyio
    from mcp import types
    from mcp.server import Server
    from mcp.server.stdio import stdio_server

    async def list_tools(ctx, params):
        return types.ListToolsResult(tools=[types.Tool(name="add", description="Add two integers for a synthetic protocol check.", inputSchema={"type": "object", "properties": {"a": {"type": "integer"}, "b": {"type": "integer"}}, "required": ["a", "b"]})])

    async def call_tool(ctx, params):
        args = params.arguments
        return types.CallToolResult(content=[types.TextContent(type="text", text=str(args["a"] + args["b"]))])

    server = Server("release-stdio", on_list_tools=list_tools, on_call_tool=call_tool)

    async def serve():
        async with stdio_server() as (read, write):
            await server.run(read, write, server.create_initialization_options())

    anyio.run(serve)
    sys.exit(0)

source, home, report_path = map(Path, sys.argv[1:4])
sys.path.insert(0, str(source))
report = {"python": sys.executable, "source": str(source), "checks": []}


def check(name, fn):
    try:
        result = fn()
        report["checks"].append({"name": name, "status": "passed", "result": result})
    except Exception:
        report["checks"].append({"name": name, "status": "failed", "error": traceback.format_exc()})
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")


def skills():
    from model_tools import handle_function_call
    from tools.skills_tool import skills_list, skill_view
    content = "---\nname: release-smoke\ndescription: Synthetic release verification skill.\n---\nReply with the validation phrase SKY-824.\n"
    created = handle_function_call("skill_manage", {"action": "create", "name": "release-smoke", "content": content})
    assert "error" not in json.loads(created), created
    viewed = json.loads(skill_view("release-smoke"))
    assert "SKY-824" in json.dumps(viewed), viewed
    listed = json.loads(skills_list())
    assert any(item["name"] == "release-smoke" for item in listed["skills"]), listed
    assert (home / "skills/release-smoke/SKILL.md").is_file()
    return {"created": json.loads(created), "skill_count": listed["count"], "viewed": viewed}


def plugin():
    import yaml
    from akashic_cli.plugins import get_plugin_manager
    from tools.registry import registry
    directory = home / "plugins/release-smoke"
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "plugin.yaml").write_text("name: release-smoke\nversion: 1.0.0\ndescription: Synthetic local validation plugin\n", encoding="utf-8")
    (directory / "__init__.py").write_text('''import json
def register(ctx):
    ctx.register_tool(name="release_smoke_add", toolset="release_smoke", schema={"name":"release_smoke_add","description":"Add two integers.","parameters":{"type":"object","properties":{"a":{"type":"integer"},"b":{"type":"integer"}},"required":["a","b"]}}, handler=lambda args, **kw: json.dumps({"sum":args["a"]+args["b"]}))
''', encoding="utf-8")
    config_path = home / "config.yaml"
    config = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
    config.setdefault("plugins", {})["enabled"] = ["release-smoke"]
    config_path.write_text(yaml.safe_dump(config), encoding="utf-8")
    manager = get_plugin_manager()
    manager.discover_and_load(force=True)
    entries = manager.list_plugins()
    found = [item for item in entries if item["name"] == "release-smoke"]
    assert found and found[0]["enabled"] and not found[0]["error"], entries
    response = registry.dispatch("release_smoke_add", {"a": 19, "b": 23}, scope=manager.scope_key)
    assert json.loads(response)["sum"] == 42, response
    config["plugins"]["enabled"] = []
    config_path.write_text(yaml.safe_dump(config), encoding="utf-8")
    manager.discover_and_load(force=True)
    assert registry.get_entry("release_smoke_add", scope=manager.scope_key) is None
    return {"registered": found, "dispatch": response, "disabled_tool_removed": True}


def stdio_mcp():
    from tools.mcp_tool_discovery import register_mcp_servers
    from tools.mcp_tool_lifecycle import shutdown_mcp_servers
    from tools.registry import registry
    try:
        names = register_mcp_servers({"release_stdio": {"command": sys.executable, "args": [str(Path(__file__).resolve()), "--stdio"], "lazy": False}})
        name = next(name for name in names if name.endswith("__add"))
        response = registry.dispatch(name, {"a": 20, "b": 22})
        parsed = json.loads(response) if isinstance(response, str) else response
        assert not parsed.get("error") and "42" in json.dumps(parsed), parsed
        return {"tools": names, "response": parsed}
    finally:
        shutdown_mcp_servers()


def mcp():
    from tools.mcp_tool_discovery import register_mcp_servers, get_mcp_status
    from tools.mcp_tool_lifecycle import shutdown_mcp_servers
    from tools.registry import registry
    try:
        names = register_mcp_servers({"release_docs": {"url": "https://learn.microsoft.com/api/mcp", "lazy": False, "timeout": 40}})
        matching = [name for name in names if name.endswith("microsoft_docs_search")]
        assert matching, {"tools": names, "status": get_mcp_status()}
        name = matching[0]
        schema = registry.get_schema(name)
        params = schema.get("parameters", schema.get("inputSchema", {}))
        properties = params.get("properties", {})
        query_key = "query" if "query" in properties else "question"
        assert query_key in properties, schema
        response = registry.dispatch(name, {query_key: "How to list files with PowerShell Get-ChildItem?"})
        parsed = json.loads(response) if isinstance(response, str) else response
        assert not parsed.get("error"), parsed
        assert "learn.microsoft.com" in json.dumps(parsed), parsed
        return {"tools": names, "schema": schema, "response": parsed}
    finally:
        shutdown_mcp_servers()


check("local skill create, discover and read through production handlers", skills)
check("local plugin opt-in, load, tool dispatch and disable", plugin)
check("local subprocess MCP discovery and tool call", stdio_mcp)
check("public HTTPS MCP discovery and actual documentation search", mcp)
sys.__stdout__.write(json.dumps(report) + "\n")
sys.exit(1 if any(row["status"] == "failed" for row in report["checks"]) else 0)
