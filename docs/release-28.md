# PR #28 — 안전한 운영 배포 체크리스트

> 대상: `BDAI9/2026-project-demo`, 프론트 `https://jj2ya.vercel.app`,
> API `https://jj-moim.amazonlightsail.com`.
>
> 이 문서는 **실행 기록이 아닙니다.** AWS에 접속한 담당자가 단계별로 확인해야 합니다.
> PR #28이 Draft라면 배포하지 마세요. 테스트가 성공해도 데이터 백업·설정·실기기 검증은 별도입니다.

## 0. 배포 전 점검 (쓰기 없음)

GitHub Actions의 최신 **tests / ui-smoke / external-api-smoke** 상태를 확인하고
PR #28의 head SHA와 실제 `main` SHA를 기록합니다. 병합 전에는 운영 주소를 바꾸지 않습니다.

로컬에서 외부 공개주소만 읽어 점검:

```bash
python deploy/check_production.py
```

서버 응답을 확인할 뿐, 모임을 생성하거나 API 키·사용자 데이터를 출력하지 않습니다.
`/healthz`만 성공했다고 해서 실제 잇플·OpenRouter 추천까지 정상인 것은 아닙니다.

**Vercel Preview 주의:** 현재 `web/v2.js`는 `jj2ya.vercel.app`일 때만
Lightsail API 주소를 지정하고, Preview URL은 같은 출처의 `/api`를 조회합니다.
따라서 Preview의 Ready 판정은 정적 빌드 성공일 뿐 **완전한 모임 생성 테스트가 아닙니다.**
동작 검증은 격리된 Playwright E2E와 실제 Production에서 각각 진행합니다.

## 1. AWS Lightsail SSH에서 현 상태 확인

다음 명령은 서버에 접속한 관리자가 실행하며, **출력에 키 값이 포함되면 외부에 공유하지 않습니다**.

```bash
sudo systemctl is-active moim
sudo git -C /opt/moim status --porcelain
sudo git -C /opt/moim branch --show-current
sudo git -C /opt/moim rev-parse HEAD
sudo test -f /var/lib/moim/moim.sqlite3 && echo "DB exists"
sudo test -f /etc/moim/moim.env && echo "Config exists"
```

`git status --porcelain`에 결과가 있으면 먼저 원인을 확인하고 배포를 중단하세요.
운영 설정 파일이나 DB를 `git reset --hard`로 덮어쓰지 마세요.

현재 실행 커밋(복구용)을 별도로 기록합니다. `main`의 최신 GitHub HEAD와
**일치하지 않는 코드**가 서버에서 돌고 있을 수 있습니다.

필요한 설정 이름만 확인 (값은 출력하지 않음):

```bash
sudo awk -F= '/^(MOIM_ALLOWED_HOST|MOIM_ALLOWED_API_ORIGINS|EATPL_SOURCE|KAKAO_JS_KEY|KAKAO_REST_API_KEY|EATPL_DETAIL_ENABLED)=/ {print $1 "=<configured>"}' /etc/moim/moim.env
```

확인할 값의 의도:
- `MOIM_ALLOWED_HOST=jj-moim.amazonlightsail.com`
- `MOIM_ALLOWED_API_ORIGINS=https://jj2ya.vercel.app`
- `EATPL_SOURCE=kskill`
- `KAKAO_JS_KEY`: 카카오톡 SDK 직접 공유 시 선택적으로 등록. JavaScript 클라이언트 키이며 서버에서 API 옵션으로 노출됨
- `KAKAO_REST_API_KEY`: 주소 보조 검색에 선택적으로 사용; **서버 비밀값**
- `EATPL_DETAIL_ENABLED`: 상세정보는 검증 전 **0 유지** 권장. 키를 바꿨다면 재시작 필요

`KAKAO_JS_KEY`를 쓰는 경우 [Kakao Developers](https://developers.kakao.com/)에서
웹 플랫폼 도메인 `https://jj2ya.vercel.app`을 정확히 등록해야 합니다.
SDK 사용 여부에 관계없이 공유 링크 복사는 동작해야 합니다.

## 2. 배포 **이전** DB 백업 (필수)

```bash
cd /opt/moim
sudo install -d -m 700 /root/moim-backups
sudo /opt/moim/.venv/bin/python -m moim.backup /var/lib/moim/moim.sqlite3 "/root/moim-backups/manual-$(date +%Y%m%d-%H%M%S).sqlite3"
sudo ls -lh /root/moim-backups
```

백업이 완료됐다는 메시지와 새 파일 존재를 **모두 확인**하세요.
오래된 서버 코드에서 동시 쓰기 중 `database is locked`가 발생할 수 있습니다.
그 경우 실패를 무시하고 진행하지 말고 요청이 적은 시간에 다시 백업합니다.
DB를 임의 삭제하거나 비어 있는 DB로 대체하지 마세요.

백업에는 방장/참여자 토큰과 알레르기 입력 등이 포함됩니다. 채팅·Git에 업로드 금지.
서버 자체 장애에 대비하려면 별도 보호된 저장소에 2차 사본도 필요합니다.

## 3. Production 배포 순서

1. 백업 완료 및 검증을 기록한 뒤 PR #28을 `Ready for review`로 전환하고 팀 검토 후 `main`으로 병합합니다.
2. Vercel이 GitHub `main` 변경을 감지하면 자동 Production 빌드가 실행될 수 있습니다.
   이전 버전 Preview를 `Redeploy`하는 것으로 최신 커밋을 배포했다고 판단하지 마세요.
3. AWS 서버: 기존 SHA 기록·작업 트리 정리 확인 후 새 `main` 커밋을 반영합니다.

```bash
sudo git -C /opt/moim fetch origin
sudo git -C /opt/moim switch main
sudo git -C /opt/moim pull --ff-only origin main
sudo git -C /opt/moim rev-parse HEAD
sudo systemctl restart moim
sudo systemctl is-active moim
sudo journalctl -u moim -n 40 --no-pager
```

`pull --ff-only`이 거부되거나 서비스가 `active`가 아니면 **즉시 중지**하고
원인을 확인합니다. 각 배포 SHA를 기록해 Vercel Production과 맞춥니다.
일시적인 프론트·백엔드 버전 불일치 가능성을 고려해 이용자가 적은 시각에 수행합니다.

4. Vercel [Deployments](https://vercel.com/dashboard)에서 **Production / Ready / main / 최신 SHA** 확인.
   AWS는 수동 배포이므로 GitHub 병합만으로 자동 반영되지 않습니다.

## 4. 배포 후 점검

```bash
python deploy/check_production.py
```

**실기기 확인:** (1) 강남 등 지역 선택, (2) 방장 2인방 생성,
(3) 링크 복사/휴대폰 카카오 공유, (4) 다른 브라우저에서 참여 및 조건 저장,
(5) 추천 결과와 실제 잇플 상세 링크 확인,
(6) 이전 버전 모임방 정상 조회, (7) 오류 로그 확인.
운영 DB에 테스트 방이 남을 수 있으므로 담당자 계정의 테스트 방만 정리합니다.

API `/api/options`는 JavaScript 키를 반환할 수 있습니다. 로그/스크린샷에
**옵션 JSON 전체를 붙여 넣지 마세요.** `OPENROUTER_API_KEY` 및
`KAKAO_REST_API_KEY` 등은 어떤 로그에도 남기지 않습니다.

## 5. 문제 발생 시 되돌리기

- AWS: 1단계에서 기록한 **이전 커밋 SHA**를 확인하고, 변경 사항이 없는 작업 트리에서
  `sudo git -C /opt/moim switch --detach <OLD_SHA>` 후
  `sudo systemctl restart moim`으로 이전 서버 코드를 실행할 수 있습니다.
  이렇게 되돌린 뒤에는 운영자와 함께 향후 `main` 복귀 방법을 결정합니다.
- Vercel: 프로젝트 Deployments에서 **이전에 검증된 Production 배포**를
  복구/재승격합니다. 표시된 소스 커밋을 반드시 확인합니다.
- DB: **자동으로 과거 백업으로 복원하지 않습니다.** 최신 방 참여 데이터가
  사라질 수 있으므로 데이터 구조 호환성 검토 및 별도 승인 후 복구합니다.

## 완료 기준

- [ ] PR #28 최신 자동 테스트 전체 통과
- [ ] AWS 작업 트리 및 이전 SHA 기록
- [ ] DB 백업 파일 생성 확인
- [ ] 필요한 환경변수 및 카카오 도메인 확인
- [ ] PR 병합·AWS 코드 반영·Vercel Production SHA 일치
- [ ] 읽기 전용 점검 통과
- [ ] 휴대폰 공유·2인방·잇플 실제 추천·구버전 방 검증
