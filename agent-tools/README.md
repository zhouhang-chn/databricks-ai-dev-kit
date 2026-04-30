# Agent Tools

Tools for analyzing and debugging agent conversations, token usage, and MLflow traces.

## Tools

### 1. `dump_trace.py`
Retrieves a full trace JSON from MLflow (using `MLFLOW_TRACKING_URI=databricks`).

**Usage:**
```bash
./agent-tools/dump_trace.py <trace_id> -o <output_file.json>
```

### 2. `generate_report.py`
Analyzes a trace JSON file and generates a detailed Markdown report with token breakdowns, insights, and recommended actions.

**Usage:**
```bash
./agent-tools/generate_report.py <input_file.json> -o <report.md>
```

## Example Workflow

To analyze a specific trace and generate a report:

```bash
# 1. Dump the trace
./agent-tools/dump_trace.py tr-9970d5a2ab3778aa313e91e7d87b1c60 -o /tmp/trace.json

# 2. Generate the report
./agent-tools/generate_report.py /tmp/trace.json -o docs/dev/token-analysis.md
```
