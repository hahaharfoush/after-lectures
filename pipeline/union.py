"""Import events from the Imperial College Union website.

The Union's What's On page is a Next.js site. It has no public API, but every
page streams its data to the browser inside `self.__next_f.push(...)` script
chunks (the React Server Components payload). The upcoming-events page embeds
every listed event there: society ("student group") events and Union-run ones.

Society events only carry a short summary in the listing, so we also fetch each
event's own page for the full description, which is where societies put the
room, price and sign-up details.
"""
from __future__ import annotations

import html as htmllib
import json
import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from html.parser import HTMLParser
from zoneinfo import ZoneInfo

import requests

BASE = "https://www.imperialcollegeunion.org"
LISTING_URL = BASE + "/whats-on/events/upcoming"
LONDON = ZoneInfo("Europe/London")
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; SocietyEventsBot/0.1; Imperial student project)"}

# Union governance (council meetings, forums, election deadlines) isn't what
# people are looking for when they want something to do tonight.
GOVERNANCE = {"Union", "Elections", "Postgraduate"}


# --- Reading the page data -------------------------------------------------

def rsc_payload(page_html: str) -> str:
    """Join the streamed React Server Components chunks into one string."""
    chunks = re.findall(r'self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)', page_html)
    return "".join(json.loads(c) for c in chunks)


def iter_dicts(payload: str):
    """Yield every JSON object embedded in the payload, including nested ones."""
    decoder = json.JSONDecoder()
    pos = 0
    while (i := payload.find("{", pos)) >= 0:
        try:
            obj, end = decoder.raw_decode(payload, i)
        except json.JSONDecodeError:
            pos = i + 1
            continue
        stack = [obj]
        while stack:
            o = stack.pop()
            if isinstance(o, dict):
                yield o
                stack.extend(o.values())
            elif isinstance(o, list):
                stack.extend(o)
        pos = end


def raw_events(listing_html: str) -> list[dict]:
    """Every event object on the listing page, one per id (the fullest copy wins)."""
    found: dict[str, dict] = {}
    for d in iter_dicts(rsc_payload(listing_html)):
        if d.get("_type") == "event" and d.get("date") and d.get("_id"):
            if d["_id"] not in found or len(d) > len(found[d["_id"]]):
                found[d["_id"]] = d
    events = list(found.values())
    _fill_recurring_refs(events)
    return events


def _is_ref(value) -> bool:
    """RSC writes repeated values as references like "$3a:props:eventList:57:body"."""
    return isinstance(value, str) and value.startswith("$")


def _fill_recurring_refs(events: list[dict]) -> None:
    """Recurring Union events repeat the first instance's fields by reference.

    Instance ids look like "<series id>-<n>", so copy the referenced fields from
    the instance in the same series that has real values.
    """
    series: dict[str, list[dict]] = {}
    for e in events:
        base = re.sub(r"-\d+$", "", e["_id"])
        series.setdefault(base, []).append(e)
    for members in series.values():
        for e in members:
            for key, value in list(e.items()):
                if _is_ref(value):
                    donor = next((m[key] for m in members if key in m and not _is_ref(m[key])), None)
                    e[key] = donor


# --- Turning raw objects into our event format ------------------------------

def portable_text(blocks) -> str:
    """Flatten Sanity "portable text" blocks into plain text paragraphs."""
    if not isinstance(blocks, list):
        return ""
    paras = []
    for block in blocks:
        if isinstance(block, dict) and block.get("_type") == "block":
            text = "".join(c.get("text", "") for c in block.get("children", []) if isinstance(c, dict))
            paras.append(text.strip())
    return "\n".join(p for p in paras if p)


def event_day(value: str) -> date:
    """Dates come as "2026-10-20" or as a UTC instant like "2026-10-06T00:00:00.000Z"."""
    if "T" in value:
        instant = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return instant.astimezone(LONDON).date()
    return date.fromisoformat(value)


def parse_hhmm(day: date, value: str | None) -> datetime | None:
    if not value or not re.fullmatch(r"\d{1,2}:\d{2}", value.strip()):
        return None
    h, m = map(int, value.strip().split(":"))
    if h == 24:
        return datetime(day.year, day.month, day.day, tzinfo=LONDON) + timedelta(days=1)
    return datetime(day.year, day.month, day.day, h, m, tzinfo=LONDON)


def normalise(raw: dict) -> dict | None:
    """Map one Union event object onto the event format the site reads."""
    categories = [c.get("title") for c in raw.get("eventCategories") or [] if isinstance(c, dict) and c.get("title")]
    categories = [c for c in categories if c != "Featured"] or list(raw.get("category") or [])
    if categories and "Elections" in categories:
        return None
    if categories and set(categories) <= GOVERNANCE and "Union" in categories:
        return None

    day = event_day(raw["date"])
    times = raw.get("startEndTime") if isinstance(raw.get("startEndTime"), dict) else {}
    start = parse_hhmm(day, times.get("startTime")) if raw.get("hasTime") is not False else None
    end = parse_hhmm(day, times.get("endTime")) if start else None
    if start and end and end <= start:  # e.g. 20:30-00:00 runs past midnight
        end += timedelta(days=1)

    is_society = bool(raw.get("isStudentGroup"))
    slug = raw.get("slug")
    slug = slug.get("current") if isinstance(slug, dict) else slug
    if is_society:
        path = raw.get("buttonLink") or f"/whats-on/events/student-group/{slug}"
    else:
        path = f"/whats-on/events/{slug}"

    location = raw.get("location") if isinstance(raw.get("location"), dict) else {}
    accessibility = portable_text(location.get("accessibility"))

    return {
        "id": f"union-{raw['_id']}",
        "source": "union",
        "url": BASE + path,
        "title": (raw.get("title") or "").strip(),
        "society": (raw.get("studentGroup") or "").strip() if is_society else "Imperial College Union",
        "isSociety": is_society,
        "start": (start or datetime(day.year, day.month, day.day, tzinfo=LONDON)).isoformat(),
        "end": end.isoformat() if end else None,
        "allDay": start is None,
        "location": (location.get("venueName") or "").strip() or None,
        "mapUrl": location.get("link") or None,
        "accessibility": accessibility or None,
        "description": portable_text(raw.get("body")),
        "categories": categories,
        "image": raw.get("mainImageURL") or None,
        "soldOut": bool(raw.get("isSoldOut")),
    }


# --- Society event pages ----------------------------------------------------

class _ProseText(HTMLParser):
    """Collect the text of the first <div class="prose ..."> on the page."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.depth = 0          # div nesting depth inside the prose block
        self.done = False
        self.parts: list[str] = []

    def handle_starttag(self, tag, attrs):
        if self.done:
            return
        classes = dict(attrs).get("class") or ""
        if self.depth == 0 and tag == "div" and classes.split()[:1] == ["prose"]:
            self.depth = 1
        elif self.depth:
            if tag == "div":
                self.depth += 1
            if tag in ("br", "p", "li"):
                self.parts.append("\n")

    def handle_endtag(self, tag):
        if self.depth and tag == "div":
            self.depth -= 1
            if self.depth == 0:
                self.done = True
        elif self.depth and tag in ("p", "li"):
            self.parts.append("\n")

    def handle_data(self, data):
        if self.depth and not self.done:
            self.parts.append(data)

    def text(self) -> str:
        joined = htmllib.unescape("".join(self.parts))
        lines = [re.sub(r"[ \t]+", " ", line).strip() for line in joined.split("\n")]
        return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


def fetch_description(session: requests.Session, url: str) -> str:
    resp = session.get(url, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    parser = _ProseText()
    parser.feed(resp.text)
    return parser.text()


def add_society_descriptions(events: list[dict], cache: dict, max_age_hours: float = 12) -> None:
    """Fill in descriptions for society events from their own pages (politely)."""
    now = time.time()
    todo = [e for e in events if e["isSociety"] and not e["description"]]
    fresh = {e["id"] for e in todo
             if e["id"] in cache and now - cache[e["id"]]["fetched"] < max_age_hours * 3600}
    session = requests.Session()

    def work(event):
        time.sleep(0.3)
        try:
            return event["id"], fetch_description(session, event["url"])
        except requests.RequestException as err:
            print(f"  ! could not fetch {event['url']}: {err}")
            return event["id"], None

    with ThreadPoolExecutor(max_workers=3) as pool:
        for event_id, text in pool.map(work, [e for e in todo if e["id"] not in fresh]):
            if text is not None:
                cache[event_id] = {"fetched": now, "description": text}

    for e in todo:
        if e["id"] in cache:
            e["description"] = cache[e["id"]]["description"]


def fetch_events(cache: dict) -> list[dict]:
    """Download the listing and return normalised events (governance filtered out)."""
    resp = requests.get(LISTING_URL, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    events = [e for e in (normalise(r) for r in raw_events(resp.text)) if e]
    add_society_descriptions(events, cache)
    return events
