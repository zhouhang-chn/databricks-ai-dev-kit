#!/usr/bin/env python3
import json
import os
import sys
import subprocess
import argparse

def get_mlflow_binary():
    # Try to find mlflow in the local venv
    venv_mlflow = os.path.join(os.getcwd(), 'databricks-builder-app', '.venv', 'bin', 'mlflow')
    if os.path.exists(venv_mlflow):
        return venv_mlflow
    return 'mlflow'

def dump_trace(trace_id, output_file=None):
    mlflow_bin = get_mlflow_binary()
    env = os.environ.copy()
    env['MLFLOW_TRACKING_URI'] = 'databricks'
    
    print(f"Retrieving trace {trace_id}...")
    try:
        result = subprocess.run(
            [mlflow_bin, 'traces', 'get', '--trace-id', trace_id],
            env=env,
            capture_output=True,
            text=True,
            check=True
        )
        
        trace_data = json.loads(result.stdout)
        
        if output_file:
            with open(output_file, 'w') as f:
                json.dump(trace_data, f, indent=2)
            print(f"Trace dumped to {output_file}")
        else:
            print(json.dumps(trace_data, indent=2))
            
        return trace_data
    except subprocess.CalledProcessError as e:
        print(f"Error retrieving trace: {e.stderr}", file=sys.stderr)
        sys.exit(1)
    except json.JSONDecodeError:
        print("Error: Could not parse MLflow output as JSON", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Dump detailed prompts from MLflow trace")
    parser.add_argument("trace_id", help="The MLflow Trace ID")
    parser.add_argument("--output", "-o", help="Output JSON file path")
    
    args = parser.parse_args()
    dump_trace(args.trace_id, args.output)
