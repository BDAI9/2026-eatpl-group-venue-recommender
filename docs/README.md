# 지금어디가 · 프로젝트 문서

**이 저장소는 BDAI9 팀의 실제 서비스 코드와 개발 문서를 관리합니다.** 개인 포트폴리오·프로젝트 소개는 별도 개인 저장소에서 관리합니다.

| 문서 | 설명 |
| --- | --- |
| [제품·사용자 흐름](product.md) | 해결하는 문제, 6단계 이용 흐름, 구현 범위 |
| [시스템 구조·API](architecture.md) | 프론트·백엔드·SQLite·eat.pl 연동 |
| [추천 알고리즘](recommendation.md) | 그룹 선호 집계, 음식 종류 우선순위, 알레르기 예외 |
| [개발·협업](development.md) | 로컬 테스트·브랜치·PR 작업 규칙 |
| [운영 배포·복구](deployment.md) | Vercel/AWS, 데이터 백업, 롤백 |
| [Windows 실행](windows-run.md) | PowerShell 로컬 실행 |
| [UI 디자인 원칙](../DESIGN.md) | 화면 스타일·접근성 점검 |

## 문서 관리 기준

- 기능이나 사용 흐름 변경 → `product.md`
- API·데이터 흐름 변경 → `architecture.md`
- 랭커/알레르기 로직 변경 → `recommendation.md`와 관련 테스트
- 운영 변경 → `deployment.md`
- 팀 협업 변경 → `development.md`

일회성 배포 기록과 초기 실험 자료는 Git 히스토리에서 확인할 수 있습니다. 운영에 필요한 코드는 이전 커밋에 의존하지 않도록 현재 `main`에 유지합니다.
