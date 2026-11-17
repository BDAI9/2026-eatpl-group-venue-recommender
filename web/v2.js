'use strict';

// Actual room and recommendation API behind the team's six-screen design.
const STATE = { currentPage: 1, location: '', decisionMode: 'group', placeType: 'restaurant',
  styles: [], name: '', budget: '', atmospheres: [], allergies: [], allergyOther: '',
  options: null, room: null, id: null, me: null, result: null, error: '', loading: false,
  recRegion: '', recType: '' };
const QUICK_DISTRICTS = ['강남', '성수', '홍대', '을지로', '여의도', '잠실', '종로', '합정'];
const icons = {restaurant:'🍚', cafe:'☕', bar:'🍻'};
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $ = id => document.getElementById(id);
let resultRun = 0;

async function api(path, method='GET', body) {
  const res = await fetch(path, {method, headers: body ? {'Content-Type':'application/json'} : {},
    body: body ? JSON.stringify(body) : undefined});
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
function goBack() { if (STATE.currentPage===1) return; if (STATE.currentPage===6) return goToPage(5); goToPage(STATE.currentPage-1); }
function resetToStart() { location.href='/'; }
function goToPage(page) { resultRun++; STATE.currentPage=page; STATE.error=''; renderApp(); window.scrollTo(0,0); }
function typeLabel() { return STATE.options?.place_types?.[STATE.placeType] || ''; }
function setMode(mode) { STATE.decisionMode=mode; renderApp(); }
function setType(type) { STATE.placeType=type; STATE.styles=[]; renderApp(); }
function toggleStyle(button) { const value=button.dataset.value; const idx=STATE.styles.indexOf(value);
  if(idx<0) STATE.styles.push(value); else STATE.styles.splice(idx,1); renderApp(); }
function checkbox(label, name, selected) { return `<label class="inline-flex cursor-pointer"><input class="peer sr-only" type="checkbox" name="${esc(name)}" value="${esc(label)}" ${selected.includes(label)?'checked':''}><span class="px-3 py-2 rounded-xl border border-gray-200 text-xs font-semibold peer-checked:bg-[#bd2333] peer-checked:text-white peer-checked:border-[#bd2333]">${esc(label)}</span></label>`; }
function renderPage2() { return `<div class="flex-1 flex flex-col justify-between p-5 page-enter"><div>
 <div class="inline-flex px-3 py-1 rounded-lg bg-gray-100 text-gray-600 text-xs font-semibold mb-3">📍 ${esc(STATE.location)}</div>
 <h2 class="text-2xl font-extrabold text-gray-900">누가, 어떻게 고를까요?</h2><p class="text-xs text-gray-500 mt-2">혼자 고르거나 링크를 공유해 함께 선택할 수 있어요.</p>
 <div class="grid grid-cols-2 gap-2 p-1.5 bg-gray-100 rounded-2xl mt-5">${[['solo','🙋 나 혼자 결정','조건을 바로 선택'],['group','🗳️ 다같이 선택','링크 공유·참여 현황']].map(([id,title,desc])=>`<button type="button" onclick="setMode('${id}')" class="py-3 rounded-xl text-sm font-extrabold ${STATE.decisionMode===id?'bg-white text-[#bd2333] shadow-sm':'text-gray-500'}">${title}<span class="block text-[10px] font-medium mt-1">${desc}</span></button>`).join('')}</div>
 <div class="mt-5 p-4 rounded-2xl border border-gray-100 bg-white text-sm font-semibold text-gray-700">${STATE.decisionMode==='group'?'모임 링크로 최대 30명까지 참여할 수 있어요.':'선호를 입력하고 혼자 추천받을 수 있어요.'}</div></div>
 <button type="button" onclick="goToPage(3)" class="w-full mt-6 py-3.5 rounded-2xl bg-[#bd2333] text-white font-bold text-sm shadow-md">다음 · 업종 및 메뉴 고르기 →</button></div>`; }
function renderPage3() { const types=Object.entries(STATE.options.place_types);
 return `<div class="flex-1 flex flex-col justify-between p-5 page-enter"><div><div class="inline-flex px-3 py-1 rounded-lg bg-gray-100 text-xs font-semibold mb-3">📍 ${esc(STATE.location || '지역 선택')}</div>
 <h2 class="text-2xl font-extrabold">어떤 곳에 갈까요?</h2><p class="text-xs text-gray-500 mt-2">카페·식당·술집과 원하는 종류를 골라 주세요.</p>
 <div class="grid grid-cols-3 gap-2 mt-5">${types.map(([id,title])=>`<button type="button" onclick="setType('${esc(id)}')" class="p-4 rounded-2xl border-2 text-center ${id===STATE.placeType?'border-[#bd2333] bg-[#fdf2f3]':'border-gray-100'}"><span class="block text-2xl">${icons[id]||'🍽️'}</span><span class="block text-sm font-bold mt-2">${esc(title)}</span></button>`).join('')}</div>
 <div class="mt-6"><p class="text-xs font-bold text-gray-700 mb-3">${esc(STATE.options.style_label[STATE.placeType])} · 여러 개 선택 가능</p><div class="flex flex-wrap gap-2">${STATE.options.styles[STATE.placeType].map(s=>`<button type="button" data-value="${esc(s)}" onclick="toggleStyle(this)" class="px-3.5 py-2 rounded-xl border text-xs font-semibold ${STATE.styles.includes(s)?'bg-[#bd2333] text-white border-[#bd2333]':'border-gray-200 text-gray-700'}">${esc(s)}</button>`).join('')}</div></div></div>
 <button type="button" onclick="goToPage(4)" class="w-full mt-8 py-3.5 rounded-2xl bg-[#bd2333] text-white font-bold text-sm shadow-md">다음 · 조건 선택하기 →</button></div>`; }
function renderPage4() { const o=STATE.options; return `<form id="conditions-form" class="flex-1 flex flex-col justify-between p-5 page-enter"><div>
 <div class="inline-flex px-3 py-1 rounded-lg bg-gray-100 text-xs font-semibold mb-3">📍 ${esc(STATE.location)} · ${esc(typeLabel())}</div>
 <h2 class="text-2xl font-extrabold">어떤 곳을 원하세요?</h2><p class="text-xs text-gray-500 mt-2">함께 고를 이름과 선호를 입력해 주세요.</p>
 <label class="block text-xs font-bold text-gray-700 mt-5 mb-2" for="name">이름</label><input id="name" required maxlength="20" value="${esc(STATE.name)}" class="w-full px-4 py-3 rounded-2xl border border-gray-200 text-sm" placeholder="예: 지우">
 <label class="block text-xs font-bold text-gray-700 mt-5 mb-2" for="region">지역</label><input id="region" required maxlength="40" value="${esc(STATE.location)}" class="w-full px-4 py-3 rounded-2xl border border-gray-200 text-sm" placeholder="지역 또는 역 이름">
 <label class="block text-xs font-bold text-gray-700 mt-5 mb-2" for="budget">1인 예산 · 선택</label><select id="budget" class="w-full px-4 py-3 rounded-2xl border border-gray-200 text-sm"><option value="">선택 안 함</option>${Object.entries(o.budgets).map(([v,l])=>`<option value="${esc(v)}" ${String(STATE.budget)===v?'selected':''}>${esc(l)}</option>`).join('')}</select>
 <fieldset class="mt-5"><legend class="text-xs font-bold text-gray-700 mb-2">분위기 · 최대 3개</legend><div class="flex flex-wrap gap-2">${o.atmospheres.map(a=>checkbox(a,'atmosphere',STATE.atmospheres)).join('')}</div></fieldset>
 <fieldset class="mt-5"><legend class="text-xs font-bold text-gray-700 mb-2">알레르기 · 선택</legend><div class="flex flex-wrap gap-2">${o.allergies.map(a=>checkbox(a,'allergy',STATE.allergies)).join('')}</div><input id="allergy-other" maxlength="40" value="${esc(STATE.allergyOther)}" class="w-full px-4 py-3 rounded-2xl border border-gray-200 text-sm mt-3" placeholder="기타 알레르기 직접 입력"></fieldset>
 <p class="text-[11px] text-gray-500 mt-4">실제 재료 정보가 없어 알레르기 안전을 보장할 수 없어요. 반드시 매장에 직접 확인하세요. 방 링크를 아는 사람은 입력 내용을 볼 수 있어요.</p>
 <p id="form-status" role="status" class="text-xs text-red-700 mt-2">${esc(STATE.error)}</p></div>
 <button type="submit" ${STATE.loading?'disabled':''} class="w-full mt-6 py-3.5 rounded-2xl bg-[#bd2333] text-white font-bold text-sm shadow-md">${STATE.loading?'저장 중…':'조건 저장하기 →'}</button></form>`; }
function renderPage5() { const room=STATE.room; const people=room?.participants || []; const share=location.origin+'/r/'+encodeURIComponent(STATE.id);
 return `<div class="flex-1 flex flex-col justify-between p-5 page-enter"><div><div class="p-4 rounded-3xl bg-gradient-to-br from-[#bd2333] to-[#981926] text-white shadow-lg"><span class="text-xs font-semibold">실제 모임 · 5초마다 갱신</span><h2 class="text-xl font-extrabold mt-2">${people.length}명이 선택했어요</h2><p class="text-xs mt-2 text-white/85">최대 30명까지 참여할 수 있어요.</p></div>
 <div class="mt-4 p-3.5 rounded-2xl bg-gray-50 border border-gray-200"><label for="share-link" class="block text-xs font-bold text-gray-700 mb-2">모임 초대 링크</label><div class="flex gap-2"><input id="share-link" readonly value="${esc(share)}" class="flex-1 min-w-0 px-3 py-2 rounded-xl border border-gray-200 text-xs"><button type="button" onclick="copyLink()" class="px-4 py-2 bg-gray-900 text-white rounded-xl text-xs font-bold">링크 복사</button></div></div>
 <h3 class="text-sm font-extrabold mt-5">참여 현황</h3><p class="text-[11px] text-gray-500 mt-1">링크를 아는 사람은 참여자의 조건을 볼 수 있어요.</p><ul class="mt-3 space-y-2">${people.map(p=>`<li class="p-3 rounded-2xl border border-gray-100 text-sm"><strong>${esc(p.name)}</strong><span class="text-xs text-gray-500 ml-2">${esc(p.region)} · ${esc(STATE.options.place_types[p.place_type]||'')}</span>${(p.allergies?.length||p.allergy_other)?`<p class="text-xs text-red-700 mt-1">알레르기: ${esc([...(p.allergies||[]),p.allergy_other].filter(Boolean).join(', '))}</p>`:''}</li>`).join('') || '<li class="text-xs text-gray-500">아직 참여자가 없어요.</li>'}</ul>
 <p id="group-status" class="text-xs text-red-700 mt-3">${esc(STATE.error)}</p></div>
 <div class="mt-5 space-y-2"><button type="button" onclick="openResults()" class="w-full py-3.5 rounded-2xl bg-[#bd2333] text-white font-bold text-sm">추천 확인하기 →</button><button type="button" onclick="editMe()" class="w-full py-3 rounded-2xl border border-gray-200 text-gray-700 font-bold text-xs">${STATE.me?'내 조건 수정':'참여하기'}</button>${STATE.me?'<button type="button" onclick="deleteMe()" class="w-full py-2 text-gray-500 text-xs underline">내 응답 삭제</button>':''}</div></div>`; }
function renderPage6() { const data=STATE.result; let body='';
 const regions=[...new Set([...Object.keys(STATE.room?.summary?.regions || {}), ...(STATE.options?.regions || []), STATE.recRegion].filter(Boolean))];
 const selectedRegion=STATE.recRegion || data?.region || STATE.room?.summary?.region || '';
 const selectedType=STATE.recType || data?.place_type || STATE.room?.summary?.place_type || '';
 if(data?.status==='ok') body=`<div class="mt-5 space-y-3">${data.results.map((r,i)=>`<${r.eatpl_url?'a':'div'} ${r.eatpl_url?`href="${esc(r.eatpl_url)}" target="_blank" rel="noopener"`:''} class="block p-4 rounded-3xl border border-gray-100 shadow-sm bg-white"><div class="flex items-center gap-2"><span class="w-7 h-7 rounded-lg bg-[#bd2333] text-white text-xs font-bold flex items-center justify-center">${i+1}</span><strong class="text-sm">${esc(r.name)}</strong><span class="text-[10px] text-gray-500">${esc(r.business_type||'')}</span></div><p class="text-xs text-gray-500 mt-2">${esc(r.address||'')}</p>${(r.reasons||[]).map(x=>`<p class="text-xs text-gray-700 mt-1">• ${esc(x)}</p>`).join('')}${(r.cautions||[]).map(x=>`<p class="text-xs text-red-700 mt-1">${esc(x)}</p>`).join('')}<p class="text-[11px] text-gray-500 mt-2">${r.estimate?.source==='ai'?'AI 가격·분위기 추정 포함':'업종 정보 기준'}</p><p class="text-xs text-[#bd2333] font-bold mt-2">${r.eatpl_url?'잇플에서 보기 ↗':data.source==='sample'?'가상 가게 · 잇플 링크 없음':'잇플 링크 없음'}</p></${r.eatpl_url?'a':'div'}>`).join('')}</div>`;
 else if(data) body=`<p class="mt-5 p-4 rounded-2xl bg-gray-50 text-sm text-gray-600">${esc(data.message||'결과가 없어요. 지역이나 조건을 바꿔 주세요.')}</p>`;
 return `<div class="flex-1 p-5 page-enter"><div class="inline-flex px-3 py-1 rounded-lg bg-[#fdf2f3] text-[#bd2333] text-xs font-bold">함께 고른 추천</div><h2 class="text-2xl font-extrabold mt-3">어디로 갈까요?</h2><p class="text-xs text-gray-500 mt-2">${STATE.room?.summary?.count||0}명의 선택을 반영했어요.</p>
 <div class="grid grid-cols-2 gap-2 mt-4"><label class="text-xs text-gray-600">지역<select id="rec-region" onchange="changeResultFilters()" class="block w-full rounded-xl border border-gray-200 p-2 mt-1">${regions.map(r=>`<option value="${esc(r)}" ${r===selectedRegion?'selected':''}>${esc(r)}</option>`).join('')}</select></label><label class="text-xs text-gray-600">장소<select id="rec-type" onchange="changeResultFilters()" class="block w-full rounded-xl border border-gray-200 p-2 mt-1">${Object.entries(STATE.options.place_types).map(([v,l])=>`<option value="${esc(v)}" ${v===selectedType?'selected':''}>${esc(l)}</option>`).join('')}</select></label></div>
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
 STATE.atmospheres=readChecks('atmosphere'); STATE.allergies=readChecks('allergy'); STATE.allergyOther=$('allergy-other').value.trim();
 if(!STATE.name || !STATE.location) { $('form-status').textContent='이름과 지역을 입력해 주세요.'; return; }
 if(STATE.atmospheres.length>3) { $('form-status').textContent='분위기는 최대 3개까지 선택해 주세요.'; return; }
 const body={name:STATE.name,region:STATE.location,place_type:STATE.placeType,styles:STATE.styles,budget:STATE.budget?Number(STATE.budget):null,atmospheres:STATE.atmospheres,allergies:STATE.allergies,allergy_other:STATE.allergyOther};
 STATE.loading=true; renderApp(); try {
  if(!STATE.id) { const room=await api('/api/rooms','POST',{title:'우리 모임'}); STATE.id=room.id; history.replaceState(null,'','/r/'+encodeURIComponent(room.id)); }
  if(STATE.me) await api(`/api/rooms/${encodeURIComponent(STATE.id)}/participants/${encodeURIComponent(STATE.me.id)}`,'PUT',{...body,token:STATE.me.token});
  else { STATE.me=await api(`/api/rooms/${encodeURIComponent(STATE.id)}/participants`,'POST',body); saveMe(STATE.me); }
  await refresh(); STATE.loading=false; STATE.currentPage=STATE.decisionMode==='solo'?6:5; renderApp();
  if(STATE.currentPage===6) getResults();
 } catch(err) { STATE.loading=false; STATE.error=err.message; renderApp(); }
}
function fillMe(person) { STATE.name=person.name; STATE.location=person.region; STATE.placeType=person.place_type; STATE.styles=[...person.styles]; STATE.budget=person.budget||''; STATE.atmospheres=[...person.atmospheres]; STATE.allergies=[...person.allergies]; STATE.allergyOther=person.allergy_other||''; }
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
