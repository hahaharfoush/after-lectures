"""Score how well a model reads events out of screenshots.

    node tools/render-screens.js 30                          # make the test screenshots
    python pipeline/eval_extract.py --model gemini-3.8-flash

The right answers come from the Union's structured listing. Each field is scored
as right, wrong (a confident mistake, the thing that loses people's trust) or
blank (the model said it wasn't shown). Blank is the correct answer when the post
never says the date.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from collections import Counter
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from extract import ExtractError, extract  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SCREENS = ROOT / "tools" / "out" / "screens"


def minutes(value) -> int | None:
    m = re.match(r"\s*(\d{1,2})[:.](\d{2})\s*([ap]m)?", str(value or ""), re.I)
    if not m:
        return None
    h, mins, half = int(m.group(1)), int(m.group(2)), (m.group(3) or "").lower()
    if half:
        h = h % 12 + (12 if half == "pm" else 0)
    return h * 60 + mins


def words(text) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", str(text or "").lower()) if len(w) > 1}


def score(truth: dict, events: list[dict]) -> dict:
    same_day = [e for e in events if e.get("date") == truth["date"]]
    if same_day:
        result = {"date": "right"}
    elif any(e.get("date") for e in events):
        result = {"date": "wrong"}
    else:
        result = {"date": "blank"}
    pool = same_day or events
    for field in ("start_time", "end_time"):
        want = minutes(truth[field])
        if want is None:
            continue
        got = [minutes(e.get(field)) for e in pool]
        result[field] = "right" if want in got else "wrong" if any(g is not None for g in got) else "blank"
    if truth.get("location"):
        want = words(truth["location"])
        got = [words(e.get("location")) for e in pool if e.get("location")]
        if not got:
            result["location"] = "blank"
        else:
            overlap = max(len(want & g) / max(1, min(len(want), len(g))) for g in got)
            result["location"] = "right" if overlap >= 0.5 else "wrong"
    return result


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--variant", choices=["all", "as-listed", "dated"], default="all")
    ap.add_argument("--delay", type=float, default=4.0, help="seconds between requests (free-tier limits)")
    args = ap.parse_args()

    manifest = json.loads((SCREENS / "manifest.json").read_text(encoding="utf-8"))
    items = [m for m in manifest if args.variant in ("all", m["variant"])]
    rows = []
    for n, item in enumerate(items, 1):
        image = (SCREENS / item["file"]).read_bytes()
        try:
            out = extract(image, "image/jpeg", date.fromisoformat(item["taken"]), models=[args.model])
            events, seconds, error = out["events"], out["seconds"], None
        except ExtractError as err:
            events, seconds, error = [], None, str(err)[:200]
        marks = score(item["truth"], events) if not error else {}
        rows.append({**item, "events": events, "seconds": seconds, "error": error, "score": marks})
        first = events[0] if events else {}
        print(f"{n:2}/{len(items)} {item['variant']:9} {item['title'][:34]:34} "
              f"truth {item['truth']['date']} {item['truth']['start_time']}  "
              f"got {first.get('date')} {first.get('start_time')}  "
              f"{' '.join(f'{k[:5]}={v}' for k, v in marks.items()) or 'ERROR ' + str(error)[:80]}", flush=True)
        time.sleep(args.delay)

    out_path = ROOT / "tools" / "out" / f"eval-{args.model}.json"
    out_path.write_text(json.dumps(rows, indent=1, ensure_ascii=False), encoding="utf-8")

    print(f"\n=== {args.model} ===")
    for variant in ("dated", "as-listed"):
        group = [r for r in rows if r["variant"] == variant and not r["error"]]
        if not group:
            continue
        print(f"\n{variant} ({len(group)} posts)")
        for field in ("date", "start_time", "end_time", "location"):
            c = Counter(r["score"][field] for r in group if field in r["score"])
            if c:
                print(f"  {field:11} right {c['right']:2}  wrong {c['wrong']:2}  blank {c['blank']:2}")
    invented = [r for r in rows if r["variant"] == "as-listed" and not r["dateInCaption"]
                and not r["error"] and r["score"].get("date") != "blank"]
    print(f"\nPosts whose caption gives no date but the model returned one: {len(invented)} (check the poster)")
    for r in invented:
        e = next((e for e in r["events"] if e.get("date")), {})
        print(f"  {r['file']}: {e.get('date')} {e.get('start_time')} evidence={e.get('evidence')!r}")
    errors = [r for r in rows if r["error"]]
    secs = [r["seconds"] for r in rows if r["seconds"]]
    print(f"\nerrors: {len(errors)}   average time: {sum(secs) / max(1, len(secs)):.1f}s   saved {out_path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
