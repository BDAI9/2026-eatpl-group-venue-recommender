"""Small read-only live smoke checks for the external K-Skill proxy.

Run only in CI validation. Does not create rooms or use secret keys.
"""
from moim.eatpl import KSkillClient
from moim.stations import find_stations

def main():
    places = KSkillClient(timeout=18).search("서울 마포구 서교동")
    if not places:
        raise AssertionError("K-Skill Eat.pl returned no validated merchants for known area")
    if not all(p["eatpl_url"] and p["id"].startswith("eatpl:") for p in places):
        raise AssertionError("K-Skill returned an unvalidated merchant URL")
    print(f"OK K-Skill Eat.pl search: {len(places)} validated merchants")
    stations = find_stations("서울 시청역")
    if not any("서울특별시" in station.label and "시청역" in station.label for station in stations):
        raise AssertionError("K-Skill Kakao-map proxy returned no Seoul City Hall metro station")
    print(f"OK K-Skill Kakao station lookup: {len(stations)} verified choices")

if __name__ == "__main__":
    main()
