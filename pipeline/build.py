"""Collect events from every source and write the file the website reads.

    python pipeline/build.py            # writes site/data/events.json

Sources so far: the Imperial College Union website. Instagram and events added
from screenshots plug in here later, each returning events in the same format.
"""
from __future__ import annotations

import json
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import tags  # noqa: E402
import union  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "site" / "data" / "events.json"
CACHE = ROOT / "pipeline" / ".cache" / "union-details.json"
MAX_DESCRIPTION = 2000


def load_cache() -> dict:
    try:
        return json.loads(CACHE.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save_cache(cache: dict) -> None:
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(json.dumps(cache), encoding="utf-8")


def main() -> None:
    now = datetime.now(union.LONDON)
    start_of_today = now.replace(hour=0, minute=0, second=0, microsecond=0)

    cache = load_cache()
    events = union.fetch_events(cache)
    save_cache(cache)

    kept = []
    for e in events:
        if datetime.fromisoformat(e["end"] or e["start"]) <= start_of_today:
            continue  # already over
        tags.enrich(e)
        if e["description"] and len(e["description"]) > MAX_DESCRIPTION:
            e["description"] = e["description"][:MAX_DESCRIPTION].rsplit(" ", 1)[0] + "…"
        kept.append(e)
    kept.sort(key=lambda e: (e["start"], e["title"]))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "generated": now.isoformat(timespec="seconds"),
        "timezone": "Europe/London",
        "sources": [{"id": "union", "name": "Imperial College Union website", "count": len(kept)}],
        "events": kept,
    }, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"wrote {len(kept)} events to {OUT.relative_to(ROOT)}  ({len(events) - len(kept)} already over)")
    print("  societies:", len({e['society'] for e in kept if e['isSociety']}))
    print("  with a location:", sum(bool(e["location"]) for e in kept),
          " with a campus:", sum(bool(e["campus"]) for e in kept))
    print("  tags:", dict(Counter(t for e in kept for t in e["tags"]).most_common()))


if __name__ == "__main__":
    main()
