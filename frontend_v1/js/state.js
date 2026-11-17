/**
 * =========================================================================
 * js/state.js — 전역 상태(State) 및 조건부 필터 규칙 관리
 * =========================================================================
 */

export const state = {
  page: 1,                  // 1: 시작, 2: 인원/방식, 3: 업종/세부, 4: 추가조건, 5: 다같이 투표, 6: 추천결과
  location: '',
  decisionMode: 'solo',     // 'solo' ('나 혼자') | 'together' ('다같이')
  targetGroup: '혼밥 / 1인', // Page 2-1: '혼밥 / 1인' | '둘이서 / 데이트' | '여럿이 / 친구모임' | '가족 / 단체회식'
  groupSize: 4,             // Page 2-2: N (2, 3, 4, or 5+)
  customGroupMode: false,
  storeType: '밥',          // '밥' | '카페' | '술'
  subCategory: '아무거나',
  veganOption: false,       // '밥' 선택 시 노출되는 비건/채식/사찰음식 토글
  preferences: [],          // 선택된 추가 선호 조건 배열

  // Page 5 다같이 투표 상태
  pollId: 'euljiro-8429',
  pollResponses: [],        // [{ voter, subCategory, preferences }]
  pollLastTick: Date.now(),

  // Page 6 결과 화면 인라인 조건 패널 열림 여부
  filterExpanded: false,
};

/**
 * Page 4 동적 조건부 선호도 칩 반환
 * - '가족 외식': 나 혼자 + (여럿이/친구모임 또는 가족/단체회식) + (밥 또는 카페)
 * - '회식': 나 혼자 + (여럿이/친구모임 또는 가족/단체회식) + (밥 또는 술)
 * - '퇴근 후 한잔': 업종이 '술'일 때만 노출
 */
export function getAvailablePreferences() {
  const chips = [
    { label: '24시간 운영', icon: '🌙' },
    { label: '매출 랭킹 1위', icon: '👑' },
    { label: '동네맛집', icon: '🏘️' },
    { label: '외국인과 함께', icon: '🌍' },
  ];

  const isGroupTarget =
    state.decisionMode === 'solo' &&
    (state.targetGroup === '여럿이 / 친구모임' || state.targetGroup === '가족 / 단체회식');

  if (isGroupTarget && (state.storeType === '밥' || state.storeType === '카페')) {
    chips.push({ label: '가족 외식', icon: '👨‍👩‍👧‍👦' });
  }

  if (isGroupTarget && (state.storeType === '밥' || state.storeType === '술')) {
    chips.push({ label: '회식', icon: '🥂' });
  }

  if (state.storeType === '술') {
    chips.push({ label: '퇴근 후 한잔', icon: '🍻' });
  }

  return chips;
}
