/**
 * =========================================================================
 * js/app.js — 메인 컨트롤러, 이벤트 핸들러 및 렌더링 루프
 * =========================================================================
 */

import { API_CONFIG, STORE_SUBCATEGORIES } from './config.js';
import { state, getAvailablePreferences } from './state.js';
import { fetchRecommendations, fetchNearbyCrossCategory } from './api.js';
import {
  renderPage1,
  renderPage2,
  renderPage3,
  renderPage4,
  renderPage5,
  renderPage6,
} from './views.js';

let pollTimerInterval = null;
let toastTimeout = null;

/**
 * 토스트 알림 표시
 */
export function showToast(message) {
  const toastEl = document.getElementById('app-toast');
  const textEl = document.getElementById('app-toast-text');
  if (!toastEl || !textEl) return;
  textEl.textContent = message;
  toastEl.classList.remove('opacity-0', 'translate-y-2');
  toastEl.classList.add('opacity-100', 'translate-y-0');

  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toastEl.classList.remove('opacity-100', 'translate-y-0');
    toastEl.classList.add('opacity-0', 'translate-y-2');
  }, 2400);
}

/**
 * 페이지 이동 컨트롤러
 */
export function goToPage(pageNum) {
  if (pollTimerInterval) {
    clearInterval(pollTimerInterval);
    pollTimerInterval = null;
  }

  const validLabels = new Set(getAvailablePreferences().map((c) => c.label));
  state.preferences = state.preferences.filter((p) => validLabels.has(p));

  if (pageNum === 5) {
    initGroupPoll();
    startPollLiveRefresh();
  }

  state.page = pageNum;
  render();
}

/* --- Page 1 Actions --- */
function submitStartSearch() {
  const input = document.getElementById('start-location-input');
  const val = input ? input.value.trim() : '';
  if (!val) {
    showToast('먹고 싶은 동네나 역 이름을 입력해주세요!');
    if (input) input.focus();
    return;
  }
  state.location = val;
  goToPage(2);
}

function selectHotspot(spot) {
  state.location = spot;
  goToPage(2);
}

function useCurrentGpsLocation() {
  const btnText = document.getElementById('gps-btn-label');
  if (btnText) btnText.textContent = '현재 위치 확인 중...';

  if ('geolocation' in navigator) {
    navigator.geolocation.getCurrentPosition(
      () => {
        state.location = '현재 위치 (을지로3가 주변)';
        showToast('현재 위치로 설정되었습니다');
        goToPage(2);
      },
      () => {
        state.location = '현재 위치 (을지로3가 주변)';
        showToast('현재 위치(서울 중구 을지로 주변)로 설정되었습니다');
        goToPage(2);
      },
      { timeout: 3000 }
    );
  } else {
    state.location = '현재 위치 (을지로3가 주변)';
    showToast('현재 위치(을지로3가 주변)로 설정되었습니다');
    goToPage(2);
  }
}

function toggleStartClearBtn(val) {
  const btn = document.getElementById('start-clear-btn');
  if (!btn) return;
  if (val && val.length > 0) {
    btn.classList.remove('hidden');
    btn.classList.add('flex');
  } else {
    btn.classList.add('hidden');
    btn.classList.remove('flex');
  }
}

function clearStartInput() {
  const input = document.getElementById('start-location-input');
  if (input) {
    input.value = '';
    input.focus();
  }
  state.location = '';
  toggleStartClearBtn('');
}

/* --- Page 2 Actions --- */
function setDecisionMode(mode) {
  state.decisionMode = mode;
  render();
}

function selectSoloTargetGroup(group) {
  state.targetGroup = group;
  goToPage(3);
}

function selectGroupSize(size, isCustom = false) {
  state.customGroupMode = isCustom;
  state.groupSize = Math.max(2, Math.min(30, Number(size) || 5));
  if (!isCustom) {
    goToPage(3);
  } else {
    render();
  }
}

function updateCustomGroupSize(val) {
  const parsed = parseInt(val, 10);
  if (!isNaN(parsed) && parsed >= 2) {
    state.groupSize = Math.min(30, parsed);
  }
}

/* --- Page 3 & 4 Actions --- */
function selectStoreType(type) {
  state.storeType = type;
  const subs = STORE_SUBCATEGORIES[type];
  state.subCategory = subs.includes('아무거나') ? '아무거나' : subs[0];
  if (type !== '밥') {
    state.veganOption = false;
  }
  render();
}

function selectSubCategory(sub) {
  state.subCategory = sub;
  render();
}

function toggleVeganOption() {
  state.veganOption = !state.veganOption;
  render();
}

function togglePreferenceChip(label) {
  if (state.preferences.includes(label)) {
    state.preferences = state.preferences.filter((p) => p !== label);
  } else {
    state.preferences = [...state.preferences, label];
  }
  render();
}

/* --- Page 5 Group Poll Actions --- */
function initGroupPoll() {
  const slug = encodeURIComponent(state.location || 'seoul').slice(0, 12);
  state.pollId = `${slug}-${Math.floor(1000 + Math.random() * 9000)}`;
  state.pollResponses = [
    {
      voter: '나 (방장)',
      subCategory: state.subCategory,
      preferences: [...state.preferences],
    },
  ];
  state.pollLastTick = Date.now();
}

function startPollLiveRefresh() {
  if (pollTimerInterval) clearInterval(pollTimerInterval);
  pollTimerInterval = setInterval(() => {
    if (state.page !== 5) return;
    state.pollLastTick = Date.now();
    const statusEl = document.getElementById('poll-live-badge');
    if (statusEl) {
      statusEl.classList.add('scale-105');
      setTimeout(() => statusEl.classList.remove('scale-105'), 300);
    }
    const timeEl = document.getElementById('poll-last-sync');
    if (timeEl) {
      timeEl.textContent = '방금 전 실시간 동기화됨 (5초 주기)';
    }
  }, API_CONFIG.POLL_REFRESH_MS);
}

function simulateTeammateVote(subCat, prefs, voterLabel) {
  const idx = state.pollResponses.length + 1;
  state.pollResponses.push({
    voter: voterLabel || `일행 ${idx}`,
    subCategory: subCat,
    preferences: prefs,
  });
  render();
}

function trimExcessVotes() {
  state.pollResponses = state.pollResponses.slice(0, state.groupSize);
  showToast(`설정 인원(${state.groupSize}명)에 맞춰 초과 응답을 정리했습니다`);
  render();
}

function resetSimulatedVotes() {
  state.pollResponses = state.pollResponses.slice(0, 1);
  showToast('내 투표만 남기고 초기화했습니다');
  render();
}

function copyPollShareLink() {
  const shareUrl = `https://jigeumeodiga.kr/vote/${state.pollId}`;
  const tempInput = document.createElement('input');
  tempInput.value = shareUrl;
  document.body.appendChild(tempInput);
  tempInput.select();
  try {
    document.execCommand('copy');
    showToast('투표 링크가 클립보드에 복사되었습니다!');
  } catch (e) {
    showToast('링크가 복사되었습니다: ' + shareUrl);
  }
  document.body.removeChild(tempInput);
}

/* --- Page 6 Filter & Location Modal Actions --- */
function toggleFilterDrawer() {
  state.filterExpanded = !state.filterExpanded;
  render();
}

function quickSwitchStoreType(newType) {
  if (state.storeType === newType) return;
  state.storeType = newType;
  const subs = STORE_SUBCATEGORIES[newType];
  state.subCategory = subs.includes('아무거나') ? '아무거나' : subs[0];
  if (newType !== '밥') state.veganOption = false;
  const validLabels = new Set(getAvailablePreferences().map((c) => c.label));
  state.preferences = state.preferences.filter((p) => validLabels.has(p));
  render();
}

function openLocationModal() {
  const modal = document.getElementById('location-modal');
  const input = document.getElementById('modal-location-input');
  if (modal) modal.classList.remove('hidden');
  if (input) {
    input.value = state.location;
    setTimeout(() => input.focus(), 50);
  }
}

function closeLocationModal() {
  const modal = document.getElementById('location-modal');
  if (modal) modal.classList.add('hidden');
}

function applyModalLocation() {
  const input = document.getElementById('modal-location-input');
  const val = input ? input.value.trim() : '';
  if (!val) {
    showToast('변경할 지역명을 입력해주세요');
    return;
  }
  state.location = val;
  closeLocationModal();
  render();
  showToast(`'${val}' 기준으로 추천을 업데이트했습니다`);
}

function selectModalHotspot(spot) {
  state.location = spot;
  closeLocationModal();
  render();
  showToast(`'${spot}' 기준으로 추천을 업데이트했습니다`);
}

/**
 * 마스터 렌더링 루프
 */
export async function render() {
  const root = document.getElementById('app-root');
  if (!root) return;

  switch (state.page) {
    case 1:
      root.innerHTML = renderPage1();
      break;
    case 2:
      root.innerHTML = renderPage2();
      break;
    case 3:
      root.innerHTML = renderPage3();
      break;
    case 4:
      root.innerHTML = renderPage4();
      break;
    case 5:
      root.innerHTML = renderPage5();
      break;
    case 6: {
      const [recommendations, nearbySection] = await Promise.all([
        fetchRecommendations(state),
        fetchNearbyCrossCategory(state),
      ]);
      root.innerHTML = renderPage6(recommendations, nearbySection);
      break;
    }
    default:
      root.innerHTML = renderPage1();
  }
}

// HTML 인라인 이벤트 핸들러(onclick 등)와 ES Module 연결
Object.assign(window, {
  goToPage,
  submitStartSearch,
  selectHotspot,
  useCurrentGpsLocation,
  toggleStartClearBtn,
  clearStartInput,
  setDecisionMode,
  selectSoloTargetGroup,
  selectGroupSize,
  updateCustomGroupSize,
  selectStoreType,
  selectSubCategory,
  toggleVeganOption,
  togglePreferenceChip,
  simulateTeammateVote,
  trimExcessVotes,
  resetSimulatedVotes,
  copyPollShareLink,
  toggleFilterDrawer,
  quickSwitchStoreType,
  openLocationModal,
  closeLocationModal,
  applyModalLocation,
  selectModalHotspot,
});

// 앱 초기화
window.addEventListener('DOMContentLoaded', () => {
  render();
});
