import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = 'http://127.0.0.1:8765';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
try {
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.locator('#location-input').waitFor();
  await page.locator('#location-input').fill('홍대');
  await page.getByRole('button', { name: /이 위치로 맛집 찾기/ }).click();
  await page.getByRole('heading', { name: '누가, 어떻게 고를까요?' }).waitFor();

  await page.getByRole('button', { name: /2명/ }).click();
  await page.getByRole('button', { name: /다음 · 업종 및 메뉴/ }).click();
  await page.getByRole('button', { name: /다음 · 조건 선택하기/ }).click();
  await page.locator('#name').fill('자동테스트 A');
  await page.locator('#conditions-form button[type=submit]').click();
  await page.locator('#share-link').waitFor();

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

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByText('2 / 2명 참여', { exact: true }).waitFor({ timeout: 20000 });
  await page.getByRole('button', { name: /모두의 조건으로 추천받기/ }).click();
  await page.getByRole('heading', { name: '어디로 갈까요?' }).waitFor();
  await page.locator('#result-status').waitFor({ timeout: 25000 });
  const result = await page.locator('#page-viewport').innerText();
  assert.match(result, /추천|장소/);
  assert.ok(!errors.length, 'Browser JavaScript exceptions: ' + errors.join(' | '));
  console.log('OK recommendation screen after 2-person room completion');
  await guest.close();
} finally {
  await browser.close();
}
