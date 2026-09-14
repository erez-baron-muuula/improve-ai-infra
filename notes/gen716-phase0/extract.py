#!/usr/bin/env python
"""GEN-716 Phase 0 extractor.

Reads every top-level session transcript under ~/.claude/projects/<proj>/*.jsonl,
reconstructs turns, and pulls out every assistant "For you" block together with
the turn context an independent annotator needs to judge its claims:
  - the user request that opened the turn
  - the tool calls made in the turn (name + compact input) and their results
  - the block text itself

Outputs (in this script's directory):
  inventory.json  - per-transcript: session, date span, line/assistant counts,
                    #foryou blocks, and a crude pruning signal.
  blocks.jsonl    - one JSON object per extracted block (with turn context).

Read-only. No transcript is modified.
"""
import json, glob, os, re, sys, datetime

ROOT = os.path.expanduser(r"~/.claude/projects")
OUT  = os.path.dirname(os.path.abspath(__file__))

# Block header: pin emoji followed (allowing markdown bold) by "For you".
FORYOU = re.compile(r"\U0001F4CC\s*\**\s*For you", re.IGNORECASE)
PIN    = "\U0001F4CC"

def top_level_transcripts():
    for proj in sorted(glob.glob(os.path.join(ROOT, "*"))):
        if not os.path.isdir(proj):
            continue
        for f in glob.glob(os.path.join(proj, "*.jsonl")):
            yield os.path.basename(proj), f

def text_blocks(msg):
    """Yield text strings from an assistant message.content list."""
    c = msg.get("content")
    if isinstance(c, list):
        for b in c:
            if isinstance(b, dict) and b.get("type") == "text":
                yield b.get("text", "")

def tool_uses(msg):
    c = msg.get("content")
    out = []
    if isinstance(c, list):
        for b in c:
            if isinstance(b, dict) and b.get("type") == "tool_use":
                inp = b.get("input", {})
                s = json.dumps(inp, ensure_ascii=False)
                if len(s) > 1200: s = s[:1200] + "...<truncated>"
                out.append({"id": b.get("id"), "name": b.get("name"), "input": s})
    return out

def user_text(msg):
    c = msg.get("content")
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        parts = []
        for b in c:
            if isinstance(b, dict):
                if b.get("type") == "text":
                    parts.append(b.get("text", ""))
                elif b.get("type") == "tool_result":
                    # tool results are context, captured separately
                    pass
        return "\n".join(parts)
    return ""

def tool_results(msg):
    c = msg.get("content")
    out = {}
    if isinstance(c, list):
        for b in c:
            if isinstance(b, dict) and b.get("type") == "tool_result":
                content = b.get("content")
                if isinstance(content, list):
                    txt = " ".join(x.get("text","") for x in content if isinstance(x, dict) and x.get("type")=="text")
                else:
                    txt = str(content)
                if len(txt) > 3000: txt = txt[:3000] + "...<truncated>"
                out[b.get("tool_use_id")] = txt
    return out

def is_real_user(rec):
    """A genuine Erez prompt, not a tool_result-carrying user record."""
    if rec.get("type") != "user":
        return False
    msg = rec.get("message", {})
    c = msg.get("content")
    if isinstance(c, str):
        return True
    if isinstance(c, list):
        # real prompt if it has any text block and no tool_result block
        has_text = any(isinstance(b,dict) and b.get("type")=="text" for b in c)
        has_tr   = any(isinstance(b,dict) and b.get("type")=="tool_result" for b in c)
        return has_text and not has_tr
    return False

def parse_ts(rec):
    t = rec.get("timestamp")
    if not t: return None
    try:
        return datetime.datetime.fromisoformat(t.replace("Z","+00:00"))
    except Exception:
        return None

inventory = []
blocks = []

for proj, path in top_level_transcripts():
    recs = []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line: continue
            try: recs.append(json.loads(line))
            except Exception: continue

    msg_recs = [r for r in recs if r.get("type") in ("user","assistant")]
    ts_all = [t for t in (parse_ts(r) for r in msg_recs) if t]
    n_assistant = sum(1 for r in recs if r.get("type")=="assistant")
    session = os.path.basename(path)[:-6]

    # Reconstruct linear turns: each real-user prompt starts a turn; everything
    # up to the next real-user prompt belongs to it.
    turns = []  # list of dict(user_text, ts, tools[list], results{id:txt}, blocks[list])
    cur = None
    for r in msg_recs:
        if is_real_user(r):
            cur = {"user_text": user_text(r.get("message",{})),
                   "ts": r.get("timestamp"), "tools": [], "results": {}, "blocks": []}
            turns.append(cur)
        elif r.get("type") == "assistant":
            if cur is None:
                cur = {"user_text": "(no preceding user prompt)","ts": r.get("timestamp"),
                       "tools": [], "results": {}, "blocks": []}
                turns.append(cur)
            m = r.get("message", {})
            cur["tools"].extend(tool_uses(m))
            for tb in text_blocks(m):
                if PIN in tb and FORYOU.search(tb):
                    cur["blocks"].append({"ts": r.get("timestamp"), "text": tb})
        elif r.get("type") == "user":  # tool_result carrier
            if cur is not None:
                cur["results"].update(tool_results(r.get("message",{})))

    n_blocks = 0
    for ti, t in enumerate(turns):
        for blk in t["blocks"]:
            n_blocks += 1
            blocks.append({
                "proj": proj,
                "session": session,
                "turn_index": ti,
                "block_ts": blk["ts"],
                "user_request": t["user_text"][:2000],
                "tool_calls": t["tools"],
                "tool_results": t["results"],
                "block_text": blk["text"],
            })

    # crude pruning signal: if there are user/assistant timestamps but the file
    # has far fewer msg records than a normal session, it may be pruned.
    inventory.append({
        "proj": proj,
        "session": session,
        "n_lines": len(recs),
        "n_msg_records": len(msg_recs),
        "n_assistant": n_assistant,
        "n_foryou_blocks": n_blocks,
        "ts_min": min(ts_all).isoformat() if ts_all else None,
        "ts_max": max(ts_all).isoformat() if ts_all else None,
    })

inventory.sort(key=lambda x: x["ts_min"] or "")
with open(os.path.join(OUT,"inventory.json"),"w",encoding="utf-8") as fh:
    json.dump(inventory, fh, ensure_ascii=False, indent=2)
with open(os.path.join(OUT,"blocks.jsonl"),"w",encoding="utf-8") as fh:
    for b in blocks:
        fh.write(json.dumps(b, ensure_ascii=False)+"\n")

# summary to stdout
tot_blocks = sum(i["n_foryou_blocks"] for i in inventory)
spanned = [i for i in inventory if i["ts_min"]]
print(f"transcripts scanned: {len(inventory)}")
print(f"total For-you blocks extracted: {tot_blocks}")
if spanned:
    print(f"date span: {spanned[0]['ts_min'][:10]} .. {max(i['ts_max'] for i in spanned)[:10]}")
print(f"transcripts with >=1 block: {sum(1 for i in inventory if i['n_foryou_blocks'])}")
print("wrote inventory.json and blocks.jsonl to", OUT)
