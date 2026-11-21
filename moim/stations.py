"""Resolve metro stations and compare their locations against Eat.pl TM128 coordinates."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from functools import lru_cache
import json
import math
import re
from urllib import parse, request

from .eatpl import _NoRedirect
from .regions import address_area_prefix, canonical_area

STATION_RADIUS_M = 500
_KAKAO_PROXY = "https://k-skill-proxy.nomadamas.org/v1/kakao-map"
_STATION_NAME = re.compile(r"^(.+?역)(?=\s|$)")
_NEAR = re.compile(r"\s*(?:근처|주변|인근)$")
_HUB_DISTANCE = 350
_STATION_SPELLINGS = {"황흥창": "광흥창"}


class StationLookupError(Exception):
    """A station search is unavailable or needs a more specific input."""


@dataclass(frozen=True)
class Station:
    label: str
    longitude: float
    latitude: float
    area: str
    address_queries: tuple[str, ...]


def station_input(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    base = _NEAR.sub("", " ".join(value.split()))
    station, _, _ = base.partition(" · ")
    return base if station.endswith("역") and len(station) > 1 else None


def station_search_variant(value: str, *, correct_spelling: bool = False) -> str | None:
    """Build an exact station query for an unverified, suffix-free place name."""
    base = _NEAR.sub("", value)
    prefix, separator, name = base.rpartition(" ")
    if not re.fullmatch(r"[가-힣0-9·]{2,}", name):
        return None
    if correct_spelling:
        fixed = _STATION_SPELLINGS.get(name.removesuffix("역"))
        return f"{prefix}{separator}{fixed}역" if fixed else None
    if name.endswith(("역", "동", "읍", "면", "구", "시", "군")):
        return None
    return f"{base}역"


def _kakao(route: str, **params) -> list[dict]:
    url = f"{_KAKAO_PROXY}/{route}?" + parse.urlencode(params)
    try:
        req = request.Request(url, headers={"Accept": "application/json"})
        with request.build_opener(_NoRedirect()).open(req, timeout=6) as response:
            data = json.loads(response.read(256_000))
        docs = data.get("documents") if isinstance(data, dict) else None
        if isinstance(docs, list):
            return [row for row in docs if isinstance(row, dict)]
    except (OSError, ValueError):
        pass
    raise StationLookupError("지하철역 위치를 확인하는 서비스 응답이 늦어요. 잠시 후 다시 시도해 주세요.")


def _station_key(name: str) -> str:
    return re.sub(r"[·.\s]", "", name)


def _distance(a: tuple[float, float], b: tuple[float, float]) -> float:
    lon1, lat1 = a
    lon2, lat2 = b
    east = (lon2 - lon1) * 111_320 * math.cos(math.radians((lat1 + lat2) / 2))
    north = (lat2 - lat1) * 111_320
    return math.hypot(east, north)


@lru_cache(maxsize=256)
def _station_rows(name: str, query: str = "") -> tuple[Station, ...]:
    docs = _kakao("search/keyword", q=query or name, category_group_code="SW8", size=15)
    groups = {}
    for row in docs:
        title = row.get("place_name") or ""
        match = _STATION_NAME.match(title)
        if not match or _station_key(match[1]) != _station_key(name):
            continue
        suffix = title[match.end():].strip()
        if "출구" in suffix or "출입구" in suffix:
            continue
        address = row.get("address_name") or ""
        area = address_area_prefix(address)
        if not area:
            continue
        try:
            lon, lat = float(row["x"]), float(row["y"])
        except (KeyError, TypeError, ValueError):
            continue
        if not (124 < lon < 132 and 32 < lat < 44):
            continue
        group = groups.setdefault(area, [])
        point = (lon, lat)
        for hub in group:
            if _distance(hub[0][0], point) <= _HUB_DISTANCE:
                hub.append((point, address))
                break
        else:
            group.append([(point, address)])

    stations = []
    for area, hubs in groups.items():
        for index, hub in enumerate(hubs, 1):
            lon = sum(point[0] for point, _ in hub) / len(hub)
            lat = sum(point[1] for point, _ in hub) / len(hub)
            addresses = tuple(dict.fromkeys(_strip_lot_number(addr) for _, addr in hub))
            label = f"{area} {name}"
            if len(hubs) > 1:
                # Distinct stations in the same district need distinguishable choices as well.
                neighborhood = addresses[0].split()[-1] if addresses else str(index)
                label = f"{label} · {neighborhood}"
                if any(s.label == label for s in stations):
                    label = f"{label} {index}"
            stations.append(Station(label, lon, lat, area, addresses))
    return tuple(sorted(stations, key=lambda s: s.label))


def _strip_lot_number(address: str) -> str:
    return re.sub(r"\s+(?:산\s*)?\d+(?:-\d+)?\s*$", "", address.strip())


def find_stations(value: str) -> tuple[Station, ...]:
    base, _, disambiguator = value.partition(" · ")
    prefix, _, name = base.rpartition(" ")
    if not name:
        name, prefix = base, ""
    name = name.replace(".", "·")
    options = _station_rows(name)
    if not prefix:
        return options
    canonical = canonical_area(prefix)
    def in_area(station: Station) -> bool:
        return (
            (station.area == canonical or station.area.startswith(canonical + " "))
            and (not disambiguator or station.label.endswith(" · " + disambiguator))
        )

    matches = tuple(s for s in options if in_area(s))
    if not matches:
        matches = tuple(s for s in _station_rows(name, f"{canonical} {name}") if in_area(s))
    return matches


def require_station(value: str) -> Station:
    options = find_stations(value)
    name = value.partition(" · ")[0]
    if not options:
        raise StationLookupError(f"'{name}' 위치를 확인하지 못했어요. 시·군·구와 역 이름을 입력해 주세요.")
    if len(options) != 1:
        raise StationLookupError("같은 이름의 역이 여러 곳이에요. 첫 화면에서 정확한 역을 선택해 주세요.")
    return options[0]


@lru_cache(maxsize=128)
def candidate_areas(station: Station) -> tuple[str, ...]:
    """Use legal neighborhoods around the center to avoid relying on station-name text."""
    lon, lat = station.longitude, station.latitude
    step_lat = 0.005
    step_lon = step_lat / math.cos(math.radians(lat))
    points = [(lon, lat), (lon + step_lon, lat), (lon - step_lon, lat),
              (lon, lat + step_lat), (lon, lat - step_lat)]

    def neighborhood(point):
        try:
            docs = _kakao("coord2region", x=point[0], y=point[1], input_coord="WGS84")
        except StationLookupError:
            return ""
        for doc in docs:
            if doc.get("region_type") == "B" and doc.get("address_name"):
                return doc["address_name"]
        return ""

    with ThreadPoolExecutor(max_workers=len(points)) as pool:
        nearby = list(pool.map(neighborhood, points))
    return tuple(dict.fromkeys(filter(None, (
        *station.address_queries, *(_short_area(area) for area in nearby), _short_area(station.area)
    ))))


def _short_area(area: str) -> str:
    # Eat.pl supports both spellings, but the commonly used abbreviations cover more records.
    short, _, tail = area.partition(" ")
    for suffix in ("특별자치시", "특별시", "광역시"):
        if short.endswith(suffix):
            return short.removesuffix(suffix) + (" " + tail if tail else "")
    return area


def tm128(longitude: float, latitude: float) -> tuple[float, float]:
    """WGS84 degrees to the Bessel KATEC/TM128 projection used by Eat.pl, in meters."""
    lon, lat = math.radians(longitude), math.radians(latitude)
    wgs_a, wgs_e2 = 6378137.0, 0.0066943799901413165
    n = wgs_a / math.sqrt(1 - wgs_e2 * math.sin(lat) ** 2)
    # WGS84 Cartesian to local Bessel datum, reversing the KATEC translation.
    x = n * math.cos(lat) * math.cos(lon) + 146.43
    y = n * math.cos(lat) * math.sin(lon) - 507.89
    z = n * (1 - wgs_e2) * math.sin(lat) - 681.46
    bessel_a = 6377397.155
    f = 1 / 299.1528128
    e2 = f * (2 - f)
    lon = math.atan2(y, x)
    planar = math.hypot(x, y)
    lat = math.atan2(z, planar * (1 - e2))
    for _ in range(5):
        n = bessel_a / math.sqrt(1 - e2 * math.sin(lat) ** 2)
        lat = math.atan2(z + e2 * n * math.sin(lat), planar)

    def meridian(p):
        return bessel_a * (
            (1 - e2 / 4 - 3 * e2**2 / 64 - 5 * e2**3 / 256) * p
            - (3 * e2 / 8 + 3 * e2**2 / 32 + 45 * e2**3 / 1024) * math.sin(2 * p)
            + (15 * e2**2 / 256 + 45 * e2**3 / 1024) * math.sin(4 * p)
            - 35 * e2**3 / 3072 * math.sin(6 * p)
        )

    sin_lat, cos_lat, tan_lat = math.sin(lat), math.cos(lat), math.tan(lat)
    n = bessel_a / math.sqrt(1 - e2 * sin_lat**2)
    ep2 = e2 / (1 - e2)
    t, c = tan_lat**2, ep2 * cos_lat**2
    a = (lon - math.radians(128)) * cos_lat
    east = n * (a + (1 - t + c) * a**3 / 6 + (5 - 18*t + t*t + 72*c - 58*ep2) * a**5 / 120)
    north = meridian(lat) - meridian(math.radians(38)) + n * tan_lat * (
        a**2 / 2 + (5 - t + 9*c + 4*c*c) * a**4 / 24
        + (61 - 58*t + t*t + 600*c - 330*ep2) * a**6 / 720
    )
    return 400000 + 0.9999 * east, 600000 + 0.9999 * north
