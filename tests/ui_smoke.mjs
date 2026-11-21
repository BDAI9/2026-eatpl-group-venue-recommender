import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = 'http://127.0.0.1:8765';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.emulateMedia({ reducedMotion: 'reduce' });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
try {
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.locator('#location-input').waitFor();
  const { mkdirSync } = await import('node:fs');
  mkdirSync('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/home-mobile.png', fullPage: true });
  const desktop = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await desktop.emulateMedia({ reducedMotion: 'reduce' });
  await desktop.goto(base, { waitUntil: 'domcontentloaded' });
  await desktop.locator('.home-shell').waitFor();
  await desktop.screenshot({ path: 'artifacts/home-desktop.png', fullPage: true });
  await desktop.close();
  await page.locator('#location-input').fill('홍대');
  await await page.getByRole('heading', { name: /취향은 달라도/ }).waitFor();
  const heroOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  assert.equal(heroOverflow, false, 'Home must not overflow mobile viewport');
  await page.getByRole('button', { name: /이 동네에서 시작하기/ }).click();
  await page.getByRole('heading', { name: '누가, 어떻게 고를까요?' }).waitFor();
  await page.screenshot({ path: 'artifacts/decision-mobile.png', fullPage: true });

  await page.locator('button[onclick="setTargetSize(2)"]').click();
  await page.getByRole('button', { name: /다음 · 업종 및 메뉴/ }).click();
  await page.screenshot({ path: 'artifacts/categories-mobile.png', fullPage: true });
  await page.getByRole('button', { name: /다음 · 조건 선택하기/ }).click();
  await page.screenshot({ path: 'artifacts/preferences-mobile.png', fullPage: true });
  await page.locator('#name').fill('자동테스트 A');
  await page.locator('#conditions-form button[type=submit]').click();
  await page.locator('#share-link').waitFor();
  await page.screenshot({ path: 'artifacts/room-mobile.png', fullPage: true });

  const roomUrl = await page.locator('#share-link').inputValue();
  assert.match(roomUrl, /\/r\/[a-zA-Z0-9_-]{4,20}$/);
  assert.ok(roomUrl.startsWith(base));
  console.log('OK created room and shareable room URL');

  const guest = await browser.newPage({ viewport: { width: 390, height: 844 } });
  guest.on('pageerror', e => errors.push(e.message));
  await guest.goto(roomUrl, { waitUntil: 'domcontentloaded' });
  await guest.getByRole('heading', { name: '어떤 곳에 갈까요?' }).waitFor();
  await guest.getByRole('button', { name: /다음 · 조건 선택하기/ }).click();
  await guest.locator('#name').fill('자동테스트 B');
  await guest.locator('#conditions-form button[type=submit]').click();
  await guest.locator('#share-link').waitFor();
  console.log('OK second participant joined invite link');

  // The backend is the source of truth for participation. Avoid brittle
  // assertions tied to the UI's Korean progress-label punctuation.
  const roomId = roomUrl.split('/').at(-1);
  const saved = await page.request.get(`${base}/api/rooms/${roomId}`);
  assert.equal(saved.status(), 200);
  const storedRoom = await saved.json();
  assert.equal(storedRoom.participants.length, 2, 'Both participants must be persisted');
  assert.equal(storedRoom.target_size, 2, 'Room capacity must be preserved');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /모두의 조건으로 추천받기/ }).waitFor({ timeout: 20000 });
  await page.getByRole('button', { name: /모두의 조건으로 추천받기/ }).click();
  await page.getByRole('heading', { name: '어디로 갈까요?' }).waitFor();
  await page.locator('#result-status').waitFor({ timeout: 25000 });
  const result = await page.locator('#page-viewport').innerText();
  assert.match(result, /추천|장소/);
  await page.screenshot({ path: 'artifacts/results-mobile.png', fullPage: true });
  assert.ok(!errors.length, 'Browser JavaScript exceptions: ' + errors.join(' | '));
  console.log('OK recommendation screen after 2-person room completion');
  await guest.close();
} finally {
  await browser.close();
}
