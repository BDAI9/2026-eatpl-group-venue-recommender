// The landing design uses the real room API, never simulated prototype data.
import { renderPage1 } from '/static/landing-view.js';

const root = document.getElementById('app-root');
root.innerHTML = renderPage1();

// GPS-to-region conversion is not implemented; the prototype substituted a
// fixed location regardless of the device position.
root.querySelector('button[onclick="useCurrentGpsLocation()"]').parentElement.remove();
for (const node of root.querySelectorAll('span, p')) {
  if (node.textContent.trim() === '실패 없는 한 끼 결정') node.textContent = '함께 고르는 모임 장소';
  if (node.textContent.trim() === '지금 인기 있는 서울 핫플레이스') node.textContent = '지역 예시';
  if (node.textContent.trim() === 'eat.pl 결제 데이터 큐레이션') node.textContent = '모임 장소 추천';
}
const input = document.getElementById('start-location-input');
input.maxLength = 40;
let creating = false;
let toastTimer;

function showToast(message) {
  const toast = document.getElementById('app-toast');
  document.getElementById('app-toast-text').textContent = message;
  toast.classList.remove('opacity-0', 'translate-y-2');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('opacity-0', 'translate-y-2'), 3500);
}

async function createRoom(region) {
  region = region.trim();

  const aliases = {
  "강남역": "강남",
  "성수동": "성수",
  "홍대입구": "홍대",
  "홍대입구역": "홍대",
  "종로·광화문": "종로",
  "광화문": "종로",
};

  region = Object.prototype.hasOwnProperty.call(aliases, region)
    ? aliases[region]
    : region;
  if (!region) { showToast('동네나 역 이름을 입력해 주세요.'); input.focus(); return; }
  if (region.length > 40) { showToast('지역은 40자 이내로 입력해 주세요.'); return; }
  if (creating) return;
  creating = true;
  try {
    const response = await fetch('/api/rooms', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({title: '우리 모임'}),
    });
    const data = await response.json();
    if (!response.ok || !data.id) throw new Error(data.message || '모임을 만들지 못했어요.');
    try { sessionStorage.setItem(`moim-start-region:${data.id}`, region); } catch { /* enter it in the room */ }
    location.assign(`/r/${encodeURIComponent(data.id)}`);
  } catch (error) {
    showToast(error.message || '모임을 만들지 못했어요. 다시 시도해 주세요.');
    creating = false;
  }
}

window.submitStartSearch = () => createRoom(input.value);
window.selectHotspot = (spot) => createRoom(spot);
window.toggleStartClearBtn = (value) => {
  const clear = document.getElementById('start-clear-btn');
  clear.classList.toggle('hidden', !value);
  clear.classList.toggle('flex', Boolean(value));
};
window.clearStartInput = () => { input.value = ''; window.toggleStartClearBtn(''); input.focus(); };
