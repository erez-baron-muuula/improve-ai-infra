#!/usr/bin/env python
"""Draw a reproducible random sample of For-you blocks and split into batches
for independent annotation. Excludes the current in-progress session."""
import json, random, os

HERE=os.path.dirname(os.path.abspath(__file__))
CUR_SESSION="82fce884-9409-4005-92bc-b8ba490738fc"  # this Phase-0 session; exclude
N=100
BATCHES=6
SEED=716

blocks=[json.loads(l) for l in open(os.path.join(HERE,"blocks.jsonl"),encoding="utf-8")]
pop=[b for b in blocks if b["session"]!=CUR_SESSION]
print(f"population (excl current session): {len(pop)}")

rng=random.Random(SEED)
sample=rng.sample(pop, N)
# give each a stable id
for i,b in enumerate(sample):
    b["block_id"]=f"B{i+1:03d}"

with open(os.path.join(HERE,"sample.jsonl"),"w",encoding="utf-8") as fh:
    for b in sample:
        fh.write(json.dumps(b,ensure_ascii=False)+"\n")

# split into batch files
for k in range(BATCHES):
    part=sample[k::BATCHES]  # round-robin so weeks are spread across batches
    with open(os.path.join(HERE,f"batch_{k+1:02d}.jsonl"),"w",encoding="utf-8") as fh:
        for b in part:
            fh.write(json.dumps(b,ensure_ascii=False)+"\n")
    print(f"batch_{k+1:02d}.jsonl: {len(part)} blocks")
print("seed",SEED,"-> sample.jsonl +",BATCHES,"batch files")
PY_MARKER=None
