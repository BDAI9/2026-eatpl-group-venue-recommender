function renderPage1() {
  const marqueeRows = [
    { emojis: '🍚 🍜 🍣 🥩 🍲 🍕 🍔 🌮 🥟 🍝 🍛 🍱 🥗 🍢 🍤', dir: 'animate-marquee-left' },
    { emojis: '☕ 🍰 🥐 🍨 🧇 🍩 🧋 🍓 🥞 🧁 🍪 🥧 🍮 🍵 🍫', dir: 'animate-marquee-right' },
    { emojis: '🍺 🥂 🍷 🍸 🥃 🍻 🍶 🍾 🍢 🍗 🧀 🥨 🍤 🥟 🍲', dir: 'animate-marquee-left-slow' },
    { emojis: '🥘 🍖 🍤 🍜 🍣 🍕 🌮 🥗 🍱 🍛 🍚 🥩 🥟 🍝 🍔', dir: 'animate-marquee-right-slow' },
    { emojis: '🧋 ☕ 🍰 🍦 🥐 🍓 🥞 🧇 🍩 🧁 🍮 🍵 🍪 🥧 🍫', dir: 'animate-marquee-left' },
    { emojis: '🍻 🥂 🍸 🍷 🍺 🍗 🍢 🧀 🍤 🥟 🥨 🍾 🍶 🥃 🍲', dir: 'animate-marquee-right' },
    { emojis: '🍱 🍛 🍚 🍜 🍣 🥩 🍲 🍕 🍔 🌮 🥟 🍝 🥗 🍢 🍤', dir: 'animate-marquee-left-slow' }
  ];

  const rowsHtml = marqueeRows.map((row) => `
    <div class="overflow-hidden whitespace-nowrap select-none opacity-25 py-1.5">
      <div class="${row.dir} text-2xl sm:text-3xl tracking-widest">
        <span class="mx-2">${row.emojis}</span>
        <span class="mx-2">${row.emojis}</span>
      </div>
    </div>
  `).join('');

  return `
    <div class="relative flex-1 flex flex-col justify-between min-h-screen lg:min-h-[780px] bg-white overflow-hidden page-enter">
      <!-- 7-Row Animated Food Emoji Marquee Background -->
      <div aria-hidden="true" class="absolute inset-0 flex flex-col justify-between py-4 pointer-events-none z-0">
        ${rowsHtml}
      </div>

      <!-- Soft Radial White Veil for Crisp Legibility -->
      <div aria-hidden="true" class="absolute inset-0 bg-gradient-to-b from-white/75 via-white/92 to-white/95 z-0 pointer-events-none"></div>

      <!-- Top Attribution Pill -->
      <div class="relative z-10 pt-7 px-5 flex items-center justify-between">
        <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#fdf2f3] border border-[#bd2333]/15 text-[#bd2333] text-xs font-bold shadow-xs">
          <span class="w-1.5 h-1.5 rounded-full bg-[#bd2333]"></span>
          함께 고르는 카페 · 식당 · 술집
        </span>
        <span class="text-[11px] font-semibold text-gray-400"> eat.pl · BC카드 기반 서비스</span>
      </div>

      <!-- Centered Brand Hero & Location Search Bar -->
      <div class="relative z-10 px-5 my-auto py-8 flex flex-col items-center text-center">
        <!-- Custom Rice-Bowl Emblem -->
        <div class="w-16 h-16 rounded-3xl bg-[#bd2333] shadow-lg shadow-[#bd2333]/25 flex items-center justify-center mb-4">
          <svg class="w-9 h-9 text-white" viewBox="0 0 24 24" fill="none">
            <path d="M7 5.5C7 4.5 7.8 4 7.8 3M12 5C12 4 12.8 3.5 12.8 2.5M17 5.5C17 4.5 17.8 4 17.8 3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            <path d="M5 12C5 9.2 8.1 7.5 12 7.5C15.9 7.5 19 9.2 19 12" fill="currentColor" fill-opacity="0.25" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            <path d="M3.5 12H20.5C20.5 16.4 16.9 19.5 12 19.5C7.1 19.5 3.5 16.4 3.5 12Z" fill="currentColor"/>
            <path d="M8.5 19.5H15.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
          </svg>
        </div>

        <h1 class="text-3xl sm:text-4xl font-black tracking-tight text-gray-900">
          지금어디가
        </h1>
        <p class="mt-2 text-sm sm:text-base font-medium text-gray-600 leading-relaxed max-w-xs">
          서로 다른 취향을 함께 모아<br />
          <span class="text-[#bd2333] font-bold">우리 모임에 어울리는 장소 찾기</span>
        </p>

        <!-- Search Input Card -->
        <div class="w-full mt-7 bg-white rounded-3xl p-4 shadow-xl shadow-gray-200/70 border border-gray-100 text-left">
          <label for="location-input" class="block text-xs font-bold text-gray-500 mb-2 px-1">
            어느 동네·역 근처에서 찾으시나요?
          </label>

          <div class="relative flex items-center">
            <span class="absolute left-3.5 text-gray-400 pointer-events-none">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
              </svg>
            </span>
            <input
              id="location-input"
              type="text"
              value="${esc(STATE.location)}"
              placeholder="어디에서 먹을까요?"
              oninput="handleLocationInput(this.value)"
              onkeydown="if(event.key==='Enter' && !event.isComposing) submitPage1()"
              class="w-full pl-11 pr-20 py-3.5 rounded-2xl bg-gray-50 border border-gray-200 focus:bg-white focus:border-[#bd2333] focus:ring-2 focus:ring-[#bd2333]/15 text-sm font-semibold text-gray-900 placeholder-gray-400 outline-none transition"
            />

            <!-- Clear input button -->
            <button
              id="loc-clear-btn"
              type="button"
              onclick="clearLocationInput()"
              aria-label="입력 지우기"
              class="${STATE.location ? '' : 'hidden'} absolute right-11 p-1.5 rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-200/70 transition"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>


          </div>

          <div id="region-choices" class="mt-2" aria-live="polite"></div>

          <!-- Quick District Chips -->
          <div class="mt-3">
            <div class="flex items-center justify-between px-1 mb-1.5">
              <span class="text-[11px] font-semibold text-gray-400">인기 상권 빠르게 선택하기</span>

            </div>
            <div class="flex flex-wrap gap-1.5">
              ${QUICK_DISTRICTS.map(d => {
                const active = STATE.location === d;
                return `
                  <button
                    type="button"
                    onclick="selectQuickDistrict('${d}')"
                    class="px-2.5 py-1.5 rounded-xl text-xs font-semibold transition ${
                      active
                        ? 'bg-[#bd2333] text-white shadow-xs'
                        : 'bg-gray-100 hover:bg-gray-200/80 text-gray-700'
                    }"
                  >
                    ${d}
                  </button>
                `;
              }).join('')}
            </div>
          </div>

          <!-- Start CTA -->
          <button
            type="button"
            onclick="submitPage1()"
            class="w-full mt-4 py-3.5 rounded-2xl bg-[#bd2333] hover:bg-[#9e1b29] active:scale-[0.99] text-white font-bold text-sm shadow-md shadow-[#bd2333]/25 transition flex items-center justify-center gap-1.5"
          >
            <span>이 위치로 맛집 찾기</span>
            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.4" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      <!-- Bottom Footer -->
      <div class="relative z-10 pb-5 px-5 text-center">
        <p class="text-[11px] font-medium text-gray-400">
          JJ2YA · 함께 고르는 맛집 - 지금 어디가
        </p>
      </div>
    </div>
  `;
}
