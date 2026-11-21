'use strict';

// Actual room and recommendation API behind the team's six-screen design.
const STATE = { currentPage: 1, location: '', decisionMode: 'group', placeType: 'restaurant',
  styles: [], name: '', budget: '', atmospheres: [], signals: [], allergies: [], allergyOther: '',
  options: null, room: null, id: null, me: null, result: null, error: '', loading: false,
  recRegion: '', recType: '', companion: 'solo', targetSize: 4, customTarget: false,
  appliedCompanion: null, suggestedAtmospheres: [], host: null, confirmReset: false, checking: false };
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
function handleLocationInput(value) { STATE.location=value; const clear=$('loc-clear-btn'); if(clear) clear.classList.toggle('hidden',!value); }
function clearLocationInput() { STATE.location=''; $('location-input').value=''; $('location-input').focus(); $('loc-clear-btn').classList.add('hidden'); }
function selectQuickDistrict(value) { STATE.location=value; $('location-input').value=value; $('loc-clear-btn').classList.remove('hidden'); }
// 1/6: 형식(한글 2자 이상)은 바로 확인하고, 실제로 가게가 검색되는 지역인지는 서버에서 확인한다
const REGION_TEXT = /^[가-힣0-9·\s]+$/;
async function submitPage1() { if(STATE.checking) return; STATE.location=STATE.location.trim().replace(/\s+/g,' ');
  if(!STATE.location) return showToast('지역이나 역 이름을 입력해 주세요.');
  if(STATE.location.length>40) return showToast('지역은 40자 이내로 입력해 주세요.');
  if(!REGION_TEXT.test(STATE.location) || (STATE.location.match(/[가-힣]/g)||[]).length<2) return showToast('지역은 한글로 입력해 주세요. 예: 강남, 성수동, 홍대입구역');
  STATE.checking=true; try { const res=await api('/api/regions/check','POST',{region:STATE.location}); STATE.location=res.region; if(res.warning) showToast(res.warning); goToPage(2); }
  catch(err) { showToast(err.message); } finally { STATE.checking=false; } }
function saveConditionsDraft() {
  if(STATE.currentPage!==4 || !$('conditions-form')) return;
  if($('name')) STATE.name=$('name').value; STATE.budget=$('budget').value;
  STATE.atmospheres=readChecks('atmosphere'); STATE.signals=readChecks('signal');
  STATE.allergies=readChecks('allergy'); STATE.allergyOther=$('allergy-other').value;
}
function goBack() { if (STATE.currentPage===1) return; if (STATE.currentPage===3 && isInvitedBeforeJoin()) return; // 초대 링크로 처음 들어온 사람은 5/6으로 돌아가지 않는다
 saveConditionsDraft(); if (STATE.currentPage===6 && STATE.decisionMode==='solo' && !STATE.room?.target_size) return goToPage(4);
 if (STATE.currentPage===6 || (STATE.currentPage===3 && STATE.id)) return goToPage(5); goToPage(STATE.currentPage-1); }
function resetToStart() { location.href='/'; }
function goToPage(page) { resultRun++; STATE.currentPage=page; STATE.error=''; renderApp(); window.scrollTo(0,0); }
function typeLabel() { return STATE.options?.place_types?.[STATE.placeType] || ''; }
function setMode(mode) { STATE.decisionMode=mode; STATE.error=''; renderApp(); }
const COMPANIONS = [
  {id:'solo', icon:'🍚', title:'혼밥 / 1인', desc:'혼자 편하게 즐기는 한 끼', atmosphere:[]},
  {id:'date', icon:'💑', title:'둘이서 / 데이트', desc:'대화하기 좋고 감성적인 분위기', atmosphere:['대화하기 좋은', '조용한']},
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
    const min=STATE.customTarget?6:2;
    if(!/^\d+$/.test(raw || '') || !Number.isInteger(value) || value<min || value>30) {
      STATE.error=STATE.customTarget?'직접 입력은 6명부터 30명까지예요. 5명 이하는 위 버튼으로 골라 주세요.':'참여 인원을 골라 주세요.'; renderApp(); return;
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
 <div class="grid grid-cols-2 gap-2" role="group" aria-label="참여 인원">${[[2,'✌️'],[3,'🤟'],[4,'🍀'],[5,'🖐️']].map(([count,icon])=>`<button type="button" onclick="setTargetSize(${count})" aria-pressed="${!STATE.customTarget&&STATE.targetSize===count}" class="p-4 min-h-[108px] text-left rounded-2xl border-2 ${!STATE.customTarget&&STATE.targetSize===count?'border-[#bd2333] bg-[#fdf2f3]':'border-gray-100 bg-white'}"><span class="block text-xl">${icon}</span><strong class="block text-sm mt-2">${count}명</strong></button>`).join('')}
 <button type="button" onclick="setCustomTarget()" aria-pressed="${STATE.customTarget}" class="col-span-2 p-4 text-left rounded-2xl border-2 ${STATE.customTarget?'border-[#bd2333] bg-[#fdf2f3]':'border-gray-100 bg-white'}"><span class="block text-xl">✍️</span><strong class="block text-sm mt-2">6명 이상 직접 입력</strong></button></div>
 ${STATE.customTarget?`<label class="block text-xs font-bold text-gray-700 mt-4" for="target-size">참여 인원 (6~30명)</label><input id="target-size" type="number" inputmode="numeric" min="6" max="30" step="1" value="${esc(STATE.targetSize)}" class="w-full px-4 py-3 rounded-2xl border border-gray-200 text-sm mt-2" placeholder="예: 6">`:''}
 <p class="text-[11px] text-gray-500 mt-3">방장이 정한 인원이 모두 참여하면 정원이 마감돼요. 기다리는 중에도 현재 참여자 기준으로 추천받을 수 있어요.</p>`}
 <p role="status" class="text-xs text-red-700 mt-3">${esc(STATE.error)}</p></div>
 <button type="button" onclick="nextFromDecision()" class="w-full mt-6 py-3.5 rounded-2xl bg-[#bd2333] text-white font-bold text-sm shadow-md">다음 · 업종 및 메뉴 고르기 →</button></div>`; }
function renderPage3() { const fixed=fixedType(); if(fixed) STATE.placeType=fixed;
 const types=Object.entries(STATE.options.place_types).filter(([id])=>!fixed || id===fixed);
 return `<div class="flex-1 flex flex-col justify-between p-5 page-enter"><div><div class="inline-flex px-3 py-1 rounded-lg bg-gray-100 text-xs font-semibold mb-3">📍 ${esc(fixedRegion() || STATE.location || '지역 선택')}</div>
 <h2 class="text-2xl font-extrabold">어떤 곳에 갈까요?</h2><p class="text-xs text-gray-500 mt-2">${fixed?`방장이 정한 장소예요. 원하는 ${esc(STATE.options.style_label[fixed])}를 골라 주세요.`:'카페·식당·술집과 원하는 종류를 골라 주세요.'}</p>
 <div class="grid ${fixed?'grid-cols-1':'grid-cols-3'} gap-2 mt-5">${types.map(([id,title])=>`<button type="button" ${fixed?'disabled':`onclick="setType('${esc(id)}')"`} class="p-4 rounded-2xl border-2 text-center ${id===STATE.placeType?'border-[#bd2333] bg-[#fdf2f3]':'border-gray-100'}"><span class="block text-2xl">${icons[id]||'🍽️'}</span><span class="block text-sm font-bold mt-2">${esc(title)}</span></button>`).join('')}</div>
 <div class="mt-6"><div class="flex items-center justify-between mb-3"><p class="text-xs font-bold text-gray-700">${esc(STATE.options.style_label[STATE.placeType])} · 여러 개 선택 가능</p><span class="text-[11px] text-[#bd2333]">${STATE.styles.length ? `${STATE.styles.length}개 선택` : '아무거나'}</span></div><div class="grid grid-cols-2 gap-2">${STATE.options.styles[STATE.placeType].map(s=>`<button type="button" data-value="${esc(s)}" onclick="toggleStyle(this)" aria-pressed="${STATE.styles.includes(s)}" class="px-3.5 py-3 rounded-xl border-2 text-left text-xs font-semibold ${STATE.styles.includes(s)?'bg-[#bd2333] text-white border-[#bd2333]':'border-gray-100 text-gray-700'}">${esc(s)} <span class="float-right" aria-hidden="true">${STATE.styles.includes(s)?'✓':'선택'}</span></button>`).join('')}<button type="button" onclick="clearStyles()" aria-pressed="${STATE.styles.length===0}" class="px-3.5 py-3 rounded-xl border-2 text-left text-xs font-semibold ${STATE.styles.length===0?'bg-[#bd2333] text-white border-[#bd2333]':'border-gray-100 text-gray-700'}">아무거나 <span class="float-right" aria-hidden="true">${STATE.styles.length===0?'✓':''}</span></button></div></div></div>
 <button type="button" onclick="goToPage(4)" class="w-full mt-8 py-3.5 rounded-2xl bg-[#bd2333] text-white font-bold text-sm shadow-md">다음 · 조건 선택하기 →</button></div>`; }
function pickSummary(values, empty='선택 안 함') { return values.length ? values.join(', ') : empty; }
function section(id, title, hint, summary, body, open=false) {
 return `<details id="sec-${id}" class="group mt-3 rounded-2xl border border-gray-200 bg-white" ${open?'open':''}><summary class="flex items-center justify-between gap-2 p-4 cursor-pointer list-none"><span><strong class="block text-sm text-gray-900">${title}</strong><span class="block text-[11px] text-gray-500 mt-0.5">${hint}</span></span><span class="flex items-center gap-2"><span id="sum-${id}" class="text-xs font-bold text-[#bd2333] text-right">${esc(summary)}</span><span class="text-gray-400 group-open:rotate-180 transition" aria-hidden="true">▾</span></span></summary><div class="px-4 pb-4">${body}</div></details>`; }
function refreshSectionSummaries() { const o=STATE.options; const budget=$('budget');
 const set=(id,v)=>{ const el=$('sum-'+id); if(el) el.textContent=v; };
 set('budget', budget && budget.value ? o.budgets[budget.value] : '선택 안 함');
 set('atmosphere', pickSummary(readChecks('atmosphere'))); set('signal', pickSummary(readChecks('signal')));
 const allergy=[...readChecks('allergy'), ($('allergy-other')?.value||'').trim()].filter(Boolean); set('allergy', pickSummary(allergy, '없음'));
 const atm=readChecks('atmosphere'); if(atm.length>3) $('form-status').textContent='분위기는 최대 3개까지 고를 수 있어요.'; else if($('form-status').textContent.startsWith('분위기')) $('form-status').textContent=''; }
function isSolo() { return STATE.decisionMode==='solo' && !STATE.room?.target_size; }
function renderPage4() { const o=STATE.options; const solo=isSolo();
 const region=fixedRegion() || STATE.location; const allergy=[...STATE.allergies, STATE.allergyOther].filter(Boolean);
 return `<form id="conditions-form" class="flex-1 flex flex-col justify-between p-5 page-enter" oninput="refreshSectionSummaries()" onchange="refreshSectionSummaries()"><div>
 <div class="inline-flex px-3 py-1 rounded-lg bg-gray-100 text-xs font-semibold mb-3">📍 ${esc(region)} · ${esc(typeLabel())}${STATE.styles.length?` · ${esc(STATE.styles.join(', '))}`:''}</div>
 <h2 class="text-2xl font-extrabold">어떤 곳을 원하세요?</h2><p class="text-xs text-gray-500 mt-2">${solo?'원하는 조건만 눌러서 골라 주세요. 모두 선택 사항이에요.':'이름을 적고, 원하는 조건을 눌러서 골라 주세요. 이름 말고는 모두 선택 사항이에요.'}</p>
 ${solo?'':`<label class="block text-xs font-bold text-gray-700 mt-5 mb-2" for="name">이름 · 필수</label><input id="name" required maxlength="20" value="${esc(STATE.name)}" class="w-full px-4 py-3 rounded-2xl border border-gray-200 text-sm" placeholder="예: 지우">`}
 <div class="mt-4">
 ${section('budget','💰 1인 예산','한 사람이 쓸 수 있는 금액', STATE.budget?o.budgets[STATE.budget]:'선택 안 함', `<select id="budget" class="w-full px-4 py-3 rounded-2xl border border-gray-200 text-sm"><option value="">선택 안 함</option>${Object.entries(o.budgets).map(([v,l])=>`<option value="${esc(v)}" ${String(STATE.budget)===v?'selected':''}>${esc(l)}</option>`).join('')}</select>`, true)}
 ${section('atmosphere','✨ 분위기','최대 3개 · 업종·가격·이름으로 추정해요', pickSummary(STATE.atmospheres), `<div class="flex flex-wrap gap-2">${o.atmospheres.map(a=>checkbox(a,'atmosphere',STATE.atmospheres)).join('')}</div><p class="text-[11px] text-gray-500 mt-2">잇플에는 분위기 정보가 없어서 업종·가격대·가게 이름으로 확인할 수 있는 분위기만 골라요.</p>`)}
 ${Array.isArray(o.signals) && o.signals.length ? section('signal','💳 방문 특성','BC카드 결제 데이터로 확인해요', pickSummary(STATE.signals), `<p class="text-[11px] text-gray-500 mb-3">선택하면 해당 결제 데이터를 가진 곳을 우선 추천해요. 필수 조건은 아니에요.</p><div class="grid grid-cols-1 gap-2">${o.signals.map(a=>`<label class="flex items-center gap-3 p-3 rounded-2xl border border-gray-200 cursor-pointer"><input type="checkbox" name="signal" value="${esc(a)}" ${STATE.signals.includes(a)?'checked':''} class="accent-[#bd2333]"><span class="text-sm font-semibold text-gray-700">${esc(a)}</span></label>`).join('')}</div>`) : ''}
 ${section('allergy','⚠️ 알레르기','위험이 높은 곳은 추천에서 빼요', pickSummary(allergy,'없음'), `<div class="flex flex-wrap gap-2">${o.allergies.map(a=>checkbox(a,'allergy',STATE.allergies)).join('')}</div><input id="allergy-other" maxlength="40" value="${esc(STATE.allergyOther)}" class="w-full px-4 py-3 rounded-2xl border border-gray-200 text-sm mt-3" placeholder="기타 알레르기 직접 입력"><p class="text-[11px] text-gray-500 mt-3">실제 재료 정보가 없어 알레르기 안전을 보장할 수 없어요. 반드시 매장에 직접 확인하세요.${solo?'':' 방 링크를 아는 사람은 입력 내용을 볼 수 있어요.'}</p>`)}
 </div>
 <p id="form-status" role="status" class="text-xs text-red-700 mt-2">${esc(STATE.error)}</p></div>
 <button type="submit" ${STATE.loading?'disabled':''} class="w-full mt-6 py-3.5 rounded-2xl bg-[#bd2333] text-white font-bold text-sm shadow-md">${STATE.loading?'저장 중…':solo?'추천 보기 →':'조건 저장하기 →'}</button></form>`; }
// 지금까지 모인 조건: 지역·업종은 방장이 정했으니 빼고, 사람들이 고른 선호만 보여 준다
function summaryEntries(room) { const summary=room?.summary||{}; const type=fixedType() || summary.place_type;
 return [...Object.entries((summary.styles||{})[type]||{}), ...Object.entries(summary.atmospheres||{}), ...Object.entries(summary.signals||{})]
  .filter(([,count])=>Number.isInteger(count)&&count>0); }
function summaryPills(room) { const valid=summaryEntries(room);
 return valid.length ? valid.map(([label,count])=>`<span class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-white border border-[#f4dfe1] text-xs font-semibold text-gray-700">${esc(label)} <strong class="text-[#bd2333]">${count}명</strong></span>`).join('') : '<span class="text-xs text-gray-500">아직 선택한 조건이 없어요.</span>'; }
// 모두의 선택을 막대 그래프로 (개인별 응답 대신)
function renderPlot(room) { const summary=room?.summary||{}; const total=summary.count||0; const o=STATE.options; const type=fixedType() || summary.place_type;
 if(!total) return '<p class="text-xs text-gray-500">아직 참여한 사람이 없어요.</p>';
 const budgets=Object.entries(summary.budgets||{}).filter(([,n])=>n>0).map(([k,n])=>[o.budgets[k]||k,n]);
 const allergies=Object.entries(summary.allergies||{}).map(([k,names])=>[k,(names||[]).length]);
 const groups=[[o.style_label[type]||'종류',Object.entries((summary.styles||{})[type]||{})],['1인 예산',budgets],['분위기',Object.entries(summary.atmospheres||{})],
  ['방문 특성',Object.entries(summary.signals||{})],['알레르기',allergies]].map(([title,items])=>[title,items.filter(([,n])=>n>0).sort((a,b)=>b[1]-a[1])]).filter(([,items])=>items.length);
 if(!groups.length) return '<p class="text-xs text-gray-500">모두 "아무거나"를 골랐어요.</p>';
 return groups.map(([title,items])=>`<div class="mt-3 first:mt-0"><p class="text-[11px] font-bold text-gray-500 mb-1.5">${esc(title)}</p>${items.map(([label,n])=>`<div class="flex items-center gap-2 mb-1.5"><span class="w-24 shrink-0 text-xs text-gray-700 truncate">${esc(label)}</span><span class="flex-1 h-2.5 rounded-full bg-white overflow-hidden"><span class="block h-full rounded-full ${title==='알레르기'?'bg-amber-500':'bg-[#bd2333]'}" style="width:${Math.round(n/total*100)}%"></span></span><span class="w-12 text-right text-[11px] font-bold text-gray-600">${n}/${total}명</span></div>`).join('')}</div>`).join(''); }
function renderPage5() { const room=STATE.room; const people=room?.participants || []; const share=location.origin+'/r/'+encodeURIComponent(STATE.id);
 const target=Number.isInteger(room?.target_size) && room.target_size>=2 && room.target_size<=30 ? room.target_size : null;
 const count=people.length; const full=target===null || count>=target; const progress=target===null?null:Math.min(100,Math.round(count/target*100));
 const place=[fixedRegion()||room?.summary?.region, STATE.options.place_types[fixedType()||room?.summary?.place_type]].filter(Boolean).join(' · ');
 return `<div class="flex-1 flex flex-col justify-between p-5 page-enter"><div><div class="p-5 rounded-3xl bg-gradient-to-br from-[#bd2333] to-[#981926] text-white shadow-lg"><span class="text-xs font-semibold">모임 현황 · 5초마다 갱신${place?` · 📍 ${esc(place)}`:''}</span><h2 class="text-xl font-extrabold mt-2">${target!==null&&count>=target?'모두 참여했어요!':target!==null?'참여를 기다리고 있어요':'함께 선택하고 있어요'}</h2><p class="text-sm font-bold mt-2">${count}${target!==null?` / ${target}`:''}명 참여</p>${target!==null?`<div class="w-full h-2 bg-black/20 rounded-full mt-3 overflow-hidden" role="progressbar" aria-label="모임 참여 현황" aria-valuemin="0" aria-valuemax="${target}" aria-valuenow="${Math.min(count,target)}"><div class="h-full rounded-full bg-white" style="width:${progress}%"></div></div>`:''}<p class="text-xs mt-3 text-white/85">${full?'모두의 조건으로 추천을 볼 수 있어요.':`${target-count}명이 더 참여하면 추천을 볼 수 있어요. 지금은 모인 결과만 보여요.`}</p></div>
 <div class="mt-4 p-3.5 rounded-2xl bg-gray-50 border border-gray-200"><label for="share-link" class="block text-xs font-bold text-gray-700 mb-2">모임 초대 링크</label><div class="flex gap-2"><input id="share-link" readonly value="${esc(share)}" class="flex-1 min-w-0 px-3 py-2 rounded-xl border border-gray-200 text-xs"><button type="button" onclick="copyLink()" class="px-3 py-2 bg-white border border-gray-300 text-gray-800 rounded-xl text-xs font-bold">복사</button></div>
 <button type="button" onclick="shareLink()" class="w-full mt-2 py-2.5 rounded-xl bg-[#FEE500] text-[#191919] text-xs font-extrabold">💬 카카오톡으로 공유하기</button><p class="text-[11px] text-gray-500 mt-2">카카오톡에서 열면 기본 브라우저로 자동으로 넘어가요.</p></div>
 <h3 class="text-sm font-extrabold mt-5">지금까지 모인 결과</h3><div class="mt-3 p-3.5 rounded-2xl bg-[#fdf2f3] border border-[#f4dfe1]">${renderPlot(room)}</div>
 <p id="group-status" class="text-xs text-red-700 mt-3">${esc(STATE.error)}</p></div>
 <div class="mt-5 space-y-2">${full?`<button type="button" onclick="openResults()" class="w-full py-3.5 rounded-2xl bg-[#bd2333] text-white font-bold text-sm">모두의 조건으로 추천받기 →</button>`:`<p class="w-full py-3.5 rounded-2xl bg-gray-100 text-gray-500 font-bold text-sm text-center">추천은 ${target}명이 모두 참여하면 열려요</p>`}
 <button type="button" onclick="editMe()" ${target!==null&&count>=target&&!STATE.me?'disabled':''} class="w-full py-3 rounded-2xl border border-gray-200 text-gray-700 font-bold text-xs disabled:opacity-50">${STATE.me?'내 조건 수정':target!==null&&count>=target?'참여 인원이 마감됐어요':'참여하기'}</button>${STATE.me?'<button type="button" onclick="deleteMe()" class="w-full py-2 text-gray-500 text-xs underline">내 응답 삭제</button>':''}
 ${STATE.host?renderResetBox():''}</div></div>`; }
function renderResetBox() { return STATE.confirmReset ? `<div role="alertdialog" aria-labelledby="reset-title" class="mt-3 p-4 rounded-2xl border-2 border-red-300 bg-red-50"><p id="reset-title" class="text-sm font-extrabold text-red-800">💣 정말 모임을 초기화할까요?</p><p class="text-xs text-red-800 mt-2">방과 모든 참여자의 응답이 <strong>완전히 사라지고</strong>, 공유한 초대 링크도 더 이상 열리지 않아요. 되돌릴 수 없어요.</p><div class="grid grid-cols-2 gap-2 mt-3"><button type="button" onclick="cancelReset()" class="py-2.5 rounded-xl border border-gray-300 bg-white text-xs font-bold text-gray-700">취소</button><button type="button" onclick="resetRoom()" class="py-2.5 rounded-xl bg-red-700 text-white text-xs font-extrabold">초기화하기</button></div></div>`
  : `<button type="button" onclick="askReset()" class="w-full py-2 text-red-700 text-xs font-bold">방장 · 모임 초기화</button>`; }
function askReset() { STATE.confirmReset=true; renderApp(); }
function cancelReset() { STATE.confirmReset=false; renderApp(); }
async function resetRoom() { try { await api(`/api/rooms/${encodeURIComponent(STATE.id)}`,'DELETE',{host_token:STATE.host}); saveMe(null); saveHost(null);
  location.href='/'; } catch(err) { STATE.confirmReset=false; STATE.error='초기화하지 못했어요. '+err.message; renderApp(); } }
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
  const link=Boolean(place.eatpl_url), top=index<3;
  const extra=[...(start&&end?[`<p class="text-xs text-gray-700">예상 운영시간 ${start}~${end}${nextDay} <span class="text-[11px] text-gray-500">(최근 한 달 결제 시각 기준 · 매장에 확인)</span></p>`]:[]),
   ...ranking.map(label=>`<p class="text-xs text-gray-700">${esc(label)}</p>`),
   ...(signals.length?[`<p class="text-xs text-gray-700">결제 데이터상 ${esc(signals.join(' · '))}이 많은 곳</p>`]:[]),
   `<p class="text-[11px] text-gray-500">${place.estimate?.source==='ai'?'가격·분위기: AI 추정 포함':'가격·분위기: 업종 기준 추정'}</p>`];
  return `<div class="p-4 rounded-3xl border-2 ${index===0?'border-[#bd2333]':'border-gray-100'} shadow-sm bg-white">
    <div class="flex flex-wrap items-center gap-2">${top?`<span class="px-2.5 py-1 rounded-full ${index===0?'bg-[#bd2333] text-white':'bg-[#fdf2f3] text-[#bd2333]'} text-[11px] font-bold">#${index+1} 오늘의 추천</span>`:`<span class="w-7 h-7 rounded-lg bg-gray-900 text-white text-xs font-bold flex items-center justify-center">${index+1}</span>`}</div>
    <div class="flex items-baseline flex-wrap gap-2 mt-3"><strong class="text-base font-extrabold text-gray-900">${esc(place.name)}</strong><span class="text-xs text-gray-500">${esc(place.business_type||'')}</span></div>
    ${place.address?`<p class="text-xs text-gray-500 mt-2">${esc(place.address)}</p>`:''}
    <div class="mt-3 space-y-1">${(place.reasons||[]).map(reason=>`<p class="text-xs text-gray-700">• ${esc(reason)}</p>`).join('') || '<p class="text-xs text-gray-500">고른 조건과 겹치는 정보가 적어, 이 지역에서 많이 찾는 곳으로 추천했어요.</p>'}${(place.cautions||[]).map(caution=>`<p class="text-xs text-red-700">${esc(caution)}</p>`).join('')}</div>
    <details class="mt-3 rounded-xl bg-gray-50"><summary class="px-3 py-2 text-[11px] font-bold text-gray-600 cursor-pointer">추가 정보</summary><div class="px-3 pb-3 space-y-1">${extra.join('')}</div></details>
    ${link?`<a href="${esc(place.eatpl_url)}" target="_blank" rel="noopener" class="mt-3 block w-full py-3 rounded-2xl ${index===0?'bg-[#bd2333] text-white':'bg-gray-900 text-white'} text-center text-sm font-extrabold">메뉴·혼잡도 확인하기 ↗</a>`:`<p class="mt-3 text-center text-[11px] text-gray-500">${source==='sample'?'가상 가게 · 잇플 링크 없음':'잇플 링크 없음'}</p>`}</div>`;
}
const HOW_WE_RECOMMEND = `<ul class="space-y-1.5 text-xs text-gray-700 list-disc pl-4">
 <li><strong>후보:</strong> 정한 지역의 잇플(BC카드) 가맹점을 최근 1개월 결제 매출 순으로 가져와요.</li>
 <li><strong>제외:</strong> 누구 한 명이라도 가진 알레르기 위험이 높은 곳은 빼요.</li>
 <li><strong>점수:</strong> 같은 종류를 원한 사람이 많을수록, 예산에 맞는 사람이 많을수록, 원하는 분위기·방문 특성이 맞을수록 위로 올려요.</li>
 <li><strong>추정:</strong> 잇플에는 가격·분위기 정보가 없어서 업종·가게 이름과 AI로 추정해요. 점수가 같으면 결제 매출이 높은 곳이 먼저예요.</li></ul>`;
function renderPage6() { const data=STATE.result; let body='';
 const region=data?.region || fixedRegion() || STATE.location, type=data?.place_type || fixedType() || STATE.placeType;
 if(data?.status==='ok') body=`<div class="mt-5"><div class="flex items-center justify-between gap-2"><h3 class="font-extrabold text-gray-900">함께 고른 추천 ${data.results.length}곳</h3><span class="text-[11px] text-gray-500">${data.source==='sample'?'가상 샘플':'eat.pl 잇플'}</span></div>${data.source!=='sample'?'<p class="text-[11px] text-gray-500 mt-1">결제 지표: 잇플 · BC카드 최근 1개월 결제 데이터 기반</p>':''}
  <details class="mt-2 rounded-2xl border border-gray-200"><summary class="px-3.5 py-2.5 text-xs font-bold text-gray-700 cursor-pointer">어떻게 추천했나요?</summary><div class="px-3.5 pb-3">${HOW_WE_RECOMMEND}</div></details>
  <div class="mt-3 space-y-3">${data.results.map((r,i)=>renderResultCard(r,i,data.source)).join('')}</div></div>`;
 else if(data) body=`<p class="mt-5 p-4 rounded-2xl bg-gray-50 text-sm text-gray-600">${esc(data.message||'결과가 없어요. 조건을 바꿔 주세요.')}</p>`;
 const people=STATE.room?.summary?.count||0;
 return `<div class="flex-1 p-5 page-enter"><div class="inline-flex px-3 py-1 rounded-lg bg-gray-100 text-xs font-semibold">📍 ${esc(region)} · ${esc(STATE.options.place_types[type]||'')}</div><h2 class="text-2xl font-extrabold mt-3">어디로 갈까요?</h2><p class="text-xs text-gray-500 mt-2">${isSolo()?'고른 조건을 반영했어요.':`${people}명의 선택을 반영했어요.`}</p>
 ${isSolo()?'':`<details class="mt-4 rounded-2xl border border-[#f4dfe1] bg-[#fdf2f3]"><summary class="p-3.5 text-xs font-bold text-[#bd2333] cursor-pointer">모두의 선택 보기</summary><div class="px-3.5 pb-3.5">${renderPlot(STATE.room)}</div></details>`}
 <p id="result-status" role="status" class="text-xs text-gray-600 mt-4">${STATE.loading?'가게를 찾고 있어요…':data?.ai_pending?'AI가 가격과 분위기를 추정하고 있어요. 잠시 후 자동 반영됩니다.':esc(STATE.error)}</p>${(data?.warnings||[]).map(w=>`<p class="text-xs text-amber-800 mt-2">${esc(w)}</p>`).join('')}${body}
 ${data?.excluded?.length?`<details class="mt-4 text-xs"><summary class="font-bold">알레르기 위험 신호로 제외된 곳 (${data.excluded.length})</summary>${data.excluded.map(p=>`<p class="mt-1">${esc(p.name)} · ${esc(p.reason)}</p>`).join('')}</details>`:''}
 <p class="text-[11px] text-gray-500 mt-5">가격·분위기는 추정값입니다. 실제 재료는 반드시 매장에 확인해 주세요.</p><button type="button" onclick="goBack()" class="mt-5 text-xs font-bold text-[#bd2333]">← ${isSolo()?'조건 다시 고르기':'참여 현황으로'}</button></div>`; }
function renderApp() { const header=$('app-header'); header.classList.toggle('hidden',STATE.currentPage===1);
 const back=$('back-btn'); if(back) back.classList.toggle('invisible', STATE.currentPage===3 && isInvitedBeforeJoin());
 $('step-badge').textContent=`${STATE.currentPage} / 6`; $('progress-bar').style.width=`${Math.round(STATE.currentPage/6*100)}%`;
 const renderer={1:renderPage1,2:renderPage2,3:renderPage3,4:renderPage4,5:renderPage5,6:renderPage6}[STATE.currentPage];
 $('page-viewport').innerHTML=renderer(); const form=$('conditions-form'); if(form) form.addEventListener('submit',submitConditions);
 if(STATE.options?.data_source==='sample') { const p=document.createElement('p'); p.className='p-3 bg-amber-50 text-amber-900 text-xs text-center'; p.textContent='가상 샘플 가게로 시험 중입니다.'; $('page-viewport').prepend(p); }
}
async function refresh() { STATE.room=await api(`/api/rooms/${encodeURIComponent(STATE.id)}`); return STATE.room; }
function readChecks(name) { return [...document.querySelectorAll(`input[name="${name}"]:checked`)].map(e=>e.value); }
async function submitConditions(event) { event.preventDefault(); if(STATE.loading) return;
 const solo=isSolo(); STATE.name=solo?'나':($('name')?.value.trim()||''); STATE.location=fixedRegion()||STATE.location; STATE.budget=$('budget').value;
 STATE.atmospheres=readChecks('atmosphere'); STATE.signals=readChecks('signal'); STATE.allergies=readChecks('allergy'); STATE.allergyOther=$('allergy-other').value.trim();
 if(!STATE.name) { $('form-status').textContent='이름을 입력해 주세요.'; $('name')?.focus(); return; }
 if(!STATE.location) { $('form-status').textContent='지역 정보가 없어요. 처음 화면에서 지역을 다시 골라 주세요.'; return; }
 if(STATE.atmospheres.length>3) { $('form-status').textContent='분위기는 최대 3개까지 선택해 주세요.'; return; }
 const body={name:STATE.name,region:STATE.location,place_type:fixedType()||STATE.placeType,styles:STATE.styles,budget:STATE.budget?Number(STATE.budget):null,atmospheres:STATE.atmospheres,...(Array.isArray(STATE.options.signals)?{signals:STATE.signals}:{}),allergies:STATE.allergies,allergy_other:STATE.allergyOther};
 STATE.loading=true; renderApp(); try {
  if(!STATE.id) { const room=await api('/api/rooms','POST',{title:'우리 모임',region:STATE.location,place_type:STATE.placeType,...(STATE.decisionMode==='group'?{target_size:Number(STATE.targetSize)}:{})});
   STATE.id=room.id; STATE.host=room.host_token||null; saveHost(STATE.host); history.replaceState(null,'','/r/'+encodeURIComponent(room.id)); }
  if(STATE.me) await api(`/api/rooms/${encodeURIComponent(STATE.id)}/participants/${encodeURIComponent(STATE.me.id)}`,'PUT',{...body,token:STATE.me.token});
  else { STATE.me=await api(`/api/rooms/${encodeURIComponent(STATE.id)}/participants`,'POST',body); saveMe(STATE.me); }
  await refresh(); STATE.loading=false; STATE.currentPage=isSolo()?6:5; renderApp();
  if(STATE.currentPage===6) getResults();
 } catch(err) { STATE.loading=false; STATE.error=err.message; renderApp(); }
}
function fillMe(person) { const o=STATE.options; STATE.name=person.name; STATE.location=person.region; STATE.placeType=person.place_type;
 STATE.styles=person.styles.filter(s=>(o.styles[person.place_type]||[]).includes(s)); STATE.budget=person.budget||''; STATE.atmospheres=person.atmospheres.filter(a=>o.atmospheres.includes(a)); STATE.signals=[...(person.signals||[])]; STATE.allergies=[...person.allergies]; STATE.allergyOther=person.allergy_other||''; }
function editMe() { if(STATE.me) { const person=STATE.room?.participants.find(p=>p.id===STATE.me.id); if(person) fillMe(person); } goToPage(3); }
async function deleteMe() { if(!STATE.me) return; try { await api(`/api/rooms/${encodeURIComponent(STATE.id)}/participants/${encodeURIComponent(STATE.me.id)}`,'DELETE',{token:STATE.me.token}); saveMe(null); STATE.me=null; await refresh(); STATE.name=''; goToPage(4); showToast('내 응답을 삭제했어요. 다시 참여하려면 조건을 저장해 주세요.'); } catch(err) { STATE.error='삭제하지 못했어요. '+err.message; renderApp(); } }
async function shareLink() { const url=location.origin+'/r/'+encodeURIComponent(STATE.id);
 const text=`📍 ${fixedRegion()||STATE.location} ${STATE.options.place_types[fixedType()]||'모임 장소'}, 같이 골라요! 조건을 체크하면 모두에게 맞는 곳을 추천해 줘요.`;
 if(navigator.share) { try { await navigator.share({title:'지금어디가 · 함께 고르는 모임 장소', text, url}); return; } catch(err) { if(err?.name==='AbortError') return; } }
 try { await navigator.clipboard.writeText(`${text}\n${url}`); showToast('초대 문구와 링크를 복사했어요. 카카오톡에 붙여 넣어 주세요.'); } catch { $('share-link').select(); showToast('링크를 선택했어요. 복사해 주세요.'); } }
async function copyLink() { try { await navigator.clipboard.writeText(location.origin+'/r/'+encodeURIComponent(STATE.id)); showToast('초대 링크를 복사했어요.'); } catch { $('share-link').select(); showToast('링크를 선택했어요. 복사해 주세요.'); } }
function openResults() { if(!STATE.room?.summary?.count) return showToast('먼저 조건을 저장해 주세요.');
 const target=STATE.room?.target_size; if(target && STATE.room.summary.count<target) return showToast(`${target}명이 모두 참여하면 추천을 볼 수 있어요.`);
 STATE.currentPage=6; getResults(); }
async function getResults(retry=0, run=++resultRun) { STATE.loading=retry===0; STATE.error=''; if(!retry) STATE.result=null; renderApp();
 try { const data=await api(`/api/rooms/${encodeURIComponent(STATE.id)}/recommend`,'POST',{}); if(run!==resultRun) return;
 STATE.result=data; STATE.loading=false; STATE.location=data.region||STATE.location; STATE.placeType=data.place_type||STATE.placeType; renderApp();
 if(data.ai_pending && retry<30) setTimeout(()=>{ if(STATE.currentPage===6 && run===resultRun) getResults(retry+1,run); },6000);
 } catch(err) { if(run!==resultRun)return; STATE.loading=false; STATE.error=err.message; renderApp(); }
}
(async function init(){ try { STATE.options=await api('/api/options'); const match=location.pathname.match(/^\/r\/([A-Za-z0-9_-]{4,20})\/?$/);
 if(match) { STATE.id=match[1]; STATE.me=loadMe(); STATE.host=loadHost();
 try { await refresh(); } catch(err) { saveMe(null); saveHost(null); $('page-viewport').innerHTML=`<div class="flex-1 flex flex-col items-center justify-center p-8 text-center"><p class="text-4xl">🫥</p><p class="text-sm font-bold mt-4">${esc(err.message)}</p><p class="text-xs text-gray-500 mt-2">방장이 모임을 초기화했거나 잘못된 링크일 수 있어요.</p><a href="/" class="mt-6 px-5 py-3 rounded-2xl bg-[#bd2333] text-white text-sm font-bold">새 모임 만들기</a></div>`; return; }
 const person=STATE.me&&STATE.room.participants.find(p=>p.id===STATE.me.id);
 if(STATE.room.place_type) STATE.placeType=STATE.room.place_type;
 if(!STATE.room.target_size && STATE.host) STATE.decisionMode='solo';
 if(person) { fillMe(person); STATE.currentPage=isSolo()?6:5; if(STATE.currentPage===6) { renderApp(); getResults(); } } else { STATE.me=null; STATE.location=STATE.room.region||STATE.room.summary?.region||''; STATE.currentPage=STATE.host?5:3; }
 } renderApp(); setInterval(async()=>{ if(STATE.id && STATE.currentPage===5 && !document.hidden) try { await refresh(); if(STATE.currentPage===5) renderApp(); } catch { /* keep last known state */ } },5000);
 } catch(err) { $('page-viewport').textContent=err.message; }
})();
