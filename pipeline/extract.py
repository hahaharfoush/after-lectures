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

# The instructions, answer format and model order live in one file shared with
# the read-screenshot server function, so both read posters the same way.
# Models are tried in order: if one is overloaded (503) or has no free quota on
# this key (429 with a zero limit), the next one is used.
SHARED = Path(__file__).resolve().parent.parent / "supabase" / "functions" / "_shared" / "extract.json"
_shared = json.loads(SHARED.read_text(encoding="utf-8"))
MODELS: list[str] = _shared["models"]
PROMPT: str = _shared["prompt"]
SCHEMA: dict = _shared["schema"]
THINKING: str = _shared["thinkingLevel"]


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
            models: list[str] | None = None, thinking: str | None = THINKING) -> dict:
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
