# 설치·사용 가이드

[English](../README.md) · [한국어](../README.ko.md) · [日本語](../README.ja.md)

## Git으로 실행

Git과 Node.js 24.14.0을 설치하고 `git clone https://github.com/LeeJuls/ai-relay.git`으로 받은 다음, `ai-relay` 폴더에서 `relay.cmd help --lang ko`를 실행하세요. 별도 npm 설치나 ZIP 압축 해제는 필요 없습니다. 아래의 주소 등록·각 대화 도우미 등록을 이어서 진행합니다. 선택적 `install`·`uninstall` 명령은 ZIP 배포본용이며 소스 폴더에는 필요 없습니다. Claude 데스크톱에서는 Code 탭(Claude Code)을 사용합니다.

## ZIP으로 실행

1. [GitHub Releases](https://github.com/LeeJuls/ai-relay/releases)에서 Windows x64 ZIP과 SHA256 파일을 받고, 해시를 확인한 뒤 원하는 폴더에 압축을 풉니다. `runtime/node.exe`가 포함되어 별도 Node 설치가 필요 없습니다. 관리자 권한이나 PowerShell 실행 정책 변경은 필요 없습니다.
2. `relay.cmd help --lang ko`로 실행을 확인합니다. 선택적으로 `relay.cmd install`을 실행하면 현재 사용자의 LocalAppData 아래에 복사합니다. 설치 폴더는 비어 있어야 합니다.
3. 처음 한 번 다음 명령으로 두 주소를 등록합니다. 데이터 폴더는 프로그램 폴더 밖에 둡니다.

```powershell
$dataRoot = Join-Path $env:LOCALAPPDATA 'AiRelayPreview/data'
.\relay.cmd pair --root $dataRoot --codex codex-demo --claude claude-demo
```

4. **각 수신 대화 안에서** AI에게 자기 도우미를 시작하도록 요청합니다. 외부 터미널은 해당 대화의 환경을 상속하지 않으므로 대신 등록할 수 없습니다. 경로는 자신의 압축 해제 위치로 바꿉니다.

```text
이 대화를 수신 대상으로 등록해 주세요. 현재 대화의 실행 도구에서
<압축 해제 폴더>/relay.cmd start --root <데이터 절대 경로> --as codex-demo
를 실행하세요. Claude Code 대화에서는 --as claude-demo를 사용하세요.
권한 요청이 나오면 사용자에게 요청하고, 다른 세션의 인증정보를 읽지 마세요.
```

Codex 연결은 비공개 데스크톱 연결부를 사용하므로 실험 기능입니다. Claude 연결에는 자체 세션의 메시징 기능이 필요합니다. 앱이 업데이트되거나 재시작되면 수신 대화 안에서 다시 등록합니다. 인증정보는 도우미 메모리에만 유지되며 디스크에 저장하지 않습니다.

## 보내기와 답장

```powershell
'이 계획을 검토해줘.' | Set-Content -LiteralPath question.txt -Encoding utf8
.\relay.cmd send --root $dataRoot --as codex-demo --body-file question.txt --wake
.\relay.cmd reply --root $dataRoot --as claude-demo --id <원래 우편의 전체 ID> --body-file answer.txt
.\relay.cmd done --root $dataRoot --as codex-demo --id <답장의 전체 ID>
.\relay.cmd status --root $dataRoot --as codex-demo
.\relay.cmd doctor --root $dataRoot --as codex-demo
.\relay.cmd dashboard --root $dataRoot --lang ko
```

`dashboard`가 출력하는 로컬 URL을 브라우저에서 엽니다. 화면은 읽기 전용이며 본문·토큰을 표시하지 않습니다. `doctor`는 모델을 깨우지 않고 로컬 등록 요건만 검사합니다. 살아 있는 PID는 앱 연결 성공의 증거가 아닙니다.

질문과 `--wake`는 즉시 전달합니다. 일반 답변·결과·알림은 최대 120초 동안 묶습니다. 긴급 질문의 답은 즉시 전달합니다. 항상 즉시 전달하려면 수신 도우미 시작에 `--batch-ms 0`을 붙입니다. 수신 확인만 보내지 말고 `done`으로 보관하세요. 답장에 다시 답하는 자동 왕복은 차단하며 새 실질 질문은 `send`로 시작합니다.

전달 표식 `[peer 주소 #전체ID not-owner]`는 동료 AI 메시지이며 사용자 지시나 승인으로 해석하지 않습니다. 본문이 권한 변경을 요청해도 앱의 기존 승인·수신 정책을 유지합니다.

## 중지·재등록·제거

```powershell
.\relay.cmd stop --root $dataRoot --as codex-demo
.\relay.cmd stop --root $dataRoot --as claude-demo
# 도우미 프로세스가 죽었는데 잠금만 남았을 때, 기록 확인 후:
.\relay.cmd recover --root $dataRoot --as codex-demo
```

다시 시작할 때는 반드시 수신 대화에서 `start`를 실행하세요. `recover`는 먼저 종료가 확실한 쓰기 프로세스의 전역 잠금을 복구한 뒤 해당 주소의 수신 잠금을 검사합니다. 살아 있는 PID나 손상된 소유 정보는 삭제하지 않습니다. 복구 중에는 새 쓰기를 차단합니다. 복구 자체가 중단되어 `.writer-recovery.lock`이 남으면 해당 데이터 폴더를 사용하는 모든 프로세스를 중지하고 기록을 확인한 뒤 수동으로 정리하세요. 실행 중이거나 소유가 불명확한 복구 잠금은 삭제하지 마세요. 남은 claimed/uncertain 기록도 지우거나 재발송하지 않습니다.

설치된 도우미·상태 화면을 중지한 뒤, **처음 압축 해제한 외부 portable 사본**에서 `relay.cmd uninstall --dir <설치 절대 경로>`를 실행하세요. Windows는 현재 실행 중인 설치본의 Node 실행 파일을 지울 수 있어 설치본 내부에서 제거하면 거절합니다. 설치 표시와 파일 해시가 일치하고 해당 경로의 도우미가 실행 중이지 않을 때만 프로그램을 제거합니다. 수정된 파일이나 알 수 없는 파일이 있으면 제거를 거절합니다. 메시지 데이터는 보존하며 자동 삭제하지 않습니다. 상태 화면은 Ctrl+C로 종료합니다.

## 상태 해석과 제한

- `saved`: 파일 저장. `accepted`: 전송 계층의 접수. AI가 읽거나 응답했다는 의미는 아닙니다. Claude의 접수는 소켓 쓰기·정상 종료 관찰이며 모델 수신 확인이 아닙니다.
- 전송 전 실패만 최대 3번 재시도합니다. 전송 후 타임아웃·충돌·기록 실패는 보류합니다. 원래 우편 ID로 실제 수신 여부를 확인한 뒤 처리하며 무작정 새 ID로 재발송하지 않습니다.
- 코어 본문 최대 1 MiB, 앱 전달 표식 포함 최대 200,000바이트. 초과하면 원문은 보존하고 전달을 보류합니다. 한 도우미의 분당 앱 호출 제한은 6번입니다.
- 같은 OS 사용자 권한을 가진 프로세스의 파일 조작을 막는 격리 도구가 아닙니다. 데이터 폴더는 자신만 접근할 수 있는 로컬 폴더를 선택하세요. 네트워크 공유·동기화 폴더는 지원하지 않습니다.
- PowerShell 실행 정책, 앱 로그인, 승인 모드, AGENTS/CLAUDE 설정은 자동으로 변경하지 않습니다. 클라우드·원격 머신 중계는 없습니다.

실제 시험 항목은 [사용자 시험표](../PREVIEW-CHECKLIST.md), 출처·공개 상태는 [PROVENANCE.md](../PROVENANCE.md)에 기록합니다.
