# Windows에서 지금어디가 실행하기

Python 3.10 이상이 필요합니다. ZIP을 풀고 파일 탐색기에서 `moim`, `web`, `.env.example`이 보이는 폴더를 여세요. 주소창에 `powershell`을 입력하고 Enter를 누르면 그 폴더에서 PowerShell이 열립니다.

## 환경 설정

명령을 한 줄씩 실행하세요.

```powershell
py --version
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
notepad .env
```

`.env` 처음 설정은 다음과 같습니다.

```dotenv
EATPL_SOURCE=kskill
EATPL_DETAIL_ENABLED=1
OPENROUTER_API_KEY=
OPENROUTER_MODEL=
KAKAO_JS_KEY=
KAKAO_REST_API_KEY=
```

- `EATPL_SOURCE=kskill`은 인터넷으로 실제 잇플 가게를 검색합니다. 가상 가게로 기본 기능을 시험하려면 `sample`을 사용하세요.
- `EATPL_DETAIL_ENABLED=1`이면 실제 잇플 후보의 상세 페이지를 백그라운드에서 읽습니다. 잇플 상세 메뉴가 있으면 OpenRouter 키 없이도 케이크와 메뉴 가격을 반영합니다. 상세 페이지 사용 조건은 공개 운영 전 제휴 담당자와 확인하세요.
- `OPENROUTER_API_KEY`를 입력하면 상세 메뉴와 후기 요약을 읽고 애매한 종류와 분위기를 추가로 추정합니다. `OPENROUTER_MODEL`을 비우면 기본 무료 모델을 사용하고, 모델을 직접 지정해도 `:free` 모델만 시도합니다.
- `KAKAO_JS_KEY`에는 팀 카카오 앱의 **JavaScript 키**를 입력하세요. 카카오 개발자 콘솔에서 해당 키로 사용할 웹 도메인에 접속 주소를 등록하세요. 예를 들어 로컬 테스트 주소가 `http://localhost:8011`이면 그 주소로 접속하고 같은 주소를 등록합니다. 다른 사람에게 보내는 모임이라면 상대도 접속 가능한 서비스 주소가 필요합니다. 키가 없거나 SDK 호출이 실패하면 휴대폰 공유창이나 링크 복사를 사용합니다.
- `KAKAO_REST_API_KEY`는 동명 지역 대조가 필요할 때 선택해서 설정합니다. JavaScript 키와 구분하세요. REST 키와 OpenRouter 키는 서버 안에서만 사용합니다.

[카카오 개발자 콘솔](https://developers.kakao.com/console/app) · [OpenRouter 키 설정](https://openrouter.ai/settings/keys)

이전에 같은 PowerShell 창에서 `$env:EATPL_SOURCE`처럼 설정한 값은 `.env`보다 우선합니다. 파일 값으로 실행하려면 새 PowerShell 창을 열거나 해당 환경 변수를 제거하세요.

## 서버 실행

```powershell
py -m moim --port 8011
```

[http://localhost:8011/](http://localhost:8011/)에서 새로 시작하세요. 실행 중인 창은 열어 두고, 종료하거나 `.env`를 바꾸려면 `Ctrl+C`를 누르세요. 같은 와이파이에서 휴대폰으로 시험할 때는 `py -m moim --port 8011 --lan`을 실행한 뒤 휴대폰에서 터미널에 표시된 주소를 여세요.

역 주변을 시험하려면 첫 화면에서 `시청역`을 입력하고 `서울특별시 중구 시청역`을 선택하세요. 위치 선택 뒤 추천 화면에 반경 500m와 역에서 각 가게까지의 직선거리가 표시됩니다.

처음 확인할 흐름은 **성수 → 혼자 결정 → 카페 → 케이크 메뉴 있음 → 추천 보기**입니다. 먼저 나온 후보가 상세 조회 뒤 업데이트될 수 있어요. 메뉴가 확인된 가게에는 메뉴명이 표시됩니다. 새 모임을 2명으로 만들어 다른 브라우저에서 초대 링크를 열면 공동 선택 흐름을 확인할 수 있어요.
