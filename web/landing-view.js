// Landing screen used by the live application.
export const HOTSPOTS = ['을지로', '성수', '강남', '홍대', '종로', '여의도'];

// Page 1 배경: 홀수 줄(1,3,5,7) 좌측 이동, 짝수 줄(2,4,6) 우측 이동
export const EMOJI_ROWS = [
  ['🍚', '🍜', '🍣', '🥩', '🍕', '🍔', '🌮', '🍲', '🥟', '🍤'],
  ['☕', '🥐', '🍰', '🍧', '🧇', '🍵', '🍩', '🧁', '🥞', '🍓'],
  ['🍺', '🍷', '🍸', '🥂', '🥃', '🍶', '🍢', '🍗', '🥘', '🫕'],
  ['🍱', '🍛', '🍝', '🥗', '🥪', '🌯', '🥙', '🧆', '🍜', '🍙'],
  ['🦀', '🦞', '🦪', '🍣', '🍤', '🥟', '🥡', '🥢', '🍲', '🔥'],
  ['🍦', '🍨', '🍮', '🍫', '🍪', '🥧', '🧋', '🍹', '🍋', '🍑'],
  ['🍖', '🥓', '🍳', '🧀', '🥖', '🥨', '🥯', '🌮', '🍕', '🍻'],
];

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
            value=""
            placeholder="어디에서 먹을까요?"
            oninput="toggleStartClearBtn(this.value)"
            onkeydown="if(event.key==='Enter') submitStartSearch()"
            class="flex-1 min-w-0 bg-transparent text-[15px] font-medium text-zinc-900 placeholder-zinc-400 focus:outline-none"
          />
          <button
            id="start-clear-btn"
            type="button"
            onclick="clearStartInput()"
            class="hidden w-6 h-6 rounded-full bg-zinc-200 hover:bg-zinc-300 text-zinc-600 items-center justify-center text-xs font-bold shrink-0"
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

