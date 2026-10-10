"""Checks for the keyword rules, using wording taken from real Union listings.

    python -m unittest discover pipeline
"""
import unittest

from tags import enrich


def event(title="Event", description="", **extra):
    base = {"title": title, "description": description, "start": "2026-10-13T00:00:00+01:00",
            "end": None, "allDay": False, "location": None, "categories": []}
    base.update(extra)
    return enrich(base)


class TagRules(unittest.TestCase):
    def test_no_membership_required_is_open_not_members_only(self):
        e = event(description="No experience needed. No membership required. Just come along!")
        self.assertIn("open", e["tags"])
        self.assertNotIn("members", e["tags"])
        self.assertIn("beginner", e["tags"])

    def test_does_not_require_membership_and_is_free(self):
        e = event(description="This session does not require membership and is free.")
        self.assertIn("open", e["tags"])
        self.assertEqual(e["price"], "Free")

    def test_open_to_all_levels_is_about_ability_not_membership(self):
        e = event(description="Open to all levels, this practice will leave you feeling centred.")
        self.assertNotIn("open", e["tags"])

    def test_members_only(self):
        self.assertIn("members", event(description="This social is members only, sorry!")["tags"])

    def test_prize_money_is_not_the_price(self):
        e = event(description="£60 cash prize if you get this week's golden question!\n£1.50 entry.")
        self.assertEqual(e["price"], "£1.50")

    def test_price_range(self):
        e = event(description="Tickets are £3 for members and £5 for non-members.")
        self.assertEqual(e["price"], "£3–£5")

    def test_free_drinks_for_winners_is_not_food(self):
        self.assertNotIn("food", event(description="Winning teams get free drinks and prizes")["tags"])

    def test_food(self):
        self.assertIn("food", event(description="Meet the committee over fresh momos and chutney.")["tags"])

    def test_free_in_title(self):
        self.assertIn("free", event(title="Vinyasa Yoga with Faye- Free Taster Session")["tags"])
        self.assertNotIn("free", event(title="Free food Friday")["tags"])

    def test_location_revealed_later_is_not_a_location(self):
        e = event(description="Location will be revealed closer to the date on our instagram!")
        self.assertIsNone(e["location"])

    def test_address_on_next_line(self):
        e = event(description="Address:\nUnion Concert Hall\nBeit Quadrangle\nPrince Consort Road")
        self.assertEqual(e["location"], "Union Concert Hall")
        self.assertEqual(e["campus"], "South Kensington")

    def test_location_label_and_campus(self):
        e = event(description="Please arrive at 6:00. Location: SALC 1 on Level 5 Sherfield Building.")
        self.assertEqual(e["location"], "SALC 1 on Level 5 Sherfield Building")
        self.assertEqual(e["campus"], "South Kensington")

    def test_other_campuses(self):
        self.assertEqual(event(location="Reynolds Building, Charing Cross campus")["campus"], "Charing Cross")
        self.assertEqual(event(location="Ground Floor, Commonwealth Building, Hammersmith Hospital")["campus"],
                         "Hammersmith")

    def test_time_from_description_when_listing_has_none(self):
        e = event(description="On every Tuesday during term time at FiveSixEight from 7pm.", allDay=True)
        self.assertFalse(e["allDay"])
        self.assertEqual(e["start"], "2026-10-13T19:00:00+01:00")

    def test_give_it_a_go_in_title(self):
        e = event(title="ICSM Drama & Light Opera GIAG", categories=["Music"])
        self.assertTrue({"beginner", "open"} <= set(e["tags"]))

    def test_drop_in_beats_sign_up(self):
        e = event(description="It's a drop-in session, no need to sign up.")
        self.assertIn("dropin", e["tags"])
        self.assertNotIn("signup", e["tags"])


if __name__ == "__main__":
    unittest.main()
