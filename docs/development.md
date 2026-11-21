# 개발 및 협업 안내

## 1. 실행 환경

- Python 3.10 이상 (메인 서버는 Python 표준 라이브러리 중심)
- 단위 테스트: `pytest`
- 브라우저 E2E: Node.js + Playwright / Chromium
- 메인 화면: `web/`의 HTML·CSS·JavaScript

```bash
# 가상 데이터로 개발하려면 .env.example을 복사한 뒤 .env를 수정
cp .env.example .env
# .env: EATPL_SOURCE=sample
python -m moim --port 8000
```

Windows는 [PowerShell 상세 가이드](windows-run.md)를 확인하세요. `.env`는 **절대 커밋하지 않습니다.**

## 2. 검증

```bash
python -m pip install pytest
python -m pytest -q
python -m compileall -q moim
node --check web/v2.js
node --check web/v2-landing.js
```

추가적인 Playwright 설치/실행 방식은 [GitHub Actions workflow](../.github/workflows/verify-integration.yml)가 기준입니다. CI는 Python 테스트·격리된 모임 E2E·외부 API 읽기 확인·운영 상태 읽기 점검을 구분합니다.

**주의:** 외부 API 읽기 테스트와 운영 상태 체크는 실패 허용으로 설정된 보조 점검이므로, CI 전체가 녹색이어도 실서버의 추천 데이터·배포 일치가 자동 보장되지는 않습니다. 또한 Vercel Preview는 프로덕션과 API 연결 주소가 달라 실제 초대 링크 시나리오에 한계가 있습니다.

## 3. 브랜치·PR

팀의 **기준 브랜치는 `main`** 입니다. 현재 저장소는 기능 브랜치에서 `main`으로 PR을 여는 방식으로 사용했습니다.

1. 최신 `main`에서 `feature/`, `fix/` 또는 `docs/` 브랜치 생성
2. 코드와 필요 테스트/문서를 함께 변경
3. **base = `main`** 인 PR 생성 (진행 중이면 Draft)
4. CI, 모바일 화면/초대 동작 확인
5. 리뷰 후 `main` 병합; 필요시 운영 배포는 별도 진행

이전에 쓰던 `dev` 통합 브랜치 설명은 현재 실제 PR 흐름과 맞지 않아 제거했습니다. 팀이 나중에 브랜치 정책을 바꾸면 이 문서와 PR 템플릿을 동시에 갱신합니다.

## 4. 변경별 체크

| 변경 유형 | 함께 갱신할 자료 |
| --- | --- |
| UI/문구 | `DESIGN.md`, 모바일 브라우저 테스트 |
| API | `docs/architecture.md`, 서버/API 테스트 |
| 추천 점수·안전 조건 | `docs/recommendation.md`, 경계 조건 단위 테스트 |
| 배포·설정 | `docs/deployment.md`, 백업/복구 점검 |
| 사용자 흐름 | `docs/product.md`, README 기능 요약 |

## 5. 협업 원칙

- 실제 사용자 이름·알레르기 입력·토큰·DB 백업·API 비밀값을 PR/이슈에 붙이지 않습니다.
- 운영 데이터와 샘플 데이터를 섞어서 결과를 보고하지 않습니다.
- 한 PR에 하나의 목적만 넣습니다. 문서 정리 PR은 기능·DB를 바꾸지 않습니다.
- 공개 배포는 GitHub 병합, Vercel 상태, AWS 서비스 버전을 **각각** 확인합니다.
