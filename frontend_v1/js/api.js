/**
 * =========================================================================
 * js/api.js — 데이터 레이어 & 백엔드 API 연동 어댑터
 * =========================================================================
 * [백엔드 이어붙이기 가이드]
 * 1. 현재는 API_CONFIG.USE_MOCK_API = true 설정으로 내장 샘플 데이터를 반환합니다.
 * 2. 백엔드 서버가 완성되면 아래 3개 함수의 fetch() 주석을 해제하여 연결하면 됩니다:
 *    - fetchRecommendations(params)        -> POST /v1/recommendations (eat.pl 가맹점 검색 연동)
 *    - fetchNearbyCrossCategory(params)    -> GET  /v1/nearby (반경 100m->200m->500m 교차 추천)
 *    - createPollSession / submitPollVote / fetchPollStatus -> 다같이 실시간 투표 DB API
 */

import { API_CONFIG } from './config.js';

/**
 * 매출 랭킹 백분위 포맷팅 (1% 미만 구간은 소수점 둘째 자리까지 표기하여 '0.0%' 방지)
 */
export function formatPercentile(pct) {
  if (pct < 1) {
    return `상위 ${pct.toFixed(2)}%`;
  }
  return `상위 ${pct.toFixed(1)}%`;
}

/**
 * 내장 eat.pl 가맹점 샘플 데이터셋 (Mock)
 */
const BASE_VENUES = {
  '밥': [
    {
      id: 'r1',
      nameSuffix: '청계옥 본점',
      subCategory: '한식',
      signature: '한우 수육 전골 · 솥밥 반상',
      percentile: 0.04,
      crowdStatus: '여유 · 바로 입장',
      priceRange: '1.6만원대',
      distanceM: 95,
      tags: ['매출 랭킹 1위', '동네맛집', '회식', '가족 외식'],
      soloFriendly: true,
      veganFriendly: false,
      is24h: false,
      foreignerPopular: true,
      eatplReason: '최근 3개월 3040 직장인 재방문율 및 점심·저녁 카드 결제 건수 1위 한식당',
    },
    {
      id: 'r2',
      nameSuffix: '스시하루카 오마카세 & 덮밥',
      subCategory: '일식',
      signature: '특선 카이센동 · 사케동 정식',
      percentile: 0.18,
      crowdStatus: '보통 · 대기 10분',
      priceRange: '1.9만원대',
      distanceM: 140,
      tags: ['동네맛집', '외국인과 함께'],
      soloFriendly: true,
      veganFriendly: false,
      is24h: false,
      foreignerPopular: true,
      eatplReason: '혼밥 바 좌석 비중 65% · 2030 단골 결제 비율이 압도적으로 높은 일식 전문점',
    },
    {
      id: 'r3',
      nameSuffix: '명가 24시 해장국·설렁탕',
      subCategory: '한식',
      signature: '특 양선지 해장국 · 도가니탕',
      percentile: 0.32,
      crowdStatus: '여유 · 좌석 충분',
      priceRange: '1.2만원대',
      distanceM: 180,
      tags: ['24시간 운영', '동네맛집', '가족 외식'],
      soloFriendly: true,
      veganFriendly: false,
      is24h: true,
      foreignerPopular: false,
      eatplReason: '심야·새벽 시간대 BC카드 결제 1위 · 현지 로컬 단골 비중 84%',
    },
    {
      id: 'r4',
      nameSuffix: '트라토리아 비안코',
      subCategory: '양식',
      signature: '트러플 크림 뇨끼 · 채끝 스테이크',
      percentile: 0.45,
      crowdStatus: '보통 · 예약 권장',
      priceRange: '2.8만원대',
      distanceM: 210,
      tags: ['외국인과 함께', '가족 외식'],
      soloFriendly: false,
      veganFriendly: true,
      is24h: false,
      foreignerPopular: true,
      eatplReason: '커플·소규모 모임 저녁 결제 객단가 상위권 이탈리안 키친',
    },
    {
      id: 'r5',
      nameSuffix: '금룡성 딤섬 & 우육면관',
      subCategory: '중식',
      signature: '소룡포 · 어향가지 · 동파육',
      percentile: 0.61,
      crowdStatus: '여유 · 바로 입장',
      priceRange: '1.5만원대',
      distanceM: 120,
      tags: ['동네맛집', '회식', '가족 외식', '외국인과 함께'],
      soloFriendly: true,
      veganFriendly: true,
      is24h: false,
      foreignerPopular: true,
      eatplReason: '단체 룸 완비 및 점심·저녁 회전율이 빠른 정통 중식 요리 전문점',
    },
    {
      id: 'r6',
      nameSuffix: '사이공 포 & 분짜 하우스',
      subCategory: '아시안',
      signature: '직화 분짜 · 양지 쌀국수',
      percentile: 0.78,
      crowdStatus: '여유 · 바로 입장',
      priceRange: '1.3만원대',
      distanceM: 165,
      tags: ['동네맛집', '외국인과 함께'],
      soloFriendly: true,
      veganFriendly: true,
      is24h: false,
      foreignerPopular: true,
      eatplReason: '점심 피크타임 1인 결제 건수 최상위 · 비건 채소 쌀국수 주문 가능',
    },
    {
      id: 'r7',
      nameSuffix: '산채비빔밥 & 사찰음식 소담',
      subCategory: '한식',
      signature: '제철 나물 솥밥 · 들깨 버섯전골',
      percentile: 0.89,
      crowdStatus: '여유 · 좌석 충분',
      priceRange: '1.4만원대',
      distanceM: 240,
      tags: ['동네맛집', '가족 외식', '외국인과 함께'],
      soloFriendly: true,
      veganFriendly: true,
      is24h: false,
      foreignerPopular: true,
      eatplReason: '채식·비건 선호 고객 및 외국인 관광객 재방문율이 높은 건강한 한식 반상',
    },
    {
      id: 'r8',
      nameSuffix: '화목순대국 & 수육 24시',
      subCategory: '한식',
      signature: '얼큰 순대국 · 모듬 수육 전골',
      percentile: 1.15,
      crowdStatus: '보통 · 대기 5분',
      priceRange: '1.1만원대',
      distanceM: 85,
      tags: ['24시간 운영', '동네맛집', '회식'],
      soloFriendly: true,
      veganFriendly: false,
      is24h: true,
      foreignerPopular: false,
      eatplReason: '10년 이상 꾸준한 지역 주민 결제 데이터를 보유한 검증된 노포 국밥집',
    },
    {
      id: 'r9',
      nameSuffix: '멘야 쿠로 라멘 & 마제소바',
      subCategory: '일식',
      signature: '돈코츠 차슈라멘 · 나고야 마제소바',
      percentile: 1.42,
      crowdStatus: '보통 · 대기 10분',
      priceRange: '1.2만원대',
      distanceM: 190,
      tags: ['동네맛집'],
      soloFriendly: true,
      veganFriendly: false,
      is24h: false,
      foreignerPopular: true,
      eatplReason: '1인 키오스크 결제 비율 72%로 혼밥 만족도가 매우 높은 자가제면 라멘집',
    },
    {
      id: 'r10',
      nameSuffix: '방콕 야시장 팟타이 & 똠얌',
      subCategory: '아시안',
      signature: '왕새우 팟타이 · 풋팟퐁커리',
      percentile: 1.85,
      crowdStatus: '여유 · 바로 입장',
      priceRange: '1.6만원대',
      distanceM: 270,
      tags: ['외국인과 함께', '회식'],
      soloFriendly: true,
      veganFriendly: true,
      is24h: false,
      foreignerPopular: true,
      eatplReason: '직장인 저녁 모임 및 다국적 방문객 결제 비중이 높은 타이 다이닝',
    },
    {
      id: 'r11',
      nameSuffix: '더그릴 브라세리 & 버거',
      subCategory: '양식',
      signature: '드라이에이징 치즈버거 · 파스타',
      percentile: 2.10,
      crowdStatus: '여유 · 좌석 충분',
      priceRange: '1.8만원대',
      distanceM: 310,
      tags: ['외국인과 함께', '가족 외식'],
      soloFriendly: true,
      veganFriendly: true,
      is24h: false,
      foreignerPopular: true,
      eatplReason: '주말 가족 단위 및 외국인 카드 결제 건수가 높은 캐주얼 아메리칸 다이닝',
    },
    {
      id: 'r12',
      nameSuffix: '진미 마라샹궈 & 꿔바로우',
      subCategory: '중식',
      signature: '소고기 마라탕 · 찹쌀 꿔바로우',
      percentile: 2.45,
      crowdStatus: '여유 · 바로 입장',
      priceRange: '1.4만원대',
      distanceM: 230,
      tags: ['24시간 운영', '동네맛집', '회식'],
      soloFriendly: true,
      veganFriendly: true,
      is24h: true,
      foreignerPopular: false,
      eatplReason: '늦은 밤까지 운영하며 채소 토핑 선택 폭이 넓어 단체·혼밥 모두 인기',
    },
  ],
  '카페': [
    {
      id: 'c1',
      nameSuffix: '로스터리 아카이브 커피바',
      subCategory: '카페',
      signature: '싱글오리진 핸드드립 · 피낭시에',
      percentile: 0.07,
      crowdStatus: '여유 · 좌석 있음',
      priceRange: '0.6만원대',
      distanceM: 75,
      tags: ['매출 랭킹 1위', '동네맛집', '외국인과 함께'],
      soloFriendly: true,
      veganFriendly: true,
      is24h: false,
      foreignerPopular: true,
      eatplReason: '상권 내 카페 업종 재방문 결제 1위 · 오트밀크 변경 무료 제공',
    },
    {
      id: 'c2',
      nameSuffix: '선데이 모닝 브런치 클럽',
      subCategory: '브런치',
      signature: '에그 베네딕트 · 아보카도 사워도우',
      percentile: 0.23,
      crowdStatus: '보통 · 대기 10분',
      priceRange: '1.8만원대',
      distanceM: 95,
      tags: ['동네맛집', '가족 외식', '외국인과 함께'],
      soloFriendly: true,
      veganFriendly: true,
      is24h: false,
      foreignerPopular: true,
      eatplReason: '주말 오전 10~13시 카드 결제 집중도 최상위 · 비건 브런치 플레이트 인기',
    },
    {
      id: 'c3',
      nameSuffix: '설화 팥빙수 & 수제 젤라또',
      subCategory: '아이스크림/빙수',
      signature: '국산 팥 우유빙수 · 피스타치오 젤라또',
      percentile: 0.39,
      crowdStatus: '여유 · 바로 입장',
      priceRange: '1.1만원대',
      distanceM: 145,
      tags: ['동네맛집', '가족 외식', '외국인과 함께'],
      soloFriendly: true,
      veganFriendly: true,
      is24h: false,
      foreignerPopular: true,
      eatplReason: '식사 후 디저트 시간대 연계 결제율 1위 수제 빙수·젤라또 전문점',
    },
    {
      id: 'c4',
      nameSuffix: '올나잇 스터디 & 24시 에스프레소',
      subCategory: '카페',
      signature: '콜드브루 라떼 · 바스크 치즈케이크',
      percentile: 0.68,
      crowdStatus: '여유 · 콘센트 좌석 다수',
      priceRange: '0.5만원대',
      distanceM: 185,
      tags: ['24시간 운영', '동네맛집'],
      soloFriendly: true,
      veganFriendly: true,
      is24h: true,
      foreignerPopular: false,
      eatplReason: '24시간 연중무휴 운영으로 밤늦게까지 카공·대화 모두 쾌적한 대형 카페',
    },
    {
      id: 'c5',
      nameSuffix: '오랑제리 가든 브런치 & 베이커리',
      subCategory: '브런치',
      signature: '프렌치 토스트 · 잠봉뵈르 샌드위치',
      percentile: 0.92,
      crowdStatus: '보통 · 좌석 충분',
      priceRange: '1.6만원대',
      distanceM: 260,
      tags: ['가족 외식', '외국인과 함께'],
      soloFriendly: true,
      veganFriendly: false,
      is24h: false,
      foreignerPopular: true,
      eatplReason: '넓은 테이블 간격으로 가족 및 친구 모임 결제 건수가 많은 베이커리 카페',
    },
    {
      id: 'c6',
      nameSuffix: '젤라테리아 델 솔레',
      subCategory: '아이스크림/빙수',
      signature: '이천쌀 젤라또 · 망고 소르베',
      percentile: 1.34,
      crowdStatus: '여유 · 테이크아웃/홀',
      priceRange: '0.6만원대',
      distanceM: 320,
      tags: ['동네맛집', '외국인과 함께'],
      soloFriendly: true,
      veganFriendly: true,
      is24h: false,
      foreignerPopular: true,
      eatplReason: '과일 비건 소르베와 로컬 플레이버로 재구매율이 높은 디저트 숍',
    },
    {
      id: 'c7',
      nameSuffix: '다방1988 핸드드립 & 찻집',
      subCategory: '카페',
      signature: '비엔나 커피 · 수제 쌍화차',
      percentile: 1.76,
      crowdStatus: '여유 · 바로 입장',
      priceRange: '0.7만원대',
      distanceM: 410,
      tags: ['동네맛집', '가족 외식'],
      soloFriendly: true,
      veganFriendly: true,
      is24h: false,
      foreignerPopular: false,
      eatplReason: '전 연령층 결제 비율이 고르게 분포된 클래식 로스팅 카페',
    },
  ],
  '술': [
    {
      id: 'b1',
      nameSuffix: '만선 포차 & 모듬해물 타운',
      subCategory: '일반술집',
      signature: '제철 숙성회 · 골뱅이 소면 무침',
      percentile: 0.09,
      crowdStatus: '활기참 · 잔여 3테이블',
      priceRange: '2.2만원대',
      distanceM: 110,
      tags: ['매출 랭킹 1위', '동네맛집', '회식', '퇴근 후 한잔'],
      soloFriendly: false,
      veganFriendly: false,
      is24h: false,
      foreignerPopular: true,
      eatplReason: '평일 오후 6~10시 직장인 법인·개인카드 결제 건수 상권 1위 주점',
    },
    {
      id: 'b2',
      nameSuffix: '스피크이지 바 녹턴 (Nocturne)',
      subCategory: '칵테일바',
      signature: '시그니처 올드패션드 · 유자 진피즈',
      percentile: 0.27,
      crowdStatus: '여유 · 바/테이블 가능',
      priceRange: '2.5만원대',
      distanceM: 150,
      tags: ['퇴근 후 한잔', '외국인과 함께'],
      soloFriendly: true,
      veganFriendly: true,
      is24h: false,
      foreignerPopular: true,
      eatplReason: '혼술 바 좌석 및 데이트·외국인 방문 결제 비중이 높은 클래식 칵테일바',
    },
    {
      id: 'b3',
      nameSuffix: '심야오뎅 & 사케바 24시',
      subCategory: '일반술집',
      signature: '스지 오뎅탕 · 명란 구이',
      percentile: 0.54,
      crowdStatus: '여유 · 바로 입장',
      priceRange: '1.9만원대',
      distanceM: 175,
      tags: ['24시간 운영', '동네맛집', '퇴근 후 한잔', '회식'],
      soloFriendly: true,
      veganFriendly: false,
      is24h: true,
      foreignerPopular: false,
      eatplReason: '2차·3차 심야 시간대 결제 빈도 최상위 · 따뜻한 국물 안주 강점',
    },
    {
      id: 'b4',
      nameSuffix: '루프탑 라운지 미드나잇 글로우',
      subCategory: '칵테일바',
      signature: '에스프레소 마티니 · 하몽 치즈 플래터',
      percentile: 0.81,
      crowdStatus: '보통 · 창가석 잔여',
      priceRange: '2.9만원대',
      distanceM: 220,
      tags: ['퇴근 후 한잔', '외국인과 함께', '회식'],
      soloFriendly: true,
      veganFriendly: true,
      is24h: false,
      foreignerPopular: true,
      eatplReason: '야경 뷰와 논알코올 목테일까지 갖춰 다국적 모임·회식 2차로 인기',
    },
    {
      id: 'b5',
      nameSuffix: '수제맥주 브루어리 탭룸',
      subCategory: '일반술집',
      signature: '페일에일 샘플러 · 크리스피 치킨',
      percentile: 1.19,
      crowdStatus: '여유 · 단체석 완비',
      priceRange: '2.0만원대',
      distanceM: 195,
      tags: ['회식', '퇴근 후 한잔', '외국인과 함께'],
      soloFriendly: true,
      veganFriendly: false,
      is24h: false,
      foreignerPopular: true,
      eatplReason: '대형 홀과 빠른 서빙으로 팀 회식 및 퇴근 후 가벼운 한잔 결제 1순위',
    },
    {
      id: 'b6',
      nameSuffix: '전통주 주막 달빛양조',
      subCategory: '일반술집',
      signature: '느린마을 막걸리 샘플러 · 육전',
      percentile: 1.58,
      crowdStatus: '여유 · 좌석 충분',
      priceRange: '2.1만원대',
      distanceM: 250,
      tags: ['동네맛집', '회식', '퇴근 후 한잔', '외국인과 함께'],
      soloFriendly: false,
      veganFriendly: true,
      is24h: false,
      foreignerPopular: true,
      eatplReason: '지역 양조장 전통주와 감자전·두부김치 등 깔끔한 한식 안주 전문점',
    },
    {
      id: 'b7',
      nameSuffix: '바 벨벳 & 싱글몰트',
      subCategory: '칵테일바',
      signature: '시그니처 하이볼 · 트러플 감자튀김',
      percentile: 1.94,
      crowdStatus: '여유 · 바 좌석 여유',
      priceRange: '2.4만원대',
      distanceM: 280,
      tags: ['24시간 운영', '퇴근 후 한잔', '동네맛집'],
      soloFriendly: true,
      veganFriendly: true,
      is24h: true,
      foreignerPopular: false,
      eatplReason: '새벽까지 조용한 분위기에서 혼술 및 대화가 가능한 숨은 칵테일 바',
    },
  ],
};

function getContextualVenues(type, locationLabel) {
  const cleanLoc = (locationLabel || '을지로').replace(/^현재 위치\s*\(|\)$/g, '').trim() || '을지로';
  const list = BASE_VENUES[type] || BASE_VENUES['밥'];

  return list.map((item) => {
    const placeName = `${cleanLoc} ${item.nameSuffix}`;
    const encodedQuery = encodeURIComponent(placeName);
    return {
      ...item,
      displayName: placeName,
      areaLabel: cleanLoc,
      merUrl: `https://eat.pl/merchant/${item.id}?area=${encodedQuery}`,
    };
  });
}

/**
 * [API 1] 맞춤형 맛집 추천 조회 (조건 일치율 50% 이상, 5~20개 반환)
 */
export async function fetchRecommendations(params) {
  if (!API_CONFIG.USE_MOCK_API) {
    // 실제 백엔드 서버 연동 시 아래 코드를 활성화하세요:
    const res = await fetch(`${API_CONFIG.BASE_URL}/recommendations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) throw new Error('추천 목록을 불러오지 못했습니다.');
    return await res.json();
  }

  const {
    location,
    decisionMode,
    targetGroup,
    storeType,
    subCategory,
    veganOption,
    preferences,
    pollResponses,
  } = params;

  const pool = getContextualVenues(storeType, location);

  // 다수결 가중치 계산 (다같이 모드 vs 나 혼자 모드)
  let subWeights = {};
  let prefWeights = {};

  if (decisionMode === 'together' && pollResponses && pollResponses.length > 0) {
    const total = pollResponses.length;
    pollResponses.forEach((resp) => {
      subWeights[resp.subCategory] = (subWeights[resp.subCategory] || 0) + 1 / total;
      (resp.preferences || []).forEach((p) => {
        prefWeights[p] = (prefWeights[p] || 0) + 1 / total;
      });
    });
  } else {
    subWeights[subCategory] = 1.0;
    (preferences || []).forEach((p) => {
      prefWeights[p] = 1.0;
    });
  }

  const scored = pool.map((venue) => {
    let score = 58;

    if (subWeights['아무거나']) {
      score += 18 * subWeights['아무거나'];
    }
    if (subWeights[venue.subCategory]) {
      score += 22 * subWeights[venue.subCategory];
    } else if (!subWeights['아무거나']) {
      score += 4;
    }

    if (storeType === '밥' && veganOption) {
      score += venue.veganFriendly ? 12 : -6;
    }

    if (decisionMode === 'solo') {
      if (targetGroup === '혼밥 / 1인' && venue.soloFriendly) score += 5;
      if (targetGroup === '가족 / 단체회식' && (venue.tags.includes('가족 외식') || venue.tags.includes('회식'))) score += 6;
      if (targetGroup === '여럿이 / 친구모임' && (venue.tags.includes('회식') || venue.tags.includes('외국인과 함께'))) score += 4;
    }

    Object.entries(prefWeights).forEach(([pref, weight]) => {
      if (venue.tags.includes(pref)) {
        score += 9 * weight;
      } else if (pref === '24시간 운영' && venue.is24h) {
        score += 9 * weight;
      } else if (pref === '외국인과 함께' && venue.foreignerPopular) {
        score += 9 * weight;
      }
    });

    score += Math.max(0, (3 - venue.percentile) * 1.2);
    const finalScore = Math.min(99, Math.max(52, Math.round(score)));

    const displayTags = [...venue.tags];
    if (storeType === '밥' && veganOption && venue.veganFriendly && !displayTags.includes('비건/채식 옵션')) {
      displayTags.unshift('비건/채식 옵션');
    }

    return {
      ...venue,
      matchScore: finalScore,
      displayTags: displayTags.slice(0, 3),
    };
  });

  return scored
    .filter((v) => v.matchScore >= 50)
    .sort((a, b) => b.matchScore - a.matchScore || a.percentile - b.percentile)
    .slice(0, 20);
}

/**
 * [API 2] 교차 업종 인근 추천 조회 (반경 100m -> 200m -> 500m 자동 확장)
 * - '밥' 선택 시 -> 근처 '카페' 4곳 이상
 * - '카페' 선택 시 -> 근처 '식당' 4곳 이상
 * - '술' 선택 시 -> null 반환 (숨김)
 */
export async function fetchNearbyCrossCategory({ storeType, location }) {
  if (storeType === '술') return null;

  if (!API_CONFIG.USE_MOCK_API) {
    const query = new URLSearchParams({ storeType, location }).toString();
    const res = await fetch(`${API_CONFIG.BASE_URL}/nearby?${query}`);
    if (!res.ok) return null;
    return await res.json();
  }

  const targetType = storeType === '밥' ? '카페' : '밥';
  const targetLabel = storeType === '밥' ? '카페' : '식당';
  const allNearby = getContextualVenues(targetType, location).sort((a, b) => a.distanceM - b.distanceM);

  const radii = [100, 200, 500];
  let chosenRadius = 500;
  let filtered = [];

  for (const r of radii) {
    const within = allNearby.filter((v) => v.distanceM <= r);
    if (within.length >= 4) {
      chosenRadius = r;
      filtered = within;
      break;
    }
  }

  if (filtered.length < 4) {
    chosenRadius = 500;
    filtered = allNearby.slice(0, Math.max(4, allNearby.length));
  }

  return {
    targetLabel,
    radiusM: chosenRadius,
    places: filtered,
  };
}
