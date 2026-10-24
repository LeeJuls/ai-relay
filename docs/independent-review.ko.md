# 독립 검토

[English](independent-review.md) · **한국어** · [日本語](independent-review.ja.md)

일반 우편은 기존처럼 연결된 작업 대화로 전달합니다. `send --mode review`는 해당 수신 대화를 깨우지 않고, 새로운 CLI 문맥에서 읽기 전용 검토를 한 번 실행합니다. 연결된 `result` 답장은 일반 우편으로 돌아가므로 요청자 대화에서는 턴이 생길 수 있습니다. 전체 대화가 필요한 작업보다 작은 독립 질문에 적합합니다.

## 수신 주소별로 한 번 설정

해당 제공자의 CLI를 별도 설치하고 ChatGPT 또는 Claude 구독으로 로그인하세요. 도구는 CLI 설치·로그인 변경·API 키 대체를 하지 않습니다. Windows에서는 최신 네이티브 `.exe`를 지정하며 `.ps1`·`.cmd`는 지원하지 않습니다. 필요한 옵션이 없는 구버전은 실행에 실패하고 중단합니다. 구독 사용 한도는 그대로 적용됩니다.

UTF-8 `review.json`을 만들고 경로·모델을 자신의 환경에 맞게 바꾸세요. 계정에서 사용 가능한 모델을 명시해야 하며 자동 대체하지 않습니다.

```json
{
  "cli": "C:/Tools/provider/cli.exe",
  "model": "YOUR-AVAILABLE-MODEL",
  "jobRoot": "C:/relay-review-jobs",
  "evidenceDirs": ["C:/review-evidence"],
  "deadlineMs": 180000
}
```

`jobRoot`는 프로젝트 및 상위 AGENTS.md·CLAUDE.md·.git 밖에 둡니다. 근거 폴더는 최대 8개이며 우편·검토 작업 폴더와 분리합니다. 인증정보·홈 폴더 전체는 지정하지 마세요. 사용자 수준의 필수 지침은 적용될 수 있습니다. 지정 범위는 **검토자에게 주는 지침이며 OS가 강제하는 읽기 허용 목록은 아닙니다.** 비밀 자료는 제출하지 말고 제공자의 읽기 전용 통제를 유지하세요.

```powershell
.\relay.cmd review-config --root C:\relay-data --as claude-demo --config-file review.json
# 기존과 같이 해당 수신 대화 안에서 실행:
.\relay.cmd start --root C:\relay-data --as claude-demo
.\relay.cmd send --root C:\relay-data --as codex-demo --mode review --task R1 --body-file question.txt --wake
```

반대 방향은 `codex-demo`에 Codex 실행 파일·모델을 별도 설정합니다. 프로그램 업그레이드 후에는 기존 도우미를 중지하고 각 수신 대화에서 다시 등록해야 새 코드가 반영됩니다. 다른 설치본이나 운영 중인 비공개 도우미는 자동 변경하지 않습니다.

## 이어 검토·상태 확인

```powershell
.\relay.cmd send --root C:\relay-data --as codex-demo --mode followup --previous <직전-검토-요청-전체ID> --task R1 --body-file followup.txt --wake
.\relay.cmd review-status --root C:\relay-data --as claude-demo
.\relay.cmd review-config --root C:\relay-data --as claude-demo --off
```

followup은 같은 주소 쌍·작업의 직전 **요청** 전체 ID를 사용합니다. 답장 ID가 아닙니다. 직전 결론·근거·다음 행동만 직렬화 6,000자 이내로 전달하며 생략 여부를 명시합니다. 세션 재개나 전체 대화 입력은 하지 않습니다. 검토 요청은 UTF-8 64 KiB까지이며 결과 형식·크기도 검증합니다.

## 신뢰성과 비용

- 실행 기록은 요청 전체 내용·데이터 위치·수신 주소·ID에 묶입니다. 중단·불확실한 실행을 자동 반복하지 않습니다. 실행 소유 프로세스가 없으면 `review-status`는 보류로 표시합니다. 살아 있는 PID도 진행의 증거는 아닙니다.
- 결과 저장 후 재시작하면 모델 재호출 없이 답장 저장을 마칠 수 있습니다. 답장 저장 시도 기록만 있고 정확한 연결 답장이 없으면 보류합니다. 원문이 보관함으로 이동해도 기존 연결 답장으로 대조합니다. 외부 모델 작업이 반드시 한 번만 실행됐다고 보장하지 않습니다.
- 실행·인증·시간 초과·출력 오류는 보통 중단 결과를 연결 답장으로 남깁니다. 충돌·저장·답장 오류는 보류로 남을 수 있으므로 상태·작업 폴더·로그를 확인하세요. 자동 재발송이나 일괄 완료는 하지 않습니다.
- `replied`는 연결 답장 저장과 원문 보관을 뜻합니다. 요청자 AI가 읽거나 행동했다는 뜻은 아닙니다. 일반 `accepted`도 전송 접수일 뿐입니다. 검토 대기는 일반 전달 집계와 분리해 `reviewPending`으로 표시합니다.
- 주소마다 한 번에 검토 하나를 실행하고 일반 우편은 별도 처리합니다. 중지 시 진행 중인 제한 시간 내 검토가 끝날 때까지 기다리며 대기 요청은 남겨 둡니다. 시간 초과 시 하위 프로세스 종료를 요청하지만 종료 완료를 보증하지는 않습니다. 검토를 끄면 대기 요청을 작업 대화로 대신 보내지 않습니다.
- 일반 전달은 모델을 호출하지 않습니다. 선택한 검토는 CLI 구독 한도를 사용하고 로컬 사용량·시간을 기록합니다. API 키·다른 제공자 환경 설정은 거부하며 우회하지 않습니다. 이 기능이 별도 API 결제를 요구하지는 않습니다. 일정한 속도·한도·토큰 절감을 보장하지 않습니다. 캐시·비캐시 입력과 출력, 작업 전체를 비교하세요.

작업 폴더에는 요청·로그·결과·사용량이 남습니다. 프로젝트 자료처럼 보호하고 불필요해지면 직접 정리하세요. 자동 기록 삭제는 없습니다. 공개 테스트는 격리된 시험 자료를 사용하며 앱·CLI 버전 호환성과 외부 사용자 적용은 아직 실험 단계입니다.

주소 전체의 실행 소유 기록은 데이터 폴더의 `reviews/<주소>/execution.json`입니다. 개별 기록 저장 전에 충돌해도 `review-status`의 `execution`으로 확인할 수 있습니다. 하위 프로세스 종료를 확인하지 못하면 이 기록을 유지하고 재시작 후에도 다음 검토를 막습니다. 일반 우편은 계속 처리합니다. 도우미를 중지한 뒤 오너가 작업과 프로세스 종료를 확인했을 때만 수동 해제하세요. 오래됐거나 부모 PID가 없다는 이유만으로 삭제하지 마세요. 안전하게 저장된 결과·답장은 대조 후 자기 소유 기록을 자동 해제합니다.

공식 설명: [Codex 비대화형 실행](https://learn.chatgpt.com/docs/non-interactive-mode), [Claude CLI](https://code.claude.com/docs/en/cli-reference). 별도 API SDK 의존성은 추가하지 않습니다.
