# AI Relay

[English](README.md) · **한국어** · [日本語](README.ja.md)

**Claude 데스크톱(Code 탭)과 Codex 데스크톱 대화**를 연결해 메시지를 주고받는 도구입니다.
일반 중계는 모델을 호출하지 않습니다. 선택형 독립 검토는 로그인한 CLI 구독을 사용하며, 별도 API 키는 필요 없습니다.

## 최근 업데이트

**0.1.0-preview.3 · 2026-10-25** — [독립 검토·핵심만 이어 검토](docs/independent-review.ko.md), 결과 저장과 중복 실행 방지를 추가했습니다. 기존 일반 우편은 유지합니다. [변경 내역](CHANGELOG.ko.md). Git 기준 버전이며 ZIP 배포는 별도입니다.

| 기존 | 개선 후(선택 사용) |
|---|---|
| 검토할 때 긴 작업 대화를 깨움 | 요청과 지정 근거만으로 새 검토 실행 |
| 재검토에 이전 문맥이 필요 | 직전 결론·근거·다음 행동만 전달 |
| 앱 접수만으로 완료 확인이 어려움 | 검토 결과·연결 답장 상태를 별도 기록 |

검토에는 토큰이 사용됩니다. 응답 속도나 일정한 절감률을 보장하지는 않습니다.

## 시작하기

Git만 설치돼 있다면:

```powershell
git clone https://github.com/LeeJuls/ai-relay.git
cd ai-relay
.\relay.cmd help --lang ko
```

`relay.cmd`가 호환되는 Node.js를 찾아 사용하고, 없으면 최초 실행 때 검증된 파일을 자동 다운로드합니다. 시스템 설치는 필요 없습니다. 인터넷 없이 실행하려면 Node.js가 포함된 [Windows ZIP](https://github.com/LeeJuls/ai-relay/releases)을 사용하세요.

[설치 가이드](docs/usage.ko.md)에 따라 각 수신 대화 안에서 도우미를 등록하세요. 별도 npm 설치는 필요 없습니다.

Windows x64 실험 시험판입니다. 앱 호환성과 외부 사용자 검증은 진행 중입니다.

## 라이선스

[MIT](LICENSE): 사용·수정·재배포를 자유롭게 하세요. 저작권·라이선스 고지는 유지하고, 출처로 [LeeJuls](https://github.com/LeeJuls/ai-relay)를 남겨주세요.

[사용 가이드](docs/usage.ko.md) · [지원 범위](SUPPORT.md) · [보안](SECURITY.md)

[토큰 절약·공용 슬롯 안내](docs/token-efficiency.ko.md)
