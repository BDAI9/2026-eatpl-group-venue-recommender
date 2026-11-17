"""K-Skill 잇플 장소 검색, 응답 검증 및 로컬 샘플 데이터."""

from __future__ import annotations

import hashlib
import json
import os
import re
import socket
from pathlib import Path
from urllib import error, request
from urllib.parse import urlencode, urlsplit

KSKILL_URL = "https://k-skill-proxy.nomadamas.org/v1/bccard-eatpl/search"
SAMPLE_PATH = Path(__file__).resolve().parent / "data" / "sample_places.json"
MAX_BYTES = 2_000_000

CAFE_TYPES = {"카페"}
BAR_TYPES = {"기타주점", "호프", "이자카야", "바(bar)", "주점", "칵테일바"}
RESTAURANT_TYPES = {
    "일반한식", "서양음식", "중국음식", "일식회집", "갈비전문점", "한정식", "고기구이", "찜/탕/찌개", "치킨",
    "국수/면/만두", "해산물구이/찜", "김밥전문점", "분식", "기타외국식", "곱창전골/구이", "피자", "족발/보쌈",
    "버거", "스시/초밥", "떡볶이전문점", "도시락/죽", "일식돈가스", "뷔페", "마라탕", "이탈리아음식", "양꼬치",
    "아시안", "전/부침개", "일식라멘", "멕시칸", "프랑스음식", "비건/채식/사찰",
}
# 실데이터(2026-11-17, 홍대·성수·강남 등 1,300여 건)에서 자주 나왔는데 위 표에 없던 업종
CAFE_TYPES |= {"기타베이커리", "빵/도넛", "아이스크림/요거트/빙수", "브런치카페/샐러드"}
RESTAURANT_TYPES |= {"기타한식", "백반/한정식", "기타일식", "기타중식", "횟집", "샌드위치/토스트"}
# 모임 장소로 추천하지 않는 업종 (이름이 술집 같아도 제외)
EXCLUDED_TYPES = {"유흥주점", "클럽", "주류판매점", "무인식품점", "기타식품소매업"}
# 업종 표기가 틀린 가게가 있어(예: 커피 체인이 '고기구이') 이름에 분명한 단서가 있으면 이름을 따른다
_BAR_NAME = ("술집", "포차", "호프", "펍", "이자카야", "pub", "izakaya")
_CAFE_NAME = ("커피", "카페", "까페", "coffee", "cafe", "베이커리", "bakery")


class EatplError(Exception):
    """사용자에게 보여줘도 되는 한국어 메시지를 담는다."""


class _NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def category_of(business_type, name: str | None = None) -> str:
    if business_type in EXCLUDED_TYPES:
        return "unknown"
    low = (name or "").lower()
    if any(w in low for w in _BAR_NAME):
        return "bar"
    if any(w in low for w in _CAFE_NAME):
        return "cafe"
    if business_type in CAFE_TYPES:
        return "cafe"
    if business_type in BAR_TYPES:
        return "bar"
    if business_type in RESTAURANT_TYPES:
        return "restaurant"
    return "unknown"


def safe_detail_url(value) -> str | None:
    """잇플 상세 페이지 주소만 통과시킨다 (다른 사이트로 새는 링크 방지)."""
    if not isinstance(value, str) or any(ch.isspace() or ord(ch) < 32 for ch in value):
        return None
    try:
        u = urlsplit(value)
    except ValueError:
        return None
    if (u.scheme == "https" and u.netloc == "web.paybooc.ai" and re.fullmatch(r"/mer/web/profile/[^/?#]+", u.path)
            and not u.query and not u.fragment):
        return value
    return None


_CORP = re.compile(r"\(주\)|㈜|\(유\)|주식회사|유한회사")


def clean_name(name: str) -> str:
    """가맹점 등록명을 화면용 이름으로. 예: '주식회사 어썸레드' → '어썸레드', '산리오러버스클럽/(주)제이콥' → '산리오러버스클럽'."""
    first = name.split("/")[0]
    cleaned = " ".join(_CORP.sub(" ", first).split())
    return cleaned or " ".join(name.split())


def map_place(row, *, is_sample: bool = False) -> dict | None:
    """응답의 가게 한 건을 내부 형식으로. 이름이 없거나 식별할 수 없으면 None."""
    if not isinstance(row, dict):
        return None
    name, address = row.get("merNm"), row.get("merAddr")
    if not isinstance(name, str) or not name.strip():
        return None
    address = address.strip() if isinstance(address, str) and address.strip() else None
    url = safe_detail_url(row.get("merUrl"))
    if not url and not address:
        return None
    identity = url or json.dumps([name.strip(), address], ensure_ascii=False)
    btype = row.get("merTpbuzNm") if isinstance(row.get("merTpbuzNm"), str) else None
    rank = row.get("allSaleRnk")
    rank = rank if isinstance(rank, (int, float)) and not isinstance(rank, bool) else None
    return {
        "id": "eatpl:" + hashlib.sha256(identity.encode("utf-8")).hexdigest()[:20],
        "name": clean_name(name),
        "address": address,
        "business_type": btype,
        "category": category_of(btype, clean_name(name)),
        "eatpl_url": None if is_sample else url,
        "sales_rank": rank,
        "open": row.get("srtTime") if isinstance(row.get("srtTime"), str) else None,
        "close": row.get("endTime") if isinstance(row.get("endTime"), str) else None,
        "is_sample": is_sample,
    }


class KSkillClient:
    """Explicitly selected adapter to the third-party K-Skill proxy.

    It is not the BC Card direct API. Review provider terms and attribution
    requirements before public use.
    """

    source = "kskill"

    def __init__(self, timeout: float = 20.0):
        self.timeout = timeout

    def search(self, location: str, business_type: str | None = None) -> list[dict]:
        params = {"location": location}
        if business_type:
            params["merTpbuzNm"] = business_type
        req = request.Request(KSKILL_URL + "?" + urlencode(params),
                              headers={"Accept": "application/json"}, method="GET")
        try:
            with request.build_opener(_NoRedirect()).open(req, timeout=self.timeout) as resp:
                raw = resp.read(MAX_BYTES + 1)
        except error.HTTPError as exc:
            raise EatplError("장소 검색 서비스를 이용할 수 없어요. 잠시 후 다시 시도해 주세요.") from exc
        except (TimeoutError, socket.timeout) as exc:
            raise EatplError("장소 검색 응답이 너무 늦어요.") from exc
        except error.URLError as exc:
            raise EatplError("장소 검색 서비스에 연결하지 못했어요.") from exc
        if len(raw) > MAX_BYTES:
            raise EatplError("장소 검색 응답이 너무 커요.")
        try:
            body = json.loads(raw)
        except (ValueError, UnicodeDecodeError) as exc:
            raise EatplError("장소 검색 응답을 읽지 못했어요.") from exc
        if not isinstance(body, dict) or not isinstance(body.get("items"), list):
            raise EatplError("장소 검색 응답을 확인하지 못했어요.")
        upstream = body.get("upstream")
        if (not isinstance(upstream, dict) or upstream.get("status_code") != 200
                or upstream.get("provider") not in ("bccard-eatpl", "bccard-eatpl-relay")):
            raise EatplError("잇플에서 받은 장소 정보인지 확인하지 못했어요.")
        # Do not return entries without a valid upstream detail URL; never
        # construct a merchant link from untrusted response content.
        places = (map_place(row) for row in body["items"])
        return [place for place in places if place and place["eatpl_url"]]


class SampleClient:
    """로컬 개발용 가상 데이터. 지역 이름이 주소에 들어간 가게만 돌려준다."""

    source = "sample"

    def __init__(self, path: Path = SAMPLE_PATH):
        self.rows = json.loads(path.read_text(encoding="utf-8"))["data"]

    def search(self, location: str, business_type: str | None = None) -> list[dict]:
        out = []
        for row in self.rows:
            if location not in (row.get("merAddr") or "") and location not in row.get("merNm", ""):
                continue
            if business_type and row.get("merTpbuzNm") != business_type:
                continue
            place = map_place(row, is_sample=True)
            if place:
                out.append(place)
        return out


def make_client(store):
    # store remains in the signature for callers that share the app factory.
    source = os.getenv("EATPL_SOURCE", "sample").strip().lower() or "sample"
    if source == "kskill":
        return KSkillClient()
    if source in ("sample", "auto"):  # old local .env files used auto
        return SampleClient()
    raise ValueError("지원하지 않는 장소 데이터 원천이에요. kskill 또는 sample을 사용해 주세요.")


def search_places(client, region: str, place_type: str) -> list[dict]:
    """지역과 장소 종류로 후보를 모은다.

    실제 술집 검색은 제공처의 대분류 둘로 조회하고 응답 소분류로 다시 거른다.
    업종 체계가 일치하지 않거나 응답 건수에 제한이 있어 완전한 목록은 아니다.
    """
    seen, out = set(), []
    if place_type == "cafe":
        calls = [("카페",)]
    elif place_type == "bar" and client.source == "kskill":
        calls = [("주점",), ("칵테일바",)]
    else:
        calls = [(None,)]
    for (btype,) in calls:
        for p in client.search(region, btype):
            if p["category"] == place_type and p["id"] not in seen:
                seen.add(p["id"])
                out.append(p)
    return out
