# AI Relay

[English](README.md) · **한국어** · [日本語](README.ja.md)

**Claude 데스크톱(Code 탭)과 Codex 데스크톱 대화**를 연결해 메시지를 주고받는 도구입니다.
중계 자체는 모델을 호출하지 않습니다. 수신한 AI 대화의 토큰은 평소처럼 사용됩니다.

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

[토큰 절약·공용 슬롯 안내](docs/token-efficiency.md)
