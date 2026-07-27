#!/usr/bin/env python3
import json, os, pathlib, sys, time
if "--version" in sys.argv:
    print("agents-crew-fake 1.0")
    raise SystemExit(0)
args=" ".join(sys.argv[1:])
if os.environ.get("FAKE_AGENT_SLEEP"):
    time.sleep(float(os.environ["FAKE_AGENT_SLEEP"]))
if os.environ.get("FAKE_AGENT_EXIT"):
    print("fake failure", file=sys.stderr)
    raise SystemExit(int(os.environ["FAKE_AGENT_EXIT"]))
output=None
for token in sys.argv[1:]:
    if token.endswith("-result.json") or token.endswith("result.json"):
        output=pathlib.Path(token)
task_id=os.environ.get("FAKE_TASK_ID","task-1")
result={"task_id":task_id,"status":"completed","summary":"fake agent completed","artifacts":[],"files_changed":[],"commands_run":[],"tests":[],"evidence":[{"criterion_id":"goal","source":"fake-agent","summary":"deterministic evidence","passed":True,"artifact":None}],"assumptions":[],"blockers":[],"recommended_next_tasks":[],"metadata":{"argv":sys.argv[1:]}}
raw="{malformed" if os.environ.get("FAKE_AGENT_MALFORMED") else json.dumps(result)
if output:
    output.parent.mkdir(parents=True,exist_ok=True);output.write_text(raw)
else:
    print(raw)
