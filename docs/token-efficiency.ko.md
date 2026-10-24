# 불필요한 턴 줄이기

[English](token-efficiency.md) · **한국어** · [日本語](token-efficiency.ja.md)

일반 중계는 모델을 호출하지 않지만 우편 전달은 수신 대화의 문맥을 사용하는 새 턴을 만들 수 있습니다. [독립 검토](independent-review.ko.md)는 수신 작업 대화 대신 짧은 CLI 문맥에서 실행합니다. 결과를 받은 요청자 대화는 다시 깨어날 수 있습니다. 일정한 절감률·속도는 보장하지 않습니다.

- 큰 문맥(대략40만 토큰 이상)은 작업 묶음을 마칠 때 인계를 정리하고 새 대화를 고려하세요. 진행 중·짧은 대화를 반복 초기화하지 마세요.
- 결과는 `--type result`, 정보는 `--type fyi`, 막혀서 답이 필요한 경우만 question을 사용하세요. 호환성 때문에 기본값은 question입니다. 질문·wake와 긴급 질문의 답은 즉시, 일반 우편은 저장 시각부터 최대120초 묶습니다.
- 접수된 본문은 자동 보관하지만 **전달은 처리가 아닙니다**. 도우미가 올린 우편을 inbox/done으로 반복 읽지 말고 필요한 답장만 하세요. `--keep-pending`은 이전 동작입니다.
- 독립 작업은 처음에 범위를 충분히 지정하고 호스트가 허용할 때만 병렬 실행하세요. 이 도구가 에이전트·권한을 대신 관리하지 않습니다.
- 노트는 범위를 좁힌 검색 후 정확한 절을 읽으세요. 생략·모호함이 있으면 근거를 추가 확인하세요. 별도 vault 도구는 포함하지 않습니다.

## 슬롯과 기록 전용

```powershell
.\relay.cmd slot --root C:\relay-data --as codex-work --action take --name unity
.\relay.cmd slot --root C:\relay-data --as claude-work --action wait --name unity --timeout-ms 60000
.\relay.cmd slot --root C:\relay-data --as codex-work --action give --name unity
.\relay.cmd slot --root C:\relay-data --as codex-work --action history --name unity
```

인계 우편 대신 슬롯을 쓰고 결과의 `now`를 읽어 별도 상태 호출을 줄이세요. give는 첫 대기자에게 넘기거나 비우며 `--to`로 지정할 수 있습니다. 실제 대기 중이 아닌 대상에게는 도구가 FYI를 남깁니다. 죽은 대기자를 자동으로 건너뛰는 준비 확인 방식은 아닙니다. 알림은 오너 승인이 아닙니다.

`notificationPending`은 알림 저장 미확인으로 이후 슬롯 조작이 같은 ID로 재시도합니다. `historyWarning`은 상태 변경 후 이력 저장 실패입니다. 상태·이력은 다중 파일 원자적 거래가 아닙니다. `take --force --reason "오너의 실제 지시"`는 승인받은 인계에만 쓰며 옵션 자체가 권한은 아닙니다. 종료 신호·시간 초과는 자기 대기를 제거하지만 강제 종료는 죽은 대기를 남길 수 있습니다.

`send-only --root C:\relay-data --as claude-records`는 등록된 주소를 기록 전용으로 바꾸며 `--off`로 되돌립니다. 질문·wake는 저장 전에 거부합니다. FYI로 바꾸거나 다른 주소로 우회하지 말고 오너나 연결된 작업 대화에 명시적으로 문의하세요.

## 로컬 측정

```powershell
node tools/turn-cost/report.mjs C:\transcripts --since 2026-10-06T00:00:00Z --until 2026-10-07T00:00:00Z --provider claude --json
```

Codex는 `--provider codex`를 사용합니다. 두 시각은 필수이며 종료는 제외합니다. Claude message.id·Codex 누적 토큰 스냅샷으로 중복을 제외하고 task_complete/task_aborted로 작업을 닫습니다. 배치는 한 턴으로 계산하며 캐시 읽기·쓰기·비캐시 입력·출력을 구분합니다. 인계 키워드는 후보일 뿐입니다. 누락·손상을 보고하고 본문·인증정보는 출력하지 않으며 하위 폴더는 재귀 탐색하지 않습니다. 로그 사용량은 실제 결제·한도 효과의 보증이 아닙니다.

로컬 화면과 기본 `start --probe-ms 30000`을 사용하세요. 연결 확인·파일 감시는 모델을 깨우지 않습니다. reply/done은 모호하지 않은6자리 이상 앞·뒤 ID도 허용합니다. CLI는 쓰기 잠금의 사전 거부만 최대10회 짧게 기다리고 IO·불확실 전송은 재시도하지 않습니다. 자세한 명령은 [사용 안내](usage.ko.md)를 참고하세요.
