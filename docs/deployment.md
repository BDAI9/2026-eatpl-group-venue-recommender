# 테스트 서버 배포 안내

## 현재 구성

- 코드: 팀 작업은 `dev`, 테스트 후 공개할 코드는 `main`에서 관리합니다.
- 주소: [JJ 테스트 서버](https://jj-moim.amazonlightsail.com/). 최종 도메인은 팀 협의 후 변경합니다.
- Lightsail 인스턴스 `bdai-moim-dev`, Distribution, Nginx HTTPS, 단일 Gunicorn 프로세스.
- 장소 검색은 `EATPL_SOURCE=kskill`, 선택적 AI 추정은 OpenRouter를 사용합니다.
- 애플리케이션: `/opt/moim`, 환경 설정: `/etc/moim/moim.env`, 방 DB: `/var/lib/moim/moim.sqlite3`.

**현재 확인된 배포 방법은 수동입니다.** 저장소에는 배포 자동화가 없으며, 서버에 별도 예약 작업이 있는지는 아직 확인하지 못했습니다. GitHub 푸시만으로 반영됐다고 가정하지 말고 검증한 `main` 커밋을 서버에 반영해 서비스를 다시 시작합니다. 서버가 실행 중인 커밋은 다음과 같이 확인합니다.

```bash
sudo git -C /opt/moim rev-parse --short HEAD
sudo systemctl is-active moim
```

## 배포 전후 순서

1. `dev`에서 통합 시험 후 `main` PR을 검토하고 병합합니다. 배포할 커밋을 기록합니다.
2. 기존 서버 소스에 미확인 변경이 없는지 확인하고, 기존 DB의 백업을 만듭니다. DB를 초기화하거나 기존 운영 파일을 덮어쓰지 않습니다.
3. GitHub에서 `main`을 가져와 기록한 커밋과 일치하는지 확인한 뒤 서버 소스를 해당 커밋으로 전환합니다. 설정 파일과 DB는 저장소 밖에 유지합니다.
4. `sudo systemctl restart moim` 후 서비스 상태를 확인합니다. 공개 주소의 첫 화면, 방 생성·두 사람 참여·수정, 실제 추천과 잇플 상세 이동을 시험합니다. `/healthz`는 프로세스 상태만 확인하며 실제 검색 성공을 보장하지 않습니다.
5. 실패하면 이전 배포 커밋과 로그를 확인해 복구합니다. DB를 과거 백업으로 자동 복원하지 않습니다.

현재 DB는 기존 직접 연동 준비 과정에서 만든 `trace_sequence` 테이블을 계속 보관합니다. K-Skill은 이 테이블을 사용하지 않지만 삭제하거나 재생성하지 않습니다. 기존 백업 및 데이터와의 호환성을 유지하기 위한 것입니다.

## 설정과 백업

로컬 `.env`는 서버에 자동 복사되지 않습니다. 서버의 `/etc/moim/moim.env`에 `MOIM_ALLOWED_HOST`, `EATPL_SOURCE=kskill` 및 선택적으로 `OPENROUTER_API_KEY`를 설정합니다. 설정 파일을 채팅, Git, 로그에 남기지 않습니다. 서비스 환경 변수 변경 후에는 앱 재시작이 필요합니다.

### 별도 도메인의 프론트엔드 (선택)

기본값은 같은 도메인만 허용합니다. 소유를 확인한 별도 HTTPS 프론트엔드에서 API를 호출해야 할 때만 `/etc/moim/moim.env`에 `MOIM_ALLOWED_API_ORIGINS=https://frontend.example.com`처럼 정확한 출처를 명시합니다. 여러 출처는 쉼표로 구분하며, 와일드카드·포트·경로·HTTP 주소는 허용하지 않습니다. 정확히 일치하는 출처에만 실제 API 경로의 CORS를 허용하고, 쿠키·브라우저 자격 증명 공유는 허용하지 않습니다. 기존 API 서버의 `MOIM_ALLOWED_HOST`는 변경하지 않습니다.

이 설정만으로 프론트엔드가 연결되지는 않습니다. 프론트엔드는 API 서버 주소를 사용해야 하며 CDN과 Nginx가 해당 API의 `OPTIONS` 및 필요한 메서드를 전달하는지 확인해야 합니다. 다른 도메인에서는 기존 브라우저의 응답 수정 토큰이 자동 이전되지 않습니다. 링크와 개인정보 노출 범위를 검토하고 실제 두 도메인에서 검증한 뒤 적용합니다.

백업은 제한된 권한의 서버 디렉터리에 아래처럼 새 파일로 생성합니다. 기존 이름을 덮어쓰지 않습니다.

```bash
cd /opt/moim
sudo install -d -m 700 /root/moim-backups
sudo /opt/moim/.venv/bin/python -m moim.backup /var/lib/moim/moim.sqlite3 "/root/moim-backups/manual-$(date +%Y%m%d-%H%M%S).sqlite3"
```

백업에는 참여자 정보가 포함됩니다. 이 백업은 같은 서버에 있어 서버 손실에 대비하지 못합니다. 정기 백업, 별도 보관소와 복구 시험이 필요합니다.

## 운영 전 확인

- 방 링크를 아는 사람은 참여자 이름과 알레르기 조건을 볼 수 있습니다. 공개 홍보 전 접근·보관·삭제 정책과 요청 제한을 정하고 검증합니다.
- 알레르기 안전성은 실제 재료를 확인할 수 없어 보장할 수 없습니다. AI 가격과 분위기도 추정치입니다.
- 검색 서비스 장애·빈 결과, 지도 정보의 부재, 최종 도메인의 HTTPS와 유입 집계, 제공처 사용 조건을 확인합니다.
- Gunicorn은 worker 한 개를 유지합니다. 현재 참여 인원 제한은 여러 worker나 서버 사이의 동시 접근을 보장하지 않습니다.
- 인스턴스와 Distribution 비용, 인증서 만료·자동 갱신, 서버 상태를 주기적으로 확인합니다.
