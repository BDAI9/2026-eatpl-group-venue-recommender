'use strict';

// Actual room and recommendation API behind the team's six-screen design.
const STATE = { currentPage: 1, location: '', decisionMode: 'group', placeType: 'restaurant',
  styles: [], name: '', budget: '', atmospheres: [], signals: [], allergies: [], allergyOther: '',
  options: null, room: null, id: null, me: null, result: null, resultBackPage: 5, error: '', loading: false,
  recRegion: '', recType: '', companion: 'solo', targetSize: 4, customTarget: false,
  appliedCompanion: null, suggestedAtmospheres: [], host: null, confirmReset: false, checking: false, regionChoices: [] };
const QUICK_DISTRICTS = ['강남', '성수', '홍대', '을지로', '여의도', '잠실', '종로', '합정'];
const icons = {
 restaurant: '<svg viewBox="0 0 24 24" class="w-6 h-6 mx-auto" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M4 11h16M6 11v2a6 6 0 0 0 12 0v-2M9 18h6M10 3v5M14 3v5"/></svg>',
 cafe: '<svg viewBox="0 0 24 24" class="w-6 h-6 mx-auto" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M4 8h13v7a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8zM17 9h2a3 3 0 0 1 0 6h-2M7 3v2M12 3v2"/></svg>',
 bar: '<svg viewBox="0 0 24 24" class="w-6 h-6 mx-auto" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="m4 4 8 9 8-9H4zM12 13v7M8 20h8"/></svg>'
};
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $ = id => document.getElementById(id);
// The hosted frontend uses the same live room database on Lightsail.
// Keep this mapping fixed: tokens must never be sent to a user-provided URL.
const API_ORIGIN = location.hostname === 'jj2ya.vercel.app' ? 'https://jj-moim.amazonlightsail.com' : '';
let resultRun = 0;

async function api(path, method='GET', body) {
  let res;
  try {
    res = await fetch(API_ORIGIN + path, {method, headers: body ? {'Content-Type':'application/json'} : {},
      body: body ? JSON.stringify(body) : undefined});
  } catch {
    throw new Error('서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.message || '요청에 실패했어요. 다시 시도해 주세요.');
    error.status = res.status;
    throw error;
  }
  return data;
}
function key() { return `moim:${STATE.id}`; }
function loadMe() { try { return JSON.parse(localStorage.getItem(key()) || 'null'); } catch { return null; } }
function saveMe(value) { try { value ? localStorage.setItem(key(), JSON.stringify(value)) : localStorage.removeItem(key()); } catch { /* optional */ } }
// 방장 토큰: 방을 만든 브라우저에만 저장한다. 방장만 모임을 초기화할 수 있다.
function hostKey() { return `moim-host:${STATE.id}`; }
function loadHost() { try { return localStorage.getItem(hostKey()); } catch { return null; } }
function saveHost(value) { try { value ? localStorage.setItem(hostKey(), value) : localStorage.removeItem(hostKey()); } catch { /* optional */ } }
// 방장이 정한 지역·업종 (예전 방은 없을 수 있음)
function fixedRegion() { return STATE.room?.region || ''; }
function fixedType() { return STATE.room?.place_type || ''; }
function isInvitedBeforeJoin() { return Boolean(STATE.id) && !STATE.me && !STATE.host; }
function showToast(message) { const box=$('toast-container'); box.replaceChildren(); const el=document.createElement('div');
  el.className='bg-gray-900 text-white rounded-2xl px-4 py-3 text-xs shadow-lg'; el.textContent=message; box.append(el);
  setTimeout(()=>el.remove(),3500); }
function handleLocationInput(value) {
  STATE.location=value;
  STATE.regionChoices=[];
  $('region-choices')?.replaceChildren();
  $('loc-clear-btn')?.classList.toggle('hidden',!value);
  document.querySelectorAll('.home-quick-chip').forEach(chip => {
    const selected = chip.textContent.trim() === value;
    chip.classList.toggle('is-selected', selected);
    chip.setAttribute('aria-pressed', String(selected));
  });
}
function clearLocationInput() { handleLocationInput(''); $('location-input').value=''; $('location-input').focus(); }
function selectQuickDistrict(value) { handleLocationInput(value); $('location-input').value=value; }
function chooseRegion(value) { selectQuickDistrict(value); submitPage1(); }
function renderRegionChoices(message) {
  const list=$('region-choices');
  if(!list) return;
  const prompt=document.createElement('p');
  prompt.className='text-xs font-bold text-gray-700';
  prompt.textContent=message;
  list.replaceChildren(prompt);
  for(const candidate of STATE.regionChoices) {
    const button=document.createElement('button');
    button.type='button';
    button.className='mt-2 mr-2 px-3 py-2 rounded-xl border border-gray-200 text-sm font-semibold';
    button.textContent=candidate;
    button.addEventListener('click',()=>chooseRegion(candidate));
    list.append(button);
  }
}
async function submitPage1() { if(STATE.checking) return; STATE.location=STATE.location.trim().replace(/\s+/g,' ');
  if(!STATE.location) return showToast('지역이나 역 이름을 입력해 주세요.');
  if(STATE.location.length>40) return showToast('지역은 40자 이내로 입력해 주세요.');
  const input=STATE.location;
  STATE.checking=true;
  try {
    const res=await api('/api/regions/check','POST',{region:input});
    if(STATE.location!==input) return;
    if(res.candidates?.length) {
      STATE.regionChoices=res.candidates;
      renderRegionChoices(res.message);
      return;
    }
    STATE.location=res.region;
    if(res.warning) showToast(res.warning);
    goToPage(2);
  } catch(err) { if(STATE.location===input) showToast(err.message); }
  finally { STATE.checking=false; }
}
function saveConditionsDraft() {
  if(STATE.currentPage!==4 || !$('conditions-form')) return;
  if($('name')) STATE.name=$('name').value; STATE.budget=$('budget').value;
  STATE.atmospheres=readChecks('atmosphere'); STATE.signals=readChecks('signal');
  STATE.allergies=readChecks('allergy'); STATE.allergyOther=$('allergy-other').value;
}
function isBackLocked() {
 return STATE.currentPage===3 && (isInvitedBeforeJoin() || (Boolean(STATE.id) && isSolo()));
}
function goBack() {
 if (STATE.currentPage===1 || isBackLocked()) return;
 if (STATE.currentPage===6) {
   STATE.loading=false;
   return goToPage(STATE.resultBackPage);
 }
 saveConditionsDraft();
 if (STATE.currentPage===3 && STATE.id) return goToPage(5);
 goToPage(STATE.currentPage-1);
}
function resetToStart() { location.href='/'; }
function goToPage(page) { resultRun++; STATE.currentPage=page; STATE.error=''; renderApp(); window.scrollTo(0,0); }
function typeLabel() { return STATE.options?.place_types?.[STATE.placeType] || ''; }
function setMode(mode) { STATE.decisionMode=mode; STATE.error=''; renderApp(); }
const COMPANIONS = [
  {id:'solo', icon:'1인', title:'1인 · 혼밥', desc:'혼자 편하게 즐기는 한 끼', atmosphere:[]},
  {id:'date', icon:'2인', title:'둘이서 · 데이트', desc:'대화하기 좋고 감성적인 분위기', atmosphere:['대화하기 좋은', '데이트·느낌있는']},
  {id:'friends', icon:'친구', title:'여럿이 · 친구모임', desc:'함께 편하게 이야기하기 좋은 분위기', atmosphere:['대화하기 좋은']},
  {id:'family', icon:'가족', title:'가족 · 단체회식', desc:'다같이 모일 수 있는 단체석 선호', atmosphere:['넓은·단체석']},
];
function setCompanion(id) { if(COMPANIONS.some(item=>item.id===id)) { STATE.companion=id; renderApp(); } }
const CUSTOM_TARGET_MIN=5;
function setTargetSize(value) { STATE.targetSize=value; STATE.customTarget=false; STATE.error=''; renderApp(); }
function setCustomTarget() {
 if(!STATE.customTarget) { STATE.customTarget=true; STATE.targetSize=''; STATE.error=''; renderApp(); }
 $('target-size')?.focus();
}
function nextFromDecision() {
  if(STATE.decisionMode==='group') {
    const raw=STATE.customTarget ? $('target-size')?.value.trim() : String(STATE.targetSize);
    const value=Number(raw);
    const min=STATE.customTarget?CUSTOM_TARGET_MIN:2;
    if(!/^\d+$/.test(raw || '') || !Number.isInteger(value) || value<min || value>30) {
      STATE.error=STATE.customTarget?`직접 입력은 ${CUSTOM_TARGET_MIN}명부터 30명까지예요. 2~4명은 위 버튼으로 골라 주세요.`:'참여 인원을 골라 주세요.'; renderApp(); return;
    }
    STATE.targetSize=value;
  } else if(STATE.appliedCompanion!==STATE.companion) {
    // The scenario only preselects editable preferences. Never claim that a
    // venue actually has seats or amenities the source does not provide.
    STATE.atmospheres=STATE.atmospheres.filter(item=>!STATE.suggestedAtmospheres.includes(item));
    const preferred=COMPANIONS.find(item=>item.id===STATE.companion)?.atmosphere || [];
    STATE.suggestedAtmospheres=preferred.filter(item=>!STATE.atmospheres.includes(item));
    STATE.atmospheres=[...STATE.atmospheres,...STATE.suggestedAtmospheres].slice(0,STATE.options.atmosphere_limit);
    STATE.appliedCompanion=STATE.companion;
  }
  goToPage(3);
}
function setType(type) {
 STATE.placeType=type;
 STATE.styles=[];
 if(type!=='cafe') STATE.atmospheres=STATE.atmospheres.filter(a=>a!==STATE.options.cafe_work_atmosphere);
 renderApp();
}
function clearStyles() {
 const preferences=STATE.options.style_preferences?.[STATE.placeType]||[];
 STATE.styles=STATE.styles.filter(style=>preferences.includes(style));
 renderApp();
}
function toggleStyle(control, redraw=true) {
  const value=control.dataset.value; const idx=STATE.styles.indexOf(value);
  if(idx<0) STATE.styles.push(value); else STATE.styles.splice(idx,1);
  if(redraw) renderApp();
}
function checkbox(label, name, selected, disableUnselected=false) {
 const checked=selected.includes(label);
 return `<label class="inline-flex cursor-pointer"><input class="peer sr-only" type="checkbox" name="${esc(name)}" value="${esc(label)}" ${checked?'checked':disableUnselected?'disabled':''}><span class="px-3 py-2 rounded-xl border border-gray-200 text-xs font-semibold peer-checked:bg-[#a9283b] peer-checked:text-white peer-checked:border-[#a9283b] peer-disabled:cursor-not-allowed peer-disabled:opacity-50 peer-focus-visible:ring-2 peer-focus-visible:ring-[#a9283b]">${esc(label)}</span></label>`;
}
function renderPage2() { return `<div class="flex-1 flex flex-col justify-between p-5 page-enter"><div>
 <div class="inline-flex px-3 py-1 rounded-lg bg-gray-100 text-gray-600 text-xs font-semibold mb-3">📍 ${esc(STATE.location)}</div>
 <h2 class="text-2xl font-bold text-gray-900">누가, 어떻게 고를까요?</h2><p class="text-xs text-gray-500 mt-2">혼자 고르거나 링크를 공유해 함께 선택할 수 있어요.</p>
 <div class="grid grid-cols-2 gap-2 p-1.5 bg-gray-100 rounded-2xl mt-5" role="group" aria-label="결정 방식">${[['solo','혼자 결정','조건 선택 후 바로 추천'],['group','함께 결정','링크 공유 · 함께 선택']].map(([id,title,desc])=>`<button type="button" onclick="setMode('${id}')" aria-pressed="${STATE.decisionMode===id}" class="py-3 rounded-xl text-sm font-bold ${STATE.decisionMode===id?'bg-white text-[#a9283b] shadow-sm':'text-gray-500'}">${title}<span class="block text-xs font-medium mt-1">${desc}</span></button>`).join('')}</div>
 ${STATE.decisionMode==='solo' ? `
 <div class="flex items-center justify-between mt-6 mb-3"><p class="text-sm font-bold text-gray-700">동행 유형</p><span class="text-xs font-semibold text-[#a9283b]">1개 선택</span></div>
 <div class="space-y-2" role="group" aria-label="동행 유형">${COMPANIONS.map(item=>`<button type="button" onclick="setCompanion('${item.id}')" aria-pressed="${STATE.companion===item.id}" class="w-full flex items-center gap-3 p-4 text-left rounded-2xl border-2 ${STATE.companion===item.id?'border-[#a9283b] bg-[#fdf2f3]':'border-gray-100 bg-white'}"><span class="w-11 h-11 flex items-center justify-center rounded-xl bg-gray-50 text-xs font-bold text-gray-600 shrink-0">${item.icon}</span><span class="flex-1"><strong class="block text-sm">${esc(item.title)}</strong><span class="block text-xs text-gray-500 mt-1">${esc(item.desc)}</span></span><span aria-hidden="true" class="text-[#a9283b] font-bold">${STATE.companion===item.id?'●':'○'}</span></button>`).join('')}</div>
 <p class="text-xs text-gray-500 mt-3">선택한 유형에 맞춰 선호 분위기를 미리 골라드려요. 다음 조건 화면에서 자유롭게 바꿀 수 있어요.</p>` : `
 <div class="flex items-center justify-between mt-6 mb-3"><p class="text-sm font-bold text-gray-700">함께 선택할 인원</p><span class="text-xs font-semibold text-[#a9283b]">나를 포함한 인원</span></div>
 <div class="grid grid-cols-2 gap-2" role="group" aria-label="참여 인원">${[[2,'02'],[3,'03'],[4,'04']].map(([count,icon])=>`<button type="button" onclick="setTargetSize(${count})" aria-pressed="${!STATE.customTarget&&STATE.targetSize===count}" class="p-4 min-h-[108px] text-left rounded-2xl border-2 ${!STATE.customTarget&&STATE.targetSize===count?'border-[#a9283b] bg-[#fdf2f3]':'border-gray-100 bg-white'}"><strong class="block text-2xl font-semibold tabular-nums">${count}</strong><span class="block text-xs mt-1 text-gray-500">명</span></button>`).join('')}
 <button type="button" onclick="setCustomTarget()" aria-pressed="${STATE.customTarget}" class="p-4 min-h-[108px] text-left rounded-2xl border-2 ${STATE.customTarget?'border-[#a9283b] bg-[#fdf2f3]':'border-gray-100 bg-white'}"><span class="block text-2xl font-semibold" aria-hidden="true">+</span><strong class="block text-sm mt-2">${CUSTOM_TARGET_MIN}명 이상</strong><span class="block text-xs font-medium text-gray-500 mt-1">직접 입력</span></button></div>
 ${STATE.customTarget?`<label class="block text-xs font-bold text-gray-700 mt-4" for="target-size">참여 인원 (${CUSTOM_TARGET_MIN}~30명)</label><input id="target-size" type="number" inputmode="numeric" min="${CUSTOM_TARGET_MIN}" max="30" step="1" value="${esc(STATE.targetSize)}" class="w-full px-4 py-3 rounded-2xl border border-gray-200 text-sm mt-2" placeholder="예: ${CUSTOM_TARGET_MIN}">`:''}
 <p class="text-xs text-gray-500 mt-3">방장이 정한 인원이 모두 참여하면 정원이 마감돼요. 정원이 차면 모두의 조건으로 추천을 볼 수 있어요.</p>`}
 <p role="status" class="text-xs text-red-700 mt-3">${esc(STATE.error)}</p></div>
 <button type="button" onclick="nextFromDecision()" class="w-full mt-6 py-3.5 rounded-2xl bg-[#a9283b] text-white font-bold text-sm shadow-md">다음 · 업종 및 메뉴 고르기 →</button></div>`; }
const PAGE3_STYLE_LABELS = {
 '디저트-케이크':'디저트·케이크',
 '아이스크림 빙수':'아이스크림·빙수',
 '기타외국식':'기타 외국식',
 '고기-구이':'고기·구이',
 '치킨버거피자':'치킨·버거·피자',
};
function renderStyleButton(style) {
 const selected=STATE.styles.includes(style);
 const label=PAGE3_STYLE_LABELS[style] ?? style;
 return `<button type="button" data-value="${esc(style)}" onclick="toggleStyle(this)" aria-pressed="${selected}" class="px-3.5 py-3 rounded-xl border-2 text-left text-xs font-semibold ${selected?'bg-[#a9283b] text-white border-[#a9283b]':'border-gray-100 text-gray-700'}">${esc(label)} <span class="float-right" aria-hidden="true">${selected?'✓':''}</span></button>`;
}
function renderPage3() { const fixed=fixedType(); if(fixed) STATE.placeType=fixed;
 const types=Object.entries(STATE.options.place_types).filter(([id])=>!fixed || id===fixed);
 const styles=STATE.options.styles[STATE.placeType];
 const preferences=STATE.options.style_preferences?.[STATE.placeType]||[];
 const selected=styles.filter(s=>STATE.styles.includes(s)).length;
 return `<div class="flex-1 flex flex-col justify-between p-5 page-enter"><div><div class="inline-flex px-3 py-1 rounded-lg bg-gray-100 text-xs font-semibold mb-3">📍 ${esc(fixedRegion() || STATE.location || '지역 선택')}</div>
 <h2 class="text-2xl font-bold">어떤 곳에 갈까요?</h2><p class="text-xs text-gray-500 mt-2">${fixed?`방장이 정한 장소예요. 원하는 ${esc(STATE.options.style_label[fixed])}를 골라 주세요.`:'카페·식당·술집과 원하는 종류를 골라 주세요.'}</p>
 <div class="grid ${fixed?'grid-cols-1':'grid-cols-3'} gap-2 mt-5">${types.map(([id,title])=>`<button type="button" ${fixed?'disabled':`onclick="setType('${esc(id)}')"`} class="p-4 rounded-2xl border-2 text-center ${id===STATE.placeType?'border-[#a9283b] bg-[#fdf2f3]':'border-gray-100'}"><span class="block text-gray-600">${icons[id]||''}</span><span class="block text-sm font-bold mt-2">${esc(title)}</span></button>`).join('')}</div>
 <div class="mt-6"><div class="flex items-center justify-between mb-3"><p class="text-xs font-bold text-gray-700">${esc(STATE.options.style_label[STATE.placeType])} · 여러 개 선택 가능</p><span class="text-xs text-[#a9283b]">${selected ? `${selected}개 선택` : '아무거나'}</span></div><div class="grid grid-cols-2 gap-2">${styles.map(renderStyleButton).join('')}<button type="button" onclick="clearStyles()" aria-pressed="${selected===0}" class="px-3.5 py-3 rounded-xl border-2 text-left text-xs font-semibold ${selected===0?'bg-[#a9283b] text-white border-[#a9283b]':'border-gray-100 text-gray-700'}">아무거나 <span class="float-right" aria-hidden="true">${selected===0?'✓':''}</span></button></div></div>
 ${preferences.length?`<div class="mt-2 flex justify-end gap-3" role="group" aria-label="선호 옵션">
   ${preferences.map(style=>`<label class="inline-flex min-h-[30px] cursor-pointer items-center gap-1.5">
     <span class="text-xs font-semibold text-gray-700">${esc(style)}</span>
     <input type="checkbox" role="switch" class="peer sr-only" data-value="${esc(style)}" onchange="toggleStyle(this, false)" ${STATE.styles.includes(style)?'checked':''}>
     <span aria-hidden="true" class="relative h-4 w-8 shrink-0 rounded-full bg-gray-400 transition-colors peer-checked:bg-[#a9283b] peer-focus-visible:ring-2 peer-focus-visible:ring-[#a9283b] peer-focus-visible:ring-offset-2 after:absolute after:left-0.5 after:top-0.5 after:h-3 after:w-3 after:rounded-full after:bg-white after:shadow-sm after:transition-transform after:content-[''] peer-checked:after:translate-x-4"></span>
   </label>`).join('')}
 </div>`:''}</div>
 <button type="button" onclick="goToPage(4)" class="w-full mt-8 py-3.5 rounded-2xl bg-[#a9283b] text-white font-bold text-sm shadow-md">다음 · 조건 선택하기 →</button></div>`; }
function pickSummary(values, empty='선택 안 함') { return values.length ? values.join(', ') : empty; }
function section(id, title, hint, summary, body, open=false) {
 return `<details id="sec-${id}" class="group mt-3 rounded-2xl border border-gray-200 bg-white" ${open?'open':''}><summary class="flex items-center justify-between gap-2 p-4 cursor-pointer list-none"><span><strong class="block text-sm text-gray-900">${title}</strong><span class="block text-xs text-gray-500 mt-0.5">${hint}</span></span><span class="flex items-center gap-2"><span id="sum-${id}" class="text-xs font-bold text-[#a9283b] text-right">${esc(summary)}</span><span class="text-gray-400 group-open:rotate-180 transition" aria-hidden="true">▾</span></span></summary><div class="px-4 pb-4">${body}</div></details>`; }
function atmosphereHint(selected) {
 const {atmosphere_limit:limit, cafe_work_atmosphere:work}=STATE.options;
 return selected.includes(work)
  ? `최대 ${esc(limit)}개 · <strong>${esc(work)}</strong> 옵션은 카페 전용이에요.`
  : `최대 ${esc(limit)}개만 선택해주세요`;
}
function refreshSectionSummaries() { const o=STATE.options; const budget=$('budget');
 const set=(id,v)=>{ const el=$('sum-'+id); if(el) el.textContent=v; };
 set('budget', budget && budget.value ? o.budgets[budget.value] : '선택 안 함');
 const atmospheres=readChecks('atmosphere');
 set('atmosphere', pickSummary(atmospheres)); set('signal', pickSummary(readChecks('signal')));
 for(const input of $('sec-atmosphere').querySelectorAll('input[name="atmosphere"]')) {
   input.disabled=atmospheres.length>=o.atmosphere_limit && !input.checked;
 }
 const hint=$('atmosphere-hint');
 const message=atmosphereHint(atmospheres);
 if(hint.innerHTML!==message) hint.innerHTML=message;
 const allergy=[...readChecks('allergy'), ($('allergy-other')?.value||'').trim()].filter(Boolean); set('allergy', pickSummary(allergy, '없음'));
 if(atmospheres.length<=o.atmosphere_limit && $('form-status').textContent.startsWith('분위기')) $('form-status').textContent='';
}
function isSolo() { return STATE.decisionMode==='solo' && !STATE.room?.target_size; }
function renderPage4() { const o=STATE.options; const solo=isSolo();
 const region=fixedRegion() || STATE.location; const allergy=[...STATE.allergies, STATE.allergyOther].filter(Boolean);
 const placeType=fixedType() || STATE.placeType;
 const atmosphereOptions=o.atmospheres.filter(a=>placeType==='cafe'||a!==o.cafe_work_atmosphere);
 if(STATE.atmospheres.includes(o.legacy_atmosphere)) atmosphereOptions.push(o.legacy_atmosphere);
 const atmospheres=STATE.atmospheres.filter(a=>atmosphereOptions.includes(a));
 const atmosphereLimitReached=atmospheres.length>=o.atmosphere_limit;
 return `<form id="conditions-form" class="flex-1 flex flex-col justify-between p-5 page-enter" oninput="refreshSectionSummaries()" onchange="refreshSectionSummaries()"><div>
 <div class="inline-flex px-3 py-1 rounded-lg bg-gray-100 text-xs font-semibold mb-3">📍 ${esc(region)} · ${esc(typeLabel())}${STATE.styles.length?` · ${esc(STATE.styles.join(', '))}`:''}</div>
 <h2 class="text-2xl font-bold">어떤 곳을 원하세요?</h2><p class="text-xs text-gray-500 mt-2">${solo?'원하는 조건만 눌러서 골라 주세요. 모두 선택 사항이에요.':'이름을 적고, 원하는 조건을 눌러서 골라 주세요. 이름 말고는 모두 선택 사항이에요.'}</p>
 ${solo?'':`<label class="block text-xs font-bold text-gray-700 mt-5 mb-2" for="name">이름 · 필수</label><input id="name" required maxlength="20" value="${esc(STATE.name)}" class="w-full px-4 py-3 rounded-2xl border border-gray-200 text-sm" placeholder="예: 지우">`}
 <div class="mt-4">
 ${section('budget','1인 예산','한 사람이 쓸 수 있는 금액', STATE.budget?o.budgets[STATE.budget]:'선택 안 함', `<select id="budget" class="w-full px-4 py-3 rounded-2xl border border-gray-200 text-sm"><option value="">선택 안 함</option>${Object.entries(o.budgets).map(([v,l])=>`<option value="${esc(v)}" ${String(STATE.budget)===v?'selected':''}>${esc(l)}</option>`).join('')}</select>`, true)}
 ${section('atmosphere','분위기',`<span id="atmosphere-hint" aria-live="polite">${atmosphereHint(atmospheres)}</span>`, pickSummary(atmospheres), `<div class="flex flex-wrap gap-2">${atmosphereOptions.map(a=>checkbox(a,'atmosphere',atmospheres,atmosphereLimitReached)).join('')}</div>`)}
 ${Array.isArray(o.signals) && o.signals.length ? section('signal','맛집 유형','BC카드 결제 데이터로 확인해요', pickSummary(STATE.signals), `<div class="grid grid-cols-1 gap-2">${o.signals.map(a=>`<label class="flex items-center gap-3 p-3 rounded-2xl border border-gray-200 cursor-pointer"><input type="checkbox" name="signal" value="${esc(a)}" ${STATE.signals.includes(a)?'checked':''} class="accent-[#a9283b]"><span class="text-sm font-semibold text-gray-700">${esc(a)}</span></label>`).join('')}</div><p class="mt-2 text-xs text-gray-500">선택하면 해당 결제 데이터를 가진 곳을 우선 추천해요. 필수 조건은 아니에요.</p>`) : ''}
 ${section('allergy','알레르기','위험이 높은 곳은 추천에서 빼요', pickSummary(allergy,'없음'), `<div class="flex flex-wrap gap-2">${o.allergies.map(a=>checkbox(a,'allergy',STATE.allergies)).join('')}</div><input id="allergy-other" maxlength="40" value="${esc(STATE.allergyOther)}" class="w-full px-4 py-3 rounded-2xl border border-gray-200 text-sm mt-3" placeholder="기타 알레르기 직접 입력"><p class="text-xs text-gray-500 mt-3">실제 재료 정보가 없어 알레르기 안전을 보장할 수 없어요. 반드시 매장에 직접 확인하세요.${solo?'':' 방 링크를 아는 사람은 입력 내용을 볼 수 있어요.'}</p>`)}
 </div>
 <p id="form-status" role="status" class="text-xs text-red-700 mt-2">${esc(STATE.error)}</p></div>
 <button type="submit" ${STATE.loading?'disabled':''} class="w-full mt-6 py-3.5 rounded-2xl bg-[#a9283b] text-white font-bold text-sm shadow-md">${STATE.loading?'저장 중…':solo?'추천 보기 →':'조건 저장하기 →'}</button></form>`; }
function choiceGroups(room) {
 const summary=room?.summary||{}; const o=STATE.options; const type=fixedType() || summary.place_type;
 const budgets=Object.entries(summary.budgets||{}).filter(([,n])=>n>0).map(([k,n])=>[o.budgets[k]||k,n]);
 const allergies=Object.entries(summary.allergies||{}).map(([k,names])=>[k,(names||[]).length]);
 const styles=Object.entries((summary.styles||{})[type]||{});
 const preferences=o.style_preferences?.[type]||[];
 return [
   ['styles',o.style_label[type]||'종류',styles.filter(([label])=>!preferences.includes(label))],
   ['preferences','선호 옵션',styles.filter(([label])=>preferences.includes(label))],
   ['budgets','1인 예산',budgets],
   ['atmospheres','분위기',Object.entries(summary.atmospheres||{})],
   ['signals','맛집 유형',Object.entries(summary.signals||{})],
   ['allergies','알레르기',allergies],
 ].map(([id,title,items])=>({id,title,items:items.filter(([,n])=>n>0).sort((a,b)=>b[1]-a[1])}))
  .filter(group=>group.items.length);
}
function renderChoices(room) {
 const total=room?.summary?.count||0;
 if(!total) return '<p class="text-xs text-gray-500">아직 참여한 사람이 없어요.</p>';
 const groups=choiceGroups(room);
 if(!groups.length) return '<p class="text-xs text-gray-500">모두 "아무거나"를 골랐어요.</p>';
 return groups.map(({id,title,items})=>{
   const barColor=id==='allergies'?'bg-amber-500':'bg-[#a9283b]';
   const rows=items.map(([label,n])=>{
     const bar=`<span aria-hidden="true" class="flex-1 h-2.5 rounded-full bg-white overflow-hidden"><span class="block h-full rounded-full ${barColor}" style="width:${Math.round(n/total*100)}%"></span></span>`;
     return `<div class="flex items-center gap-2 mb-1.5"><span class="w-24 shrink-0 text-xs text-gray-700 truncate">${esc(label)}</span>${bar}<span class="w-12 shrink-0 text-right text-xs font-bold text-gray-600 whitespace-nowrap">${n}명</span></div>`;
   }).join('');
   return `<div class="mt-3 first:mt-0"><p class="text-xs font-bold text-gray-500 mb-1.5">${esc(title)}</p>${rows}</div>`;
 }).join('');
}
function rankedChoices(items) {
 const ranks=new Map();
 for(const [label,count] of items) {
   if(!ranks.has(count)) ranks.set(count,[]);
   ranks.get(count).push(label);
 }
 return [...ranks.values()].map(tied=>tied.join(', ')).join(' > ');
}
function renderResultChoices(room) {
 const total=room?.summary?.count||0;
 const groups=choiceGroups(room);
 const signalIndex=groups.findIndex(group=>group.id==='signals');
 if(signalIndex>=0) groups.push(...groups.splice(signalIndex,1));
 const rows=groups.map(({id,title,items})=>{
   let content;
   if(id==='styles'||id==='atmospheres') content=esc(rankedChoices(items));
   else if(id==='signals') content=`<ul class="flex flex-wrap gap-1">${items.map(([label])=>`<li class="rounded-md border border-[#f4dfe1] bg-white px-1.5 py-0.5 text-xs">${esc(label)}</li>`).join('')}</ul>`;
   else if(id==='allergies') content=items.map(([label])=>esc(label)).join(', ');
   else content=items.map(([label,n])=>`${esc(label)} ${n}명`).join(', ');
   return `<div class="contents"><dt class="flex items-baseline justify-between gap-2 whitespace-nowrap font-semibold"><span>${esc(title)}</span><span aria-hidden="true" class="text-gray-400">|</span></dt><dd class="min-w-0 break-words">${content}</dd></div>`;
 }).join('');
 return `<details id="result-choices" class="mt-2"><summary class="py-1 text-xs font-bold text-[#a9283b] cursor-pointer">모두(${total}명)의 선택 확인하기</summary>
 ${rows?`<dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 pt-1 pb-2 text-xs leading-5 text-gray-700">${rows}</dl>`:'<p class="py-1 text-xs text-gray-500">아직 선택한 조건이 없어요.</p>'}</details>`;
}
function renderPage5() { const room=STATE.room; const people=room?.participants || []; const share=location.origin+'/r/'+encodeURIComponent(STATE.id);
 const target=Number.isInteger(room?.target_size) && room.target_size>=2 && room.target_size<=30 ? room.target_size : null;
 const count=people.length; const full=target===null || count>=target; const progress=target===null?null:Math.min(100,Math.round(count/target*100));
 const place=[fixedRegion()||room?.summary?.region, STATE.options.place_types[fixedType()||room?.summary?.place_type]].filter(Boolean).join(' · ');
 return `<div class="flex-1 flex flex-col justify-between p-5 page-enter"><div><div class="p-5 rounded-3xl choice-highlight text-white"><span class="text-xs font-semibold">모임 현황${place?` · 📍 ${esc(place)}`:''}</span><h2 class="text-xl font-bold mt-2">${target!==null&&count>=target?'모두 참여했어요!':target!==null?'참여를 기다리고 있어요':'함께 선택하고 있어요'}</h2><p class="text-sm font-bold mt-2">${count}명 참여</p>${target!==null?`<div class="w-full h-2 bg-black/20 rounded-full mt-3 overflow-hidden" role="progressbar" aria-label="모임 참여 현황" aria-valuemin="0" aria-valuemax="${target}" aria-valuenow="${Math.min(count,target)}"><div class="h-full rounded-full bg-white" style="width:${progress}%"></div></div>`:''}<p class="text-xs mt-3 text-white/85">${full?'모두의 조건으로 추천을 볼 수 있어요.':`${target-count}명이 더 참여하면 추천을 볼 수 있어요. 지금은 모인 결과만 보여요.`}</p></div>
 <div class="mt-4 p-3.5 rounded-2xl bg-gray-50 border border-gray-200"><label for="share-link" class="block text-xs font-bold text-gray-700 mb-2">모임 초대 링크</label><div class="flex gap-2"><input id="share-link" readonly value="${esc(share)}" class="flex-1 min-w-0 px-3 py-2 rounded-xl border border-gray-200 text-xs"><button type="button" onclick="copyLink()" class="px-3 py-2 bg-white border border-gray-300 text-gray-800 rounded-xl text-xs font-bold">복사</button>
 <button type="button" onclick="shareLink()" class="px-3 py-2 rounded-xl bg-[#FEE500] text-[#191919] text-xs font-bold">${STATE.options.kakao_js_key?'카카오톡 공유':'공유하기'}</button></div></div>
 <details id="group-choices" class="mt-5 rounded-2xl bg-[#fdf2f3] border border-[#f4dfe1]"><summary class="p-3.5 cursor-pointer text-sm font-bold">지금까지 모인 조건</summary><div class="px-3.5 pb-3.5">${renderChoices(room)}</div></details>
 <p id="group-status" class="text-xs text-red-700 mt-3">${esc(STATE.error)}</p></div>
 <div class="mt-5 space-y-2">${full?`<button type="button" onclick="openResults()" class="w-full py-3.5 rounded-2xl bg-[#a9283b] text-white font-bold text-sm">모두의 조건으로 추천받기 →</button>`:`<p class="w-full py-3.5 rounded-2xl bg-gray-100 text-gray-500 font-bold text-sm text-center">추천은 ${target}명이 모두 참여하면 열려요</p>`}
 <button type="button" onclick="editMe()" ${target!==null&&count>=target&&!STATE.me?'disabled':''} class="w-full py-3 rounded-2xl border border-gray-200 text-gray-700 font-bold text-xs disabled:opacity-50">${STATE.me?'내 조건 수정':target!==null&&count>=target?'참여 인원이 마감됐어요':'참여하기'}</button>${STATE.me?'<button type="button" onclick="deleteMe()" class="w-full py-2 text-gray-500 text-xs underline">내 응답 삭제</button>':''}
 ${STATE.host?renderResetBox():''}</div></div>`; }
function renderResetBox() { return STATE.confirmReset ? `<dialog id="reset-dialog" oncancel="cancelReset()" aria-labelledby="reset-title" class="w-[90%] max-w-sm p-4 rounded-2xl border-2 border-red-300 bg-red-50 backdrop:bg-black/40"><p id="reset-title" class="text-sm font-bold text-red-800">정말 모임을 초기화할까요?</p><p class="text-xs text-red-800 mt-2">방과 모든 참여자의 응답이 <strong>완전히 사라지고</strong>, 공유한 초대 링크도 더 이상 열리지 않아요. 되돌릴 수 없어요.</p><div class="grid grid-cols-2 gap-2 mt-3"><button type="button" onclick="cancelReset()" autofocus class="py-2.5 rounded-xl border border-gray-300 bg-white text-xs font-bold text-gray-700">취소</button><button type="button" onclick="resetRoom()" class="py-2.5 rounded-xl bg-red-700 text-white text-xs font-bold">초기화하기</button></div></dialog>`
  : `<button type="button" onclick="askReset()" class="w-full py-2 text-red-700 text-xs font-bold">방장 · 모임 초기화</button>`; }
function askReset() { STATE.confirmReset=true; renderApp(); }
function cancelReset() { STATE.confirmReset=false; renderApp(); }
async function resetRoom() { try { await api(`/api/rooms/${encodeURIComponent(STATE.id)}`,'DELETE',{host_token:STATE.host}); saveMe(null); saveHost(null);
  location.href='/'; } catch(err) { STATE.confirmReset=false; STATE.error='초기화하지 못했어요. '+err.message; renderApp(); } }
function rankLabel(value, scope, limit) {
  return Number.isFinite(value) && value>=0 && value<=limit
    ? `${scope} 매출 상위 ${value.toFixed(2)}%` : '';
}
function compactMatchReason(reason) {
  const [match, source, qualification]=reason.split(' · ');
  const budget=reason.match(/(?:^| · )(예산 맞는 사람 \d+명)$/);
  if(budget) return budget[1];
  if(match==='잇플 결제 데이터') return [source, qualification].filter(Boolean).join(' · ');
  if(source?.startsWith('잇플 ')) return qualification==='좌석 정보 미확인'
    ? `${match} · ${qualification}` : match;
  return reason;
}
function timeLabel(value) {
  if(typeof value!=='string' || !/^\d{4}$/.test(value)) return '';
  const hour=Number(value.slice(0,2)), minute=Number(value.slice(2));
  return hour<24 && minute<60 ? `${value.slice(0,2)}:${value.slice(2)}` : '';
}
function renderResultCard(place, index, source) {
  const top=index<3;
  const topColors=index===0?'bg-[#a9283b] text-white':'bg-[#fdf2f3] text-[#a9283b]';
  const real=source!=='sample' && !place.is_sample;
  const national=top&&real?rankLabel(place.sales_rank,'전국',5):'';
  const ranking=top&&real?(national||rankLabel(place.region_sales_rank,'지역',10)):'';

  const signals=real?Object.entries(STATE.options.signal_fields||{}).filter(([,field])=>place[field]===true).map(([label])=>label):[];
  const start=real?timeLabel(place.open):'', end=real?timeLabel(place.close):'';
  const nextDay=start && end && end<start ? ' (다음 날)' : '';
  const link=Boolean(place.eatpl_url);
  const extra=[...(start&&end?[`<p class="text-xs text-gray-700">예상 운영시간 ${start}~${end}${nextDay} <span class="text-xs text-gray-500">(최근 한 달 결제 시각 기준 · 매장에 확인)</span></p>`]:[]),
   ...(signals.length?[`<p class="text-xs text-gray-700">결제 데이터 기준 · ${esc(signals.join(' · '))}</p>`]:[]),
   `<p class="text-xs text-gray-500">${place.estimate?.menu_price?'가격: 잇플 상세 메뉴 조합': '가격: 업종 기준 추정'}</p>`];
  return `<div class="place-card ${index===0?'is-featured':''} p-4 rounded-3xl border border-gray-200 bg-white">
    <div class="flex flex-wrap items-center gap-2">${top?`<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full ${topColors} text-xs font-bold">${index+1}순위 추천</span>`:`<span class="w-7 h-7 rounded-lg bg-gray-900 text-white text-xs font-bold flex items-center justify-center">${index+1}</span>`}
      ${ranking?`<span class="inline-flex items-center whitespace-nowrap rounded-full border border-[#a9283b] px-2.5 py-1 text-xs font-semibold text-gray-700">${esc(ranking)}</span>`:''}</div>
    <div class="flex items-baseline flex-wrap gap-2 mt-3"><strong class="text-base font-bold text-gray-900">${esc(place.name)}</strong><span class="text-xs text-gray-500">${esc(place.business_type||'')}</span></div>
    ${place.address?`<p class="text-xs text-gray-500 mt-2">${esc(place.address)}</p>`:''}
    ${Number.isInteger(place.distance_m)?`<p class="text-xs text-gray-600 mt-1">역에서 직선 약 ${place.distance_m}m</p>`:''}
    ${place.estimate?.dessert_items?.length?`<p class="mt-2 text-xs font-bold text-[#a9283b]">잇플 메뉴 확인 · ${esc(place.estimate.dessert_items.join(', '))}</p>`:''}
    <details id="result-match-${esc(place.id)}" class="mt-3 rounded-xl bg-transparent"><summary class="px-3 pt-4 pb-1 text-xs font-bold text-gray-600 cursor-pointer">일치하는 취향 보기</summary>
      <div class="px-3 pb-3 space-y-1">${(place.reasons||[]).map(reason=>`<p class="text-xs text-gray-700">• ${esc(compactMatchReason(reason))}</p>`).join('') || '<p class="text-xs text-gray-500">고른 조건과 겹치는 정보가 적어, 이 지역에서 많이 찾는 곳으로 추천했어요.</p>'}</div></details>
    <details id="result-extra-${esc(place.id)}" class="rounded-xl bg-transparent"><summary class="px-3 py-2 text-xs font-bold text-gray-600 cursor-pointer">추가 정보</summary><div class="px-3 pb-3 space-y-1">${extra.join('')}</div></details>
    ${place.cautions?.length?`<div class="mt-2 space-y-1">${place.cautions.map(caution=>`<p class="text-xs text-red-700">${esc(caution)}</p>`).join('')}</div>`:''}
    ${link?`<a href="${esc(place.eatpl_url)}" target="_blank" rel="noopener" class="place-link mt-3 block w-full py-3 rounded-2xl text-center text-sm font-bold">메뉴·혼잡도 확인하기 ↗</a>`:`<p class="mt-3 text-center text-xs text-gray-500">${source==='sample'?'가상 가게 · 잇플 링크 없음':'잇플 링크 없음'}</p>`}</div>`;
}
const HOW_WE_RECOMMEND = `<ul class="space-y-1.5 text-xs text-gray-700 list-disc pl-4">
 <li><strong>후보:</strong> 정한 지역의 잇플(BC카드) 가맹점을 최근 1개월 결제 매출 순으로 가져와요.</li>
 <li><strong>제외:</strong> 누구 한 명이라도 가진 알레르기 위험이 높은 곳은 빼요.</li>
 <li><strong>음식 우선순위:</strong> 식당은 더 많은 사람이 선택한 음식 종류를 먼저 보여줘요. 그 종류가 확인된 매장이 없거나 알레르기 위험이 높으면 다음 선택지를 보여줘요.</li>
 <li><strong>세부 점수:</strong> 같은 득표수 안에서는 예산·분위기·맛집 유형이 얼마나 맞는지 비교하고, 점수가 같으면 매출 순위로 정해요.</li>
 <li><strong>근거:</strong> 음식 종류는 잇플 업종과 확인 가능한 상세 정보로 분류해요. 가격은 메뉴 정보나 업종 추정이라 실제와 다를 수 있어요.</li></ul>`;
function humanizeRecommendationWarning(message) {
  if (typeof message !== 'string') return '';
  if (message.includes('OPENROUTER_API_KEY')) {
    return '일부 상세 정보가 없어 업종을 기준으로 추천했어요. 가격과 분위기는 방문 전에 확인해 주세요.';
  }
  return message;
}
function resultStatusText(data) {
 if(STATE.error) return STATE.error;
 if(STATE.loading) return '가게를 찾고 있어요…';
 if(data?.details_pending) return '잇플 상세 메뉴와 후기를 확인하는 중이에요…';
 if(data?.ai_pending) return '메뉴와 후기를 더 확인하고 있어요… 잠시 후 추천이 업데이트돼요.';
 if(data?.status==='ok' || data?.status==='empty')
   return STATE.resultBackPage===4 ? '선택한 조건으로 추천했어요' : '모두가 선택한 조건으로 추천했어요';
 return '';
}
function resultContentKey(data) {
 // Progress flags only change the one status line. They do not justify replacing cards.
 if(!data) return '';
 const {ai_pending, details_pending, ...visible} = data;
 return JSON.stringify(visible);
}
function renderPage6() { const data=STATE.result; const solo=STATE.resultBackPage===4; let body='';
 const region=data?.region || fixedRegion() || STATE.location, type=data?.place_type || fixedType() || STATE.placeType;
 if(data?.status==='ok') body=`<div class="mt-5"><div class="flex items-center justify-between gap-2"><h3 class="min-w-0 break-words text-2xl font-bold text-gray-900">${esc(region)} · ${esc(STATE.options.place_types[type]||'')}</h3><span class="shrink-0 text-xs text-gray-500">${data.source==='sample'?'가상 샘플':'eat.pl 잇플'}</span></div>${data.source!=='sample'?'<p class="text-xs text-gray-500 mt-1">결제 지표: 잇플 · BC카드 최근 1개월 결제 데이터 기반</p>':''}
  <div class="mt-3 space-y-3">${data.results.map((r,i)=>renderResultCard(r,i,data.source)).join('')}</div></div>`;
 else if(data) body=`<p class="mt-5 p-4 rounded-2xl bg-gray-50 text-sm text-gray-600">${esc(data.message||'결과가 없어요. 조건을 바꿔 주세요.')}</p>`;
 const status=esc(resultStatusText(data));
 return `<div class="flex-1 p-5 page-enter"><h2 class="text-2xl font-bold mt-3">어디로 갈까요?</h2><p id="result-status" role="status" class="text-xs text-gray-500 mt-2">${status}</p>
 ${data?.station_radius_m?`<p class="text-xs text-gray-600 mt-2">역 중심에서 직선 반경 ${data.station_radius_m}m</p>`:''}
 ${solo?'':renderResultChoices(STATE.room)}
 ${(data?.warnings||[]).map(w=>`<p class="text-xs text-amber-800 mt-2">${esc(humanizeRecommendationWarning(w))}</p>`).join('')}${body}
 ${data?.excluded?.length?`<details class="mt-4 text-xs"><summary class="font-bold">알레르기 위험 신호로 제외된 곳 (${data.excluded.length})</summary>${data.excluded.map(p=>`<p class="mt-1">${esc(p.name)} · ${esc(p.reason)}</p>`).join('')}</details>`:''}
 <p class="text-xs text-gray-500 mt-5">가격과 이용 조건은 매장에 확인해 주세요. 알레르기가 있다면 실제 재료도 확인해 주세요.</p><button type="button" onclick="goBack()" class="mt-5 text-xs font-bold text-[#a9283b]">← ${solo?'조건 다시 고르기':'참여 현황으로'}</button>
 ${data?.status==='ok'?`<details id="result-how" class="mt-2 rounded-2xl border border-gray-200"><summary class="px-3.5 py-2.5 text-xs font-bold text-gray-700 cursor-pointer">어떻게 추천했나요?</summary><div class="px-3.5 pb-3">${HOW_WE_RECOMMEND}</div></details>`:''}</div>`; }
function renderApp({quiet=false}={}) { const header=$('app-header'); header.classList.toggle('hidden',STATE.currentPage===1);
 const back=$('back-btn');
 if(back) {
   const locked=isBackLocked();
   back.style.visibility=locked?'hidden':'';
   back.disabled=locked;
 }
 $('step-badge').textContent=`${STATE.currentPage} / 6`; $('progress-bar').style.width=`${Math.round(STATE.currentPage/6*100)}%`;
 const renderer={1:renderPage1,2:renderPage2,3:renderPage3,4:renderPage4,5:renderPage5,6:renderPage6}[STATE.currentPage];
 const viewport=$('page-viewport');
 const opened=[...viewport.querySelectorAll('details[id][open]')].map(item=>item.id);
 if($('reset-dialog')?.open && STATE.confirmReset && STATE.currentPage===5) return;
 // Only real room/result changes reach this path. Don't replay the entrance
 // animation, lose the reading position, or collapse open explanations on refresh.
 const scrollY=quiet ? window.scrollY : null;
 const focusedId=quiet && viewport.contains(document.activeElement) ? document.activeElement.id : '';
 viewport.innerHTML=renderer();
 for(const id of opened) { const item=$(id); if(item) item.open=true; }
 if(quiet) {
   viewport.querySelector('.page-enter')?.classList.remove('page-enter');
   if(focusedId) $(focusedId)?.focus({preventScroll:true});
   if(scrollY!==null) window.scrollTo(0, scrollY);
 }
 const modal=$('reset-dialog'); if(modal) modal.showModal();
 const form=$('conditions-form'); if(form) form.addEventListener('submit',submitConditions);
 if(STATE.options?.data_source==='sample') { const p=document.createElement('p'); p.className='p-3 bg-amber-50 text-amber-900 text-xs text-center'; p.textContent='가상 샘플 가게로 시험 중입니다.'; $('page-viewport').prepend(p); }
}
async function refresh() { STATE.room=await api(`/api/rooms/${encodeURIComponent(STATE.id)}`); return STATE.room; }
function readChecks(name) { return [...document.querySelectorAll(`input[name="${name}"]:checked`)].map(e=>e.value); }
async function submitConditions(event) { event.preventDefault(); if(STATE.loading) return;
 const solo=isSolo(); STATE.name=solo?'나':($('name')?.value.trim()||''); STATE.location=fixedRegion()||STATE.location; STATE.budget=$('budget').value;
 STATE.atmospheres=readChecks('atmosphere'); STATE.signals=readChecks('signal'); STATE.allergies=readChecks('allergy'); STATE.allergyOther=$('allergy-other').value.trim();
 if(!STATE.name) { $('form-status').textContent='이름을 입력해 주세요.'; $('name')?.focus(); return; }
 if(!STATE.location) { $('form-status').textContent='지역 정보가 없어요. 처음 화면에서 지역을 다시 골라 주세요.'; return; }
 if(STATE.atmospheres.length>STATE.options.atmosphere_limit) { $('form-status').textContent=`분위기는 최대 ${STATE.options.atmosphere_limit}개까지 선택해 주세요.`; return; }
 const body={name:STATE.name,region:STATE.location,place_type:fixedType()||STATE.placeType,styles:STATE.styles,budget:STATE.budget?Number(STATE.budget):null,atmospheres:STATE.atmospheres,...(Array.isArray(STATE.options.signals)?{signals:STATE.signals}:{}),allergies:STATE.allergies,allergy_other:STATE.allergyOther};
 STATE.loading=true; renderApp(); try {
  if(!STATE.id) { const room=await api('/api/rooms','POST',{title:'우리 모임',region:STATE.location,place_type:STATE.placeType,...(solo?{}:{target_size:Number(STATE.targetSize)})});
   STATE.id=room.id; STATE.host=room.host_token||null; saveHost(STATE.host); history.replaceState(null,'','/r/'+encodeURIComponent(room.id)); }
  if(STATE.me) await api(`/api/rooms/${encodeURIComponent(STATE.id)}/participants/${encodeURIComponent(STATE.me.id)}`,'PUT',{...body,token:STATE.me.token});
  else { STATE.me=await api(`/api/rooms/${encodeURIComponent(STATE.id)}/participants`,'POST',body); saveMe(STATE.me); }
  await refresh(); STATE.loading=false;
  if(solo) showResultsFrom(4);
  else goToPage(5);
 } catch(err) { STATE.loading=false; STATE.error=err.message; renderApp(); }
}
function fillMe(person) { const o=STATE.options; STATE.name=person.name; STATE.location=person.region; STATE.placeType=person.place_type;
 const allowed=[...(o.styles[person.place_type]||[]), ...(o.style_preferences?.[person.place_type]||[])];
 STATE.styles=person.styles.filter(s=>allowed.includes(s)); STATE.budget=person.budget||''; STATE.atmospheres=person.atmospheres.filter(a=>o.atmospheres.includes(a)||a===o.legacy_atmosphere); STATE.signals=[...(person.signals||[])]; STATE.allergies=[...person.allergies]; STATE.allergyOther=person.allergy_other||''; }
function editMe() { if(STATE.me) { const person=STATE.room?.participants.find(p=>p.id===STATE.me.id); if(person) fillMe(person); } goToPage(3); }
async function deleteMe() { if(!STATE.me) return; try { await api(`/api/rooms/${encodeURIComponent(STATE.id)}/participants/${encodeURIComponent(STATE.me.id)}`,'DELETE',{token:STATE.me.token}); saveMe(null); STATE.me=null; await refresh(); STATE.name=''; goToPage(4); showToast('내 응답을 삭제했어요. 다시 참여하려면 조건을 저장해 주세요.'); } catch(err) { STATE.error='삭제하지 못했어요. '+err.message; renderApp(); } }
function prepareKakaoShare() {
 const key=STATE.options?.kakao_js_key;
 if(!key) return;
 const sdk=document.createElement('script');
 sdk.src='https://t1.kakaocdn.net/kakao_js_sdk/2.7.2/kakao.min.js';
 sdk.integrity='sha384-TiCUE00h649CAMonG018J2ujOgDKW/kVWlChEuu4jK2vxfAAD0eZxzCKakxg55G4';
 sdk.crossOrigin='anonymous';
 sdk.addEventListener('load',()=>{ try { if(!window.Kakao.isInitialized()) window.Kakao.init(key); } catch { /* use native share */ } });
 document.head.append(sdk);
}
async function shareLink() { const url=location.origin+'/r/'+encodeURIComponent(STATE.id);
 const text=`📍 ${fixedRegion()||STATE.location} ${STATE.options.place_types[fixedType()]||'모임 장소'}, 같이 골라요! 조건을 체크하면 모두에게 맞는 곳을 추천해 줘요.`;
 if(window.Kakao?.isInitialized()) {
   try {
     await window.Kakao.Share.sendDefault({
       objectType:'text', text, link:{mobileWebUrl:url, webUrl:url}, buttonTitle:'모임 참여하기'
     });
     return;
   } catch { /* use native share or copy */ }
 }
 if(navigator.share) { try { await navigator.share({title:'지금어디가 · 함께 고르는 모임 장소', text, url}); return; } catch(err) { if(err?.name==='AbortError') return; } }
 try { await navigator.clipboard.writeText(`${text}\n${url}`); showToast('초대 문구와 링크를 복사했어요. 카카오톡에 붙여 넣어 주세요.'); } catch { $('share-link').select(); showToast('링크를 선택했어요. 복사해 주세요.'); } }
async function copyLink() { try { await navigator.clipboard.writeText(location.origin+'/r/'+encodeURIComponent(STATE.id)); showToast('초대 링크를 복사했어요.'); } catch { $('share-link').select(); showToast('링크를 선택했어요. 복사해 주세요.'); } }
function openResults() { if(!STATE.room?.summary?.count) return showToast('먼저 조건을 저장해 주세요.');
 const target=STATE.room?.target_size; if(target && STATE.room.summary.count<target) return showToast(`${target}명이 모두 참여하면 추천을 볼 수 있어요.`);
 showResultsFrom(5); }
function showResultsFrom(backPage) {
 STATE.resultBackPage=backPage;
 STATE.currentPage=6;
 getResults();
}
async function getResults(retry=0, run=++resultRun) {
 // First request shows the loading view once; background polls keep the existing cards.
 if(!retry) { STATE.loading=true; STATE.error=''; STATE.result=null; renderApp(); }
 try {
   const data=await api(`/api/rooms/${encodeURIComponent(STATE.id)}/recommend`,'POST',{});
   if(run!==resultRun) return;
   const previous=STATE.result;
   STATE.result=data;
   STATE.loading=false;
   STATE.location=data.region||STATE.location;
   STATE.placeType=data.place_type||STATE.placeType;
   if(!retry || resultContentKey(data)!==resultContentKey(previous)) {
     renderApp({quiet:retry>0});
   } else {
     const status=$('result-status');
     if(status) status.textContent=resultStatusText(data);
   }
   if((data.ai_pending || data.details_pending) && retry<30)
     setTimeout(()=>{ if(STATE.currentPage===6 && run===resultRun) getResults(retry+1,run); },6000);
 } catch(err) {
   if(run!==resultRun) return;
   STATE.loading=false;
   STATE.error=err.message;
   // Poll failures are reported in place; do not wipe successful recommendations.
   if(retry && $('result-status')) $('result-status').textContent=STATE.error;
   else renderApp();
 }
}
function renderRoomLoadError(error) {
  const panel = document.createElement('div');
  panel.className = 'flex-1 flex flex-col items-center justify-center p-8 text-center';
  const message = document.createElement('p');
  message.className = 'text-sm font-bold';
  message.textContent = error.message;
  panel.append(message);
  if (error.status === 404) {
    saveMe(null);
    saveHost(null);
    const link = document.createElement('a');
    link.href = '/';
    link.className = 'mt-6 px-5 py-3 rounded-2xl bg-[#a9283b] text-white text-sm font-bold';
    link.textContent = '새 모임 만들기';
    panel.append(link);
  } else {
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'mt-6 px-5 py-3 rounded-2xl bg-[#a9283b] text-white text-sm font-bold';
    retry.textContent = '다시 시도';
    retry.addEventListener('click', () => location.reload());
    panel.append(retry);
  }
  $('page-viewport').replaceChildren(panel);
}
(async function init(){ try { STATE.options=await api('/api/options'); prepareKakaoShare(); const match=location.pathname.match(/^\/r\/([A-Za-z0-9_-]{4,20})\/?$/);
 if(match) { STATE.id=match[1]; STATE.me=loadMe(); STATE.host=loadHost();
 try { await refresh(); } catch (err) { renderRoomLoadError(err); return; }
 const person=STATE.me&&STATE.room.participants.find(p=>p.id===STATE.me.id);
 if(STATE.room.place_type) STATE.placeType=STATE.room.place_type;
 if(!STATE.room.target_size && STATE.host) STATE.decisionMode='solo';
 if(person) {
   fillMe(person);
   if(isSolo()) showResultsFrom(4);
   else STATE.currentPage=5;
 } else { STATE.me=null; STATE.location=STATE.room.region||STATE.room.summary?.region||''; STATE.currentPage=STATE.host?5:3; }
 } if(STATE.currentPage!==6) renderApp();
 let roomPollInFlight=false;
 setInterval(async()=>{
   if(roomPollInFlight || !STATE.id || STATE.currentPage!==5 || document.hidden) return;
   const id=STATE.id;
   roomPollInFlight=true;
   try {
     const previous=JSON.stringify(STATE.room);
     const next=await api(`/api/rooms/${encodeURIComponent(id)}`);
     if(STATE.id!==id) return;
     STATE.room=next;
     if(STATE.currentPage===5 && JSON.stringify(next)!==previous) renderApp({quiet:true});
   } catch { /* keep the last known participant list; retry on next interval */ }
   finally { roomPollInFlight=false; }
 },5000);
 } catch(err) { $('page-viewport').textContent=err.message; }
})();
