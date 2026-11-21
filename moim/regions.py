"""지역 검색 결과를 시·군·구가 포함된 검색어로 정리한다."""

from __future__ import annotations

import json
import os
import re
from urllib import parse, request

# 도로명 주소에서는 법정동이 괄호 안에 오기도 한다.
_ADDRESS_REGION = re.compile(
    r"^([가-힣]+ (?:[가-힣]+[시군구])(?: [가-힣]+구)?)(?=\s|$)"
)
_AREA_SUFFIXES = ("동", "읍", "면", "리", "구", "시", "군")
_SHORT_NAME = re.compile(r"[가-힣]{2,}")
_PROVINCE_NAMES = {
    "서울": "서울특별시", "부산": "부산광역시", "대구": "대구광역시",
    "인천": "인천광역시", "광주": "광주광역시", "대전": "대전광역시",
    "울산": "울산광역시", "세종": "세종특별자치시",
    "경기": "경기도", "강원": "강원특별자치도", "충북": "충청북도",
    "충남": "충청남도", "전북": "전북특별자치도", "전남": "전라남도",
    "경북": "경상북도", "경남": "경상남도", "제주": "제주특별자치도",
}
_PROVINCE_ALIASES = {
    **_PROVINCE_NAMES,
    "강원도": "강원특별자치도", "전라북도": "전북특별자치도", "제주도": "제주특별자치도",
}
_PROVINCE_ALIASES.update({town + "시": _PROVINCE_NAMES[town]
                          for town in ("서울", "부산", "대구", "인천", "대전", "울산", "세종")})
for _name in _PROVINCE_NAMES.values():
    if _name.endswith("시"):
        _PROVINCE_ALIASES[_name.removesuffix("시")] = _name
_CITY_ALIASES = {"광주": ["광주광역시", "경기도 광주시"]}


def canonical_area(region: str) -> str:
    first, sep, rest = " ".join(region.split()).partition(" ")
    return _PROVINCE_ALIASES.get(first, first) + sep + rest


def address_area_prefix(address: str) -> str:
    prefix = _ADDRESS_REGION.match(" ".join(address.split()))
    return canonical_area(prefix[1]) if prefix else ""


def _short_neighborhood(region: str) -> bool:
    return bool(
        _SHORT_NAME.fullmatch(region)
        and not region.endswith((*_AREA_SUFFIXES, "역"))
        and region not in _PROVINCE_ALIASES
    )


def _address_matches(region: str, places: list[dict]) -> set[str]:
    suffix = r"(?:동|읍|면|리)" if _short_neighborhood(region) else ""
    local_token = re.compile(rf"(?<![가-힣])({re.escape(region)}{suffix})(?![가-힣])")
    matches = set()
    for place in places:
        address = " ".join((place.get("address") or "").split())
        prefix = _ADDRESS_REGION.match(address)
        local = local_token.search(address)
        if prefix and local:
            area = prefix[1]
            name = local[1]
            matches.add(canonical_area(area if name in area.split() else f"{area} {name}"))
    return matches


def _map_address_matches(region: str, key: str) -> set[str]:
    url = "https://dapi.kakao.com/v2/local/search/address.json?" + parse.urlencode(
        {"query": region, "analyze_type": "exact", "size": 15}
    )
    req = request.Request(url, headers={"Authorization": f"KakaoAK {key}"})
    try:
        with request.urlopen(req, timeout=3) as response:
            data = json.loads(response.read(128_000))
    except (OSError, ValueError):
        return set()
    matches = set()
    for item in data.get("documents", []):
        address = item.get("address") or {}
        neighborhood = address.get("region_3depth_name")
        first = address.get("region_1depth_name")
        second = address.get("region_2depth_name")
        local_name = region.rsplit(" ", 1)[-1]
        if first and second:
            if neighborhood == local_name:
                matches.add(canonical_area(f"{first} {second} {neighborhood}"))
            elif local_name == second.rsplit(" ", 1)[-1]:
                matches.add(canonical_area(f"{first} {second}"))
    return matches


def address_candidates(region: str, places: list[dict]) -> list[str]:
    if region in _CITY_ALIASES:
        return _CITY_ALIASES[region]
    if region in _PROVINCE_ALIASES or region in _PROVINCE_NAMES.values():
        return [canonical_area(region)]
    abbreviated = _short_neighborhood(region)
    if not abbreviated and not region.endswith(_AREA_SUFFIXES):
        return []
    matches = _address_matches(region, places) if " " not in region else set()
    key = os.getenv("KAKAO_REST_API_KEY", "").strip()
    if key:
        mapped = _map_address_matches(region + "동" if abbreviated else region, key)
        if " " in region:
            mapped = {area for area in mapped if matches_selected_area(region, area)}
        matches.update(mapped)
    return sorted(matches)[:8]


def search_terms(region: str) -> list[str]:
    """Search abbreviated and official address variants, then the neighborhood if qualified."""
    canonical = canonical_area(region)
    first, sep, tail = canonical.partition(" ")
    short = next((name for name, full in _PROVINCE_NAMES.items() if full == first), None)
    qualified = sep and tail.endswith(_AREA_SUFFIXES)
    terms = [region]
    if short and (qualified or not sep):
        terms.extend((short + sep + tail, canonical))
    if qualified:
        terms.append(tail.rsplit(" ", 1)[-1])
    return list(dict.fromkeys(terms))


def find_region_places(region: str, search) -> list[dict]:
    # Use the same lookup for a bare neighborhood name and its explicit -동 form when available.
    exact_dong = region + "동" if _short_neighborhood(region) else None
    for query in ([exact_dong] if exact_dong else []) + search_terms(region):
        places = [place for place in search(query)
                  if matches_selected_area(region, place.get("address") or "")]
        if places and (query != exact_dong or _address_matches(query, places)):
            return places
    return []


def matches_selected_area(region: str, address: str) -> bool:
    first, sep, tail = canonical_area(region).partition(" ")
    address_first, _, remainder = canonical_area(address).partition(" ")
    if not sep:
        return first not in _PROVINCE_NAMES.values() or region == "광주" or address_first == first
    if not tail.endswith(_AREA_SUFFIXES):
        return True
    return address_first == first and all(
        re.search(rf"(?<![가-힣]){re.escape(part)}(?![가-힣])", remainder)
        for part in tail.split()
    )
