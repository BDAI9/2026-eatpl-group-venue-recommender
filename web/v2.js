'use strict';

// Actual room and recommendation API behind the team's six-screen design.
const STATE = { currentPage: 1, location: '', decisionMode: 'group', placeType: 'restaurant',
  styles: [], name: '', budget: '', atmospheres: [], signals: [], allergies: [], allergyOther: '',
  options: null, room: null, id: null, me: null, result: null, error: '', loading: false,
  recRegion: '', recType: '', companion: 'solo', targetSize: 4, customTarget: false,
  appliedCompanion: null, suggestedAtmospheres: [] };
const QUICK_DISTRICTS = ['강남', '성수', '홍대', '을지로', '여의도', '잠실', '종로', '합정'];
const icons = {restaurant:'🍚', cafe:'☕', bar:'🍻'};
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
  if (!res.ok) throw new Error(data.message || '요청에 실패했어요. 다시 시도해 주세요.');
  return data;
}
function key() { return `moim:${STATE.id}`; }
function loadMe() { try { return JSON.parse(localStorage.getItem(key()) || 'null'); } catch { return null; } }
function saveMe(value) { try { value ? localStorage.setItem(key(), JSON.stringify(value)) : localStorage.removeItem(key()); } catch { /* optional */ } }
function showToast(message) { const box=$('toast-container'); box.replaceChildren(); const el=document.createElement('div');
  el.className='bg-gray-900 text-white rounded-2xl px-4 py-3 text-xs shadow-lg'; el.textContent=message; box.append(el);
  setTimeout(()=>el.remove(),3500); }
function handleLocationInput(value) { STATE.location=value; const clear=$('loc-clear-btn'); if(clear) clear.classList.toggle('hidden',!value); }
function clearLocationInput() { STATE.location=''; $('location-input').value=''; $('location-input').focus(); $('loc-clear-btn').classList.add('hidden'); }
function selectQuickDistrict(value) { STATE.location=value; $('location-input').value=value; $('loc-clear-btn').classList.remove('hidden'); }
function submitPage1() { STATE.location=STATE.location.trim(); if(!STATE.location) return showToast('지역이나 역 이름을 입력해 주세요.');
  if(STATE.location.length>40) return showToast('지역은 40자 이내로 입력해 주세요.'); goToPage(2); }
function saveConditionsDraft() {
  if(STATE.currentPage!==4 || !$('conditions-form')) return;
  STATE.name=$('name').value; STATE.location=$('region').value; STATE.budget=$('budget').value;
  STATE.atmospheres=readChecks('atmosphere'); STATE.signals=readChecks('signal');
  STATE.allergies=readChecks('allergy'); STATE.allergyOther=$('allergy-other').value;
}
function goBack() { if (STATE.currentPage===1) return; saveConditionsDraft(); if (STATE.currentPage===6 || (STATE.currentPage===3 && STATE.id)) return goToPage(5); goToPage(STATE.currentPage-1); }
function resetToStart() { location.href='/'; }
function goToPage(page) { resultRun++; STATE.currentPage=page; STATE.error=''; renderApp(); window.scrollTo(0,0); }
function typeLabel() { return STATE.options?.place_types?.[STATE.placeType] || ''; }
function setMode(mode) { STATE.decisionMode=mode; STATE.error=''; renderApp(); }
const COMPANIONS = [
  {id:'solo', icon:'🍚', title:'혼밥 / 1인', desc:'혼자 편하게 즐기는 한 끼', atmosphere:[]},
  {id:'date', icon:'💑', title:'둘이서 / 데이트', desc:'대화하기 좋고 감성적인 분위기', atmosphere:['대화하기 좋은', '감성·인테리어']},
  {id:'friends', icon:'🙌', title:'여럿이 / 친구모임', desc:'활기찬 분위기를 선호 조건으로 선택', atmosphere:['활기찬']},
  {id:'family', icon:'👨‍👩‍👧‍👦', title:'가족 / 단체회식', desc:'넓은·단체석을 선호 조건으로 선택', atmosphere:['넓은·단체석']},
];
function setCompanion(id) { if(COMPANIONS.some(item=>item.id===id)) { STATE.companion=id; renderApp(); } }
function setTargetSize(value) { STATE.targetSize=value; STATE.customTarget=false; STATE.error=''; renderApp(); }
function setCustomTarget() { STATE.customTarget=true; STATE.targetSize=''; STATE.error=''; renderApp(); $('target-size')?.focus(); }
function nextFromDecision() {
  if(STATE.decisionMode==='group') {
    const raw=STATE.customTarget ? $('target-size')?.value.trim() : String(STATE.targetSize);
    const value=Number(raw);
    if(!/^\d+$/.test(raw || '') || !Number.isInteger(value) || value<2 || value>30) {
      STATE.error='참여 인원은 방장을 포함해 2명부터 30명까지 선택해 주세요.'; renderApp(); return;
    }
    STATE.targetSize=value;
  } else if(STATE.appliedCompanion!==STATE.companion) {
    // The scenario only preselects editable preferences. Never claim that a
    // venue actually has seats or amenities the source does not provide.
    STATE.atmospheres=STATE.atmospheres.filter(item=>!STATE.suggestedAtmospheres.includes(item));
    const preferred=COMPANIONS.find(item=>item.id===STATE.companion)?.atmosphere || [];
    STATE.suggestedAtmospheres=preferred.filter(item=>!STATE.atmospheres.includes(item));
    STATE.atmospheres=[...STATE.atmospheres,...STATE.suggestedAtmospheres].slice(0,3);
    STATE.appliedCompanion=STATE.companion;
  }
  goToPage(3);
}
function setType(type) { STATE.placeType=type; STATE.styles=[]; renderApp(); }
function clearStyles() { STATE.styles=[]; renderApp(); }
function toggleStyle(button) { const value=button.dataset.value; const idx=STATE.styles.indexOf(value);
  if(idx<0) STATE.styles.push(value); else STATE.styles.splice(idx,1); renderApp(); }
function checkbox(label, name, selected) { return `<label class="inline-flex cursor-pointer"><input class="peer sr-only" type="checkbox" name="${esc(name)}" value="${esc(label)}" ${selected.includes(label)?'checked':''}><span class="px-3 py-2 rounded-xl border border-gray-200 text-xs font-semibold peer-checked:bg-[#bd2333] peer-checked:text-white peer-checked:border-[#bd2333]">${esc(label)}</span></label>`; }
function renderPage2() { return `<div class="flex-1 flex flex-col justify-between p-5 page-enter"><div>
 <div class="inline-flex px-3 py-1 rounded-lg bg-gray-100 text-gray-600 text-xs font-semibold mb-3">📍 ${esc(STATE.location)}</div>
 <h2 class="text-2xl font-extrabold text-gray-900">누가, 어떻게 고를까요?</h2><p class="text-xs text-gray-500 mt-2">혼자 고르거나 링크를 공유해 함께 선택할 수 있어요.</p>
 <div class="grid grid-cols-2 gap-2 p-1.5 bg-gray-100 rounded-2xl mt-5" role="group" aria-label="결정 방식">${[['solo','🙋 나 혼자 결정','조건을 바로 선택'],['group','🗳️ 다같이 선택','링크 공유·참여 현황']].map(([id,title,desc])=>`<button type="button" onclick="setMode('${id}')" aria-pressed="${STATE.decisionMode===id}" class="py-3 rounded-xl text-sm font-extrabold ${STATE.decisionMode===id?'bg-white text-[#bd2333] shadow-sm':'text-gray-500'}">${title}<span class="block text-[10px] font-medium mt-1">${desc}</span></button>`).join('')}</div>
 ${STATE.decisionMode==='solo' ? `
 <div class="flex items-center justify-between mt-6 mb-3"><p class="text-sm font-bold text-gray-700">동행 유형</p><span class="text-xs font-semibold text-[#bd2333]">1개 선택</span></div>
 <div class="space-y-2" role="group" aria-label="동행 유형">${COMPANIONS.map(item=>`<button type="button" onclick="setCompanion('${item.id}')" aria-pressed="${STATE.companion===item.id}" class="w-full flex items-center gap-3 p-4 text-left rounded-2xl border-2 ${STATE.companion===item.id?'border-[#bd2333] bg-[#fdf2f3]':'border-gray-100 bg-white'}"><span class="w-10 h-10 flex items-center justify-center rounded-xl bg-white text-xl">${item.icon}</span><span class="flex-1"><strong class="block text-sm">${esc(item.title)}</strong><span class="block text-xs text-gray-500 mt-1">${esc(item.desc)}</span></span><span aria-hidden="true" class="text-[#bd2333] font-bold">${STATE.companion===item.id?'●':'○'}</span></button>`).join('')}</div>
 <p class="text-[11px] text-gray-500 mt-3">선택한 유형에 맞춰 선호 분위기를 미리 골라드려요. 다음 조건 화면에서 자유롭게 바꿀 수 있어요.</p>` : `
 <div class="flex items-center justify-between mt-6 mb-3"><p class="text-sm font-bold text-gray-700">함께 선택할 인원</p><span class="text-xs font-semibold text-[#bd2333]">나를 포함한 인원</span></div>
 <div class="grid grid-cols-2 gap-2" role="group" aria-label="참여 인원">${[[2,'✌️'],[3,'🤟'],[4,'🍀']].map(([count,icon])=>`<button type="button" onclick="setTargetSize(${count})" aria-pressed="${!STATE.customTarget&&STATE.targetSize===count}" class="p-4 min-h-[108px] text-left rounded-2xl border-2 ${!STATE.customTarget&&STATE.targetSize===count?'border-[#bd2333] bg-[#fdf2f3]':'border-gray-100 bg-white'}"><span class="block text-xl">${icon}</span><strong class="block text-sm mt-2">${count}명</strong></button>`).join('')}
 <button type="button" onclick="setCustomTarget()" aria-pressed="${STATE.customTarget}" class="p-4 min-h-[108px] text-left rounded-2xl border-2 ${STATE.customTarget?'border-[#bd2333] bg-[#fdf2f3]':'border-gray-100 bg-white'}"><span class="block text-xl">✍️</span><strong class="block text-sm mt-2">5명 이상 직접 입력</strong></button></div>
 ${STATE.customTarget?`<label class="block text-xs font-bold text-gray-700 mt-4" for="target-size">참여 인원 (2~30명)</label><input id="target-size" type="number" inputmode="numeric" min="2" max="30" step="1" value="${esc(STATE.targetSize)}" class="w-full px-4 py-3 rounded-2xl border border-gray-200 text-sm mt-2" placeholder="예: 6">`:''}
 <p class="text-[11px] text-gray-500 mt-3">방장이 정한 인원이 모두 참여하면 정원이 마감돼요. 기다리는 중에도 현재 참여자 기준으로 추천받을 수 있어요.</p>`}
 <p role="status" class="text-xs text-red-700 mt-3">${esc(STATE.error)}</p></div>
 <button type="button" onclick="nextFromDecision()" class="w-full mt-6 py-3.5 rounded-2xl bg-[#bd2333] text-white font-bold text-sm shadow-md">다음 · 업종 및 메뉴 고르기 →</button></div>`; }
function renderPage3() { const types=Object.entries(STATE.options.place_types);
 return `<div class="flex-1 flex flex-col justify-between p-5 page-enter"><div><div class="inline-flex px-3 py-1 rounded-lg bg-gray-100 text-xs font-semibold mb-3">📍 ${esc(STATE.location || '지역 선택')}</div>
 <h2 class="text-2xl font-extrabold">어떤 곳에 갈까요?</h2><p class="text-xs text-gray-500 mt-2">카페·식당·술집과 원하는 종류를 골라 주세요.</p>
 <div class="grid grid-cols-3 gap-2 mt-5">${types.map(([id,title])=>`<button type="button" onclick="setType('${esc(id)}')" class="p-4 rounded-2xl border-2 text-center ${id===STATE.placeType?'border-[#bd2333] bg-[#fdf2f3]':'border-gray-100'}"><span class="block text-2xl">${icons[id]||'🍽️'}</span><span class="block text-sm font-bold mt-2">${esc(title)}</span></button>`).join('')}</div>
 <div class="mt-6"><div class="flex items-center justify-between mb-3"><p class="text-xs font-bold text-gray-700">${esc(STATE.options.style_label[STATE.placeType])} · 여러 개 선택 가능</p><span class="text-[11px] text-[#bd2333]">${STATE.styles.length ? `${STATE.styles.length}개 선택` : '아무거나'}</span></div><div class="grid grid-cols-2 gap-2">${STATE.options.styles[STATE.placeType].map(s=>`<button type="button" data-value="${esc(s)}" onclick="toggleStyle(this)" aria-pressed="${STATE.styles.includes(s)}" class="px-3.5 py-3 rounded-xl border-2 text-left text-xs font-semibold ${STATE.styles.includes(s)?'bg-[#bd2333] text-white border-[#bd2333]':'border-gray-100 text-gray-700'}">${esc(s)} <span class="float-right" aria-hidden="true">${STATE.styles.includes(s)?'✓':'선택'}</span></button>`).join('')}<button type="button" onclick="clearStyles()" aria-pressed="${STATE.styles.length===0}" class="px-3.5 py-3 rounded-xl border-2 text-left text-xs font-semibold ${STATE.styles.length===0?'bg-[#bd2333] text-white border-[#bd2333]':'border-gray-100 text-gray-700'}">아무거나 <span class="float-right" aria-hidden="true">${STATE.styles.length===0?'✓':''}</span></button></div></div></div>
 <button type="button" onclick="goToPage(4)" class="w-full mt-8 py-3.5 rounded-2xl bg-[#bd2333] text-white font-bold text-sm shadow-md">다음 · 조건 선택하기 →</button></div>`; }
function renderPage4() { const o=STATE.options; return `<form id="conditions-form" class="flex-1 flex flex-col justify-between p-5 page-enter"><div>
 <div class="inline-flex px-3 py-1 rounded-lg bg-gray-100 text-xs font-semibold mb-3">📍 ${esc(STATE.location)} · ${esc(typeLabel())}</div>
 <h2 class="text-2xl font-extrabold">어떤 곳을 원하세요?</h2><p class="text-xs text-gray-500 mt-2">함께 고를 이름과 선호를 입력해 주세요.</p>
 <label class="block text-xs font-bold text-gray-700 mt-5 mb-2" for="name">이름</label><input id="name" required maxlength="20" value="${esc(STATE.name)}" class="w-full px-4 py-3 rounded-2xl border border-gray-200 text-sm" placeholder="예: 지우">
 <label class="block text-xs font-bold text-gray-700 mt-5 mb-2" for="region">지역</label><input id="region" required maxlength="40" value="${esc(STATE.location)}" class="w-full px-4 py-3 rounded-2xl border border-gray-200 text-sm" placeholder="지역 또는 역 이름">
 <label class="block text-xs font-bold text-gray-700 mt-5 mb-2" for="budget">1인 예산 · 선택</label><select id="budget" class="w-full px-4 py-3 rounded-2xl border border-gray-200 text-sm"><option value="">선택 안 함</option>${Object.entries(o.budgets).map(([v,l])=>`<option value="${esc(v)}" ${String(STATE.budget)===v?'selected':''}>${esc(l)}</option>`).join('')}</select>
 <fieldset class="mt-5"><legend class="text-xs font-bold text-gray-700 mb-2">분위기 · 최대 3개</legend><div class="flex flex-wrap gap-2">${o.atmospheres.map(a=>checkbox(a,'atmosphere',STATE.atmospheres)).join('')}</div><p class="text-[11px] text-gray-500 mt-2">분위기는 가게 이름과 업종에 기반한 추정일 수 있어요.</p></fieldset>
 ${Array.isArray(o.signals) && o.signals.length ? `<fieldset class="mt-5"><legend class="text-xs font-bold text-gray-700 mb-2">중요하게 보는 결제 방문 특성 · 선택</legend><p class="text-[11px] text-gray-500 mb-3">선택하면 해당 결제 데이터를 가진 곳을 우선 추천해요. 필수 조건은 아니에요.</p><div class="grid grid-cols-1 gap-2">${o.signals.map(a=>`<label class="flex items-center gap-3 p-3 rounded-2xl border border-gray-200 cursor-pointer"><input type="checkbox" name="signal" value="${esc(a)}" ${STATE.signals.includes(a)?'checked':''} class="accent-[#bd2333]"><span class="text-sm font-semibold text-gray-700">${esc(a)}</span></label>`).join('')}</div></fieldset>` : ''}
 <fieldset class="mt-5"><legend class="text-xs font-bold text-gray-700 mb-2">알레르기 · 선택</legend><div class="flex flex-wrap gap-2">${o.allergies.map(a=>checkbox(a,'allergy',STATE.allergies)).join('')}</div><input id="allergy-other" maxlength="40" value="${esc(STATE.allergyOther)}" class="w-full px-4 py-3 rounded-2xl border border-gray-200 text-sm mt-3" placeholder="기타 알레르기 직접 입력"></fieldset>
 <p class="text-[11px] text-gray-500 mt-4">실제 재료 정보가 없어 알레르기 안전을 보장할 수 없어요. 반드시 매장에 직접 확인하세요. 방 링크를 아는 사람은 입력 내용을 볼 수 있어요.</p>
 <p id="form-status" role="status" class="text-xs text-red-700 mt-2">${esc(STATE.error)}</p></div>
 <button type="submit" ${STATE.loading?'disabled':''} class="w-full mt-6 py-3.5 rounded-2xl bg-[#bd2333] text-white font-bold text-sm shadow-md">${STATE.loading?'저장 중…':'조건 저장하기 →'}</button></form>`; }
function summaryPills(room) {
 const summary=room?.summary||{};
 const entries=[...Object.entries(summary.regions||{}),...Object.entries(summary.place_types||{}).map(([k,n])=>[STATE.options.place_types[k]||k,n]),
  ...Object.values(summary.styles||{}).flatMap(value=>Object.entries(value||{})),...Object.entries(summary.atmospheres||{}),...Object.entries(summary.signals||{})];
 const valid=entries.filter(([,count])=>Number.isInteger(count)&&count>0);
 return valid.length ? valid.map(([label,count])=>`<span class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-white border border-[#f4dfe1] text-xs font-semibold text-gray-700">${esc(label)} <strong class="text-[#bd2333]">${count}명</strong></span>`).join('') : '<span class="text-xs text-gray-500">아직 선택한 조건이 없어요.</span>';
}
function renderPage5() { const room=STATE.room; const people=room?.participants || []; const share=location.origin+'/r/'+encodeURIComponent(STATE.id);
 const target=Number.isInteger(room?.target_size) && room.target_size>=2 && room.target_size<=30 ? room.target_size : null;
 const count=people.length; const full=target!==null && count>=target; const progress=target===null?null:Math.min(100,Math.round(count/target*100));
 return `<div class="flex-1 flex flex-col justify-between p-5 page-enter"><div><div class="p-5 rounded-3xl bg-gradient-to-br from-[#bd2333] to-[#981926] text-white shadow-lg"><span class="text-xs font-semibold">모임 현황 · 5초마다 갱신</span><h2 class="text-xl font-extrabold mt-2">${full?'모두 참여했어요!':target!==null?'참여를 기다리고 있어요':'함께 선택하고 있어요'}</h2><p class="text-sm font-bold mt-2">${count}${target!==null?` / ${target}`:''}명 참여</p>${target!==null?`<div class="w-full h-2 bg-black/20 rounded-full mt-3 overflow-hidden" role="progressbar" aria-label="모임 참여 현황" aria-valuemin="0" aria-valuemax="${target}" aria-valuenow="${Math.min(count,target)}"><div class="h-full rounded-full bg-white" style="width:${progress}%"></div></div>`:''}<p class="text-xs mt-3 text-white/85">${target!==null?(full?'지금까지 모인 조건으로 추천받을 수 있어요.':'기다리는 중에도 현재 참여자의 조건으로 추천받을 수 있어요.'):'현재 참여한 분들의 조건으로 추천받을 수 있어요.'}</p></div>
 <div class="mt-4 p-3.5 rounded-2xl bg-gray-50 border border-gray-200"><label for="share-link" class="block text-xs font-bold text-gray-700 mb-2">모임 초대 링크</label><div class="flex gap-2"><input id="share-link" readonly value="${esc(share)}" class="flex-1 min-w-0 px-3 py-2 rounded-xl border border-gray-200 text-xs"><button type="button" onclick="copyLink()" class="px-4 py-2 bg-gray-900 text-white rounded-xl text-xs font-bold">링크 복사</button></div></div>
 <h3 class="text-sm font-extrabold mt-5">지금까지 모인 조건</h3><div class="mt-3 p-3.5 rounded-2xl bg-[#fdf2f3] border border-[#f4dfe1] flex flex-wrap gap-2">${summaryPills(room)}</div>
 <h3 class="text-sm font-extrabold mt-5">참여 현황</h3><p class="text-[11px] text-gray-500 mt-1">링크를 아는 사람은 참여자의 조건을 볼 수 있어요.</p><ul class="mt-3 space-y-2">${people.map(p=>`<li class="p-3 rounded-2xl border border-gray-100 text-sm"><strong>${esc(p.name)}</strong><span class="text-xs text-gray-500 ml-2">${esc(p.region)} · ${esc(STATE.options.place_types[p.place_type]||'')}</span>${(p.styles||[]).length?`<p class="text-xs text-gray-600 mt-1">${esc(p.styles.join(' · '))}</p>`:''}${(p.allergies?.length||p.allergy_other)?`<p class="text-xs text-red-700 mt-1">알레르기: ${esc([...(p.allergies||[]),p.allergy_other].filter(Boolean).join(', '))}</p>`:''}</li>`).join('') || '<li class="text-xs text-gray-500">아직 참여자가 없어요.</li>'}</ul>
 <p id="group-status" class="text-xs text-red-700 mt-3">${esc(STATE.error)}</p></div>
 <div class="mt-5 space-y-2"><button type="button" onclick="openResults()" class="w-full py-3.5 rounded-2xl bg-[#bd2333] text-white font-bold text-sm">${full?'모두의 조건으로 추천받기':'현재 조건으로 추천받기'} →</button><button type="button" onclick="editMe()" ${full&&!STATE.me?'disabled':''} class="w-full py-3 rounded-2xl border border-gray-200 text-gray-700 font-bold text-xs disabled:opacity-50">${STATE.me?'내 조건 수정':full?'참여 인원이 마감됐어요':'참여하기'}</button>${STATE.me?'<button type="button" onclick="deleteMe()" class="w-full py-2 text-gray-500 text-xs underline">내 응답 삭제</button>':''}</div></div>`; }
function rankLabel(value, scope) {
  return typeof value==='number' && Number.isFinite(value) && value>=0 && value<=100
    ? `${scope} 결제 매출 상위 ${value}%` : '';
}
function timeLabel(value) {
  if(typeof value!=='string' || !/^\d{4}$/.test(value)) return '';
  const hour=Number(value.slice(0,2)), minute=Number(value.slice(2));
  return hour<24 && minute<60 ? `${value.slice(0,2)}:${value.slice(2)}` : '';
}
function renderResultCard(place, index, source) {
  const real=source!=='sample' && !place.is_sample;
  const ranking=real?[rankLabel(place.sales_rank,'전국'),rankLabel(place.region_sales_rank,'지역')].filter(Boolean):[];
  const signals=real?[[place.local_customer,'동네 주민 방문'],[place.foreign_customer,'외국인 방문'],[place.group_customer,'직장인 방문']].filter(([value])=>value===true).map(([,label])=>label):[];
  const start=real?timeLabel(place.open):'', end=real?timeLabel(place.close):'';
  const nextDay=start && end && end<start ? ' (다음 날)' : '';
  const link=Boolean(place.eatpl_url), first=index===0;
  return `<${link?'a':'div'} ${link?`href="${esc(place.eatpl_url)}" target="_blank" rel="noopener"`:''} class="block p-4 rounded-3xl border-2 ${first?'border-[#bd2333]':'border-gray-100'} shadow-sm bg-white">
    <div class="flex flex-wrap items-center gap-2">${first?'<span class="px-2.5 py-1 rounded-full bg-[#bd2333] text-white text-[11px] font-bold">#1 오늘의 추천</span>':`<span class="w-7 h-7 rounded-lg bg-gray-900 text-white text-xs font-bold flex items-center justify-center">${index+1}</span>`}${ranking.map(label=>`<span class="px-2.5 py-1 rounded-full bg-[#fdf2f3] text-[#bd2333] text-[11px] font-bold">${esc(label)}</span>`).join('')}</div>
    <div class="flex items-baseline flex-wrap gap-2 mt-3"><strong class="text-base font-extrabold text-gray-900">${esc(place.name)}</strong><span class="text-xs text-gray-500">${esc(place.business_type||'')}</span></div>
    ${place.address?`<p class="text-xs text-gray-500 mt-2">${esc(place.address)}</p>`:''}
    ${start&&end?`<p class="text-xs text-gray-700 mt-2">결제 시각 기반 예상 운영시간 ${start}~${end}${nextDay}</p><p class="text-[11px] text-gray-500 mt-1">최근 한 달 결제 승인 시각으로 추정했어요. 실제 영업시간은 매장에 확인해 주세요.</p>`:''}
    <div class="mt-3 space-y-1">${(place.reasons||[]).map(reason=>`<p class="text-xs text-gray-700">• ${esc(reason)}</p>`).join('') || '<p class="text-xs text-gray-500">일치하는 선호 정보가 적어요.</p>'}${(place.cautions||[]).map(caution=>`<p class="text-xs text-red-700">${esc(caution)}</p>`).join('')}</div>
    ${signals.length?`<div class="mt-3 flex flex-wrap gap-1.5">${signals.map(label=>`<span class="px-2 py-1 rounded-lg bg-gray-100 text-[11px] text-gray-600">${esc(label)}</span>`).join('')}</div>`:''}
    <div class="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between gap-2"><p class="text-[11px] text-gray-500">${place.estimate?.source==='ai'?'AI 가격·분위기 추정 포함':'업종 정보 기준'}</p><span class="text-xs text-[#bd2333] font-bold">${link?'잇플에서 보기 ↗':source==='sample'?'가상 가게 · 잇플 링크 없음':'잇플 링크 없음'}</span></div></${link?'a':'div'}>`;
}
function renderPage6() { const data=STATE.result; let body='';
 const regions=[...new Set([...Object.keys(STATE.room?.summary?.regions || {}), ...(STATE.options?.regions || []), STATE.recRegion].filter(Boolean))];
 const selectedRegion=STATE.recRegion || data?.region || STATE.room?.summary?.region || '';
 const selectedType=STATE.recType || data?.place_type || STATE.room?.summary?.place_type || '';
 if(data?.status==='ok') body=`<div class="mt-5"><div class="flex items-center justify-between gap-2"><h3 class="font-extrabold text-gray-900">함께 고른 추천 ${data.results.length}곳</h3><span class="text-[11px] text-gray-500">${data.source==='sample'?'가상 샘플':'eat.pl 잇플'}</span></div>${data.source!=='sample'?'<p class="text-[11px] text-gray-500 mt-1">결제 지표: 잇플 · BC카드 최근 1개월 결제 데이터 기반</p>':''}<div class="mt-3 space-y-3">${data.results.map((r,i)=>renderResultCard(r,i,data.source)).join('')}</div></div>`;
 else if(data) body=`<p class="mt-5 p-4 rounded-2xl bg-gray-50 text-sm text-gray-600">${esc(data.message||'결과가 없어요. 지역이나 조건을 바꿔 주세요.')}</p>`;
 return `<div class="flex-1 p-5 page-enter"><div class="inline-flex px-3 py-1 rounded-lg bg-[#fdf2f3] text-[#bd2333] text-xs font-bold">함께 고른 추천</div><h2 class="text-2xl font-extrabold mt-3">어디로 갈까요?</h2><p class="text-xs text-gray-500 mt-2">${STATE.room?.summary?.count||0}명의 선택을 반영했어요.</p>
 <div class="grid grid-cols-2 gap-2 mt-4"><label class="text-xs text-gray-600">지역<select id="rec-region" onchange="changeResultFilters()" class="block w-full rounded-xl border border-gray-200 p-2 mt-1">${regions.map(r=>`<option value="${esc(r)}" ${r===selectedRegion?'selected':''}>${esc(r)}</option>`).join('')}</select></label><label class="text-xs text-gray-600">장소<select id="rec-type" onchange="changeResultFilters()" class="block w-full rounded-xl border border-gray-200 p-2 mt-1">${Object.entries(STATE.options.place_types).map(([v,l])=>`<option value="${esc(v)}" ${v===selectedType?'selected':''}>${esc(l)}</option>`).join('')}</select></label></div>
 <div class="mt-4 p-3.5 rounded-2xl border border-[#f4dfe1] bg-[#fdf2f3]"><p class="text-xs font-bold text-[#bd2333] mb-2">모두의 선택</p><div class="flex flex-wrap gap-2">${summaryPills(STATE.room)}</div></div>
 <p id="result-status" role="status" class="text-xs text-gray-600 mt-4">${STATE.loading?'가게를 찾고 있어요…':data?.ai_pending?'AI가 가격과 분위기를 추정하고 있어요. 잠시 후 자동 반영됩니다.':esc(STATE.error)}</p>${(data?.warnings||[]).map(w=>`<p class="text-xs text-amber-800 mt-2">${esc(w)}</p>`).join('')}${body}
 ${data?.excluded?.length?`<details class="mt-4 text-xs"><summary class="font-bold">알레르기 위험 신호로 제외된 곳 (${data.excluded.length})</summary>${data.excluded.map(p=>`<p class="mt-1">${esc(p.name)} · ${esc(p.reason)}</p>`).join('')}</details>`:''}
 <p class="text-[11px] text-gray-500 mt-5">가격·분위기는 추정값입니다. 실제 재료는 반드시 매장에 확인해 주세요.</p><button type="button" onclick="goToPage(5)" class="mt-5 text-xs font-bold text-[#bd2333]">← 참여 현황으로</button></div>`; }
function renderApp() { const header=$('app-header'); header.classList.toggle('hidden',STATE.currentPage===1);
 $('step-badge').textContent=`${STATE.currentPage} / 6`; $('progress-bar').style.width=`${Math.round(STATE.currentPage/6*100)}%`;
 const renderer={1:renderPage1,2:renderPage2,3:renderPage3,4:renderPage4,5:renderPage5,6:renderPage6}[STATE.currentPage];
 $('page-viewport').innerHTML=renderer(); const form=$('conditions-form'); if(form) form.addEventListener('submit',submitConditions);
 if(STATE.options?.data_source==='sample') { const p=document.createElement('p'); p.className='p-3 bg-amber-50 text-amber-900 text-xs text-center'; p.textContent='가상 샘플 가게로 시험 중입니다.'; $('page-viewport').prepend(p); }
}
async function refresh() { STATE.room=await api(`/api/rooms/${encodeURIComponent(STATE.id)}`); return STATE.room; }
function readChecks(name) { return [...document.querySelectorAll(`input[name="${name}"]:checked`)].map(e=>e.value); }
async function submitConditions(event) { event.preventDefault(); if(STATE.loading) return;
 STATE.name=$('name').value.trim(); STATE.location=$('region').value.trim(); STATE.budget=$('budget').value;
 STATE.atmospheres=readChecks('atmosphere'); STATE.signals=readChecks('signal'); STATE.allergies=readChecks('allergy'); STATE.allergyOther=$('allergy-other').value.trim();
 if(!STATE.name || !STATE.location) { $('form-status').textContent='이름과 지역을 입력해 주세요.'; return; }
 if(STATE.atmospheres.length>3) { $('form-status').textContent='분위기는 최대 3개까지 선택해 주세요.'; return; }
 const body={name:STATE.name,region:STATE.location,place_type:STATE.placeType,styles:STATE.styles,budget:STATE.budget?Number(STATE.budget):null,atmospheres:STATE.atmospheres,...(Array.isArray(STATE.options.signals)?{signals:STATE.signals}:{}),allergies:STATE.allergies,allergy_other:STATE.allergyOther};
 STATE.loading=true; renderApp(); try {
  if(!STATE.id) { const room=await api('/api/rooms','POST',{title:'우리 모임',...(STATE.decisionMode==='group'?{target_size:Number(STATE.targetSize)}:{})}); STATE.id=room.id; history.replaceState(null,'','/r/'+encodeURIComponent(room.id)); }
  if(STATE.me) await api(`/api/rooms/${encodeURIComponent(STATE.id)}/participants/${encodeURIComponent(STATE.me.id)}`,'PUT',{...body,token:STATE.me.token});
  else { STATE.me=await api(`/api/rooms/${encodeURIComponent(STATE.id)}/participants`,'POST',body); saveMe(STATE.me); }
  await refresh(); STATE.loading=false; STATE.currentPage=STATE.decisionMode==='solo'?6:5; renderApp();
  if(STATE.currentPage===6) getResults();
 } catch(err) { STATE.loading=false; STATE.error=err.message; renderApp(); }
}
function fillMe(person) { STATE.name=person.name; STATE.location=person.region; STATE.placeType=person.place_type; STATE.styles=[...person.styles]; STATE.budget=person.budget||''; STATE.atmospheres=[...person.atmospheres]; STATE.signals=[...(person.signals||[])]; STATE.allergies=[...person.allergies]; STATE.allergyOther=person.allergy_other||''; }
function editMe() { if(STATE.me) { const person=STATE.room?.participants.find(p=>p.id===STATE.me.id); if(person) fillMe(person); } goToPage(3); }
async function deleteMe() { if(!STATE.me) return; try { await api(`/api/rooms/${encodeURIComponent(STATE.id)}/participants/${encodeURIComponent(STATE.me.id)}`,'DELETE',{token:STATE.me.token}); saveMe(null); STATE.me=null; await refresh(); renderApp(); showToast('내 응답을 삭제했어요.'); } catch(err) { STATE.error='삭제하지 못했어요. '+err.message; renderApp(); } }
async function copyLink() { try { await navigator.clipboard.writeText(location.origin+'/r/'+encodeURIComponent(STATE.id)); showToast('초대 링크를 복사했어요.'); } catch { $('share-link').select(); showToast('링크를 선택했어요. 복사해 주세요.'); } }
function openResults() { if(!STATE.room?.summary?.count) return showToast('먼저 조건을 저장해 주세요.'); STATE.currentPage=6; STATE.recRegion=''; STATE.recType=''; getResults(); }
function changeResultFilters() { STATE.recRegion=$('rec-region').value; STATE.recType=$('rec-type').value; getResults(); }
async function getResults(retry=0, run=++resultRun) { STATE.loading=retry===0; STATE.error=''; if(!retry) STATE.result=null; renderApp();
 try { const data=await api(`/api/rooms/${encodeURIComponent(STATE.id)}/recommend`,'POST',{
  ...(STATE.recRegion ? {region:STATE.recRegion} : {}), ...(STATE.recType ? {place_type:STATE.recType} : {}) }); if(run!==resultRun) return;
 STATE.result=data; STATE.loading=false; STATE.location=data.region||STATE.location; STATE.placeType=data.place_type||STATE.placeType; renderApp();
 if(data.ai_pending && retry<30) setTimeout(()=>{ if(STATE.currentPage===6 && run===resultRun) getResults(retry+1,run); },6000);
 } catch(err) { if(run!==resultRun)return; STATE.loading=false; STATE.error=err.message; renderApp(); }
}
(async function init(){ try { STATE.options=await api('/api/options'); const match=location.pathname.match(/^\/r\/([A-Za-z0-9_-]{4,20})\/?$/);
 if(match) { STATE.id=match[1]; STATE.me=loadMe(); await refresh(); const person=STATE.me&&STATE.room.participants.find(p=>p.id===STATE.me.id);
 if(person) { fillMe(person); STATE.currentPage=5; } else { STATE.me=null; STATE.location=STATE.room.summary?.region||''; STATE.currentPage=3; }
 } renderApp(); setInterval(async()=>{ if(STATE.id && STATE.currentPage===5 && !document.hidden) try { await refresh(); if(STATE.currentPage===5) renderApp(); } catch { /* keep last known state */ } },5000);
 } catch(err) { $('page-viewport').textContent=err.message; }
})();
