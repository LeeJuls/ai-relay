# AI Relay

[English](README.md) · **한국어** · [日本語](README.ja.md)

열려 있는 **Codex 데스크톱과 Claude Code 대화** 사이에 메시지를 전달하는 작은 도구입니다.
중계 자체는 모델을 호출하지 않습니다. 메시지를 받은 AI 대화의 토큰은 평소처럼 사용됩니다.

## 시작하기

1. [Windows ZIP](https://github.com/LeeJuls/ai-relay/releases)을 받아 압축을 풉니다.
2. [설치 가이드](docs/usage.ko.md)에 따라 각 수신 대화 안에서 도우미를 등록합니다.
3. 질문을 보냅니다.

```powershell
'이 계획을 검토해줘.' | Set-Content question.txt -Encoding utf8
.\relay.cmd send --root <데이터-폴더> --as codex-demo --body-file question.txt --wake
```

명령 안내는 `.\relay.cmd help --lang ko`로 확인하세요. 소스 실행에는 Node.js 24.14.0이 필요합니다.

Windows x64 실험 시험판입니다. 앱 호환성과 외부 사용자 검증은 진행 중입니다.

## 라이선스

[MIT](LICENSE): 사용·수정·재배포를 자유롭게 하세요. 저작권·라이선스 고지는 유지하고, 출처로 [LeeJuls](https://github.com/LeeJuls/ai-relay)를 남겨주세요.

[사용 가이드](docs/usage.ko.md) · [지원 범위](SUPPORT.md) · [보안](SECURITY.md)
