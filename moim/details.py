"""Read the menu and short evidence already present in the Eat.pl profile HTML."""

from __future__ import annotations

import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from html.parser import HTMLParser
from urllib import request

from .eatpl import _NoRedirect, safe_detail_url
from .options import CAFE_WORK_ATMOSPHERE, DATE_ATMOSPHERE, GROUP_SEATING, OUTDOOR_SEATING, PRIVATE_ROOM

_MAX_HTML = 768_000
_POOL = ThreadPoolExecutor(max_workers=4, thread_name_prefix="eatpl-profile")
_LOCK = threading.Lock()
_CACHE = {}
_VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
_SECTIONS = {"ple-menu-wrap": "menu", "ai-ple-info": "review", "service-wrap": "service"}
_CAKE = re.compile(r"케이크|케익|갸또|갸토|(?<![a-z])(?:cheesecake|cake)(?![a-z])", re.I)
_NOT_CAKE = re.compile(r"팬\s*케이크|pancake|핫케이크|오트케이크|오코노미야키", re.I)
_DRINK = re.compile(r"아메리카노|카페\s*라[떼테]|에스프레소|콜드\s*브루|americano|caff[eè] latte", re.I)


class _ProfileParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.stack = []
        self.menu = []
        self.review = []
        self.services = []
        self.item = None

    def handle_starttag(self, tag, attrs):
        if tag in _VOID:
            return
        attrs = dict(attrs)
        classes = set((attrs.get("class") or "").split())
        section = self.stack[-1][1] if self.stack else None
        section = next((_SECTIONS[c] for c in _SECTIONS if c in classes), section)
        field = None
        if section == "menu":
            if tag == "div" and "item" in classes:
                self.item = {}
                field = "item"
            elif tag in ("p", "span") and self.item is not None:
                field = next((c for c in ("name", "price") if c in classes), None)
        elif section == "review" and tag == "li":
            field = "review"
        elif section == "service" and tag == "li":
            field = "service"
        self.stack.append([tag, section, field, []])

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                break
        else:
            return
        frame = self.stack[i]
        del self.stack[i:]
        field = frame[2]
        value = " ".join("".join(frame[3]).split())[:200]
        if field == "item":
            if self.item and self.item.get("name"):
                self.menu.append(self.item)
            self.item = None
        elif field in ("name", "price") and self.item is not None:
            self.item[field] = value
        elif value and field == "review":
            self.review.append(value)
        elif value and field == "service":
            self.services.append(value)

    def handle_data(self, data):
        if self.stack and self.stack[-1][0] in ("script", "style"):
            return
        for frame in self.stack:
            if frame[2] and frame[2] != "item":
                frame[3].append(data)


def parse_profile(html: str) -> dict:
    parser = _ProfileParser()
    parser.feed(html)
    return {"menu": parser.menu[:25], "review": parser.review[:8], "services": parser.services[:12]}


def _fetch(url: str) -> dict:
    url = safe_detail_url(url)
    if not url:
        return {}
    try:
        req = request.Request(url, headers={"Accept": "text/html", "User-Agent": "Mozilla/5.0 (compatible; Moim/1.0)"})
        with request.build_opener(_NoRedirect()).open(req, timeout=4) as response:
            if response.headers.get_content_type() != "text/html":
                return {}
            raw = response.read(_MAX_HTML + 1)
            encoding = response.headers.get_content_charset() or "utf-8"
        if len(raw) <= _MAX_HTML:
            return parse_profile(raw.decode(encoding, errors="replace"))
    except (OSError, LookupError, ValueError):
        pass
    return {}


def enabled() -> bool:
    return os.getenv("EATPL_DETAIL_ENABLED", "").strip() == "1"


def profiles(places: list[dict], *, background: bool) -> tuple[dict, bool]:
    """Reuse per-profile requests across rooms and polls. Failed requests get a short TTL."""
    futures = {}
    with _LOCK:
        now = time.monotonic()
        for cached_url, (future, started) in list(_CACHE.items()):
            if future.done() and now - started > (1800 if future.result() else 60):
                del _CACHE[cached_url]
        for place in places:
            url = safe_detail_url(place.get("eatpl_url"))
            if not url:
                continue
            if url not in _CACHE:
                if len(_CACHE) >= 256:
                    oldest = next((key for key, (f, _) in _CACHE.items() if f.done()), None)
                    if oldest is None:
                        continue
                    del _CACHE[oldest]
                _CACHE[url] = (_POOL.submit(_fetch, url), now)
            futures[place["id"]] = _CACHE[url][0]
    ready = {pid: future for pid, future in futures.items() if not background or future.done()}
    return {pid: future.result() for pid, future in ready.items()}, len(ready) != len(futures)


def cake_items(detail: dict) -> list[str]:
    return [row["name"] for row in detail.get("menu", [])
            if _CAKE.search(row["name"]) and supports_cake_inference(row["name"])]


def _price(value: str) -> int | None:
    if not re.fullmatch(r"\s*(?:\d{1,3}(?:,\d{3})+|\d+)\s*원\s*", value):
        return None
    amount = int(re.sub(r"[^0-9]", "", value))
    return amount if 0 < amount <= 1_000_000 else None


def cafe_price(detail: dict, cakes: list[str]) -> dict | None:
    rows = [(row["name"], _price(row.get("price", ""))) for row in detail.get("menu", [])]
    drinks = [(name, price) for name, price in rows if price and _DRINK.search(name)]
    desserts = [(name, price) for name, price in rows if price and name in cakes]
    if drinks and desserts:
        drink = min(drinks, key=lambda row: row[1])
        dessert = min(desserts, key=lambda row: row[1])
        total = drink[1] + dessert[1]
        band = next((i for i, limit in enumerate((10_000, 20_000, 30_000, 50_000), 1) if total <= limit), 5)
        return {"band": band, "amount": total, "items": [drink[0], dessert[0]]}
    return None


_GROUP_SEAT = r"단체\s*(?:좌석|석|테이블)"
_TERRACE = r"야외\s*(?:좌석|테이블|석)|테라스(?:\s*(?:좌석|테이블|석))?"
_ROOM = r"개별\s*룸|독립\s*룸|프라이빗(?:한)?\s*룸|별실|(?<![가-힣])룸(?=$|\s|[은는이가을를에도])"
_AVAILABLE = r"(?:이용\s*가능|예약\s*가능|운영\s*중|마련|갖춰|있[고는어다음습으며]|있$|제공)"
_UNAVAILABLE = r"없[는다어음습고으며]|불가|미제공|(?:사용|이용|운영|예약)\s*(?:중단|종료|안\s*(?:함|됨|돼)|하지\s*않)|사용할 수 없"
_FACILITY_PATTERNS = {
    GROUP_SEATING: (_GROUP_SEAT, rf"(?:{_GROUP_SEAT}).{{0,12}}{_AVAILABLE}|"
                                 r"(?:\d{1,2}\s*(?:명|인)(?:이|도|까지)?|여러 명이).{0,16}"
                                 r"(?:한\s*테이블|같이 앉|함께 앉|같은 테이블)"),
    OUTDOOR_SEATING: (_TERRACE, rf"(?:{_TERRACE}).{{0,12}}{_AVAILABLE}|"
                               rf"(?:{_TERRACE})(?:에|에서).{{0,16}}(?:앉[아았을]|식사[했하]|먹었|즐겼)"),
    PRIVATE_ROOM: (_ROOM, rf"(?:{_ROOM}).{{0,12}}{_AVAILABLE}|"
                          rf"(?:{_ROOM})(?:에|에서).{{0,12}}(?:식사[했하]|먹었|이용했)"),
}
_FACILITY_HINTS = {
    GROUP_SEATING: r"단체\s*(?:이용|손님|인원)(?:도|을|은|이)?\s*(?:수용\s*)?(?:가능|받을 수)",
    OUTDOOR_SEATING: r"테라스(?:는|에선|에서는).{0,32}(?:저녁 공기|바람).{0,18}(?:즐길 수|만끽)",
}
_REVIEW_PATTERNS = {
    "조용한": (r"조용(?:한|하[고며니]|해|하다|합니)|한적(?:한|하|해)|"
             r"(?:분위기|공간|매장|실내).{0,10}(?:차분|고즈넉)", r"조용하지\s*않|(?:너무|매우)\s*시끄|소음이\s*심"),
    "대화하기 좋은": (
        r"(?<![가-힣])대화(?:를|나|와|\s|하기).{0,16}(?:좋|적합|편했|편하|편한|편안)|"
        r"(?:이야기|얘기)를?\s*(?:나누기|하기).{0,7}(?:좋|편|적합)|"
        r"편(?:하게|안하게)\s*(?:대화|이야기)(?:를)?\s*(?:할 수|나누|하며)",
        r"(?:대화|이야기).{0,14}(?:어렵|힘들|불편|좋지\s*않)|시끄러워"),
    "가성비": (
        r"가성비.{0,13}(?:좋|뛰어|훌륭|괜찮|만족|최고|높)|"
        r"가격\s*(?:대비|에\s*비해).{0,18}(?:만족|푸짐|(?:양|품질|구성|맛).{0,8}(?:좋|많|뛰어))|"
        r"이\s*가격에.{0,13}(?:구성|맛|양|품질).{0,8}(?:좋|훌륭|만족|푸짐)",
        r"가성비.{0,12}(?:나쁘|떨어|별로|좋지\s*않)|가격\s*대비.{0,12}(?:아쉽|실망|부족)"),
    DATE_ATMOSPHERE: (
        r"(?:빈티지|레트로|앤틱|앤티크|비비드|미니멀|우드\s*톤|한옥|일본풍).{0,15}"
        r"(?:인테리어|가구|소품|포스터|디자인|공간|외관|분위기|개조)|"
        r"(?:인테리어|가구|소품|실내).{0,15}(?:빈티지|레트로|앤틱|앤티크|비비드|미니멀|감각적|세련)|"
        r"(?:독특|특색|감각적|세련).{0,8}(?:인테리어|실내 디자인)|앤틱과 모던",
        r"인테리어.{0,10}(?:별로|아쉽|실망)"),
    "아늑·편안": (
        r"(?:아늑|포근|안락|편안).{0,10}(?:분위기|공간|매장|실내|느낌)|"
        r"(?:분위기|공간|매장|실내).{0,12}(?:아늑|포근|안락|편안)|"
        r"편안하게\s*(?:머물|쉬|휴식|앉아|시간을 보내)",
        r"(?:아늑|포근|안락|편안)(?:하지|해 보이)\s*않|분위기.{0,10}불편"),
    CAFE_WORK_ATMOSPHERE: (
        r"(?:콘센트.{0,14}(?:많|자리마다|좌석마다|충분)|(?:자리마다|좌석마다|각 자리마다).{0,12}콘센트)|"
        r"(?:노트북|작업|공부).{0,17}(?:전용\s*(?:좌석|공간)|(?:테이블|책상|좌석).{0,10}(?:편|넓|좋|마련))|"
        r"(?:좌석|테이블|책상).{0,14}(?:넓|편).{0,15}(?:작업|공부|노트북)|"
        r"(?:조용|한적).{0,24}(?:공부|작업|집중).{0,11}(?:좋|적합|편|가능|높)",
        r"(?:노트북|작업|공부).{0,12}(?:제한|금지|불가|어렵)|콘센트.{0,9}없"),
}


def _clauses(text: str) -> list[str]:
    return re.split(r"[.!?;,·]+\s*|지만\s*|으나\s*", text)


def _facility_matches(detail: dict, label: str, subject: str, positive: str, party_size: int) -> dict | None:
    for source in ("services", "review"):
        positive_quote = None
        hint_quote = None
        restricted = False
        for quote in detail.get(source, []):
            for clause in _clauses(quote):
                if label in (GROUP_SEATING, PRIVATE_ROOM) and re.search(positive, clause):
                    minimum = re.search(r"(\d{1,2})\s*(?:명|인)\s*(?:이상|부터)", clause)
                    maximum = re.search(r"(?:최대\s*(\d{1,2})\s*(?:명|인)|(\d{1,2})\s*(?:명|인)\s*까지)", clause)
                    if ((minimum and party_size < int(minimum[1]))
                            or (maximum and party_size > int(maximum[1] or maximum[2]))):
                        restricted = True
                        continue
                if re.search(subject, clause) and re.search(_UNAVAILABLE, clause):
                    return None
                if re.search(positive, clause) or (source == "services" and re.fullmatch(subject, clause.strip())):
                    positive_quote = positive_quote or quote
                elif source == "review" and label in _FACILITY_HINTS and re.search(_FACILITY_HINTS[label], clause):
                    hint_quote = hint_quote or quote
        if positive_quote:
            return {"source": source, "text": positive_quote}
        if source == "services" and restricted:
            return None
        if hint_quote and not restricted:
            return {"source": source, "text": hint_quote, "hint": True}
    return None


def atmosphere_evidence(detail: dict, party_size: int = 1, *, place_type: str | None = None) -> dict:
    """Return one source quotation per supported preference."""
    evidence = {}
    for label, (subject, positive) in _FACILITY_PATTERNS.items():
        match = _facility_matches(detail, label, subject, positive, party_size)
        if match:
            evidence[label] = match
    for label, (positive, negative) in _REVIEW_PATTERNS.items():
        if label == CAFE_WORK_ATMOSPHERE and place_type not in (None, "cafe"):
            continue
        for quote in detail.get("review", []):
            if any(re.search(positive, part) and not re.search(negative, part) for part in _clauses(quote)):
                evidence[label] = {"source": "review", "text": quote}
                break
    return evidence


def supports_cake_inference(name: str) -> bool:
    return (
        bool(_CAKE.search(name) or re.search(r"티라미수|무스|쉬폰|시폰|파운드|테린느|롤\s*조각", name))
        and not _NOT_CAKE.search(name)
        and not re.search(r"라떼|라테|음료|프라페|스무디|쉐이크|시럽", name)
    )


def dessert_items(detail: dict) -> list[str]:
    return [row["name"] for row in detail.get("menu", [])
            if re.search(r"디저트|마카롱|와플|타르트|쿠키|푸딩|휘낭시에|휘낭시|카눌레|마들렌|스콘|브라우니", row["name"])
            and not re.search(r"빙수|아이스크림|젤라또|라떼|라테|스무디|프라페|쉐이크", row["name"])]
