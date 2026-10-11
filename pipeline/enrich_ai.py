"""Fill gaps in listed events by having the AI read each event's poster and caption.

The Union listing gives a date and a time slot, but the room, the real start
time, free food and the price are usually only on the poster. For example, one
event listed 16:00-20:00 with no room has a poster saying "SAF 119, 6-8pm, Free
food!".

Each poster is read once and the answer cached, keyed on the image and text, so
a run only pays for new or changed events.
"""
from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, time as dtime
from pathlib import Path

import requests

import tags
from extract import MODELS, ExtractError, extract

CACHE = Path(__file__).parent / ".cache" / "ai-reads.json"
MAX_PER_RUN = 80          # stay well inside free-tier daily limits
PROMPT_VERSION = 2        # bump to re-read every poster after changing the prompt
NOT_A_PLACE = tags.NOT_A_PLACE


def _key(event: dict) -> str:
    raw = f"{PROMPT_VERSION}|{event['image']}|{event.get('description') or ''}|{event['start'][:10]}"
    return hashlib.sha1(raw.encode()).hexdigest()


def _hhmm(value) -> dtime | None:
    try:
        h, m = str(value).split(":")[:2]
        return dtime(int(h), int(m))
    except (ValueError, AttributeError):
        return None


def merge(event: dict, read: dict) -> dict:
    """Combine what the AI read with the listing. The listing wins on the date;
    the poster wins on details the listing doesn't have. Returns the fields changed."""
    day = event["start"][:10]
    candidates = read.get("events") or []
    match = next((r for r in candidates if r.get("date") == day), None) \
        or next((r for r in candidates if not r.get("date")), None)
    if not match:
        return {}
    changed = {}
    start = datetime.fromisoformat(event["start"])
    end = datetime.fromisoformat(event["end"]) if event.get("end") else None

    # A poster time inside the booked slot is more precise than the slot itself
    # (rooms get booked for longer than the event runs).
    t0, t1 = _hhmm(match.get("start_time")), _hhmm(match.get("end_time"))
    if t0:
        new_start = start.replace(hour=t0.hour, minute=t0.minute)
        inside = event.get("allDay") or (start <= new_start and (end is None or new_start < end))
        if inside and new_start != start:
            event["start"], event["allDay"] = new_start.isoformat(), False
            changed["start"] = t0.strftime("%H:%M")
            if t1:
                new_end = new_start.replace(hour=t1.hour, minute=t1.minute)
                if new_end > new_start and (end is None or new_end <= end) and new_end != end:
                    event["end"] = new_end.isoformat()
                    changed["end"] = t1.strftime("%H:%M")

    location = (match.get("location") or "").strip()
    if location and not event.get("location") and not NOT_A_PLACE.search(location):
        event["location"] = location
        event["campus"] = tags.campus_for(location, event.get("title"), event.get("description")) or event.get("campus")
        changed["location"] = location

    price = (match.get("price") or "").strip()
    if price and not event.get("price") and "food" not in price.lower():
        if price.lower().rstrip("!. ") in ("free", "free entry", "free admission", "free to attend"):
            price = "Free"
        event["price"] = price
        changed["price"] = price

    tagset = set(event.get("tags") or [])
    before = set(tagset)
    if match.get("free_food") is True:
        tagset.add("food")
    if match.get("open_to_non_members") is True:
        tagset.add("open")
        tagset.discard("members")
    elif match.get("open_to_non_members") is False:
        tagset.add("members")
        tagset.discard("open")
    if match.get("signup_required") is True:
        tagset.add("signup")
        tagset.discard("dropin")
    elif match.get("signup_required") is False:
        tagset.add("dropin")
        tagset.discard("signup")
    if match.get("beginner_friendly") is True:
        tagset.add("beginner")
    if (event.get("price") or "").lower().startswith("free"):
        tagset.add("free")
    if tagset != before:
        event["tags"] = sorted(tagset)
        changed["tags"] = sorted(tagset - before)

    if changed:
        event["fromPoster"] = sorted(k for k in changed if k in ("start", "end", "location", "price"))
    return changed


def enrich_all(events: list[dict]) -> None:
    """Read posters for events that have one (cached), and merge the results in."""
    if not os.environ.get("GEMINI_API_KEY"):
        print("  (no GEMINI_API_KEY: skipping poster reading)")
        return
    try:
        cache = json.loads(CACHE.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        cache = {}

    fresh = 0
    updated = 0
    for event in events:
        if not event.get("image"):
            continue
        key = _key(event)
        if key not in cache:
            if fresh >= MAX_PER_RUN:
                continue
            try:
                img = requests.get(event["image"], timeout=30)
                img.raise_for_status()
                mime = img.headers.get("content-type", "image/jpeg").split(";")[0]
                if not mime.startswith("image/") or len(img.content) > 8_000_000:
                    continue
                day = datetime.fromisoformat(event["start"]).date()
                read = extract(img.content, mime, day, caption=event.get("description"), models=MODELS)
                cache[key] = {"model": read["model"], "events": read["events"]}
                fresh += 1
            except (requests.RequestException, ExtractError) as err:
                print(f"  ! could not read poster for {event['id']}: {str(err)[:120]}")
                continue
        if merge(event, cache[key]):
            updated += 1

    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(json.dumps(cache), encoding="utf-8")
    print(f"  posters read this run: {fresh}, events improved: {updated}")
