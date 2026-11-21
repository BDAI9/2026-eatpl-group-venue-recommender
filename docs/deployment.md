# 운영 배포·복구 가이드

**이 문서는 최신 배포 절차의 단일 기준입니다.** 과거 PR별 배포 기록은 GitHub PR·커밋 이력에서 확인할 수 있습니다.

> GitHub `main`과 Vercel 빌드 상태만으로 AWS 백엔드 배포 완료를 확인할 수 없습니다. 실제 실행 SHA는 SSH에서 확인해야 합니다. 이 문서는 실행 완료 기록이 아닙니다.

## 운영 구성

| 위치 | 역할 |
| --- | --- |
| [jj2ya.vercel.app](https://jj2ya.vercel.app/) | 정적 프론트엔드 (Vercel) |
| [jj-moim.amazonlightsail.com](https://jj-moim.amazonlightsail.com/) | HTTPS API (Lightsail) |
| `/opt/moim` | 서버 코드 |
| `/etc/moim/moim.env` | 서버 비밀 설정 |
| `/var/lib/moim/moim.sqlite3` | 운영 SQLite DB |
| `moim` systemd | Gunicorn 1 worker / 여러 스레드 |

### 1. 배포 전 확인

아래는 읽기 전용입니다.

```bash
sudo systemctl is-active moim
sudo git -C /opt/moim status --porcelain
sudo git -C /opt/moim rev-parse HEAD
sudo test -f /etc/moim/moim.env && echo "Config exists"
sudo test -f /var/lib/moim/moim.sqlite3 && echo "DB exists"
```

- `status --porcelain`에 내용이 있다면 중단하고 확인합니다. 무조건적인 `reset --hard`는 금지합니다.
- **기존 전체 SHA**를 기록하고, GitHub에서 새 `main` SHA와 CI 결과를 확인합니다.
- 서버 설정에는 `MOIM_ALLOWED_HOST=jj-moim.amazonlightsail.com`, `MOIM_ALLOWED_API_ORIGINS=https://jj2ya.vercel.app`, `EATPL_SOURCE=kskill`이 필요합니다.
- `OPENROUTER_API_KEY`·`KAKAO_REST_API_KEY`는 비밀입니다. 설정값을 출력하거나 PR에 넣지 않습니다. `KAKAO_JS_KEY`는 공유 SDK용이므로 공개될 수 있습니다.
- 잇플 상세정보는 제공처의 사용 조건을 확인한 경우에만 `EATPL_DETAIL_ENABLED=1`을 적용합니다.

### 2. 운영 DB 백업 (필수)

```bash
sudo install -d -m 700 /root/moim-backups
sudo /opt/moim/.venv/bin/python -m moim.backup \
  /var/lib/moim/moim.sqlite3 \
  "/root/moim-backups/manual-$(date +%Y%m%d-%H%M%S).sqlite3"
sudo ls -lh /root/moim-backups
```

새 파일 생성과 무결성 검증 성공을 확인하세요. 오류가 발생하면 **배포를 중단**합니다. 백업에는 참여자 입력·알레르기·토큰이 포함되므로 Git·채팅에 올리지 않습니다. 서버 유실에 대비한 별도 비공개 저장소 보관·복구 시험도 필요합니다. 기존 `trace_sequence`, `room_settings` 테이블을 임의 삭제하지 않습니다.

### 3. AWS 업데이트

작업 트리가 깨끗하고 백업이 확인된 경우에만 실시합니다. 서버가 분리 HEAD 상태일 수 있으므로 지정한 SHA를 정확히 체크아웃합니다.

```bash
sudo git -C /opt/moim fetch origin main
sudo git -C /opt/moim rev-parse origin/main
# 아래 <전체_SHA>를 위에서 확인한 배포 커밋으로 바꾸세요.
sudo git -C /opt/moim switch --detach <전체_SHA>
sudo git -C /opt/moim rev-parse HEAD
sudo systemctl restart moim
sudo systemctl is-active moim
curl -fsS https://jj-moim.amazonlightsail.com/healthz
```

명령이 실패하면 중단하고 로그를 확인합니다. 로그에는 민감한 값이 포함될 수 있으므로 외부 공유 전 확인합니다.

```bash
sudo journalctl -u moim -n 40 --no-pager
```

### 4. Vercel·실서비스 점검

Vercel Deployments에서 **Production / Ready / 원하는 `main` SHA**를 확인합니다. 이어서 `python deploy/check_production.py`로 공개 URL의 상태·허용 출처를 읽기 전용 점검합니다. 테스트 시 다른 브라우저로 방 생성→2명 참여→추천→eat.pl 상세 링크를 확인하고, 기존 방 수정 및 5/6·6/6 갱신과 음식 다수결을 확인합니다. `/healthz` 성공이나 Vercel Preview의 Ready만으로 실제 추천 성공을 판단하지 않습니다.

### 5. 롤백

- **AWS:** 사전에 기록한 `OLD_SHA`로 `sudo git -C /opt/moim switch --detach <OLD_SHA>` 후 재시작·상태 확인. 작업 트리 변경이 있다면 먼저 중단합니다.
- **Vercel:** 확인된 이전 Production 배포를 다시 승격하고 SHA를 확인합니다.
- **DB:** 예전 백업을 자동 복원하지 않습니다. 최신 모임·참여자 기록이 손실될 수 있으므로 별도 승인과 검토가 필요합니다.

### 운영 전 보완할 사항

링크로 노출되는 이름·알레르기 정보의 접근·보관·삭제 정책, 요청 남용 제한, eat.pl/K-Skill 사용 조건, 인증서/비용/백업 정책을 검토합니다. 단일 worker 전제의 동시성 설계를 검증 없이 확대하지 않습니다.
