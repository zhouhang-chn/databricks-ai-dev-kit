#!/usr/bin/env python3
import json
import os
import sys
import argparse
from datetime import datetime

def analyze_trace(trace_data):
    """Analyze trace data and return categorized insights."""
    spans = trace_data.get('data', {}).get('spans', [])
    
    # Get total tokens from metadata
    info = trace_data.get('info', {})
    metadata = info.get('trace_metadata', {})
    token_usage = json.loads(metadata.get('mlflow.trace.tokenUsage', '{}'))
    
    llm_spans = [s for s in spans if s.get('name') == 'llm']
    if not llm_spans:
        return None

    # Use the last LLM span for the full accumulated context
    last_llm = llm_spans[-1]
    span_inputs_raw = last_llm['attributes'].get('mlflow.spanInputs', '{}')
    
    # Check if inputs were truncated by MLflow (very common)
    is_truncated = span_inputs_raw.endswith('..."') or len(span_inputs_raw) > 30000
    
    try:
        if span_inputs_raw.endswith('..."'):
            # Try to fix partial JSON if it's just a simple truncation
            inputs = json.loads(span_inputs_raw[:-4] + '"}')
        else:
            inputs = json.loads(span_inputs_raw)
    except:
        inputs = {}
    
    messages = inputs.get('messages', [])
    system_prompt = inputs.get('system', '')
    
    # Estimate tool definitions if we can't find them in the trace
    # In many traces, tool definitions are the bulk of the tokens but are often 
    # hidden from the primary 'messages' list in the tracer.
    tools_in_trace = inputs.get('tools', [])
    tools_char_count = len(json.dumps(tools_in_trace))
    
    report = {
        "trace_id": info.get('trace_id'),
        "timestamp": info.get('request_time'),
        "duration_ms": info.get('execution_duration_ms'),
        "total_tokens": token_usage.get('total_tokens', 0),
        "input_tokens": token_usage.get('input_tokens', 0),
        "output_tokens": token_usage.get('output_tokens', 0),
        "is_truncated": is_truncated,
        "categories": {
            "System Prompt": len(system_prompt),
            "Tool Definitions": tools_char_count,
            "Conversation History": 0,
            "Tool Results": 0,
            "Current Prompt": 0
        },
        "prompts": {
            "system": system_prompt,
            "history": [],
            "current": ""
        }
    }
    
    # If the total character count is significantly lower than the token count,
    # and we know there are many tools, we can infer the tool definition impact.
    total_reported_chars = len(system_prompt) + tools_char_count
    
    for i, msg in enumerate(messages):
        # ... (rest of message loop remains similar)
        role = msg.get('role')
        content = msg.get('content', '')
        
        content_str = ""
        is_tool_result = False
        
        if isinstance(content, list):
            for block in content:
                if isinstance(block, dict):
                    if 'text' in block:
                        content_str += block['text']
                    elif 'input' in block:
                        content_str += f"\n[Tool Use: {block.get('name')}]\n{json.dumps(block.get('input'), indent=2)}"
                    elif 'type' in block and block['type'] == 'tool_result':
                        is_tool_result = True
                        if isinstance(block.get('content'), list):
                            for sub in block['content']:
                                if isinstance(sub, dict) and 'text' in sub:
                                    content_str += sub['text']
                        else:
                            content_str += str(block.get('content', ''))
        else:
            content_str = str(content)
            
        char_count = len(content_str)
        
        if i == 0 and role == 'user' and not is_tool_result:
             report["prompts"]["current"] = content_str
             report["categories"]["Current Prompt"] = char_count
        elif is_tool_result:
            report["categories"]["Tool Results"] += char_count
            report["prompts"]["history"].append({"role": "tool", "content": content_str})
        else:
            report["categories"]["Conversation History"] += char_count
            report["prompts"]["history"].append({"role": role, "content": content_str})

    return report

def generate_markdown(report):
    """Generate Markdown report from analysis."""
    lines = []
    lines.append(f"# Token Usage Analysis: {report['trace_id']}")
    lines.append("")
    lines.append("## Executive Summary")
    lines.append(f"- **Total Tokens:** {report['total_tokens']:,}")
    lines.append(f"- **Input/Context:** {report['input_tokens']:,} tokens")
    lines.append(f"- **Model Output:** {report['output_tokens']:,} tokens")
    lines.append(f"- **Execution Time:** {report['duration_ms']/1000:.2f}s")
    if report['is_truncated']:
        lines.append("- ⚠️ **Note:** The trace data in MLflow was truncated, so some detailed counts are estimated.")
    lines.append("")
    
    lines.append("## 1. Context Breakdown")
    lines.append("| Category | Captured Chars | Est. Tokens | % of Input |")
    lines.append("| :--- | :--- | :--- | :--- |")
    
    total_input_tokens = report['input_tokens']
    total_chars = sum(report['categories'].values())
    
    # Inferred tokens: total_input - (chars / 4)
    # This accounts for everything MLflow truncated
    captured_tokens = int(total_chars / 3.5) # Rough estimate for captured chars
    missing_tokens = max(0, total_input_tokens - captured_tokens)
    
    for cat, count in report['categories'].items():
        est_tokens = int(count / 3.5)
        pct = (est_tokens / total_input_tokens * 100) if total_input_tokens > 0 else 0
        lines.append(f"| {cat} | {count:,} | ~{est_tokens:,} | {pct:.1f}% |")
    
    if missing_tokens > 500:
        lines.append(f"| **Truncated Data** (Missing from Trace) | - | ~{missing_tokens:,} | {(missing_tokens/total_input_tokens*100):.1f}% |")
    
    lines.append("")
    
    lines.append("## 2. Why is the token count so high?")
    lines.append(f"The trace shows **{report['input_tokens']:,} input tokens**, but only **{total_chars:,} characters** were captured in the MLflow log.")
    lines.append("")
    lines.append("### Key Drivers:")
    # Key Driver Analysis
    lines.append("### Key Drivers:")

    # Check if system/tools are missing from trace but tokens are high
    inferred_baseline = 40000 # Typical baseline for 46 tools + system prompt
    if report['input_tokens'] > inferred_baseline and report['categories']['System Prompt'] == 0:
        lines.append(f"1. **Invisible Baseline Context (~{inferred_baseline:,}+ tokens):** The MLflow tracer (`mlflow.anthropic.autolog`) currently **omits** the `system` prompt and `tools` definitions from the logged attributes, even though they are sent to the model. These account for the bulk of the {report['input_tokens']:,} tokens.")

    lines.append("2. **Tool Definitions (46 tools):** Each Databricks MCP tool has a JSON schema. Multiplying these by 46 creates a massive baseline context sent with *every* request.")

    if report['categories']['Tool Results'] > 10000:
        lines.append("3. **Technical Metadata:** Large tool outputs (DDLs, file contents) further inflate the context.")

    lines.append("4. **Accumulated History:** Full conversation transcripts are sent back each time.")
    lines.append("")

    lines.append("## 3. Recommended Actions")
    lines.append("- [ ] **Dynamic Tool Loading:** Only register MCP tools relevant to the user's intent or current project.")
    lines.append("- [ ] **Tool Schema Compression:** Shorten descriptions and remove optional fields from tool JSON schemas.")
    if report['input_tokens'] > 100000:
        lines.append("- [ ] **Implement Tool Result Summarization:** (High Priority) Modify `get_table_stats_and_schema` to return only basic metadata by default.")

    # Generate automatic insights
    if report['categories']['Tool Results'] > total_chars * 0.5:
        lines.append("- ⚠️ **Heavy Tool Results:** Tool outputs (JSON/DDL) are dominating the context. This is often caused by retrieving full table schemas or large file contents.")
    if report['categories']['System Prompt'] > 30000:
        lines.append("- ℹ️ **Large System Context:** The system prompt and tool definitions are large. Consider pruning tool definitions that aren't needed for this session.")
    if report['categories']['Conversation History'] > total_chars * 0.3:
        lines.append("- ℹ️ **Growing History:** The conversation is getting long. The model is re-reading many previous turns.")
        
    lines.append("")
    lines.append("## 3. Recommended Actions")
    if report['categories']['Tool Results'] > 50000:
        lines.append("- [ ] **Implement Tool Pagination/Summarization:** Modify tools like `get_table_stats_and_schema` to return summaries by default.")
    lines.append("- [ ] **Session Pruning:** Start a fresh session if history becomes too large.")
    lines.append("- [ ] **Selective Skill Loading:** Only load the specific skills needed for the current task.")
    lines.append("")
    
    lines.append("## 4. Detailed Prompts (Raw)")
    lines.append("")
    lines.append("### System Prompt")
    lines.append("```text")
    lines.append(report['prompts']['system'])
    lines.append("```")
    lines.append("")
    lines.append("### Current User Request")
    lines.append("```text")
    lines.append(report['prompts']['current'])
    lines.append("```")
    lines.append("")
    lines.append("### Context History")
    for msg in report['prompts']['history']:
        lines.append(f"#### {msg['role'].upper()}")
        lines.append("```text")
        content = msg['content']
        if len(content) > 5000:
            lines.append(content[:5000] + "\n... [TRUNCATED FOR REPORT READABILITY] ...")
        else:
            lines.append(content)
        lines.append("```")
        lines.append("")

    return "\n".join(lines)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate token usage report from trace JSON")
    parser.add_argument("input_file", help="Trace JSON file")
    parser.add_argument("--output", "-o", help="Output Markdown file")
    
    args = parser.parse_args()
    
    with open(args.input_file, 'r') as f:
        data = json.load(f)
        
    report_data = analyze_trace(data)
    if report_data:
        md = generate_markdown(report_data)
        if args.output:
            with open(args.output, 'w') as f:
                f.write(md)
            print(f"Report generated: {args.output}")
        else:
            print(md)
    else:
        print("Error: Could not analyze trace data")
