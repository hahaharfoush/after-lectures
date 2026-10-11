"""Read event details out of a poster, Instagram post or screenshot with Gemini.

    python pipeline/extract.py screenshot.jpg --taken 2026-10-09
    python pipeline/extract.py --probe        # which models answer on this key

Needs GEMINI_API_KEY in the environment. Returns zero or more events, each with
date, times, place, price and the yes/no facts the site filters on. Anything the
image doesn't actually say comes back as null: a wrong time is worse than none.
"""
from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import sys
import time
from datetime import date
from pathlib import Path

import requests

API = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

# Tried in order. If a model is overloaded (503) or has no free quota on this
# key (429 with a zero limit), the next one is used.
MODELS = ["gemini-3.1-flash-lite", "gemini-flash-lite-latest", "gemini-3.5-flash"]

PROMPT = """You read event announcements from Imperial College London student societies: \
posters, Instagram posts and screenshots of them.

The screenshot was taken on {taken}. Use it to turn relative dates ("this Thursday", \
"tomorrow", "next week") into calendar dates. If a date has no year, use the next \
occurrence on or after {taken_iso}.

List every distinct event or session people can turn up to. If one post lists several \
dates, return one entry per date. For each:
- title: the event's name as written, without emojis
- society: the society or group running it (often the account name)
- date: YYYY-MM-DD
- start_time, end_time: 24-hour HH:MM
- location: room, building or venue as written, e.g. "SAF G34" or "Union Dining Hall"
- price: the cost to attend, as written, e.g. "Free entry" or "£3 members, £5 non-members"; \
"free food" on its own is not a price
- free_food, open_to_non_members, signup_required, beginner_friendly: true or false \
only when the post says so
- recurring: "weekly" if it says it happens every week, otherwise null
- evidence: a few words copied from the image showing where the date and time came from

Never guess. Use null for anything that isn't shown, including a location that is "TBC" \
or "to be announced". If the image isn't announcing an event (a recap, a meme, a \
committee introduction), return an empty list."""

_nullable = lambda t: {"type": t, "nullable": True}
SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "events": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "title": {"type": "STRING"},
                    "society": _nullable("STRING"),
                    "date": _nullable("STRING"),
                    "start_time": _nullable("STRING"),
                    "end_time": _nullable("STRING"),
                    "location": _nullable("STRING"),
                    "price": _nullable("STRING"),
                    "free_food": _nullable("BOOLEAN"),
                    "open_to_non_members": _nullable("BOOLEAN"),
                    "signup_required": _nullable("BOOLEAN"),
                    "beginner_friendly": _nullable("BOOLEAN"),
                    "recurring": _nullable("STRING"),
                    "evidence": _nullable("STRING"),
                },
                "required": ["title", "society", "date", "start_time", "end_time", "location", "price"],
            },
        }
    },
    "required": ["events"],
}


class ExtractError(RuntimeError):
    pass


def _key() -> str:
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not key:
        raise ExtractError("GEMINI_API_KEY is not set")
    return key


def _call(model: str, body: dict, timeout: float = 120) -> dict:
    resp = requests.post(API.format(model=model), json=body, timeout=timeout,
                         headers={"x-goog-api-key": _key()})
    if resp.status_code != 200:
        try:
            message = resp.json().get("error", {}).get("message", "")
        except ValueError:
            message = resp.text[:300]
        raise ExtractError(f"{model}: HTTP {resp.status_code}: {message[:300]}")
    return resp.json()


def _text(response: dict) -> str:
    candidates = response.get("candidates") or []
    if not candidates:
        raise ExtractError(f"no answer: {json.dumps(response.get('promptFeedback', {}))[:200]}")
    parts = candidates[0].get("content", {}).get("parts", [])
    return "".join(p.get("text", "") for p in parts if not p.get("thought"))


def extract(image: bytes, mime: str, taken_on: date, caption: str | None = None,
            models: list[str] | None = None, thinking: str | None = "low") -> dict:
    """Return {"model", "seconds", "events": [...]} for one image (plus optional caption text)."""
    taken = taken_on.strftime("%A %d %B %Y").replace(" 0", " ")
    parts = [{"text": PROMPT.format(taken=taken, taken_iso=taken_on.isoformat())},
             {"inline_data": {"mime_type": mime, "data": base64.b64encode(image).decode()}}]
    if caption:
        parts.append({"text": f"Caption posted with the image:\n{caption}"})
    body = {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {"responseMimeType": "application/json", "responseSchema": SCHEMA},
    }
    if thinking:
        # Reading a poster doesn't need long deliberation; "low" is much faster.
        body["generationConfig"]["thinkingConfig"] = {"thinkingLevel": thinking}

    errors = []
    for model in models or MODELS:
        for attempt in range(3):
            started = time.time()
            try:
                data = json.loads(_text(_call(model, body)))
                return {"model": model, "seconds": round(time.time() - started, 1), "events": data.get("events", [])}
            except ExtractError as err:
                text = str(err)
                errors.append(text)
                if "HTTP 429" in text and ("limit: 0" in text or "free_tier" in text.lower()):
                    break                      # no free quota for this model: try the next one
                if "HTTP 429" in text:
                    time.sleep(20 * (attempt + 1))
                elif "HTTP 5" in text:
                    time.sleep(4 * (attempt + 1))
                else:
                    break
            except (requests.RequestException, json.JSONDecodeError) as err:
                errors.append(f"{model}: {err}")
                time.sleep(3)
    raise ExtractError("every model failed:\n  " + "\n  ".join(errors[-6:]))


def probe(models: list[str]) -> None:
    """Send one tiny request to each model and report which ones answer."""
    for model in models:
        body = {"contents": [{"role": "user", "parts": [{"text": "Reply with the word ok."}]}]}
        started = time.time()
        try:
            reply = _text(_call(model, body, timeout=60)).strip()
            print(f"  {model:32} ok   {time.time() - started:4.1f}s  {reply[:20]!r}")
        except ExtractError as err:
            print(f"  {model:32} FAIL {str(err)[len(model) + 2:][:110]}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("image", nargs="?")
    ap.add_argument("--taken", default=date.today().isoformat(), help="date the screenshot was taken (YYYY-MM-DD)")
    ap.add_argument("--probe", nargs="*", metavar="MODEL", help="check which models answer")
    ap.add_argument("--model", help="use only this model")
    ap.add_argument("--thinking", default="low", help="thinking level: minimal, low, medium, high, or none")
    args = ap.parse_args()
    if args.probe is not None:
        probe(args.probe or MODELS)
        return
    if not args.image:
        ap.error("give an image path, or --probe")
    path = Path(args.image)
    mime = mimetypes.guess_type(path.name)[0] or "image/jpeg"
    result = extract(path.read_bytes(), mime, date.fromisoformat(args.taken),
                     models=[args.model] if args.model else None,
                     thinking=None if args.thinking == "none" else args.thinking)
    json.dump(result, sys.stdout, indent=1, ensure_ascii=False)
    print()


if __name__ == "__main__":
    main()
