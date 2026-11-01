# Discord 세션 요약 공유 Implementation Plan

> For agentic workers: 실행 시 `superpowers:executing-plans`로 아래 TDD 단계를 순서대로 수행한다. 독립 최종 코드 리뷰는 구현 후 별도로 수행한다. 아래 체크리스트는 구현 후 갱신했으며 실제 결과와 환경 제한은 하단에 기록한다.

**Goal:** 선택한 Claude·Codex 작업 대화의 사람이 확인한 짧은 요약을 `준영-claude`·`준영-codex`가 고정 AI 채널에 각 1건, 총 2건만 게시하는 출력 전용 경계를 오프라인으로 구현·검증한다.

**Architecture:** 신뢰하는 운영자 binding/승인 manifest → 순수 요약 검증 → 별도 영속 outbox의 선행 claim → 주입된 봇별 publisher → 순차 batch 종료. 요약 본문은 권한이나 목적지를 정하지 못한다. 실제 credential/Discord 실행 진입점은 이번 구현에 추가하지 않는다.

**Tech Stack:** Node 24.14.0 ESM, 표준 모듈, `node:test`, 기존 `lib/storage.mjs`, 주입형 Discord REST 경계. 의존성 추가 없음.

**Spec:** [승인된 출력 전용 설계](../specs/2026-10-31-discord-session-summary-sharing-design.md). 사용자 승인 2026-10-31 06:53:54 UTC. 이후 전달된 Claude 기술 피드백은 아래 안전 조건으로 반영한다.

## Global Constraints

- 기존 격리 worktree `ai-relay-discord-mock`에서만 작업한다. 원본 main·private pipe·일반 수신기·기존 질문/응답 runtime을 바꾸지 않는다. 이 신규 작업의 commit/push는 하지 않는다.
- 실제 토큰 파일·인증·실설정·기존 세션·채널 기록을 읽지 않는다. 새 AI 호출, Discord 접근, 봇 생성/이름 변경/설치/권한 변경, 실게시, daemon은 제외한다.
- Claude 본문은 사용자가 전달한 출처이며 직접 세션 검증이 아니다. Codex 본문은 현재 작업 대화가 작성한 요약이다. 출처를 서로 바꾸거나 입력 실행 권한으로 해석하지 않는다.
- 실제 Claude 요약 도착과 무관하게 합성 fixture로 전부 시험한다. 출력 성공은 Codex 입력 연결·Claude↔Codex 대화 성공의 증거가 아니다.
- 사용자 확인은 최종 표시 본문·시각·출처·bot·목적지·2건 수량에 적용한다. 코드의 manifest 검증이 사람의 실제 승인 자체를 입증하지는 않는다.
- 각 봇의 credential callback/실행 기록은 분리한다. 공유 trial ledger는 quota/중복 상태만 조정한다. 본문·비밀·raw 오류/응답/헤더는 진단 로그에 남기지 않는다.

## Review Focus

| 위험 | 책임 경계와 필수 시험 |
| --- | --- |
| 출처 위장·교차 provider·목적지 변경 | policy: 신뢰 binding/manifest와 strict draft 분리, 불일치 시 외부 호출 0 |
| 승인 이후 본문 변경·민감정보/멘션 누출 | policy: timestamp 포함 최종 본문 해시 고정, 알려진 패턴 거부·길이 실측 |
| 동시·재시작·새 ID로 중복 게시 | store: trial/provider quota와 bot/channel/body 해시 중복키, durable claim·단일 실행 |
| 전송 후 저장 실패·불확실 결과 재송신 | publisher/store: once-only effect, receipt 검증, claim 보존·held·자동 재시도 0 |
| 부분 실패·시간 초과 후 추가 실행 | batch: 순차 최대 2건/3분, 실패 시 잔여 중지, 늦은 callback·정리 검증 |

## 고정 계약과 결정

- `Bindings`: 운영자가 제공한 `trial_id`, `guild_id`, `channel_id`, `owner_id`, 차단 채널, `sources.claude/codex`. 각 source는 고정 `source_session_ref`, `provider`, `bot_id`, `display_name`, `provenance`를 가진다. 두 bot ID는 달라야 한다. 실제 값 대신 합성 ID로 시험한다.
- `Draft`: `{slot, revision, authored_at, sections:{completed,verified,unverified,next}}`만 허용한다. 출처/시각은 본문이 인증하는 사실이 아니라 운영자가 검토하는 진술이다. accessor/prototype/알 수 없는 키·target/auth/history/attachment 필드는 거부한다.
- `snapshotBindings(input)`은 검증한 JSON 스냅샷을 만든다. `prepareSummary({bindings,draft,locale})`는 출처·작성 시각·네 항목을 모두 렌더링한 불변 `PreparedSummary`를 반환한다. 현재 상태 진술은 작성 시점 기준임을 표시한다.
- 최종 본문 전체는 **1800 UTF-16 code units 이하 AND UTF-8 4096 bytes 이하**다. 최신 사용자 승인에 따라 기존 REST 상한 1800과 일치한다. 분할/절단/사후 문구 추가를 하지 않는다. 멘션은 치환하지 않고 `@everyone`, `@here`, `<@...>`, `<#...>` 등 알려진 Discord 형식을 거부하며 `allowed_mentions`도 빈 값으로 고정한다.
- 알려진 credential/header·개인 절대 경로 형식은 게시 중단 후 본문 수정 요청으로 반환한다. 일반 비밀 탐지의 완전성을 주장하지 않는다. 사람 검토를 함께 요구하며 실제 비밀 파일과 비교하지 않는다.
- `ExpectedManifest`: `{schema_version,trial_id,batch_id,approval_ref,approved_at,expires_at,bindings_digest,entries:[{slot,summary_id,revision,content_digest}]}`. 신뢰 운영자 입력이며 draft의 `approved:true`를 받지 않는다. 정확히 두 entry, 두 source가 있어야 한다. `validateApproval({expectedManifest,bindings,summaries,now})`는 완전히 일치해야 통과한다.
- 승인 만료 기본값 15분은 mock용 제안이다. 실제 게시 전에 운영자가 확정한다. 실행 기한은 `min(start+180000, expires_at)`이며 승인 만료 후 실행하지 않는다.
- `content_digest`는 timestamp/provenance까지 포함한 최종 본문의 SHA-256이다. `summary_id`는 source/provider/bot/목적지/revision/content digest의 canonical 값으로 고정한다. nonce는 이 ID의 24자리 hex다. secret은 해시하지 않는다.
- 별도 `dedup_key=SHA256(bot_id,channel_id,content_digest)`와 **trial/provider당 1회 claim quota**를 함께 보존한다. timestamp/revision/summary ID/batch ID만 변경해 held/accepted를 우회하지 못한다. 동일 trial root에서 다른 trial로 교체하지 못한다. 새 trial은 별도 운영자 승인 사항이며 자동 생성하지 않는다.
- 봇 client는 publisher에만 주입한다. 신뢰 binding의 bot ID와 client의 검증 결과를 비교한다. client가 제시한 ID로 기대값을 만들지 않는다. fake identity 시험은 실제 Discord identity/권한 입증이 아니다.

## Task 1 — 순수 policy·승인 스냅샷·합성 fixture

**Files:** 새 `tools/discord-summary/policy.mjs`, `test/discord-summary-fixture.mjs`, `test/discord-summary-policy.test.mjs`; `locales/en.json`, `locales/ko.json`, `locales/ja.json`에 네 항목/출처/검토 상태 문자열 추가.

- [x] RED: `rejects forged provenance or draft authority`, `rejects crossed providers and shared bot identity`, `rejects wrong destination and missing source`, `freezes final preview including timestamp`, `rejects changed approved body or binding` 시험을 먼저 쓴다. 실패가 목표 기능 부재 때문인지 확인한다.
- [x] RED: `rejects mentions without rewriting`, `rejects known fake secrets and private paths`, `measures fully rendered multibyte text`, `rejects oversize without splitting`, `rejects accessors and late mutation` 시험을 추가한다. 승인 이후 locale/시각 변경도 해시 불일치여야 한다.
- [x] 최소 구현: 위 세 순수 함수와 strict schema/canonical digest만 구현한다. 임의의 draft가 승인 manifest를 스스로 만들게 하지 않는다. locale는 운영자 입력에 고정한다.
- [x] GREEN: `node --test test/discord-summary-policy.test.mjs`; EN/KO/JA key parity와 빈 입력·경계값을 확인한다. fixture에는 실제 ID/요약/경로/secret을 넣지 않는다.

## Task 2 — 별도 영속 outbox와 trial quota

**Files:** 새 `tools/discord-summary/store.mjs`, `test/discord-summary-store.test.mjs`, 필요 시 `test/discord-summary-concurrency-child.mjs`.

**Interface:** `openSummaryStore({root,approvedBatch})` → `beginRun({run_id,started_at,deadline_at})`, `claimNext(run_id)`, `recordOutcome({run_id,summary_id,generation,outcome})`, `stop({run_id,reason})`, `status()`, `close()`.

- [x] RED: `persists claim and quota before effect`, `allows one concurrent run and one inflight`, `reopens accepted without resending`, `blocks changed IDs and timestamps after held`, `rejects changed binding or batch in existing trial`를 작성한다.
- [x] RED: `preserves interrupted claim`, `rejects stale generation`, `preserves previous ledger on failed write`, `fails closed on corrupt or foreign root`, `retains dedup history`를 작성한다. 별도 인스턴스·필요한 Node 자식 프로세스로 writer 경쟁을 검증한다. 자식은 Node fixture만 실행한다.
- [x] 최소 구현: `lib/storage.mjs`의 owned path/atomic JSON/writer lock을 재사용한다. 기존 mailbox나 discord-question ledger를 열지 않는다. row는 `pending/claimed/accepted/not_sent/held`, batch는 `prepared/active/finished/stopped/held`로 분리한다. 미시도 건은 `not_attempted`로 보고한다.
- [x] `beginRun`은 한번의 CAS로 활성화한다. 다른 활성 실행을 멋대로 죽었다고 보지 않는다. 중단된 claim은 영속 보존하며 새 프로세스는 `inspection_required`를 반환하고 POST하지 않는다. lock 삭제·자동 recovery·이력 초기화는 구현하지 않는다.
- [x] GREEN: `node --test test/discord-summary-policy.test.mjs test/discord-summary-store.test.mjs`; fake effect가 claim 저장 전에 불릴 수 없고 총 claim은 provider별 1개임을 확인한다.

## Task 3 — 봇별 publisher 경계와 결과 분류

**Files:** 새 `tools/discord-summary/publisher.mjs`, `test/discord-summary-publisher.test.mjs`. 기존 `tools/discord-adapter/rest.mjs`는 수정 없이 저수준 고정 채널 request guard만 재사용한다.

**Interface:** `createSummaryPublisher({expectedManifest,bindings,summaries,botClients,now})` → `publish(claimedSummary)`, `close()`. 각 client는 `verifyIdentity()`와 주입된 `request`만 제공하며 credential은 밖으로 반환하지 않는다.

- [x] RED: `rejects manifest source or target mismatch before client calls`, `rejects wrong verified bot before POST`, `publishes one pinned nonce with suppressed mentions`, `validates receipt id channel and nonce`를 작성한다.
- [x] RED: `classifies 401 403 429 and rejected 4xx as not_sent`, `holds 5xx timeout malformed receipt and thrown transport`, `does not retry duplicate or uncertain publish`, `redacts fake secrets from every diagnostic`를 작성한다. raw 오류에 가짜 token/header를 넣되 safe code/count만 노출돼야 한다.
- [x] 최소 구현: bot identity를 claim 후 확인하고 고정 채널 POST만 수행한다. request timeout 10초·response 상한 64KB·redirect 금지·retry 0을 유지한다. POST 호출 후 throw는 기본 uncertain이다. POST 전 확실한 검증 실패와 구분한다.
- [x] body/응답은 await 경계 전에 안전한 값으로 스냅샷한다. 중복·동시 publisher 호출 자체도 보류하고 claim generation과 일치하는 결과만 store에 반영한다. 전송 뒤 저장 오류는 claim/quota를 남기고 batch를 멈춘다.
- [x] GREEN: `node --test test/discord-summary-publisher.test.mjs`; 합성 fetch만 사용하며 공식 네트워크·토큰 loader·live entry import는 금지한다.

## Task 4 — 순차 bounded batch와 fake-only 실행 예제

**Files:** 새 `tools/discord-summary/batch.mjs`, `tools/discord-summary/scenario.mjs`, `test/discord-summary-batch.test.mjs`, `test/discord-summary-scenario.test.mjs`.

**Interface:** `openSummaryBatch({root,expectedManifest,bindings,summaries,publisher,now,timers})` → `run()`, `stop()`, `status()`, `close()`. fake clock/timer를 주입한다.

- [x] RED: `requires both approved summaries before start`, `posts Claude then Codex exactly once`, `rejects concurrent runs`, `stops remaining entry on definite or uncertain failure`, `does not bypass quota with new revision`을 작성한다.
- [x] RED: `deadline stops dispatch and aborts inflight`, `stop before start sends nothing`, `late callback cannot trigger next post`, `closes clients timers and child fixtures`, `import has no effects`를 작성한다. 완료 후 추가 run과 재시작도 0 POST여야 한다.
- [x] 최소 구현: 두 건 준비 후에만 시계를 시작한다. 두 receipt 확인 즉시 종료, 첫 실패/held/명시 stop/최대 3분이면 잔여 dispatch를 차단한다. 전송 중 취소의 불확실성은 held로 보존한다. 성공/held/not_sent/not_attempted counts만 출력한다.
- [x] scenario는 항상 fakeDiscord/fakePublisher만 사용하며 live flag·기본 fetch·환경 토큰 자동 탐색이 없다. `node tools/discord-summary/scenario.mjs --root <새 합성 시험 폴더>`로 예제를 실행할 수 있게 한다. 기존 root 이력은 삭제하지 않는다.
- [x] GREEN: `node --test test/discord-summary-*.test.mjs`; 네트워크·AI 호출·history 조회·credential loader 호출 카운트 모두 0, POST fixture 2회, 각 source 1회임을 확인한다. 실제 사용량 측정으로 표현하지 않는다.

## Task 5 — 문서·회귀·독립 리뷰

**Files:** 새 `docs/discord-session-summaries.md`; 관련 설계/계획의 체크리스트; 사용자 노출 동작을 설명하는 `CHANGELOG.md`, `CHANGELOG.ko.md`, `CHANGELOG.ja.md`를 함께 갱신한다. 버전 bump·release artifact는 만들지 않는다.

- [x] fake 실행 명령, 네 항목 입력, 승인 preview/manifest, 출처 한계, known-pattern 검사 한계, 상태/중지/불확실 복구 절차를 적는다. held는 사람의 확인 전 재전송하지 않으며 새 ID로 우회하지 않는다.
- [x] `node --test test/discord-summary-*.test.mjs` → `npm test` → `npm run check` → `npm pack --dry-run --ignore-scripts`를 실행한다. 먼저 현재 scripts가 여전히 로컬 시험임을 확인한다. 설치/실연결을 요구하는 변경이 있으면 실행하지 않고 명시한다.
- [x] 최종 diff에 실 ID/개인 경로/본문 로그/기계 설정/secret이 포함되지 않았는지 **변경한 명시적 파일만** 검토한다. 실제 secret 파일을 열거나 광범위 diff에 포함하지 않는다.
- [x] 독립 읽기 전용 리뷰로 Review Focus 다섯 항목과 기존 runtime 불변을 검토한다. 지적된 오류는 회귀 시험부터 보완하고 영향 범위만 재검증한다. 새 시험 수/실패/미실행/명령/리뷰 수정/프로세스 정리를 Obsidian에 기록한다.

## 실행 체크포인트와 미확정 준비

1. **권장 실행:** 같은 격리 worktree에서 한 구현자가 순차 TDD. Task 1 완료 시 manifest/본문 해시, Task 2 완료 시 quota/재시작, Task 4 완료 시 효과 수/종료를 점검한다. fake 시험은 실제 Claude 요약 대기를 이유로 멈추지 않는다.
2. **오프라인 완료:** 새 시험·전체 회귀·check·pack과 리뷰 결과를 보고한다. 과거 309 PASS/CI와 과거 Claude 왕복 1건은 역사적 근거이며 이번 출력 기능 검증으로 재사용하지 않는다.
3. **사용자 자료 대기:** 사용자가 전달할 Claude 요약과 두 최종 본문 확인. Claude 98개 재현은 사용자 전달, 이후 시험과 구분한다. 작성 시각 이후 상태 변화가 있으면 승인 전에 새 본문으로 재검토한다.
4. **live 별도 승인:** aibot 재사용/표시 이름 변경 여부, 두 번째 bot/app 생성·설치, 두 봇의 실제 ID·AI 채널 전용 effective ACL, 각 로컬 credential 사용 범위 확인이 먼저다. 그 후 정확한 최종 preview/manifest와 최대 3분·총 2건 게시 시작을 승인받는다. 이번 계획은 이를 실행하지 않는다.

## 계획 자체 검토

- 설계 범위와 파일/함수 이름을 대조했다. 일반 질문 publisher를 요약으로 위장하거나 resume/AI 호출을 추가하지 않는다.
- 다섯 실패 유형마다 소유 module·구체적 RED 시험·완료 조건을 지정했다. 영속 quota가 summary ID/시각 변경 우회를 막고, 활성 실행/중단 claim을 구분한다.
- 피드백 채택: 최종 문구 길이/해시, 멘션 발견 시 거부, 봇별 credential/실행 분리, 순차 게시, 작성 시각, 실제 ACL/이름 변경 승인 분리. 최신 구현 승인에 따라 1800 상한을 적용한다. 이전800 제약은 대체됐다.
- 초기 계획 작성 이후 사용자 승인으로 제품 구현·오프라인 시험을 수행했다. live 연결·신규 commit/push는 수행하지 않았다.

## 구현·검증 결과 (2026-10-31)

- 최신 승인 결정: 1800 UTF-16 units AND UTF-8 4096bytes, 최종 문구 전체 실측. 작성 시각은 본문, 승인 시각은 고정 manifest에 포함한다.
- policy/store/publisher/batch/scenario와 합성 fixture 및 다섯 시험 파일을 구현했다. 신규 51/51 PASS, 실패·취소·skip 0.
- 독립 리뷰 Important 2건을 RED→GREEN으로 수정했다: 가짜 claim 허용 → 저장소가 저장 성공 뒤 발급하는 프로세스 내 일회용 capability 소비/ledger 재검증 필수; 입력 배열 map 실행 → strict prototype/index descriptor 복제, 사용자 메서드 호출 금지. capability는 직렬화·재시작·재사용할 수 없다.
- 추가 RED→GREEN: 지연 timer 전에 도착한 기한 초과 receipt 보류, foreign nonempty root 거부, 알 수 없는 ledger 필드 거부. 전송 후 outcome 저장 실패 claim 보존, 새 timestamp/ID 우회 차단도 검증했다.
- 전체 npm test 최초 348 중344 PASS/4 FAIL, 이후 351 중347 PASS/동일4 FAIL. 기존 core와 mock-store junction EPERM, dashboard loopback EACCES, package Windows CIM 접근거부다. 이름 제외 필터가 해당4개를 제외하지 못한 것을 확인한 뒤 파일 목록으로 명시 제외했다. 권한 상향/우회는 하지 않았다. 최종 선택 회귀 결과는 실행 ledger/Obsidian에 별도 기록한다.
- 테스트 보강: UTF16 정확1800/1801 경계, UTF16 이하의 UTF8 초과, 기존 guarded REST에 합성 oversize/redirect/timeout 오류 주입, 새 publisher의 소비된 capability 재사용 거부. timeout 시험은 실제10초 대기가 아닌 합성 timeout 오류 분류이며 실제 네트워크를 감시한 시험은 아니다.
- 문서/3개 locale/3개 changelog를 갱신했다. 실제 Claude 본문 수신·bot 준비·identity/ACL·credential 사용·실게시 승인은 여전히 별도다. 독립 reviewer는 수정 전 코드를 검토했으며 수정 후 재리뷰 대신 실패 재현 시험과 회귀로 검증했다.

최종 검증: 신규51/51, 실행 가능한40개 파일 회귀332/332(환경 제한4개 파일의28개 시험 제외), check syntax0/modules47/locale99, pack dry-run exit0/48파일. 전체 회귀의 기존4개 권한 실패는 미해결 환경 제한이며 전체 green으로 보고하지 않는다. UTF-8 및 상대 링크8개 확인, tracked diff whitespace 검증 성공.

## 후속 작업 — guarded/cancellable client 경계

- [x] 기존 rest.mjs는 외부 AbortSignal이 아닌 자체10초 timeout만 사용함을 읽기 확인했다. 기존 live 동작을 바꾸지 않고 새 `tools/discord-summary/client.mjs`에서 POST validator를 재사용했다. 실제 token loader/fetch 기본값/live CLI는 추가하지 않았다.
- [x] 주입형 credential/fetch/clock/timers, official identity GET과 pinned AI channel POST, 외부 취소+작업별10초+trial 기한을 구현했다. timer 설치가 끝난 뒤만 작업을 예약한다. credential 전후·fetch 직전·응답 이후를 검사한다. identity/receipt allowlist만 반환하고 raw 오류/본문은 노출하지 않는다.
- [x] prePOST 취소/기한은 private error provenance로 확실한 not_sent, fetch 시작 후 취소/timeout/응답 오류는 uncertain으로 구분한다. publisher가 일반 transport 오류를 not_sent로 오인하지 않도록 했다.
- [x] `test/discord-summary-client.test.mjs`와 `test/discord-summary-transport.test.mjs`, publisher 회귀를 추가했다. 실제 guarded client→publisher→store→batch를 합성 wire로 통합했다. abort 무시 fetch 및 늦은 receipt에도 held/잔여 게시0/재전송0을 확인했다. 가짜 timer로 검증하므로 실제10초 지연이나 OS socket 해제를 입증하는 시험은 아니다.
- [x] 독립 후속 리뷰 Important2를 RED→GREEN으로 수정했다. identity 확인 뒤 callback credential이 달라지는 문제는 client 내부 메모리 고정으로 해결했다(파일 복사/해시/출력 없음). 지연 timer가10초 경계를 우회하는 문제는 operation deadline 고정과 매 await 전후 검사로 해결했다. timer 설치 실패 뒤 예약 effect가 남는 문제도 실패 재현 후 수정했다.
- [x] 요약 시험은 이전51개에20개를 추가하여 **71/71 PASS**. 추가20개는 client17개+publisher1개+transport2개다. 이전 full351은 당시 신규42개를 포함했고, 이후332는 신규51개를 포함하면서 제한 파일28개를 제외한 수다. 서로 다른 revision의 수치를 그대로 빼면 안 된다. 최신 수치와 명령은 실행 ledger/Obsidian에 기록한다.

실환경 준비 최소 묶음(미실행): 기존 aibot을 준영-claude로 재사용/rename 승인, 신규 준영-codex 앱·봇 생성 승인, 지정 guild에 최소 설치와 두 봇의 AI channel 전용 effective ACL 확인, 봇별 token 사용자 발급·ignored 로컬 저장 및 정확한 프로그램 인증 사용 승인. 그 후 사용자 전달 Claude 요약과 두 최종 preview/manifest 확인, bounded2건 실제 시작 승인이 필요하다. 기존 권한 거절을 반복하거나 더 넓은 역할 권한으로 우회하지 않는다.

환경 실패 분류: junction2개는 sandbox 파일시스템 기능 제한, dashboard는 local loopback 접속 제한, package는 Windows CIM 프로세스 메타데이터 접근 제한이다. 각각 적합한 지원 환경 또는 명시적으로 승인된 테스트 권한 검토가 필요하며 봇 token/Discord 권한으로 해결되지 않는다. 이번에는 실패 원인 증거만 기록하고 권한 변경/재시도를 하지 않았다.

후속 최종 검증: 신규71/71, 제한4개 파일28개 시험을 제외한42개 파일352/352 PASS(실패/취소/skip0), check syntax0/modules48/locale99, pack dry-run exit0/48files. 최신 전체 예상380개는 산술상 수치이며 전체 실행 성공으로 주장하지 않는다.
