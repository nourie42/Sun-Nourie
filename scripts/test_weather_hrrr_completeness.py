#!/usr/bin/env python3
"""Offline regressions for HRRR cycle availability and verified fallbacks."""
import datetime as dt
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import weather_fusion_collect as weather

UTC = dt.timezone.utc


def fake_urls(model, run, hour):
    index = f"{model}-{run:%Y%m%d%H}-f{hour:02d}.idx"
    return index[:-4], index


def temperature_index(model, text):
    return [{"field": "temperature"}]


class HRRRCycleTests(unittest.TestCase):
    def test_missing_intermediate_hour_falls_back_to_older_complete_cycle(self):
        now = dt.datetime(2026, 11, 14, 22, 30, tzinfo=UTC)
        requested = []

        def fetch(index, retries=0):
            requested.append(index)
            if "hrrr-2026111421-f14.idx" == index:
                raise FileNotFoundError("404 FH014")
            return b"temperature"

        with patch.object(weather, "urls", fake_urls), patch.object(weather, "parse_index", temperature_index):
            run, hours = weather.select_model_cycle("hrrr", now, fetch)
        self.assertEqual(weather.iso(run), "2026-11-14T20:00:00Z")
        self.assertEqual(hours, 18)
        self.assertIn("hrrr-2026111421-f14.idx", requested)
        self.assertIn("hrrr-2026111420-f18.idx", requested)

    def test_unfinished_extended_cycle_retains_complete_18_hour_forecast(self):
        now = dt.datetime(2026, 11, 14, 19, 30, tzinfo=UTC)

        def fetch(index, retries=0):
            if index == "hrrr-2026111418-f25.idx":
                raise FileNotFoundError("404 extended hour")
            return b"temperature"

        with patch.object(weather, "urls", fake_urls), patch.object(weather, "parse_index", temperature_index):
            run, hours = weather.select_model_cycle("hrrr", now, fetch)
        self.assertEqual(weather.iso(run), "2026-11-14T18:00:00Z")
        self.assertEqual(hours, 18)

    def test_complete_six_hour_cycle_uses_all_48_hours(self):
        now = dt.datetime(2026, 11, 14, 19, 30, tzinfo=UTC)
        checked = []

        def fetch(index, retries=0):
            checked.append(index)
            return b"temperature"

        with patch.object(weather, "urls", fake_urls), patch.object(weather, "parse_index", temperature_index):
            run, hours = weather.select_model_cycle("hrrr", now, fetch)
        self.assertEqual(weather.iso(run), "2026-11-14T18:00:00Z")
        self.assertEqual(hours, 48)
        self.assertIn("hrrr-2026111418-f00.idx", checked)
        self.assertIn("hrrr-2026111418-f48.idx", checked)
        self.assertEqual(len(checked), 49)  # FH018 is reused during extended availability check.

    def test_no_false_complete_cycle_on_missing_temperature(self):
        now = dt.datetime(2026, 11, 14, 22, 30, tzinfo=UTC)
        def missing_temperature(model, text):
            return []
        with patch.object(weather, "urls", fake_urls), patch.object(weather, "parse_index", missing_temperature):
            with self.assertRaisesRegex(RuntimeError, "No complete recent hrrr run found"):
                weather.select_model_cycle("hrrr", now, lambda index, retries=0: b"index")

    def test_nbm_selection_is_unchanged(self):
        now = dt.datetime(2026, 11, 14, 22, 30, tzinfo=UTC)
        checked = []
        def fetch(index, retries=0):
            checked.append(index)
            return b"temperature"
        with patch.object(weather, "urls", fake_urls), patch.object(weather, "parse_index", temperature_index):
            run, hours = weather.select_model_cycle("nbm", now, fetch)
        self.assertEqual(weather.iso(run), "2026-11-14T21:00:00Z")
        self.assertEqual(hours, 240)
        self.assertEqual(checked, ["nbm-2026111421-f240.idx"])


if __name__ == "__main__":
    unittest.main()
