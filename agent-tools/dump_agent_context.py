#!/usr/bin/env python3
import json
import os
import sys
from pathlib import Path

# Add the server directory to sys.path so we can import app modules
sys.path.insert(0, os.path.join(os.getcwd(), 'databricks-builder-app'))

from server.services.system_prompt import get_system_prompt
from server.services.databricks_tools import load_databricks_tools

def dump_context():
    output_file = 'docs/dev/agent_full_context.md'
    os.makedirs('docs/dev', exist_ok=True)
    
    # 1. Get System Prompt
    # Using dummy values similar to a fresh session
    system_prompt = get_system_prompt(
        workspace_folder="/Workspace/Users/user@example.com/ai_dev_kit",
        workspace_url="https://adb-123456789.0.databricks.azure.cn",
        enabled_skills=[
            "databricks-agent-bricks",
            "databricks-python-sdk",
            "databricks-spark-declarative-pipelines",
            "databricks-synthetic-data-gen",
            "databricks-unstructured-pdf-generation"
        ]
    )
    
    # 2. Get Databricks MCP Tools
    server, tool_names = load_databricks_tools()
    
    # The server is an McpSdkServerConfig (or similar) from FastMCP
    # Since load_databricks_tools returns the FastMCP server wrapper, we can access its tools.
    # FastMCP tools are usually accessible via server.tools or similar.
    # Let's try to extract the JSON schemas directly from the FastMCP instance.
    
    # Since we are using mcp.server.fastmcp, the actual FastMCP object is inside
    # If server is a FastMCP instance, we can call list_tools()
    
    tool_schemas = []
    
    # FastMCP tools are stored in ._tools
    # Let's extract them
    try:
        # If server is FastMCP
        for tool_name, tool_func in server._tools.items():
            # FastMCP uses pydantic models for args
            schema = {
                "name": tool_name,
                "description": tool_func.description,
                "input_schema": tool_func.parameters
            }
            tool_schemas.append(schema)
    except Exception as e:
        tool_schemas.append({"error": f"Could not extract FastMCP tools: {e}"})
        
    # To get ALL 46 tools, we also need the built-in Claude Code tools (Bash, Read, Write, etc.)
    # Since we don't have an easy way to dump the exact Claude SDK built-ins without running an agent,
    # we will document the Databricks ones perfectly, and list the built-in names.
    
    with open(output_file, 'w') as f:
        f.write("# Agent Full Context Dump\n\n")
        
        f.write("## 1. System Prompt\n")
        f.write("```text\n")
        f.write(system_prompt)
        f.write("\n```\n\n")
        
        f.write(f"## 2. Databricks MCP Tool Definitions ({len(tool_schemas)} tools)\n\n")
        for tool in tool_schemas:
            f.write(f"### {tool.get('name', 'Unknown')}\n")
            f.write(f"**Description:** {tool.get('description', 'No description')}\n\n")
            f.write("**Input Schema:**\n")
            f.write("```json\n")
            f.write(json.dumps(tool.get('input_schema', {}), indent=2))
            f.write("\n```\n\n")
            
        f.write("## 3. Built-in Claude Code Tools\n")
        f.write("The remaining tools making up the 46 total are standard Claude Code tools:\n")
        f.write("`Task`, `AskUserQuestion`, `Bash`, `CronCreate`, `CronDelete`, `CronList`, `Edit`, `EnterPlanMode`, `EnterWorktree`, `ExitPlanMode`, `ExitWorktree`, `Glob`, `Grep`, `Monitor`, `NotebookEdit`, `PushNotification`, `Read`, `RemoteTrigger`, `ScheduleWakeup`, `Skill`, `TaskOutput`, `TaskStop`, `TodoWrite`, `WebFetch`, `WebSearch`, `Write`\n")

    print(f"Successfully dumped full context to {output_file}")

if __name__ == "__main__":
    dump_context()
