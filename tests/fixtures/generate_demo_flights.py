#!/usr/bin/env python3
"""Generate a realistic demo/test dataset for Flight Journal.

Produces a JSON file in the same envelope shape that ExportService::exportJson
writes (and that ImportService::importJson accepts), so it can be restored
directly from Personal settings → Import / Export.

Characteristics (see the project brief):
- ~200 legs spanning ~2015..2026, home airport FRA.
- Year-over-year fluctuation with a pronounced COVID dip in 2020-2021.
- Mix of short- and long-haul, with connecting, open-jaw and circular routings.
- Realistic airline / aircraft / registration / cabin distributions.
- A handful of flights with deliberately invalid airport codes.

Deterministic: a fixed RNG seed makes the output reproducible.
"""

import argparse
import json
import math
import os
import random
import sys
from datetime import datetime, timezone, date, timedelta

random.seed(20260609)

TODAY = date(2026, 6, 9)

# --- Reference airports ---------------------------------------------------------
# The curated set of airports the demo routes use. Names, coordinates and the
# canonical code are loaded from the reference dataset (see load_reference) so
# the fixture's labels, codes and distances are exactly what airport
# reconciliation produces against that same data. We must never ship a fixture
# whose label/code pairs disagree with the reference (it would self-corrupt on a
# recheck and look broken on the map). Every code here has an IATA entry, so the
# canonical code equals the code itself.
CURATED_CODES = [
    # Germany / home region
    "FRA", "MUC", "BER", "HAM", "DUS", "STR", "CGN",
    # Europe short-haul
    "LHR", "LGW", "MAN", "EDI", "CDG", "ORY", "NCE", "LYS", "AMS", "BRU", "ZRH", "GVA",
    "VIE", "MAD", "BCN", "FCO", "MXP", "LIN", "VCE", "NAP", "ATH", "LIS", "OPO", "DUB",
    "CPH", "ARN", "OSL", "HEL", "WAW", "PRG", "BUD", "PMI", "TFS", "MLA", "KRK", "KEF",
    "TLV", "IST",
    # Long-haul
    "JFK", "EWR", "ORD", "BOS", "IAD", "SFO", "LAX", "SEA", "MIA", "YYZ", "YVR", "MEX",
    "GRU", "EZE", "DXB", "DOH", "AUH", "SIN", "HKG", "NRT", "HND", "ICN", "PEK", "PVG",
    "BKK", "DEL", "BOM", "JNB", "CPT", "SYD", "MEL", "AKL", "NBO", "CAI", "RUH", "MLE",
]


def load_reference(path, codes):
    """Build {code: (name, lat, lon)} for `codes` from the reference airports JSON.

    The reference file is the mwgg/Airports dataset (the same JSON an admin
    imports into Flight Journal): an object keyed by ICAO, each value carrying
    icao/iata/name/lat/lon. We index by IATA and look each curated code up there;
    the canonical code Flight Journal stores is IATA-when-present, and every
    curated code has one. Any code missing from the reference is a hard error —
    we will not silently emit an airport the product cannot reconcile.
    """
    with open(path, encoding="utf-8") as f:
        ref = json.load(f)
    by_iata = {}
    for entry in ref.values():
        iata = entry.get("iata")
        if iata:
            by_iata[iata] = entry
    out = {}
    missing = []
    for code in codes:
        entry = by_iata.get(code)
        if entry is None or not entry.get("name"):
            missing.append(code)
            continue
        out[code] = (entry["name"], float(entry["lat"]), float(entry["lon"]))
    if missing:
        raise SystemExit(
            "Reference data is missing usable entries for: " + ", ".join(missing)
            + ". Use an airports.json that contains these IATA codes."
        )
    return out


def _default_reference_path():
    """Look for an airports.json next to this script or in the CWD."""
    here = os.path.dirname(os.path.abspath(__file__))
    for candidate in (os.path.join(here, "airports.json"), "airports.json"):
        if os.path.exists(candidate):
            return candidate
    return None


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument(
    "--airports", default=_default_reference_path(),
    help="Path to the reference airports JSON (mwgg/Airports format, keyed by "
         "ICAO). Defaults to airports.json next to this script or in the CWD.",
)
parser.add_argument(
    "--out", default="tests/fixtures/demo-flights.json",
    help="Output path for the generated demo dataset.",
)
args = parser.parse_args()

if not args.airports or not os.path.exists(args.airports):
    sys.exit(
        "Reference airports JSON not found. Pass --airports /path/to/airports.json "
        "(the same mwgg/Airports dataset an admin imports into Flight Journal)."
    )

AIRPORTS = load_reference(args.airports, CURATED_CODES)


def haversine_km(a, b):
    (_, la1, lo1) = AIRPORTS[a]
    (_, la2, lo2) = AIRPORTS[b]
    r = 6371.0088  # IUGG mean Earth radius — matches Service/GreatCircle.php
    p1, p2 = math.radians(la1), math.radians(la2)
    dphi = math.radians(la2 - la1)
    dl = math.radians(lo2 - lo1)
    h = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return int(round(2 * r * math.asin(math.sqrt(h))))


# --- Aircraft -------------------------------------------------------------------
AC_RAW = {
    "A319": "A319", "A320": "A320", "A321": "A321",
    "A20N": "A320neo", "A21N": "A321neo",
    "B738": "B737-800", "B38M": "737 MAX 8", "B752": "757-200",
    "E190": "E190", "E195": "E195", "BCS3": "A220-300",
    "A332": "A330-200", "A333": "A330-300", "A339": "A330-900neo",
    "A343": "A340-300", "A346": "A340-600",
    "A359": "A350-900", "A35K": "A350-1000", "A388": "A380-800",
    "B744": "747-400", "B748": "747-8", "B763": "767-300",
    "B772": "777-200", "B77W": "777-300ER",
    "B788": "787-8", "B789": "787-9", "B78X": "787-10",
}

NB_DEFAULT = ["A320", "A321", "A319", "B738", "A20N", "A21N"]
NB = {
    "LH": ["A320", "A321", "A319", "A20N", "A21N", "E190"],
    "LX": ["A320", "A321", "BCS3", "A20N"],
    "OS": ["A320", "A321", "E195", "A20N"],
    "EW": ["A319", "A320", "A20N"],
    "SN": ["A319", "A320", "A21N"],
    "BA": ["A319", "A320", "A321", "A20N", "A21N"],
    "AF": ["A319", "A320", "A321", "BCS3"],
    "KL": ["B738", "E190", "E195"],
    "IB": ["A319", "A320", "A321", "A20N"],
    "VY": ["A320", "A21N"],
    "AZ": ["A319", "A320", "A21N"],
    "A3": ["A320", "A21N"],
    "TP": ["A320", "A21N", "BCS3"],
    "EI": ["A320", "A21N"],
    "SK": ["A320", "A21N", "BCS3"],
    "AY": ["A320", "A321", "E190"],
    "LO": ["B738", "E195", "A21N"],
    "DE": ["A320", "A21N", "B738"],
    "FI": ["B752", "B38M"],
    "TK": ["A320", "A321", "B738", "A21N"],
    "LY": ["B738", "A21N"],
    "G3": ["B738", "B38M"],
    "AR": ["B738", "A20N"],
}
WB_DEFAULT = ["A333", "B77W", "A359"]
WB = {
    "LH": ["A359", "A333", "A343", "A346", "B744", "B748"],
    "LX": ["A333", "A343", "B77W"],
    "OS": ["B763", "B772"],
    "BA": ["B77W", "B788", "B789", "A35K", "B744", "B772"],
    "AF": ["A359", "B77W", "B772", "A332", "A333"],
    "KL": ["B77W", "B789", "A333", "B772"],
    "IB": ["A333", "A359"],
    "TP": ["A339", "A333"],
    "EK": ["B77W", "A388"],
    "QR": ["A359", "A35K", "B77W", "B788"],
    "EY": ["B77W", "B789", "A359"],
    "SQ": ["A359", "B77W", "A388", "B789"],
    "CX": ["A359", "A35K", "B77W", "A333"],
    "NH": ["B789", "B77W", "B788", "A359"],
    "JL": ["B789", "B77W", "B788"],
    "KE": ["B77W", "A333", "A388", "B748"],
    "OZ": ["A359", "B77W", "A333"],
    "CA": ["A333", "A359", "B77W", "B789"],
    "MU": ["A333", "A359", "B77W", "B789"],
    "TG": ["A359", "B77W", "A333"],
    "AI": ["B788", "B77W", "B789"],
    "SA": ["A333", "A346"],
    "UA": ["B772", "B789", "B77W", "B788"],
    "AA": ["B772", "B789", "B77W", "B788"],
    "AC": ["B789", "B788", "B77W"],
    "TK": ["A333", "B77W", "B789", "A359"],
    "LO": ["B788", "B789"],
    "FI": ["B752", "B763"],
    "MS": ["B77W", "A333", "B789"],
    "SV": ["B77W", "A333", "B789"],
    "AR": ["A333", "B789"],
    "KQ": ["B788", "B789"],
}


def pick_aircraft(dist, al):
    if dist < 2300:
        pool = NB.get(al, NB_DEFAULT)
    elif dist < 3800:
        narrow = [c for c in NB.get(al, NB_DEFAULT) if c in ("A321", "A21N", "B38M", "B752")]
        if narrow and random.random() < 0.5:
            pool = narrow
        else:
            pool = WB.get(al, WB_DEFAULT)
    else:
        pool = WB.get(al, WB_DEFAULT)
    code = random.choice(pool)
    return code, AC_RAW[code]


# --- Registrations: a small reused tail pool per airline ------------------------
LET = "ABCDEFGHJKLMNPQRSTUVWXYZ"
DIG = "0123456789"


def _l(n):
    return "".join(random.choice(LET) for _ in range(n))


def _d(n):
    return "".join(random.choice(DIG) for _ in range(n))


REG_BUILDERS = {
    "LH": lambda: "D-A" + _l(3), "EW": lambda: "D-A" + _l(3), "DE": lambda: "D-A" + _l(3),
    "LX": lambda: "HB-J" + _l(2), "OS": lambda: "OE-L" + _l(2), "SN": lambda: "OO-S" + _l(2),
    "BA": lambda: "G-" + _l(4), "AF": lambda: "F-G" + _l(3), "KL": lambda: "PH-B" + _l(2),
    "IB": lambda: "EC-" + _l(3), "VY": lambda: "EC-" + _l(3), "AZ": lambda: "EI-" + _l(3),
    "A3": lambda: "SX-D" + _l(2), "TP": lambda: "CS-T" + _l(2), "EI": lambda: "EI-" + _l(3),
    "SK": lambda: "SE-" + _l(3), "AY": lambda: "OH-L" + _l(2), "LO": lambda: "SP-L" + _l(2),
    "FI": lambda: "TF-" + _l(3), "TK": lambda: "TC-J" + _l(2), "LY": lambda: "4X-E" + _l(2),
    "EK": lambda: "A6-E" + _l(2), "QR": lambda: "A7-B" + _l(2), "EY": lambda: "A6-B" + _l(2),
    "SQ": lambda: "9V-S" + _l(2), "CX": lambda: "B-L" + _l(2),
    "NH": lambda: "JA" + _d(3) + random.choice("AJ"), "JL": lambda: "JA" + _d(3) + random.choice("AJ"),
    "KE": lambda: "HL" + _d(4), "OZ": lambda: "HL" + _d(4),
    "CA": lambda: "B-" + _d(4), "MU": lambda: "B-" + _d(4),
    "TG": lambda: "HS-T" + _l(2), "AI": lambda: "VT-" + _l(3), "SA": lambda: "ZS-S" + _l(2),
    "MS": lambda: "SU-G" + _l(2), "SV": lambda: "HZ-A" + _l(2),
    "UA": lambda: "N" + _d(3) + _l(2), "AA": lambda: "N" + _d(3) + _l(2), "B6": lambda: "N" + _d(3) + _l(2),
    "AC": lambda: "C-" + random.choice("FG") + _l(3), "AR": lambda: "LV-" + _l(3),
    "G3": lambda: "PR-G" + _l(2), "KQ": lambda: "5Y-K" + _l(2),
}
REG_POOL = {al: [b() for _ in range(8)] for al, b in REG_BUILDERS.items()}


def pick_reg(al):
    return random.choice(REG_POOL.get(al, ["D-A" + _l(3)]))


# --- Cabin / seat ---------------------------------------------------------------
def pick_cabin(dist):
    if dist < 1500:
        return random.choices(["economy", "business", "first"], [0.86, 0.12, 0.02])[0]
    if dist < 4000:
        return random.choices(["economy", "premium_economy", "business", "first"], [0.78, 0.05, 0.15, 0.02])[0]
    return random.choices(["economy", "premium_economy", "business", "first"], [0.68, 0.13, 0.16, 0.03])[0]


def pick_seat(cabin, widebody):
    wide_letters = "ABCDEFGHK"
    narrow_letters = "ABCDEF"
    letters = wide_letters if widebody else narrow_letters
    if cabin == "first":
        row = random.randint(1, 4)
        return f"{row}{random.choice('ADGK' if widebody else 'AC')}"
    if cabin == "business":
        row = random.randint(1, 12)
        return f"{row}{random.choice(letters)}"
    if cabin == "premium_economy":
        row = random.randint(20, 34)
        return f"{row}{random.choice(letters)}"
    row = random.randint(10, 52 if widebody else 38)
    return f"{row}{random.choice(letters)}"


WIDEBODY = {"A332", "A333", "A339", "A343", "A346", "A359", "A35K", "A388",
            "B744", "B748", "B763", "B772", "B77W", "B788", "B789", "B78X"}

NOTES = [
    None, None, None, None, None, None, None, None, None,
    "Upgraded to business at the gate", "Delayed ~2h, missed connection rebooked",
    "Window seat over the Alps", "Honeymoon trip", "Volcanic ash rerouting",
    "Brand-new aircraft, delivery flight", "Free upgrade with miles",
    "Turbulent descent", "Met the captain in the lounge", "Last flight on this type",
    "Bumped to a later flight", "Crew strike — rebooked", "Sat next to a colleague",
]


def flight_number(al, dist):
    if dist >= 4000:
        return str(random.randint(1, 499))
    return str(random.randint(100, 2999))


# --- Journey templates ----------------------------------------------------------
# A journey is a list of "days"; each day is (gap_before_days, [(orig, dest, airline), ...]).
HOME = "FRA"

EU = [
    ("LHR", "BA"), ("LGW", "BA"), ("MAN", "BA"), ("EDI", "BA"),
    ("CDG", "AF"), ("ORY", "AF"), ("NCE", "AF"), ("LYS", "AF"),
    ("AMS", "KL"), ("BRU", "SN"), ("ZRH", "LX"), ("GVA", "LX"),
    ("VIE", "OS"), ("MAD", "IB"), ("BCN", "VY"), ("FCO", "AZ"),
    ("MXP", "LH"), ("LIN", "LH"), ("VCE", "LH"), ("NAP", "LH"),
    ("ATH", "A3"), ("LIS", "TP"), ("OPO", "TP"), ("DUB", "EI"),
    ("CPH", "SK"), ("ARN", "SK"), ("OSL", "SK"), ("HEL", "AY"),
    ("WAW", "LO"), ("PRG", "LH"), ("BUD", "LH"), ("PMI", "EW"),
    ("TFS", "DE"), ("MLA", "LH"), ("KRK", "LH"), ("KEF", "FI"),
    ("STR", "LH"), ("HAM", "LH"), ("BER", "LH"), ("MUC", "LH"),
    ("DUS", "EW"), ("CGN", "EW"), ("TLV", "LH"), ("IST", "TK"),
]
LONG = [
    ("JFK", "LH"), ("EWR", "UA"), ("ORD", "UA"), ("BOS", "LH"),
    ("IAD", "UA"), ("SFO", "LH"), ("LAX", "LH"), ("SEA", "LH"),
    ("MIA", "AA"), ("YYZ", "AC"), ("YVR", "AC"), ("MEX", "LH"),
    ("GRU", "LH"), ("EZE", "LH"), ("DXB", "EK"), ("DOH", "QR"),
    ("AUH", "EY"), ("SIN", "SQ"), ("HKG", "CX"), ("NRT", "NH"),
    ("HND", "JL"), ("ICN", "KE"), ("PEK", "CA"), ("PVG", "MU"),
    ("BKK", "TG"), ("DEL", "AI"), ("BOM", "AI"), ("JNB", "SA"),
    ("CPT", "LH"), ("NBO", "KQ"), ("CAI", "MS"), ("RUH", "SV"),
]
CONNECT = [  # FRA - hub - far destination, same day, with EK/QR/SQ/TK
    ("DXB", "SYD", "EK"), ("DXB", "MEL", "EK"), ("DXB", "AKL", "EK"),
    ("DXB", "BKK", "EK"), ("DXB", "JNB", "EK"), ("DXB", "MLE", "EK"),
    ("DOH", "SYD", "QR"), ("DOH", "AKL", "QR"), ("DOH", "CPT", "QR"),
    ("DOH", "BKK", "QR"), ("SIN", "SYD", "SQ"), ("SIN", "MEL", "SQ"),
    ("IST", "BKK", "TK"), ("IST", "DEL", "TK"), ("IST", "NBO", "TK"),
]
CIRCLE = [  # three legs, multi-day, returning to FRA
    [("SIN", "SQ"), ("HKG", "CX"), "LH"],
    [("JFK", "LH"), ("LAX", "AA"), "LH"],
    [("NRT", "LH"), ("ICN", "OZ"), "LH"],
    [("GRU", "LH"), ("EZE", "AR"), "LH"],
    [("CPT", "LH"), ("JNB", "SA"), "LH"],
    [("BKK", "TG"), ("SIN", "SQ"), "LH"],
    [("YYZ", "AC"), ("JFK", "B6"), "LH"],
]
OPENJAW_EU = [("VCE", "FCO"), ("BCN", "MAD"), ("NAP", "FCO"), ("EDI", "LHR"),
              ("OSL", "CPH"), ("OPO", "LIS"), ("MXP", "VCE"), ("LGW", "MAN")]
OPENJAW_LH = [("JFK", "EWR"), ("SFO", "LAX"), ("NRT", "HND"), ("PEK", "PVG"),
              ("EWR", "JFK"), ("LAX", "SFO")]
DAYTRIP = [("LHR", "BA"), ("CDG", "AF"), ("MUC", "LH"), ("ZRH", "LX"),
           ("VIE", "OS"), ("BRU", "SN"), ("AMS", "KL"), ("HAM", "LH")]


def gap(a, b):
    return random.randint(a, b)


def make_journey():
    """Return a list of (gap_before_days, [(orig, dest, airline), ...])."""
    cat = random.choices(
        ["eu_ret", "eu_day", "lh_ret", "connect", "openjaw_eu", "openjaw_lh", "circle"],
        [0.46, 0.05, 0.20, 0.08, 0.07, 0.04, 0.10],
    )[0]
    if cat == "eu_ret":
        d, al = random.choice(EU)
        return [(0, [(HOME, d, al)]), (gap(2, 9), [(d, HOME, al)])]
    if cat == "eu_day":
        d, al = random.choice(DAYTRIP)
        return [(0, [(HOME, d, al), (d, HOME, al)])]
    if cat == "lh_ret":
        d, al = random.choice(LONG)
        return [(0, [(HOME, d, al)]), (gap(5, 18), [(d, HOME, al)])]
    if cat == "connect":
        hub, dest, al = random.choice(CONNECT)
        return [
            (0, [(HOME, hub, al), (hub, dest, al)]),
            (gap(7, 16), [(dest, hub, al), (hub, HOME, al)]),
        ]
    if cat == "openjaw_eu":
        a, b = random.choice(OPENJAW_EU)
        al1 = dict(EU).get(a, "LH")
        al2 = dict(EU).get(b, "LH")
        return [(0, [(HOME, a, al1)]), (gap(3, 9), [(b, HOME, al2)])]
    if cat == "openjaw_lh":
        a, b = random.choice(OPENJAW_LH)
        al1 = dict(LONG).get(a, "LH")
        al2 = dict(LONG).get(b, "LH")
        return [(0, [(HOME, a, al1)]), (gap(6, 18), [(b, HOME, al2)])]
    # circle
    (a, al_a), (b, al_b), al_back = random.choice(CIRCLE)
    return [
        (0, [(HOME, a, al_a)]),
        (gap(3, 7), [(a, b, al_b)]),
        (gap(3, 7), [(b, HOME, al_back)]),
    ]


# --- Per-year leg targets (note the COVID dip in 2020-2021) --------------------
YEAR_TARGETS = {
    2015: 14, 2016: 16, 2017: 18, 2018: 20, 2019: 26,
    2020: 5, 2021: 8, 2022: 18, 2023: 22, 2024: 20, 2025: 16, 2026: 6,
}


def journey_dates(journey, start):
    """Expand a journey to [(date, [(orig, dest, airline), ...]), ...]."""
    out = []
    cur = start
    first = True
    for gap_days, legs in journey:
        if not first:
            cur = cur + timedelta(days=gap_days)
        first = False
        out.append((cur, legs))
    return out


# --- Build all legs -------------------------------------------------------------
# Journeys are laid out sequentially on a single, monotonically advancing date
# cursor, so two trips can never overlap. The only same-day multi-leg days are
# genuine connections *within* one journey — there is never a second, conflicting
# itinerary sharing a date (e.g. two long-haul departures from FRA on one day).
raw_legs = []  # each: dict(date, orig, dest, airline, seq)
seq = 0
cursor = date(2015, 1, 1)
for year, target in YEAR_TARGETS.items():
    # Don't start before this year (with a little jitter); never move backwards.
    year_start = date(year, 1, 1) + timedelta(days=random.randint(0, 25))
    if cursor < year_start:
        cursor = year_start
    year_count = 0
    guard = 0
    while year_count < target and guard < 500:
        guard += 1
        if cursor.year > year or cursor > TODAY:
            break
        dated = journey_dates(make_journey(), cursor)
        for d, legs in dated:
            for (o, dest, al) in legs:
                raw_legs.append({"date": d, "orig": o, "dest": dest, "airline": al, "seq": seq})
                seq += 1
                if d.year == year:
                    year_count += 1
        # Time at home before the next trip; keeps the cursor strictly ahead.
        cursor = dated[-1][0] + timedelta(days=random.randint(7, 26))

# Drop anything in the future.
raw_legs = [l for l in raw_legs if l["date"] <= TODAY]


def epoch_noon(d):
    return int(datetime(d.year, d.month, d.day, 12, 0, tzinfo=timezone.utc).timestamp())


def build_flight(orig, dest, airline, d, day_seq):
    valid = orig in AIRPORTS and dest in AIRPORTS
    dist = haversine_km(orig, dest) if valid else None
    ref_dist = dist if dist is not None else 800
    ac_code, ac_raw = pick_aircraft(ref_dist, airline)
    cabin = pick_cabin(ref_dist)
    flight = {
        "flightDate": d.isoformat(),
        "daySeq": day_seq,
        "originCode": orig,
        "destinationCode": dest,
        "originLabel": AIRPORTS[orig][0] if orig in AIRPORTS else orig,
        "destinationLabel": AIRPORTS[dest][0] if dest in AIRPORTS else dest,
        "airlineCode": airline,
        "flightNumber": flight_number(airline, ref_dist),
        "aircraftTypeCode": ac_code,
        "aircraftTypeRaw": ac_raw,
        "registration": pick_reg(airline),
        "cabinClass": cabin,
        "seat": pick_seat(cabin, ac_code in WIDEBODY),
        "notes": random.choice(NOTES),
        "distanceKm": dist,
        "createdAt": epoch_noon(d),
        "updatedAt": epoch_noon(d),
    }
    return flight


# --- A few deliberately invalid-code flights ------------------------------------
INVALID = [
    {"date": date(2017, 6, 14), "orig": "FRA", "dest": "XQZ",
     "olabel": "Frankfurt am Main", "dlabel": "Mystery Field", "al": "LH"},
    {"date": date(2019, 3, 2), "orig": "ZZ9", "dest": "FRA",
     "olabel": "Nowhere International", "dlabel": "Frankfurt am Main", "al": "LH"},
    {"date": date(2022, 8, 21), "orig": "AB", "dest": "CD",
     "olabel": "Test Origin", "dlabel": "Test Destination", "al": "XX"},
    {"date": date(2023, 11, 9), "orig": "FRA", "dest": "FOO",
     "olabel": "Frankfurt am Main", "dlabel": "Foobar Airfield", "al": "LH"},
    {"date": date(2024, 5, 30), "orig": "BAR", "dest": "FRA",
     "olabel": "Barville Strip", "dlabel": "Frankfurt am Main", "al": "EW"},
]

def invalid_endpoint(code, label):
    """(code, label) for one endpoint of a deliberately-unmatched demo flight.

    A recognised code stores its canonical code + the reference name (so the
    valid half of the leg plots normally); an unrecognised one stores *no* code
    and the user's free text, which is how real un-reconciled data looks — it
    surfaces under the "Unmatched airports" filter and stays unplottable.
    """
    if code in AIRPORTS:
        return code, AIRPORTS[code][0]
    return None, label


# Nudge each invalid flight onto a free date so it stays a solitary single-leg
# day rather than merging into a real connection.
used_dates = {l["date"] for l in raw_legs}
invalid_legs = []
for inv in INVALID:
    d = inv["date"]
    while d in used_dates:
        d = d + timedelta(days=1)
    used_dates.add(d)
    invalid_legs.append({
        "date": d, "orig": inv["orig"], "dest": inv["dest"],
        "airline": inv["al"], "seq": seq, "olabel": inv["olabel"], "dlabel": inv["dlabel"],
    })
    seq += 1

all_legs = raw_legs + invalid_legs

# --- Assign day_seq per date (preserving same-day connection order) -------------
from collections import defaultdict
by_date = defaultdict(list)
for l in all_legs:
    by_date[l["date"]].append(l)

flights = []
for d in sorted(by_date):
    legs = sorted(by_date[d], key=lambda x: x["seq"])
    for i, l in enumerate(legs, start=1):
        if "olabel" in l:  # deliberately unmatched leg
            o_code, o_label = invalid_endpoint(l["orig"], l["olabel"])
            d_code, d_label = invalid_endpoint(l["dest"], l["dlabel"])
            ref = 1200
            ac_code, ac_raw = pick_aircraft(ref, l["airline"] if l["airline"] in REG_POOL else "LH")
            cabin = pick_cabin(ref)
            flights.append({
                "flightDate": d.isoformat(),
                "daySeq": i,
                "originCode": o_code,
                "destinationCode": d_code,
                "originLabel": o_label,
                "destinationLabel": d_label,
                "airlineCode": l["airline"],
                "flightNumber": flight_number(l["airline"], ref),
                "aircraftTypeCode": ac_code,
                "aircraftTypeRaw": ac_raw,
                "registration": pick_reg(l["airline"] if l["airline"] in REG_POOL else "LH"),
                "cabinClass": cabin,
                "seat": pick_seat(cabin, ac_code in WIDEBODY),
                "notes": "Imported with an unrecognised airport code",
                "distanceKm": None,
                "createdAt": epoch_noon(d),
                "updatedAt": epoch_noon(d),
            })
        else:
            flights.append(build_flight(l["orig"], l["dest"], l["airline"], d, i))

envelope = {
    "app": "flightjournal",
    "version": 1,
    "exportedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00"),
    "flights": flights,
}

OUT = args.out
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(envelope, f, ensure_ascii=False, indent=2)
    f.write("\n")

# --- Summary --------------------------------------------------------------------
from collections import Counter
year_counts = Counter(f["flightDate"][:4] for f in flights)
airline_counts = Counter(f["airlineCode"] for f in flights)
print(f"Wrote {len(flights)} flights to {OUT}")
print("By year: " + ", ".join(f"{y}:{year_counts[y]}" for y in sorted(year_counts)))
print("Top airlines: " + ", ".join(f"{a}:{c}" for a, c in airline_counts.most_common(12)))
print(f"Invalid-code flights: {sum(1 for f in flights if f['distanceKm'] is None)}")
multi = Counter(f['flightDate'] for f in flights)
print(f"Multi-leg days: {sum(1 for d, c in multi.items() if c > 1)}")
