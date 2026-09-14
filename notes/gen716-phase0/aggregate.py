#!/usr/bin/env python
"""Aggregate the independent annotations into the Phase 0 measurement.
Runs over whatever annotations_NN.json files exist (defensive to partial runs)."""
import json, glob, os, collections

HERE=os.path.dirname(os.path.abspath(__file__))
files=sorted(glob.glob(os.path.join(HERE,"annotations_*.json")))

rows=[]
for f in files:
    try:
        data=json.load(open(f,encoding="utf-8"))
    except Exception as e:
        print("SKIP (bad json):",os.path.basename(f),e); continue
    if isinstance(data,dict): data=[data]
    for b in data:
        b["_src"]=os.path.basename(f)
        rows.append(b)

print(f"annotation files: {len(files)}  blocks annotated: {len(rows)}")

label_ct=collections.Counter()
verdict_ct=collections.Counter()
wrong_claims=[]
acted_on=[]
needs_fuller=0
zero_claim_blocks=0

for b in rows:
    claims=b.get("claims") or []
    if not claims: zero_claim_blocks+=1
    for c in claims:
        label_ct[c.get("label","?")]+=1
    verdict_ct[b.get("block_verdict","?")]+=1
    if b.get("needs_fuller_evidence"): needs_fuller+=1
    for w in (b.get("wrong_claims") or []):
        w["_block"]=b.get("block_id"); w["_src"]=b["_src"]
        wrong_claims.append(w)
        if str(w.get("acted_on")).lower() in ("true","1","yes"):
            acted_on.append(w)

nb=len(rows)
print("\n== claim labels ==")
for k,v in label_ct.most_common(): print(f"  {k:14s} {v}")
tot_claims=sum(label_ct.values())
print(f"  TOTAL claims  {tot_claims}   ({tot_claims/nb:.1f}/block)")

print("\n== block verdicts ==")
for k,v in verdict_ct.most_common(): print(f"  {k:18s} {v}  ({100*v/nb:.0f}%)")
print(f"  blocks with 0 falsifiable claims: {zero_claim_blocks} ({100*zero_claim_blocks/nb:.0f}%)")
print(f"  needs_fuller_evidence flagged:    {needs_fuller} ({100*needs_fuller/nb:.0f}%)")

print(f"\n== wrong claims: {len(wrong_claims)} across {nb} blocks ==")
print(f"   block-level wrong rate: {sum(1 for b in rows if b.get('block_verdict')=='has_wrong_claim')}/{nb}")
for w in wrong_claims:
    print(f"  [{w['_block']}] acted_on={w.get('acted_on')} erez_caught={w.get('erez_caught')}")
    print(f"      claim: {str(w.get('claim_text'))[:120]}")
    print(f"      dep:   {str(w.get('dependency'))[:160]}")

print(f"\n== ACTED-ON wrong claims (the binding constraint): {len(acted_on)} ==")
for w in acted_on:
    print(f"  [{w['_block']}] {str(w.get('claim_text'))[:100]}")
    print(f"      dep: {str(w.get('dependency'))[:160]}")
