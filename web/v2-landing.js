function renderPage1() {
  return `
    <div class="home-shell page-enter">
      <header class="home-top">
        <span class="home-brand"><span class="home-brand-mark" aria-hidden="true">●</span> 지금어디가</span>
        <span class="home-source">eat.pl 데이터 기반</span>
      </header>

      <section class="home-intro" aria-labelledby="home-title">
        <div class="home-illustration" aria-hidden="true">
          <svg viewBox="0 0 320 124" role="presentation" focusable="false">
            <path d="M74 64 C104 64 116 32 151 55 M74 64 C108 66 118 91 151 66 M244 64 C217 64 205 37 171 55" fill="none" stroke="#d6cac5" stroke-width="2" stroke-linecap="round" stroke-dasharray="3 7"/>
            <circle cx="67" cy="64" r="22" fill="#f4f0ec" stroke="#dfd6d0"/>
            <circle cx="249" cy="64" r="22" fill="#f4f0ec" stroke="#dfd6d0"/>
            <circle cx="160" cy="60" r="30" fill="#a9283b"/>
            <path d="M148 60c0-7 5-12 12-12s12 5 12 12c0 10-12 20-12 20s-12-10-12-20z" fill="none" stroke="#fff" stroke-width="2.2" stroke-linejoin="round"/>
            <circle cx="160" cy="59" r="4.5" fill="#fff"/>
            <path d="M58 69c0-7 18-7 18 0M67 60a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM240 69c0-7 18-7 18 0M249 60a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" fill="none" stroke="#87756e" stroke-width="1.8" stroke-linecap="round"/>
            <circle cx="112" cy="26" r="4" fill="#b18d85"/>
            <circle cx="214" cy="99" r="4" fill="#b18d85"/>
          </svg>
        </div>
        <p class="home-kicker">우리 모임, 어디서 만날까?</p>
        <h1 id="home-title" class="home-title">취향은 달라도,<br><span>장소는 함께 고르자.</span></h1>
        <p class="home-description">동네를 정하고 각자 원하는 조건을 모으면<br>우리에게 맞는 카페·식당·술집을 추천해요.</p>
      </section>

      <section class="home-search" aria-label="모임 장소 정하기">
        <label for="location-input" class="home-label">어디에서 만날까요?</label>
        <div class="home-input-wrap">
          <svg aria-hidden="true" viewBox="0 0 24 24" class="home-search-icon" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
            <circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>
          </svg>
          <input id="location-input" type="text" autocomplete="off"
            value="${esc(STATE.location)}" placeholder="동네 또는 지하철역"
            oninput="handleLocationInput(this.value)"
            onkeydown="if(event.key==='Enter' && !event.isComposing) submitPage1()"
            class="home-input" />
          <button id="loc-clear-btn" type="button" onclick="clearLocationInput()"
            aria-label="입력 지우기" class="home-input-clear ${STATE.location ? '' : 'hidden'}">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>
          </button>
        </div>
        <div id="region-choices" class="home-region-choices" aria-live="polite"></div>
        <p class="home-quick-label">자주 찾는 지역</p>
        <div class="home-quick-chips" role="group" aria-label="자주 찾는 지역">
          ${QUICK_DISTRICTS.map(d => `
            <button type="button" onclick="selectQuickDistrict('${d}')" aria-pressed="${STATE.location===d}"
              class="home-quick-chip ${STATE.location===d?'is-selected':''}">${d}</button>
          `).join('')}
        </div>
        <button type="button" class="home-start" onclick="submitPage1()">
          이 동네에서 시작하기
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m9 5 7 7-7 7"/></svg>
        </button>
        <p class="home-helper">다음 화면에서 혼자 고를지, 함께 고를지 선택해요.</p>
      </section>

      <footer class="home-footer">별도 로그인 없이 · 링크로 함께 선택</footer>
    </div>
  `;
}
