# After Lectures

Every Imperial society event in one place: what's on now, today and this week.
*After Lectures* is a working title; to rename it, change it in `site/index.html`
and `site/manifest.webmanifest`.

An unofficial student project, not run by Imperial College Union or Imperial
College London.

## How it works

```
pipeline/  Python: collects events from each source → site/data/events.json
site/      The website: plain HTML/CSS/JS, installable on phones, works offline
tools/     Headless-Chrome scripts: end-to-end checks and icon rendering
```

1. **`pipeline/union.py`** reads the Union's What's On page. The site has no API,
   but each page carries its data in the React Server Components payload
   (`self.__next_f.push(...)` chunks), which we decode. Society events only have
   a summary there, so we also fetch each event's own page for the full
   description (politely: 3 at a time, cached for 12 hours).
2. **`pipeline/tags.py`** guesses location, campus, price and tags (free, food,
   open to all, newcomers, sign-up, members only) with cautious keyword rules.
   These get replaced by the AI step once Instagram is connected.
3. **`pipeline/enrich_ai.py`** has Gemini read each event's poster and caption
   (`pipeline/extract.py`) to fill in what the listing lacks: the room, the real
   start time inside the booked slot, free food, price, sign-up. Each poster is
   read once and cached. Event pages say which details came from the poster.
4. **`pipeline/build.py`** merges sources, drops finished events and writes
   `site/data/events.json`.
4. **`site/`** renders it. Routes live in the URL hash (`#/now`, `#/day/2026-10-13`,
   `#/saved`, `#/e/<id>`) so any view or event can be shared as a link. Saved
   events are stored on the device for now.

## Run it locally

```bash
pip install -r pipeline/requirements.txt
python pipeline/build.py                          # fetch events (~20 s)
python -m http.server 8765 --directory site       # then open http://localhost:8765
```

Tests:

```bash
python -m unittest discover -s pipeline           # tagging rules
node tools/check.js                               # 26 end-to-end checks + screenshots in tools/out/
```

`tools/check.js` pins the clock to Monday 12 October 2026, 18:30, so the "now"
view has something on. `node tools/make-icons.js` re-renders the PNG icons from
`site/icons/icon.svg`.

## AI reading test

`tools/render-screens.js` draws 30 real Union events as Instagram-style
screenshots, twice each: the caption as written, and with a date line in the
styles societies use ("📅 Tue 13 Oct · 6pm–8pm", "13/10 | 6pm-8pm", "This
Tuesday from 6pm"). `pipeline/eval_extract.py --model <name>` scores the answers
against the Union's own listing.

Result for `gemini-3.1-flash-lite` (free tier, 11 Oct 2026), the model we use:

| | right | wrong | left blank |
|---|---|---|---|
| Date, posts with a date line (30) | 30 | 0 | 0 |
| Start time, same posts | 29 | 0 | 1 |
| Date, captions as written (30, 21 never say when) | 9 | 0 | 21 |

It never invented a date, and averaged 3.3 s. `gemini-3.5-flash` invented one in
its first 8 undated posts and was about 20 times slower, so we don't use it.

Run with `GEMINI_API_KEY` set:

```bash
node tools/render-screens.js 30
python pipeline/eval_extract.py --model gemini-3.1-flash-lite
```

## Deploying

`.github/workflows/update-and-deploy.yml` runs every 3 hours on GitHub Actions:
it runs the tests, collects fresh events, reads new posters (using the
`GEMINI_API_KEY` repository secret) and publishes `site/` to GitHub Pages.

## Roadmap

- **Weeks 1–2:** Union events ✅, the main views and filters ✅, installable
  website ✅, adding events from screenshots, share with friends.
- **Weeks 3–5:** society Instagram posts through Meta's official API, with an AI
  step reading each caption and poster; weekly sessions; merging duplicates;
  Imperial-email sign-in; reminders; change and cancellation alerts.
- **Weeks 6–8:** timetable-aware "I'm free" view, following societies, a daily
  "tonight" message.
- **January:** launch at the start of spring term.
