# 지금어디가 (Jigeum Eodiga) — Frontend

BC카드 `eat.pl` 결제 데이터 기반 맛집·카페·주점 큐레이션 모바일 웹 프론트엔드 저장소입니다.  
별도의 빌드 도구(Webpack/Vite/Node.js) 없이 **순수 HTML + Tailwind CSS CDN + 표준 ES Modules**로 구성되어 있어 GitHub Pages에 즉시 배포하고, 백엔드 API를 쉽게 연결할 수 있습니다.

## 폴더 구조

```text
jigeum-eodiga-frontend/
├── index.html          # 메인 엔트리 HTML (모바일 퍼스트 프레임 & 모달 껍데기)
├── README.md           # 프로젝트 구조 및 백엔드 연동 가이드
├── css/
│   └── style.css       # Pretendard 폰트, 7줄 음식 이모지 마퀴 애니메이션, 화면 전환 효과
└── js/
    ├── config.js       # 브랜드 상수, 업종/세부 카테고리 매핑, API 설정(USE_MOCK_API)
    ├── state.js        # 전역 상태(state) 및 조건부 선호도 칩 필터 로직
    ├── api.js          # 백엔드 API 연동 어댑터 및 샘플 데이터 (백엔드 연결 시 이 파일만 수정)
    ├── views.js        # Page 1 ~ Page 6 화면별 UI HTML 템플릿 렌더러
    └── app.js          # 메인 컨트롤러, 이벤트 핸들러 및 렌더링 루프
```

## 로컬 실행 방법 (주의사항)

`index.html`은 `<script type="module">` 방식을 사용하므로 파일을 더블클릭(`file://`)해서 열면 브라우저 보안 정책(CORS)으로 스크립트가 차단됩니다. 아래 방법 중 하나로 실행해 주세요.

1. **VS Code Live Server 확장 프로그램**: `index.html` 우클릭 → `Open with Live Server`
2. **Python 간이 서버**: 터미널에서 프로젝트 폴더로 이동 후 `python -m http.server 8000` 실행 → `http://localhost:8000` 접속
3. **GitHub Pages 배포**: GitHub 저장소 업로드 후 `Settings > Pages > Branch: main` 선택 시 즉시 웹 URL 생성

## 백엔드 API 연동 가이드 (`js/api.js`)

추후 백엔드 서버(BC카드 `eat.pl` 가맹점 검색 API 및 다같이 투표 DB)가 준비되면 **UI 코드를 건드리지 않고** 다음 두 곳만 수정하면 됩니다.

1. `js/config.js`에서 `API_CONFIG.USE_MOCK_API`를 `false`로 변경하고 `BASE_URL` 입력
2. `js/api.js`의 `fetchRecommendations()` 및 `fetchNearbyCrossCategory()` 내부의 실제 `fetch()` 호출부 활성화
