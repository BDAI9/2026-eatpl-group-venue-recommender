# Windows PowerShell 실행

Python 3.10 이상을 설치하고 프로젝트 최상위 폴더(`moim/`, `web/`, `.env.example`이 있는 위치)에서 PowerShell을 엽니다.

## 1. 설정

```powershell
py --version
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
notepad .env
```

처음에는 외부 서비스와 상관없이 확인 가능한 **가상 데이터**로 시작하세요.

```dotenv
EATPL_SOURCE=sample
EATPL_DETAIL_ENABLED=0
OPENROUTER_API_KEY=
OPENROUTER_MODEL=
KAKAO_JS_KEY=
KAKAO_REST_API_KEY=
```

실제 장소를 시험하려면 `EATPL_SOURCE=kskill`로 변경합니다. 상세정보 조회(`EATPL_DETAIL_ENABLED=1`)는 사용 조건 확인 후 활성화하세요. OpenRouter는 추가 추정용 선택 키입니다. Kakao JavaScript 키는 공유용 공개 클라이언트 키이고, Kakao REST 키와 OpenRouter 키는 서버 전용 비밀입니다. 어떤 키도 Git에 올리지 마세요.

## 2. 실행

```powershell
py -m moim --port 8011
```

[http://127.0.0.1:8011/](http://127.0.0.1:8011/)에서 확인하고 종료는 `Ctrl+C`입니다. 같은 Wi-Fi의 휴대폰과 시험할 때는 `py -m moim --port 8011 --lan`으로 시작하여 터미널에 표시된 LAN 주소를 사용합니다. Windows 방화벽은 신뢰하는 개인 네트워크에서만 허용하세요.

## 3. 확인·테스트

- 혼자 결정 → 음식 종류 → 추천
- 2인 모임 → 다른 브라우저 참여·수정 → 추천
- 5/6 참여 화면과 6/6 추천 화면의 불필요한 새로 그리기 여부

```powershell
py -m pip install pytest
py -m pytest -q
```

환경변수를 바꿨으면 서버를 재시작하세요. PowerShell에서 먼저 지정한 `$env:EATPL_SOURCE` 등의 환경값은 `.env`보다 우선할 수 있습니다.

[개발·협업](development.md) · [추천 기준](recommendation.md)
