"""Checks for merging what the AI read off a poster into a listed event."""
import unittest

from enrich_ai import merge


def listed(**extra):
    base = {"id": "union-1", "title": "Welcome to Friends of Palestine", "description": "",
            "start": "2026-10-12T16:00:00+01:00", "end": "2026-10-12T20:00:00+01:00",
            "allDay": False, "location": None, "campus": None, "price": None, "tags": []}
    base.update(extra)
    return base


def read(**fields):
    base = {"title": "Welcome Night", "date": None, "start_time": None, "end_time": None,
            "location": None, "price": None}
    base.update(fields)
    return {"events": [base]}


class Merge(unittest.TestCase):
    def test_poster_fills_room_time_and_food(self):
        e = listed()
        changed = merge(e, read(start_time="18:00", end_time="20:00", location="SAF 119", free_food=True))
        self.assertEqual(e["start"], "2026-10-12T18:00:00+01:00")
        self.assertEqual(e["end"], "2026-10-12T20:00:00+01:00")
        self.assertEqual(e["location"], "SAF 119")
        self.assertEqual(e["campus"], "South Kensington")
        self.assertIn("food", e["tags"])
        self.assertEqual(e["fromPoster"], ["location", "start"])
        self.assertIn("location", changed)

    def test_poster_time_outside_the_listed_slot_is_ignored(self):
        e = listed()
        merge(e, read(start_time="21:00"))
        self.assertEqual(e["start"], "2026-10-12T16:00:00+01:00")

    def test_listing_location_is_kept(self):
        e = listed(location="Metric")
        merge(e, read(location="Union bar"))
        self.assertEqual(e["location"], "Metric")

    def test_tbc_is_not_a_location(self):
        e = listed()
        merge(e, read(location="Location TBC"))
        self.assertIsNone(e["location"])

    def test_events_on_other_days_are_not_used(self):
        e = listed()
        self.assertEqual(merge(e, read(date="2026-10-19", location="Huxley 308")), {})
        self.assertIsNone(e["location"])

    def test_untimed_listing_gets_the_poster_time(self):
        e = listed(start="2026-10-13T00:00:00+01:00", end=None, allDay=True)
        merge(e, read(date="2026-10-13", start_time="19:00"))
        self.assertFalse(e["allDay"])
        self.assertEqual(e["start"], "2026-10-13T19:00:00+01:00")

    def test_members_only_and_no_signup(self):
        e = listed(tags=["open", "signup"])
        merge(e, read(open_to_non_members=False, signup_required=False))
        self.assertIn("members", e["tags"])
        self.assertNotIn("open", e["tags"])
        self.assertIn("dropin", e["tags"])
        self.assertNotIn("signup", e["tags"])

    def test_free_price(self):
        e = listed()
        merge(e, read(price="Free"))
        self.assertEqual(e["price"], "Free")
        self.assertIn("free", e["tags"])


if __name__ == "__main__":
    unittest.main()
