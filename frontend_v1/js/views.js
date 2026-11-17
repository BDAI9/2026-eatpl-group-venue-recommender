/**
 * =========================================================================
 * js/views.js — 페이지별 UI 컴포넌트 렌더링 (Page 1 ~ Page 6)
 * =========================================================================
 */

import { HOTSPOTS, EMOJI_ROWS, STORE_SUBCATEGORIES, STORE_ICONS } from './config.js';
import { state, getAvailablePreferences } from './state.js';
import { formatPercentile } from './api.js';

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function getRiceBowlSvg(sizeClass = 'w-6 h-6', color = '#FFFFFF', accent = '#bd2333') {
  return `
    <svg class="${sizeClass}" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M11.5 6.5C11.5 5 12.8 4.5 12.8 3" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
      <path d="M16 5.5C16 4 17.3 3.5 17.3 2" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
      <path d="M20.5 6.5C20.5 5 21.8 4.5 21.8 3" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
      <path d="M7.5 15C7.5 11.4 11.3 9 16 9C20.7 9 24.5 11.4 24.5 15H7.5Z" fill="${color}" fill-opacity="0.92"/>
      <path d="M4.5 15.5H27.5C27.5 21.6 22.8 26 16 26C9.2 26 4.5 21.6 4.5 15.5Z" fill="${color}"/>
      <path d="M11.5 26.5H20.5" stroke="${color}" stroke-width="2.2" stroke-linecap="round"/>
      <path d="M8.5 18.5H23.5" stroke="${accent}" stroke-width="1.8" stroke-linecap="round"/>
    </svg>
  `;
}

export function renderStepHeader(stepNum, totalSteps, backPage) {
  const pct = Math.round((stepNum / totalSteps) * 100);
  return `
    <header class="px-5 pt-5 pb-3 bg-white shrink-0">
      <div class="flex items-center justify-between mb-3">
        <button
          type="button"
          onclick="goToPage(${backPage})"
          class="w-9 h-9 -ml-2 rounded-full hover:bg-zinc-100 active:bg-zinc-200 flex items-center justify-center text-zinc-700 transition-colors"
          aria-label="이전 단계"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <div class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#fdf2f3] border border-[#f7d4d8] text-[#bd2333] text-xs font-semibold max-w-[210px]">
          <svg class="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clip-rule="evenodd"/>
          </svg>
          <span class="truncate">${escapeHtml(state.location)}</span>
        </div>

        <span class="text-xs font-semibold text-zinc-400 tabular-nums">${stepNum} / ${totalSteps}</span>
      </div>

      <div class="w-full h-1.5 bg-zinc-100 rounded-full overflow-hidden">
        <div class="h-full bg-[#bd2333] rounded-full transition-all duration-300" style="width: ${pct}%"></div>
      </div>
    </header>
  `;
}

export function renderPage1() {
  const rowsHtml = EMOJI_ROWS.map((rowEmojis, idx) => {
    const rowNumber = idx + 1;
    const isOdd = rowNumber % 2 === 1;
    const trackClass = isOdd ? 'marquee-track-left' : 'marquee-track-right';
    const duration = 30 + (idx % 4) * 4;
    const repeated = [...rowEmojis, ...rowEmojis, ...rowEmojis, ...rowEmojis];
    const itemsHtml = repeated
      .map(
        (emoji) =>
          `<span class="inline-flex items-center justify-center w-12 h-12 mx-1.5 rounded-2xl bg-white/[0.08] backdrop-blur-[1px] text-2xl select-none">${emoji}</span>`
      )
      .join('');

    return `
      <div class="w-full overflow-hidden py-1.5">
        <div class="${trackClass}" style="--duration: ${duration}s;">
          ${itemsHtml}
        </div>
      </div>
    `;
  }).join('');

  const hotspotChipsHtml = HOTSPOTS.map(
    (spot) => `
      <button
        type="button"
        onclick="selectHotspot('${spot}')"
        class="px-3.5 py-2 rounded-full bg-white/15 hover:bg-white/25 active:bg-[#bd2333] text-white text-xs font-medium backdrop-blur-md border border-white/20 transition-all"
      >
        ${spot}
      </button>
    `
  ).join('');

  return `
    <section class="relative flex-1 flex flex-col justify-between h-full bg-[#191112] text-white overflow-hidden">
      <div class="absolute inset-0 flex flex-col justify-between py-4 opacity-55 pointer-events-none select-none" aria-hidden="true">
        ${rowsHtml}
      </div>

      <div class="absolute inset-0 bg-gradient-to-b from-[#170f10]/85 via-[#170f10]/70 to-[#170f10]/92 pointer-events-none"></div>

      <div class="relative z-10 px-6 pt-9 flex items-center justify-between">
        <div class="inline-flex items-center gap-2">
          <div class="w-9 h-9 rounded-2xl bg-[#bd2333] flex items-center justify-center shadow-lg shadow-[#bd2333]/40">
            ${getRiceBowlSvg('w-5 h-5', '#FFFFFF', '#bd2333')}
          </div>
          <span class="text-lg font-extrabold tracking-tight text-white">지금어디가</span>
        </div>
        <span class="text-[11px] font-medium px-2.5 py-1 rounded-full bg-white/10 text-white/80 border border-white/15">
          eat.pl 결제 데이터 큐레이션
        </span>
      </div>

      <div class="relative z-10 px-6 my-auto py-6">
        <div class="mb-6">
          <div class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#bd2333]/90 text-white text-xs font-semibold mb-3 shadow-sm">
            <span>실패 없는 한 끼 결정</span>
          </div>
          <h1 class="text-[34px] leading-[1.18] font-black tracking-tight text-white mb-2.5">
            지금어디가
          </h1>
          <p class="text-[15px] leading-relaxed font-medium text-white/85">
            고민은 짧게, 맛있는 결정은 지금 바로
          </p>
        </div>

        <div class="bg-white rounded-full p-1.5 pl-5 shadow-2xl shadow-black/40 flex items-center gap-2 border-2 border-white focus-within:border-[#bd2333] transition-colors">
          <input
            id="start-location-input"
            type="text"
            value="${escapeHtml(state.location)}"
            placeholder="어디에서 먹을까요?"
            oninput="toggleStartClearBtn(this.value)"
            onkeydown="if(event.key==='Enter') submitStartSearch()"
            class="flex-1 min-w-0 bg-transparent text-[15px] font-medium text-zinc-900 placeholder-zinc-400 focus:outline-none"
          />
          <button
            id="start-clear-btn"
            type="button"
            onclick="clearStartInput()"
            class="${state.location ? 'flex' : 'hidden'} w-6 h-6 rounded-full bg-zinc-200 hover:bg-zinc-300 text-zinc-600 items-center justify-center text-xs font-bold shrink-0"
            aria-label="입력 지우기"
          >
            ✕
          </button>
          <button
            type="button"
            onclick="submitStartSearch()"
            class="bg-[#bd2333] hover:bg-[#991b28] active:scale-[0.98] text-white text-sm font-bold px-5 py-3 rounded-full shadow-md shadow-[#bd2333]/30 transition-all shrink-0 flex items-center gap-1"
          >
            <span>시작</span>
            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </button>
        </div>

        <div class="mt-3 flex justify-start">
          <button
            type="button"
            onclick="useCurrentGpsLocation()"
            class="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-white/12 hover:bg-white/20 active:bg-white/25 text-white text-xs font-semibold backdrop-blur-md border border-white/15 transition-all"
          >
            <svg class="w-3.5 h-3.5 text-[#ff7b89]" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 2v2m0 16v2M2 12h2m16 0h2m-4.93-5.07l-1.41 1.41M8.34 15.66l-1.41 1.41m0-10.14l1.41 1.41m7.32 7.32l1.41 1.41M12 8a4 4 0 100 8 4 4 0 000-8z" />
            </svg>
            <span id="gps-btn-label">현재 위치로 설정</span>
          </button>
        </div>
      </div>

      <div class="relative z-10 px-6 pb-8">
        <p class="text-xs font-semibold text-white/65 mb-2.5 flex items-center gap-1.5">
          <span class="w-1.5 h-1.5 rounded-full bg-[#bd2333]"></span>
          지금 인기 있는 서울 핫플레이스
        </p>
        <div class="flex flex-wrap gap-2">
          ${hotspotChipsHtml}
        </div>
      </div>
    </section>
  `;
}

export function renderPage2() {
  const totalSteps = state.decisionMode === 'together' ? 4 : 3;

  const soloTargets = [
    { label: '혼밥 / 1인', desc: '눈치 보지 않고 편하게 즐기는 한 끼', icon: '🧍' },
    { label: '둘이서 / 데이트', desc: '분위기와 맛 모두 만족스러운 시간', icon: '💑' },
    { label: '여럿이 / 친구모임', desc: '다 함께 나누기 좋고 활기찬 공간', icon: '👯' },
    { label: '가족 / 단체회식', desc: '넓은 좌석과 호불호 없는 메뉴 구성', icon: '👨‍👩‍👧‍👦' },
  ];

  const groupSizes = [2, 3, 4];

  return `
    <section class="flex-1 flex flex-col h-full bg-white overflow-hidden animate-page-in">
      ${renderStepHeader(1, totalSteps, 1)}

      <div class="flex-1 overflow-y-auto px-5 pt-3 pb-6">
        <h2 class="text-[22px] font-extrabold text-zinc-900 tracking-tight mb-1.5">
          오늘 어떻게 결정할까요?
        </h2>
        <p class="text-xs text-zinc-500 mb-5">
          혼자 빠르게 고르거나, 일행과 투표로 다수결 추천을 받을 수 있어요.
        </p>

        <div class="grid grid-cols-2 gap-2.5 mb-6">
          <button
            type="button"
            onclick="setDecisionMode('solo')"
            class="p-4 rounded-2xl border-2 text-left transition-all ${
              state.decisionMode === 'solo'
                ? 'border-[#bd2333] bg-[#fdf2f3] shadow-sm'
                : 'border-zinc-200 bg-white hover:border-zinc-300'
            }"
          >
            <div class="flex items-center justify-between mb-2">
              <span class="text-2xl">🙋</span>
              <span class="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold ${
                state.decisionMode === 'solo' ? 'bg-[#bd2333] text-white' : 'bg-zinc-100 text-zinc-400'
              }">✓</span>
            </div>
            <div class="text-base font-extrabold ${state.decisionMode === 'solo' ? 'text-[#bd2333]' : 'text-zinc-900'}">나 혼자</div>
            <div class="text-[11px] text-zinc-500 mt-0.5">내가 직접 조건 선택</div>
          </button>

          <button
            type="button"
            onclick="setDecisionMode('together')"
            class="p-4 rounded-2xl border-2 text-left transition-all ${
              state.decisionMode === 'together'
                ? 'border-[#bd2333] bg-[#fdf2f3] shadow-sm'
                : 'border-zinc-200 bg-white hover:border-zinc-300'
            }"
          >
            <div class="flex items-center justify-between mb-2">
              <span class="text-2xl">🗳️</span>
              <span class="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold ${
                state.decisionMode === 'together' ? 'bg-[#bd2333] text-white' : 'bg-zinc-100 text-zinc-400'
              }">✓</span>
            </div>
            <div class="text-base font-extrabold ${state.decisionMode === 'together' ? 'text-[#bd2333]' : 'text-zinc-900'}">다같이</div>
            <div class="text-[11px] text-zinc-500 mt-0.5">일행 투표 · 다수결 집계</div>
          </button>
        </div>

        ${
          state.decisionMode === 'solo'
            ? `
              <div class="animate-page-in">
                <div class="flex items-center justify-between mb-3">
                  <h3 class="text-sm font-bold text-zinc-800">누구와 함께 방문하나요?</h3>
                  <span class="text-[11px] font-semibold text-[#bd2333]">방문 유형 선택</span>
                </div>
                <div class="space-y-2.5">
                  ${soloTargets
                    .map((item) => {
                      const active = state.targetGroup === item.label;
                      return `
                        <button
                          type="button"
                          onclick="selectSoloTargetGroup('${item.label}')"
                          class="w-full p-4 rounded-2xl border transition-all flex items-center gap-3.5 text-left group ${
                            active
                              ? 'border-[#bd2333] bg-[#fdf2f3]/70'
                              : 'border-zinc-200 hover:border-[#bd2333]/50 hover:bg-zinc-50'
                          }"
                        >
                          <span class="w-11 h-11 rounded-2xl bg-white border border-zinc-100 shadow-xs flex items-center justify-center text-xl shrink-0">
                            ${item.icon}
                          </span>
                          <div class="flex-1 min-w-0">
                            <div class="text-[15px] font-bold text-zinc-900 group-hover:text-[#bd2333] transition-colors">
                              ${item.label}
                            </div>
                            <div class="text-xs text-zinc-500 mt-0.5 truncate">${item.desc}</div>
                          </div>
                          <svg class="w-4 h-4 text-zinc-400 group-hover:text-[#bd2333] shrink-0" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
                          </svg>
                        </button>
                      `;
                    })
                    .join('')}
                </div>
              </div>
            `
            : `
              <div class="animate-page-in">
                <div class="flex items-center justify-between mb-3">
                  <h3 class="text-sm font-bold text-zinc-800">함께 투표할 총 인원(N)을 선택하세요</h3>
                  <span class="text-[11px] font-semibold text-[#bd2333]">총 ${state.groupSize}명</span>
                </div>

                <div class="grid grid-cols-2 gap-2.5 mb-4">
                  ${groupSizes
                    .map((n) => {
                      const selected = !state.customGroupMode && state.groupSize === n;
                      return `
                        <button
                          type="button"
                          onclick="selectGroupSize(${n}, false)"
                          class="p-4 rounded-2xl border-2 text-center transition-all ${
                            selected
                              ? 'border-[#bd2333] bg-[#fdf2f3] text-[#bd2333]'
                              : 'border-zinc-200 hover:border-[#bd2333]/50 text-zinc-900'
                          }"
                        >
                          <div class="text-lg font-extrabold">${n}인</div>
                          <div class="text-[11px] text-zinc-500 mt-0.5">${n}명 투표 집계</div>
                        </button>
                      `;
                    })
                    .join('')}

                  <button
                    type="button"
                    onclick="selectGroupSize(${Math.max(5, state.groupSize)}, true)"
                    class="p-4 rounded-2xl border-2 text-center transition-all ${
                      state.customGroupMode
                        ? 'border-[#bd2333] bg-[#fdf2f3] text-[#bd2333]'
                        : 'border-zinc-200 hover:border-[#bd2333]/50 text-zinc-900'
                    }"
                  >
                    <div class="text-lg font-extrabold">5인 이상</div>
                    <div class="text-[11px] text-zinc-500 mt-0.5">직접 인원 입력</div>
                  </button>
                </div>

                ${
                  state.customGroupMode
                    ? `
                      <div class="p-4 rounded-2xl bg-zinc-50 border border-zinc-200 mb-4 animate-page-in">
                        <label class="block text-xs font-bold text-zinc-700 mb-2">참여 인원 수 직접 입력 (최대 30명)</label>
                        <div class="flex items-center gap-2">
                          <input
                            type="number"
                            min="2"
                            max="30"
                            value="${state.groupSize}"
                            oninput="updateCustomGroupSize(this.value)"
                            class="w-24 px-3.5 py-2.5 rounded-xl bg-white border border-zinc-300 text-base font-bold text-zinc-900 text-center focus:outline-none focus:border-[#bd2333]"
                          />
                          <span class="text-sm font-semibold text-zinc-600">명 함께 투표</span>
                        </div>
                      </div>
                    `
                    : ''
                }

                <button
                  type="button"
                  onclick="goToPage(3)"
                  class="w-full py-3.5 rounded-2xl bg-[#bd2333] hover:bg-[#991b28] text-white text-sm font-bold shadow-md shadow-[#bd2333]/25 transition-all"
                >
                  ${state.groupSize}인 투표 취향 선택하기
                </button>
              </div>
            `
        }
      </div>
    </section>
  `;
}

export function renderPage3() {
  const totalSteps = state.decisionMode === 'together' ? 4 : 3;
  const storeTypes = [
    { type: '밥', label: '밥', desc: '식사 · 한끼', icon: '🍚' },
    { type: '카페', label: '카페', desc: '커피 · 디저트', icon: '☕' },
    { type: '술', label: '술', desc: '한잔 · 모임', icon: '🍻' },
  ];

  const subList = STORE_SUBCATEGORIES[state.storeType] || [];

  return `
    <section class="flex-1 flex flex-col h-full bg-white overflow-hidden animate-page-in">
      ${renderStepHeader(2, totalSteps, 2)}

      <div class="flex-1 overflow-y-auto px-5 pt-3 pb-6">
        ${
          state.decisionMode === 'together'
            ? `
              <div class="mb-4 p-3 rounded-2xl bg-[#fdf2f3] border border-[#f7d4d8] flex items-start gap-2.5">
                <span class="text-base leading-none mt-0.5">🗳️</span>
                <p class="text-xs font-medium text-[#991b28] leading-relaxed">
                  <strong>다같이 모드 (${state.groupSize}인):</strong> 지금 선택하는 카테고리와 다음 단계 선호 조건은 일행들의 투표 결과와 합산되어 <strong>다수결 가중치</strong>로 반영됩니다.
                </p>
              </div>
            `
            : ''
        }

        <h2 class="text-[22px] font-extrabold text-zinc-900 tracking-tight mb-1.5">
          지금 무엇이 끌리나요?
        </h2>
        <p class="text-xs text-zinc-500 mb-5">
          업종을 고르면 세부 메뉴 카테고리를 바로 선택할 수 있어요.
        </p>

        <div class="grid grid-cols-3 gap-2.5 mb-6">
          ${storeTypes
            .map((st) => {
              const active = state.storeType === st.type;
              return `
                <button
                  type="button"
                  onclick="selectStoreType('${st.type}')"
                  class="py-4 px-2 rounded-2xl border-2 flex flex-col items-center justify-center transition-all ${
                    active
                      ? 'border-[#bd2333] bg-[#fdf2f3] shadow-sm'
                      : 'border-zinc-200 bg-white hover:border-zinc-300'
                  }"
                >
                  <span class="text-3xl mb-1.5">${st.icon}</span>
                  <span class="text-base font-extrabold ${active ? 'text-[#bd2333]' : 'text-zinc-900'}">${st.label}</span>
                  <span class="text-[11px] text-zinc-500 mt-0.5">${st.desc}</span>
                </button>
              `;
            })
            .join('')}
        </div>

        <div class="mb-5">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-sm font-bold text-zinc-800">
              ${state.storeType === '밥' ? '어떤 종류의 식사를 원하세요?' : state.storeType === '카페' ? '어떤 카페 분위기를 원하세요?' : '어떤 주점을 찾으시나요?'}
            </h3>
            <span class="text-[11px] font-semibold text-[#bd2333]">세부 선택</span>
          </div>

          <div class="grid grid-cols-2 gap-2.5">
            ${subList
              .map((sub) => {
                const active = state.subCategory === sub;
                return `
                  <button
                    type="button"
                    onclick="selectSubCategory('${sub}')"
                    class="py-3.5 px-4 rounded-2xl border-2 text-sm font-bold transition-all flex items-center justify-between ${
                      active
                        ? 'border-[#bd2333] bg-[#bd2333] text-white shadow-sm'
                        : 'border-zinc-200 bg-white text-zinc-800 hover:border-[#bd2333]/50'
                    }"
                  >
                    <span>${sub}</span>
                    <span class="text-xs ${active ? 'text-white' : 'text-zinc-300'}">●</span>
                  </button>
                `;
              })
              .join('')}
          </div>
        </div>

        ${
          state.storeType === '밥'
            ? `
              <div class="p-4 rounded-2xl bg-emerald-50/70 border border-emerald-200/80 flex items-center justify-between gap-3">
                <div class="flex items-center gap-2.5 min-w-0">
                  <span class="text-xl shrink-0">🌿</span>
                  <div class="min-w-0">
                    <div class="text-xs font-bold text-emerald-950">비건 / 채식 / 사찰음식 옵션</div>
                    <div class="text-[11px] text-emerald-700 truncate">채식 메뉴가 준비된 매장을 우선 추천해요</div>
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked="${state.veganOption}"
                  onclick="toggleVeganOption()"
                  class="w-12 h-7 rounded-full transition-colors p-0.5 shrink-0 ${
                    state.veganOption ? 'bg-emerald-600' : 'bg-zinc-300'
                  }"
                >
                  <span class="block w-6 h-6 rounded-full bg-white shadow transition-transform ${
                    state.veganOption ? 'translate-x-5' : 'translate-x-0'
                  }"></span>
                </button>
              </div>
            `
            : ''
        }
      </div>

      <div class="p-5 pt-3 bg-white border-t border-zinc-100 shrink-0">
        <button
          type="button"
          onclick="goToPage(4)"
          class="w-full py-3.5 rounded-2xl bg-[#bd2333] hover:bg-[#991b28] active:scale-[0.99] text-white text-sm font-bold shadow-lg shadow-[#bd2333]/25 transition-all"
        >
          다음 단계로
        </button>
      </div>
    </section>
  `;
}

export function renderPage4() {
  const totalSteps = state.decisionMode === 'together' ? 4 : 3;
  const availableChips = getAvailablePreferences();

  return `
    <section class="flex-1 flex flex-col h-full bg-white overflow-hidden animate-page-in">
      ${renderStepHeader(3, totalSteps, 3)}

      <div class="flex-1 overflow-y-auto px-5 pt-3 pb-6">
        ${
          state.decisionMode === 'together'
            ? `
              <div class="mb-4 p-3 rounded-2xl bg-[#fdf2f3] border border-[#f7d4d8] flex items-start gap-2.5">
                <span class="text-base leading-none mt-0.5">📊</span>
                <p class="text-xs font-medium text-[#991b28] leading-relaxed">
                  <strong>다수결 가중치 반영 안내:</strong> 선택한 세부 조건 역시 일행 투표와 함께 집계되어 득표율이 높은 조건에 더 큰 가중치를 부여합니다.
                </p>
              </div>
            `
            : ''
        }

        <h2 class="text-[22px] font-extrabold text-zinc-900 tracking-tight mb-1.5">
          더 중요하게 보는 조건이 있나요?
        </h2>
        <p class="text-xs text-zinc-500 mb-5">
          원하는 키워드를 모두 골라주세요. 선택하지 않고 바로 넘어가도 좋아요.
        </p>

        <div class="grid grid-cols-2 gap-2.5">
          ${availableChips
            .map((chip) => {
              const selected = state.preferences.includes(chip.label);
              return `
                <button
                  type="button"
                  onclick="togglePreferenceChip('${chip.label}')"
                  class="p-3.5 rounded-2xl border-2 text-left transition-all flex items-center gap-2.5 ${
                    selected
                      ? 'border-[#bd2333] bg-[#fdf2f3] text-[#bd2333] shadow-xs'
                      : 'border-zinc-200 bg-white text-zinc-800 hover:border-zinc-300'
                  }"
                >
                  <span class="text-lg shrink-0">${chip.icon}</span>
                  <span class="text-[13px] font-bold leading-snug">${chip.label}</span>
                </button>
              `;
            })
            .join('')}
        </div>

        <div class="mt-6 p-4 rounded-2xl bg-zinc-50 border border-zinc-200/80">
          <div class="text-[11px] font-bold text-zinc-400 uppercase tracking-wider mb-2">현재 선택 요약</div>
          <div class="flex flex-wrap gap-1.5">
            <span class="px-2.5 py-1 rounded-full bg-white border border-zinc-200 text-xs font-semibold text-zinc-700">
              📍 ${escapeHtml(state.location)}
            </span>
            <span class="px-2.5 py-1 rounded-full bg-white border border-zinc-200 text-xs font-semibold text-zinc-700">
              ${state.decisionMode === 'solo' ? `🙋 ${state.targetGroup}` : `🗳️ 다같이 ${state.groupSize}인`}
            </span>
            <span class="px-2.5 py-1 rounded-full bg-[#fdf2f3] border border-[#f7d4d8] text-xs font-bold text-[#bd2333]">
              ${STORE_ICONS[state.storeType]} ${state.storeType} · ${state.subCategory}
            </span>
            ${
              state.veganOption
                ? `<span class="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-semibold">🌿 비건/채식</span>`
                : ''
            }
            ${state.preferences
              .map(
                (p) =>
                  `<span class="px-2.5 py-1 rounded-full bg-zinc-800 text-white text-xs font-semibold">#${p}</span>`
              )
              .join('')}
          </div>
        </div>
      </div>

      <div class="p-5 pt-3 bg-white border-t border-zinc-100 shrink-0">
        ${
          state.decisionMode === 'together'
            ? `
              <button
                type="button"
                onclick="goToPage(5)"
                class="w-full py-3.5 rounded-2xl bg-[#bd2333] hover:bg-[#991b28] active:scale-[0.99] text-white text-sm font-bold shadow-lg shadow-[#bd2333]/25 transition-all"
              >
                투표방 생성 및 일행 초대하기
              </button>
            `
            : `
              <button
                type="button"
                onclick="goToPage(6)"
                class="w-full py-3.5 rounded-2xl bg-[#bd2333] hover:bg-[#991b28] active:scale-[0.99] text-white text-sm font-bold shadow-lg shadow-[#bd2333]/25 transition-all"
              >
                BC카드 데이터 기반 맛집 추천받기
              </button>
            `
        }
      </div>
    </section>
  `;
}

export function renderPage5() {
  const votedCount = state.pollResponses.length;
  const targetN = state.groupSize;
  const isOverCapacity = votedCount > targetN;
  const isComplete = votedCount === targetN;
  const progressPct = Math.min(100, Math.round((votedCount / targetN) * 100));
  const shareUrl = `https://jigeumeodiga.kr/vote/${state.pollId}`;

  const subs = STORE_SUBCATEGORIES[state.storeType];
  const altSub1 = subs[0] !== state.subCategory ? subs[0] : subs[1] || subs[0];
  const altSub2 = subs[1] && subs[1] !== altSub1 ? subs[1] : subs[0];

  return `
    <section class="flex-1 flex flex-col h-full bg-white overflow-hidden animate-page-in">
      ${renderStepHeader(4, 4, 4)}

      <div class="flex-1 overflow-y-auto px-5 pt-3 pb-6">
        <h2 class="text-[22px] font-extrabold text-zinc-900 tracking-tight mb-1">
          일행들의 취향을 모으고 있어요
        </h2>
        <p class="text-xs text-zinc-500 mb-4">
          링크를 공유하면 각자 고른 카테고리·조건이 다수결 가중치로 합산됩니다.
        </p>

        ${
          isOverCapacity
            ? `
              <div class="mb-4 p-3.5 rounded-2xl bg-red-50 border-2 border-red-500 text-red-900 animate-page-in">
                <div class="flex items-start gap-2.5">
                  <span class="text-lg leading-none">🚨</span>
                  <div class="flex-1">
                    <div class="text-xs font-extrabold text-red-700">
                      설정한 인원(${targetN}명)보다 많은 응답(${votedCount}명)이 집계되었습니다!
                    </div>
                    <p class="text-[11px] text-red-600 mt-1 leading-relaxed">
                      중복 투표가 포함되었을 수 있습니다. 초과 응답을 제외하거나 그대로 합산할 수 있습니다.
                    </p>
                    <button
                      type="button"
                      onclick="trimExcessVotes()"
                      class="mt-2 px-3 py-1.5 rounded-full bg-red-600 hover:bg-red-700 text-white text-[11px] font-bold transition-colors"
                    >
                      초과 ${votedCount - targetN}건 제외하고 ${targetN}명으로 맞추기
                    </button>
                  </div>
                </div>
              </div>
            `
            : ''
        }

        <div class="p-4 rounded-3xl bg-zinc-900 text-white mb-4 shadow-md">
          <div class="flex items-center justify-between mb-2.5">
            <div id="poll-live-badge" class="inline-flex items-center gap-2 transition-transform">
              <span class="relative flex h-2.5 w-2.5">
                <span class="animate-ping absolute inline-flex h-full w-full rounded-full ${
                  isOverCapacity ? 'bg-red-400' : isComplete ? 'bg-emerald-400' : 'bg-[#ff6b7a]'
                } opacity-75"></span>
                <span class="relative inline-flex rounded-full h-2.5 w-2.5 ${
                  isOverCapacity ? 'bg-red-500' : isComplete ? 'bg-emerald-500' : 'bg-[#bd2333]'
                }"></span>
              </span>
              <span class="text-sm font-extrabold">
                ${isComplete ? '모두 투표 완료!' : '기다리는 중…'} ${votedCount}/${targetN}명이 투표했습니다
              </span>
            </div>
          </div>

          <div class="w-full h-2 bg-white/15 rounded-full overflow-hidden mb-2">
            <div
              class="h-full rounded-full transition-all duration-300 ${
                isOverCapacity ? 'bg-red-500' : isComplete ? 'bg-emerald-400' : 'bg-[#bd2333]'
              }"
              style="width: ${progressPct}%"
            ></div>
          </div>

          <div class="flex items-center justify-between text-[11px] text-white/65">
            <span id="poll-last-sync">실시간 집계 중 (5초마다 자동 새로고침)</span>
            <span class="font-bold text-white">${votedCount} / ${targetN}명</span>
          </div>
        </div>

        <div class="p-3.5 rounded-2xl bg-zinc-50 border border-zinc-200 mb-5">
          <div class="text-[11px] font-bold text-zinc-500 mb-1.5">투표방 초대 링크</div>
          <div class="flex items-center gap-2">
            <div class="flex-1 min-w-0 px-3 py-2 rounded-xl bg-white border border-zinc-200 text-xs font-medium text-zinc-600 truncate select-all">
              ${shareUrl}
            </div>
            <button
              type="button"
              onclick="copyPollShareLink()"
              class="px-3.5 py-2 rounded-xl bg-[#bd2333] hover:bg-[#991b28] text-white text-xs font-bold shrink-0 transition-colors"
            >
              링크 복사
            </button>
          </div>
        </div>

        <div class="p-4 rounded-2xl border border-dashed border-zinc-300 bg-zinc-50/60 mb-5">
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs font-extrabold text-zinc-800">⚡ 일행 투표 시뮬레이터</span>
            ${
              votedCount > 1
                ? `<button type="button" onclick="resetSimulatedVotes()" class="text-[11px] font-semibold text-zinc-400 hover:text-zinc-700 underline">초기화</button>`
                : ''
            }
          </div>
          <p class="text-[11px] text-zinc-500 mb-3">
            버튼을 눌러 일행의 투표를 즉시 시뮬레이션해보세요. (인원 초과 테스트도 가능해요)
          </p>
          <div class="grid grid-cols-1 gap-2">
            <button
              type="button"
              onclick="simulateTeammateVote('${altSub1}', ['동네맛집', '매출 랭킹 1위'])"
              class="w-full py-2.5 px-3.5 rounded-xl bg-white hover:bg-[#fdf2f3] border border-zinc-200 hover:border-[#bd2333] text-xs font-bold text-zinc-800 hover:text-[#bd2333] flex items-center justify-between transition-all"
            >
              <span>+1 일행 투표 (${altSub1} · 동네맛집·랭킹 1위)</span>
              <span class="text-[#bd2333] font-extrabold">+ 투표</span>
            </button>
            <button
              type="button"
              onclick="simulateTeammateVote('${altSub2}', ['외국인과 함께'])"
              class="w-full py-2.5 px-3.5 rounded-xl bg-white hover:bg-[#fdf2f3] border border-zinc-200 hover:border-[#bd2333] text-xs font-bold text-zinc-800 hover:text-[#bd2333] flex items-center justify-between transition-all"
            >
              <span>+1 일행 투표 (${altSub2} · 외국인과 함께)</span>
              <span class="text-[#bd2333] font-extrabold">+ 투표</span>
            </button>
          </div>
        </div>

        <div>
          <div class="text-xs font-bold text-zinc-700 mb-2">참여 현황 (${votedCount}명)</div>
          <div class="space-y-1.5">
            ${state.pollResponses
              .map(
                (resp) => `
                  <div class="px-3.5 py-2.5 rounded-xl bg-zinc-50 border border-zinc-100 flex items-center justify-between text-xs">
                    <span class="font-bold text-zinc-800">${escapeHtml(resp.voter)}</span>
                    <span class="text-zinc-500 font-medium">
                      ${escapeHtml(resp.subCategory)}${resp.preferences.length ? ' · ' + resp.preferences.slice(0, 2).join(', ') : ''}
                    </span>
                  </div>
                `
              )
              .join('')}
          </div>
        </div>
      </div>

      <div class="p-5 pt-3 bg-white border-t border-zinc-100 shrink-0">
        <button
          type="button"
          onclick="goToPage(6)"
          class="w-full py-3.5 rounded-2xl bg-[#bd2333] hover:bg-[#991b28] active:scale-[0.99] text-white text-sm font-bold shadow-lg shadow-[#bd2333]/25 transition-all"
        >
          다수결 가중치 추천 결과 보기 (${votedCount}명 집계)
        </button>
      </div>
    </section>
  `;
}

export function renderPage6(recommendations, nearbySection) {
  const heroPlace = recommendations[0];
  const listPlaces = recommendations.slice(1);
  const availablePrefs = getAvailablePreferences();

  let groupBreakdownHtml = '';
  if (state.decisionMode === 'together' && state.pollResponses.length > 0) {
    const counts = {};
    state.pollResponses.forEach((r) => {
      counts[r.subCategory] = (counts[r.subCategory] || 0) + 1;
    });
    const sortedVotes = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const totalV = state.pollResponses.length;

    groupBreakdownHtml = `
      <div class="mx-4 mt-3 p-3.5 rounded-2xl bg-[#fdf2f3] border border-[#f7d4d8]">
        <div class="flex items-center justify-between mb-2">
          <span class="text-xs font-extrabold text-[#bd2333] flex items-center gap-1">
            <span>🗳️</span> 다같이 투표 집계 (${totalV}/${state.groupSize}명 반영)
          </span>
          <span class="text-[11px] font-semibold text-[#991b28]">다수결 가중치 적용됨</span>
        </div>
        <div class="space-y-1.5">
          ${sortedVotes
            .map(([cat, cnt]) => {
              const pct = Math.round((cnt / totalV) * 100);
              return `
                <div class="flex items-center gap-2 text-[11px]">
                  <span class="w-16 font-bold text-zinc-800 truncate">${escapeHtml(cat)}</span>
                  <div class="flex-1 h-2 bg-white rounded-full overflow-hidden">
                    <div class="h-full bg-[#bd2333] rounded-full" style="width: ${pct}%"></div>
                  </div>
                  <span class="w-14 text-right font-bold text-[#bd2333] tabular-nums">${cnt}표 (${pct}%)</span>
                </div>
              `;
            })
            .join('')}
        </div>
      </div>
    `;
  }

  return `
    <section class="flex-1 flex flex-col h-full bg-[#F8F7F5] overflow-hidden animate-page-in">
      <header class="bg-white border-b border-zinc-200/80 px-4 pt-4 pb-3 shrink-0 z-20">
        <div class="flex items-center justify-between mb-2.5">
          <button
            type="button"
            onclick="goToPage(1)"
            class="inline-flex items-center gap-1.5 text-left group"
            title="처음으로 돌아가기"
          >
            <div class="w-7 h-7 rounded-xl bg-[#bd2333] flex items-center justify-center">
              ${getRiceBowlSvg('w-4 h-4', '#FFFFFF', '#bd2333')}
            </div>
            <span class="text-base font-black text-zinc-900 tracking-tight group-hover:text-[#bd2333] transition-colors">지금어디가</span>
          </button>

          <button
            type="button"
            onclick="toggleFilterDrawer()"
            class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-bold border transition-colors ${
              state.filterExpanded
                ? 'bg-zinc-900 text-white border-zinc-900'
                : 'bg-zinc-100 hover:bg-zinc-200 text-zinc-700 border-zinc-200'
            }"
          >
            <span>조건 조정</span>
            <svg class="w-3.5 h-3.5 transition-transform ${state.filterExpanded ? 'rotate-180' : ''}" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>

        <div class="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
          <button
            type="button"
            onclick="openLocationModal()"
            class="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-[#bd2333] text-white text-xs font-bold shrink-0 shadow-xs"
          >
            <span>📍 ${escapeHtml(state.location)}</span>
            <span class="text-[10px] opacity-80">✎</span>
          </button>

          ${(['밥', '카페', '술'])
            .map((t) => {
              const active = state.storeType === t;
              return `
                <button
                  type="button"
                  onclick="quickSwitchStoreType('${t}')"
                  class="px-3 py-1.5 rounded-full text-xs font-bold shrink-0 border transition-colors ${
                    active
                      ? 'bg-zinc-900 text-white border-zinc-900'
                      : 'bg-white hover:bg-zinc-100 text-zinc-700 border-zinc-200'
                  }"
                >
                  ${STORE_ICONS[t]} ${t}
                </button>
              `;
            })
            .join('')}

          <button
            type="button"
            onclick="toggleFilterDrawer()"
            class="px-3 py-1.5 rounded-full bg-[#fdf2f3] text-[#bd2333] border border-[#f7d4d8] text-xs font-bold shrink-0"
          >
            ${escapeHtml(state.subCategory)} ▾
          </button>
        </div>

        ${
          state.filterExpanded
            ? `
              <div class="mt-3 pt-3 border-t border-zinc-100 space-y-3 animate-page-in">
                <div>
                  <div class="text-[11px] font-bold text-zinc-400 mb-1.5">세부 카테고리 변경</div>
                  <div class="flex flex-wrap gap-1.5">
                    ${(STORE_SUBCATEGORIES[state.storeType] || [])
                      .map((sub) => {
                        const active = state.subCategory === sub;
                        return `
                          <button
                            type="button"
                            onclick="selectSubCategory('${sub}')"
                            class="px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${
                              active
                                ? 'bg-[#bd2333] text-white border-[#bd2333]'
                                : 'bg-zinc-50 hover:bg-zinc-100 text-zinc-700 border-zinc-200'
                            }"
                          >
                            ${sub}
                          </button>
                        `;
                      })
                      .join('')}
                  </div>
                </div>

                <div>
                  <div class="text-[11px] font-bold text-zinc-400 mb-1.5">추가 선호 조건</div>
                  <div class="flex flex-wrap gap-1.5">
                    ${
                      state.storeType === '밥'
                        ? `
                          <button
                            type="button"
                            onclick="toggleVeganOption()"
                            class="px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${
                              state.veganOption
                                ? 'bg-emerald-600 text-white border-emerald-600'
                                : 'bg-zinc-50 text-zinc-700 border-zinc-200'
                            }"
                          >
                            🌿 비건/채식
                          </button>
                        `
                        : ''
                    }
                    ${availablePrefs
                      .map((chip) => {
                        const active = state.preferences.includes(chip.label);
                        return `
                          <button
                            type="button"
                            onclick="togglePreferenceChip('${chip.label}')"
                            class="px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${
                              active
                                ? 'bg-zinc-900 text-white border-zinc-900'
                                : 'bg-zinc-50 hover:bg-zinc-100 text-zinc-700 border-zinc-200'
                            }"
                          >
                            ${chip.icon} ${chip.label}
                          </button>
                        `;
                      })
                      .join('')}
                  </div>
                </div>
              </div>
            `
            : ''
        }
      </header>

      <div class="flex-1 overflow-y-auto pb-8">
        ${groupBreakdownHtml}

        <div class="px-4 pt-4 pb-2 flex items-center justify-between">
          <div class="text-xs font-bold text-zinc-600">
            조건 일치율 50% 이상 <span class="text-[#bd2333] font-extrabold">${recommendations.length}곳</span> 추천
          </div>
          <span class="text-[11px] text-zinc-400 font-medium">결제 데이터 적합도순</span>
        </div>

        ${
          heroPlace
            ? `
              <div class="px-4 mb-4">
                <article class="rounded-3xl bg-white border-2 border-[#bd2333] shadow-lg shadow-[#bd2333]/10 p-5 relative overflow-hidden">
                  <div class="flex items-center justify-between gap-2 mb-3">
                    <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#bd2333] text-white text-xs font-extrabold shadow-xs">
                      <span>🏆</span> #1 오늘의 1순위 추천
                    </span>
                    <div class="flex items-center gap-1.5">
                      <span class="px-2.5 py-1 rounded-full bg-[#fdf2f3] text-[#bd2333] text-xs font-extrabold tabular-nums">
                        ${formatPercentile(heroPlace.percentile)}
                      </span>
                      <span class="px-2.5 py-1 rounded-full bg-zinc-900 text-white text-xs font-bold tabular-nums">
                        일치 ${heroPlace.matchScore}%
                      </span>
                    </div>
                  </div>

                  <div class="mb-2">
                    <div class="flex items-center gap-2 text-xs font-semibold text-zinc-500 mb-1">
                      <span class="text-[#bd2333] font-bold">${heroPlace.subCategory}</span>
                      <span>·</span>
                      <span>도보 ${heroPlace.distanceM}m</span>
                      <span>·</span>
                      <span>${heroPlace.priceRange}</span>
                    </div>
                    <h3 class="text-xl font-black text-zinc-900 tracking-tight">
                      ${escapeHtml(heroPlace.displayName)}
                    </h3>
                  </div>

                  <p class="text-[13px] font-semibold text-zinc-700 mb-2">
                    대표메뉴: ${escapeHtml(heroPlace.signature)}
                  </p>

                  <div class="p-3 rounded-2xl bg-zinc-50 border border-zinc-100 text-xs text-zinc-600 leading-relaxed mb-4">
                    <span class="font-bold text-[#bd2333]">eat.pl 데이터 · </span>${escapeHtml(heroPlace.eatplReason)}
                  </div>

                  <div class="pt-3 border-t border-zinc-100 flex items-center gap-2">
                    <div class="flex flex-wrap gap-1.5 min-w-0">
                      ${heroPlace.displayTags
                        .map(
                          (tag) =>
                            `<span class="px-2.5 py-1 rounded-lg bg-zinc-100 text-zinc-700 text-[11px] font-semibold">${escapeHtml(tag)}</span>`
                        )
                        .join('')}
                    </div>
                    <a
                      href="${heroPlace.merUrl}"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="ml-auto shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-[#bd2333] hover:bg-[#991b28] text-white text-xs font-bold transition-colors"
                    >
                      <span>메뉴·혼잡도 확인</span>
                      <span aria-hidden="true">↗</span>
                    </a>
                  </div>
                </article>
              </div>
            `
            : ''
        }

        <div class="px-4 space-y-3">
          ${listPlaces
            .map((place, index) => {
              const rank = index + 2;
              return `
                <article class="rounded-2xl bg-white border border-zinc-200/90 p-4 shadow-2xs hover:border-zinc-300 transition-colors">
                  <div class="flex items-center justify-between gap-2 mb-1.5">
                    <div class="flex items-center gap-1.5 min-w-0">
                      <span class="w-5 h-5 rounded-md bg-zinc-900 text-white text-[11px] font-extrabold flex items-center justify-center shrink-0">
                        ${rank}
                      </span>
                      <span class="text-xs font-bold text-[#bd2333] shrink-0">${place.subCategory}</span>
                      <span class="text-zinc-300">·</span>
                      <span class="text-xs text-zinc-500 truncate">도보 ${place.distanceM}m · ${place.priceRange}</span>
                    </div>
                    <div class="flex items-center gap-1 shrink-0">
                      <span class="px-2 py-0.5 rounded-md bg-[#fdf2f3] text-[#bd2333] text-[11px] font-extrabold tabular-nums">
                        ${formatPercentile(place.percentile)}
                      </span>
                      <span class="px-2 py-0.5 rounded-md bg-zinc-100 text-zinc-700 text-[11px] font-bold tabular-nums">
                        ${place.matchScore}%
                      </span>
                    </div>
                  </div>

                  <h4 class="text-base font-extrabold text-zinc-900 mb-1">
                    ${escapeHtml(place.displayName)}
                  </h4>
                  <p class="text-xs text-zinc-600 mb-3 truncate">
                    ${escapeHtml(place.signature)} · <span class="text-zinc-500">${escapeHtml(place.crowdStatus)}</span>
                  </p>

                  <div class="pt-2.5 border-t border-zinc-100 flex items-center gap-2">
                    <div class="flex flex-wrap gap-1 min-w-0">
                      ${place.displayTags
                        .map(
                          (tag) =>
                            `<span class="px-2 py-0.5 rounded-md bg-zinc-100 text-zinc-600 text-[11px] font-semibold">${escapeHtml(tag)}</span>`
                        )
                        .join('')}
                    </div>
                    <a
                      href="${place.merUrl}"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="ml-auto shrink-0 inline-flex items-center gap-0.5 px-2.5 py-1.5 rounded-lg bg-[#fdf2f3] hover:bg-[#bd2333] text-[#bd2333] hover:text-white border border-[#f7d4d8] text-[11px] font-bold transition-colors"
                    >
                      <span>메뉴·혼잡도 확인</span>
                      <span aria-hidden="true">↗</span>
                    </a>
                  </div>
                </article>
              `;
            })
            .join('')}
        </div>

        ${
          nearbySection
            ? `
              <div class="mt-7 pt-5 border-t border-zinc-200/80">
                <div class="px-4 mb-3 flex items-center justify-between">
                  <div>
                    <div class="flex items-center gap-1.5">
                      <h3 class="text-base font-extrabold text-zinc-900">
                        ${state.storeType === '밥' ? '식사 후 바로 가기 좋은 근처 카페' : '브런치·커피 전후 들르기 좋은 근처 식당'}
                      </h3>
                    </div>
                    <p class="text-xs text-zinc-500 mt-0.5">
                      반경 <strong class="text-[#bd2333]">${nearbySection.radiusM}m 이내</strong> 자동 탐색 · 추천 ${nearbySection.targetLabel} ${nearbySection.places.length}곳
                    </p>
                  </div>
                  <span class="px-2.5 py-1 rounded-full bg-zinc-900 text-white text-[11px] font-bold shrink-0">
                    반경 ${nearbySection.radiusM}m
                  </span>
                </div>

                <div class="flex gap-3 overflow-x-auto no-scrollbar px-4 pb-2">
                  ${nearbySection.places
                    .map(
                      (np) => `
                        <article class="w-[240px] shrink-0 rounded-2xl bg-white border border-zinc-200 p-3.5 shadow-2xs flex flex-col justify-between">
                          <div>
                            <div class="flex items-center justify-between gap-1 mb-1.5">
                              <span class="px-2 py-0.5 rounded-md bg-zinc-100 text-zinc-700 text-[11px] font-bold">
                                ${np.subCategory} · ${np.distanceM}m
                              </span>
                              <span class="text-[11px] font-extrabold text-[#bd2333] tabular-nums">
                                ${formatPercentile(np.percentile)}
                              </span>
                            </div>
                            <h4 class="text-sm font-extrabold text-zinc-900 truncate mb-1">
                              ${escapeHtml(np.displayName)}
                            </h4>
                            <p class="text-xs text-zinc-500 truncate mb-3">
                              ${escapeHtml(np.signature)}
                            </p>
                          </div>

                          <div class="pt-2.5 border-t border-zinc-100 flex items-center justify-between gap-2">
                            <span class="text-[11px] font-semibold text-zinc-400 truncate">
                              ${escapeHtml(np.displayTags[0] || '동네맛집')}
                            </span>
                            <a
                              href="${np.merUrl}"
                              target="_blank"
                              rel="noopener noreferrer"
                              class="ml-auto shrink-0 inline-flex items-center gap-0.5 px-2.5 py-1 rounded-lg bg-zinc-900 hover:bg-[#bd2333] text-white text-[11px] font-bold transition-colors"
                            >
                              <span>메뉴·혼잡도 확인</span>
                              <span aria-hidden="true">↗</span>
                            </a>
                          </div>
                        </article>
                      `
                    )
                    .join('')}
                </div>
              </div>
            `
            : ''
        }

        <footer class="mt-8 px-4 text-center">
          <div class="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-zinc-200/60 text-[11px] font-semibold text-zinc-500">
            <span class="w-1.5 h-1.5 rounded-full bg-[#bd2333]"></span>
            <span>eat.pl 잇플 · BC카드 결제 데이터 기반</span>
          </div>
        </footer>
      </div>
    </section>
  `;
}
