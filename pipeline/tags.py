"""Rule-based guesses for location, campus, start time, price and filter tags.

These are deliberately cautious keyword rules: a tag is only added when the
text says so fairly explicitly. They are a stopgap until the AI step reads each
post and poster properly, and they work the same for every source.
"""
from __future__ import annotations

import re
from datetime import datetime

# Building and venue names -> campus. Checked against the location first, then
# the description. Order matters: more specific names come first.
CAMPUS_KEYWORDS = [
    ("White City", r"white city|wood lane|msrh|molecular sciences research hub|i-?hub|translation (and|&) innovation hub|michael uren|scale space"),
    ("Hammersmith", r"hammersmith|du cane|commonwealth building|ictem|burlington danes"),
    ("Charing Cross", r"charing cross|reynolds|fulham palace road"),
    ("St Mary's", r"st\.? mary'?s|paddington|norfolk place|qeqm"),
    ("Chelsea & Westminster", r"chelsea (and|&) westminster|chelwest"),
    ("Silwood Park", r"silwood"),
    ("Harlington", r"harlington"),
    ("Online", r"^online$|\bonline (event|session|talk|webinar)\b|\bon (zoom|teams)\b|\bvia (zoom|teams)\b"),
    ("South Kensington", r"south ken|huxley|sherfield|salc|great hall|blyth|\bsaf\b|alexander fleming|blackett|skempton"
                         r"|\brsm\b|royal school of mines|bessemer|\bbone building|roderic hill|city (and|&) guilds|\bcagb\b"
                         r"|electrical (and electronic )?engineering|\beee(\b|\d)|mech(anical)? eng|chemistry building|dalby court|queen'?s lawn"
                         r"|queen'?s tower|abdus salam|central library|\bbeit\b|metric|fivesixeight|\b568\b|h-?bar|ħ-bar"
                         r"|union dining hall|\budh\b|union concert hall|read theatre|ethos|prince'?s gardens|southside"
                         r"|eastside|weeks hall|imperial college road|exhibition road|faculty building|ace extension"
                         r"|imperial college union|union building|activities space|lower lounge|hyde park|prince consort"),
]

LOCATION_LABEL = re.compile(
    r"(?:📍|\b(?:location|venue|where|place|room|address)\b\s*[:\-–])[ \t]*\n?[ \t]*(?P<loc>[^\n]{3,90})", re.I)
NOT_A_PLACE = re.compile(r"\b(tbc|tba|tbd|to be (confirmed|announced|decided)|will be (revealed|announced|confirmed|sent|shared)"
                         r"|closer to the (date|time)|check (our|the) (instagram|whatsapp|groupchat))\b", re.I)

# Phrases that say the event is open to everyone. Checked before "members only"
# so that "no membership required" doesn't read as a members-only event.
OPEN = re.compile(
    r"\bopen to (all|everyone|anyone|non-?members|all students)\b(?!\s+(levels|abilities|ages|skill|experience|years|genders))"
    r"|\b(everyone|all) (is |are )?welcome\b"
    r"|\bnon-?members (are )?(also )?welcome\b|\bno membership (is )?(needed|required|necessary)\b"
    r"|\b(does not|doesn'?t|do not|don'?t) (require|need) (a )?membership\b|\bmembership (is )?not (needed|required)\b"
    r"|\bdon'?t (need to|have to) be a member\b|\bwithout (the need to )?(pay or )?be(ing)? a member\b", re.I)
MEMBERS_ONLY = re.compile(
    r"\bmembers[- ]only\b|\bfor members only\b|\bonly (open )?(to|for) members\b|(?<!no )\bmembership (is )?required\b", re.I)

TAG_RULES = {
    "beginner": r"\bbeginners?\b|\bno (prior |previous )?experience\b|\ball (abilities|levels|skill levels|experience levels)\b"
                r"|\bnever (played|tried|done)\b|\btaster\b|\bfirst[- ]timers?\b|\bnewcomers?\b",
    "free": r"\bfree (event|entry|of charge|admission|to attend|to join|session|class|workshop|lesson|taster|trial|tour"
            r"|film|screening|for (all|everyone))\b|\bentry is free\b|\bfor free\b|\bno charge\b|\bcompletely free\b"
            r"|\btotally free\b|\bat no cost\b|\bit'?s free\b|\bfree!|\band is (completely |totally |also )?free\b"
            r"|\b(session|event|entry|this|class|workshop|screening|admission|everything) (is|are) (completely |totally |also )?free\b",
    "food": r"\bfree food\b|\bpizzas?\b|\bsnacks\b|\brefreshments\b|\bfood (will be )?(provided|served|included)\b"
            r"|\bfree (lunch|dinner|breakfast)\b|\bcakes?\b|\bdoughnuts?\b|\bdonuts?\b|\bbubble tea\b|\bboba\b"
            r"|\bbiscuits\b|\bsweets\b|\bbbq\b|\bbarbecue\b|\bpotato(es)?\b|\bcrepes?\b|\bpancakes?\b|\bmomos?\b"
            r"|\bdumplings?\b|\bsamosas?\b|\bsushi\b|\btacos?\b|\bburgers?\b|\bnachos\b|\bpopcorn\b|\bhot chocolate\b"
            r"|\bmince pies?\b|\bcookies\b|\bbrownies?\b|\bice cream\b",
    "signup": r"\bsign[- ]?up\b|\bregist(er|ration)\b|\bbook (your |a )?(tickets?|place|spot|slot)\b|\btickets?\b"
              r"|\brsvp\b|\bfill in (this|the|our) (very )?(short )?form\b|forms\.(office\.com|cloud\.microsoft)|\bfixr\b"
              r"|\beventbrite\b|\blimited (spaces|spots|places)\b",
    "dropin": r"\bdrop[- ]in\b|\bjust (turn|show) up\b|\bno (need to )?(sign[- ]?up|register|book)\b",
    "alcoholfree": r"\balcohol[- ]free\b|\bnon[- ]alcoholic\b|\bdry (event|social)\b|\bsober\b|\bmocktails?\b",
}
TAG_RES = {name: re.compile(rx, re.I) for name, rx in TAG_RULES.items()}
GIAG = re.compile(r"\bgive it a go\b|\bgiag\b", re.I)

# A £ amount only counts as the price when the words around it are about paying,
# not about prizes or fundraising ("£60 cash prize", "we raised £500").
PRICE = re.compile(r"£\s?(\d{1,3}(?:\.\d{2})?)")
PRICE_WORDS = re.compile(r"ticket|entry|cost|price|fee|pay|member|per person|each|admission|charge|subs|deposit", re.I)
NOT_PRICE_WORDS = re.compile(r"prize|win|worth|voucher|tab|raise|donat|fund|budget|grant|reward|jackpot", re.I)

START_TIME = re.compile(r"\b(?:from|at|starts? at|starting at|doors (?:open )?at)\s+(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)\b", re.I)


def campus_for(*texts: str | None) -> str | None:
    for text in texts:
        if not text:
            continue
        low = text.lower()
        for campus, rx in CAMPUS_KEYWORDS:
            if re.search(rx, low):
                return campus
    return None


def location_from_text(text: str) -> str | None:
    m = LOCATION_LABEL.search(text or "")
    if not m or NOT_A_PLACE.search(m.group("loc")):
        return None
    loc = re.split(r"(?<=[a-z0-9)])\.\s|\s[-–]\s(?=[A-Z])", m.group("loc").strip())[0]
    return loc.strip(" .,:;") or None


def price_from_text(text: str) -> str | None:
    amounts = []
    for m in PRICE.finditer(text):
        window = text[max(0, m.start() - 40):m.end() + 40]
        if PRICE_WORDS.search(window) and not NOT_PRICE_WORDS.search(window):
            amounts.append(float(m.group(1)))
    amounts = sorted({a for a in amounts if a > 0})
    if not amounts:
        return None
    fmt = lambda p: f"£{p:g}" if p == int(p) else f"£{p:.2f}"
    return fmt(amounts[0]) if len(amounts) == 1 else f"{fmt(amounts[0])}–{fmt(amounts[-1])}"


def start_time_from_text(event: dict) -> None:
    """For events listed without a time, use a clear "from 7pm" in the description."""
    m = START_TIME.search(event.get("description") or "")
    if not m:
        return
    hour, minute, half = int(m.group(1)), int(m.group(2) or 0), m.group(3).lower()
    if not 1 <= hour <= 12:
        return
    hour = hour % 12 + (12 if half == "pm" else 0)
    day = datetime.fromisoformat(event["start"])
    event["start"] = day.replace(hour=hour, minute=minute).isoformat()
    event["allDay"] = False


def enrich(event: dict) -> dict:
    """Add location (if missing), campus, price and tags to an event in place."""
    description = event.get("description") or ""
    text = f"{event['title']}\n{description}"
    if not event.get("location"):
        event["location"] = location_from_text(description)
    event["campus"] = campus_for(event.get("location"), event["title"], description)
    if event.get("allDay"):
        start_time_from_text(event)

    tags = {name for name, rx in TAG_RES.items() if rx.search(text)}
    if OPEN.search(text):
        tags.add("open")
    elif MEMBERS_ONLY.search(text):
        tags.add("members")
    if GIAG.search(event["title"]) or any(GIAG.search(c) for c in event.get("categories") or []):
        # The Union describes Give it a Go as trying a society "without the need
        # to pay or be a member", so these are beginner-friendly and open to all.
        tags |= {"beginner", "open"}
        tags.discard("members")
    if re.search(r"\bfree\b(?!\s+(food|drinks?|pizza|snacks))", event["title"], re.I):
        tags.add("free")
    if "dropin" in tags:
        tags.discard("signup")

    event["price"] = price_from_text(text)
    if event["price"]:
        tags.discard("free")
    elif "free" in tags:
        event["price"] = "Free"

    if event.get("soldOut"):
        tags.add("soldout")
    if event.get("accessibility") and "wheelchair" in event["accessibility"].lower():
        tags.add("accessible")
    event["tags"] = sorted(tags)
    return event
