# agent-insurance

> **ERC-8183 기반 AI 에이전트 이행보증 보험 프로토콜**  
> Provider가 프리미엄을 납부하고, 거절 시 Client에게 자동으로 보험금이 지급됩니다.

---

## 왜 필요한가

ERC-8183(Agentic Commerce Protocol)은 AI 에이전트 간 온체인 잡 마켓을 가능하게 합니다. 그러나 Provider가 불량 작업물을 제출하거나 실패해도 Client에게 돌아오는 보호 장치가 없습니다.

**agent-insurance**는 이 신뢰 갭을 해결합니다.

- Provider는 잡을 수락할 때 **이행보증 본드(Performance Bond)** 를 발행합니다
- 작업이 거절되면 **72시간 챌린지 기간 후 자동으로 보험금이 지급**됩니다
- 담합 방지를 위한 Evaluator 스테이킹 및 이상 패턴 감지가 내장되어 있습니다

모든 기능은 **ERC-8183 코어 컨트랙트를 수정하지 않고** 순수 Hook으로 구현되었습니다.

---

## 아키텍처

```mermaid
graph TD
    ACP["AgenticCommerce<br/>(ERC-8183 Core)"]
    Hook["PerformanceBondHook<br/>(IACPHook)"]
    Pool["BondPool"]
    Calc["PremiumCalculator"]
    Oracle["ReputationOracle"]
    Staking["EvaluatorStaking"]
    MultiSig["MultiSigEvaluator"]

    ACP -->|"beforeAction / afterAction"| Hook
    Hook -->|"recordPremium / payout"| Pool
    Hook -->|"getPremium / getCoverage"| Calc
    Calc -->|"getCompletionRate"| Oracle
    Hook -->|"recordJob"| Staking
    MultiSig -->|"reject()"| ACP

    style ACP fill:#1a1a2e,color:#fff,stroke:#4444ff
    style Hook fill:#16213e,color:#fff,stroke:#00bcd4
    style Pool fill:#0f3460,color:#fff,stroke:#00bcd4
    style Calc fill:#0f3460,color:#fff,stroke:#00bcd4
    style Staking fill:#1a3a2a,color:#fff,stroke:#00e676
    style MultiSig fill:#1a3a2a,color:#fff,stroke:#00e676
```

### 컨트랙트 구성

| 컨트랙트 | 역할 |
|----------|------|
| `PerformanceBondHook` | ACP Hook 구현체. 프리미엄 징수, 보험금 큐잉, 챌린지 처리 |
| `BondPool` | 프리미엄 적립 및 보험금 지급 풀. 최소 준비금 비율 강제 |
| `PremiumCalculator` | Provider 평판 + Tier + 기간 기반 보험료 산정 |
| `EvaluatorStaking` | Evaluator 스테이킹 및 이상 패턴 감지 (Level 2) |
| `MultiSigEvaluator` | 다중 서명 Evaluator — 3명 중 2명 합의 (Level 2) |

---

## 자금 흐름

### 정상 완료 (complete)

```mermaid
sequenceDiagram
    participant P as Provider
    participant Hook as PerformanceBondHook
    participant Pool as BondPool
    participant ACP as AgenticCommerce
    participant C as Client

    P->>Hook: approve(premium)
    P->>ACP: setBudget(jobId, amount, tier)
    ACP->>Hook: beforeAction(setBudget)
    Hook->>Pool: transferFrom(provider, premium)
    Hook->>Pool: recordPremium(premium)
    Note over Hook,Pool: Bond 발행 ✅

    C->>ACP: fund(jobId)
    P->>ACP: submit(jobId, deliverable)
    ACP->>Hook: beforeAction(complete)
    ACP->>P: transfer(net)
    ACP->>Hook: afterAction(complete)
    Hook->>Pool: (프리미엄 풀 수익 유지)
    Note over Hook: BondReleased 이벤트 ✅
```

### 거절 → 보험금 지급 (reject)

```mermaid
sequenceDiagram
    participant E as Evaluator
    participant ACP as AgenticCommerce
    participant Hook as PerformanceBondHook
    participant Pool as BondPool
    participant C as Client
    participant Anyone as Anyone

    E->>ACP: reject(jobId, reason)
    ACP->>C: refund(budget) ← ACP 자체 처리
    ACP->>Hook: afterAction(reject)
    Hook->>Hook: ClaimQueued (72h 대기)
    Note over Hook: 챌린지 기간 시작

    alt Provider가 이의신청 없음
        Anyone->>Hook: executePayout(jobId) [72h 후]
        Hook->>Pool: payout(client, coverageAmt)
        Pool->>C: transfer(coverageAmt)
        Note over C: budget + coverageAmt 수령 ✅
    else Provider 이의신청
        Note over Hook: Provider.challengeClaim() 호출 시<br/>지급 무기한 보류
    end
```

---

## 보험료 산정

```
failRate    = (10000 - providerCompletionRate) / 10000
covRatio    = tierCoverageRatio[tier]   // Basic=30%, Standard=60%, Premium=100%
durFactor   = 1 + ln(durationDays) / 20
premiumBPS  = max(failRate × covRatio × 0.9 × durFactor, 0.5%)
premium     = budget × premiumBPS

coverage    = min(budget × covRatio, budget × 80%)  // 80% 상한
```

### Tier별 비교

| Tier | 커버리지 | 프리미엄 (70% 완료율 Provider, 30일) |
|------|---------|--------------------------------------|
| Basic | 30% | ~0.5% |
| Standard | 60% | ~1.0% |
| Premium | 80%\* | ~1.7% |

\* `MAX_COVERAGE_BPS = 8000` 상한 적용

---

## 도덕적 해이 방지 (Level 1 + 2)

```mermaid
graph LR
    subgraph Level1 ["Level 1 (MVP)"]
        L1A["커버리지 80% 상한<br/>Client도 20% 손실"]
        L1B["72h 챌린지 기간<br/>Provider 이의신청 가능"]
        L1C["30일 쿨다운<br/>동일 Client-Evaluator 쌍"]
    end

    subgraph Level2 ["Level 2 (성숙)"]
        L2A["EvaluatorStaking<br/>1000 USDC 필수"]
        L2B["이상 패턴 감지<br/>reject율 >30% → 자동 정지"]
        L2C["슬래시 10%<br/>부정 판정 확인 시"]
        L2D["MultiSig Evaluator<br/>3명 중 2명 합의"]
    end

    Level1 --> Level2
```

---

## 빠른 시작

### 요구사항

- Node.js 22+ (LTS)
- Hardhat 2.x

```bash
git clone https://github.com/oxyuns/agent-insurance
cd agent-insurance
npm install
```

### 컴파일

```bash
npm run compile
```

### 테스트

```bash
npm test
```

```
✔ 26/26 tests passing
```

### 배포 (Base Sepolia)

```bash
# .env 설정
export ACP_ADDRESS=<ERC-8183 AgenticCommerce 주소>
export PRIVATE_KEY=<배포자 지갑>

npm run deploy -- --network baseSepolia
```

**배포 순서:**

```mermaid
flowchart TD
    A["1. BondPool.deploy(USDC, admin, reserveRatio=2000)"]
    B["2. PremiumCalculator.deploy(reputationOracle)"]
    C["3. EvaluatorStaking.deploy(USDC, admin)"]
    D["4. PerformanceBondHook.deploy(ACP, pool, calc, USDC, staking)"]
    E["5. BondPool.setHook(hook)"]
    F["6. EvaluatorStaking.transferOwnership(hook)"]
    G["7. ACP Admin: setHookWhitelist(hook, true)"]
    H["8. BondPool.depositCapital(initialCapital)"]

    A --> B --> C --> D --> E --> F --> G --> H
```

---

## Provider 통합 예시

```javascript
// 1. 프리미엄 사전 approve
const premium = await calculator.getPremium(budget, providerAddr, durationDays, 2)
await usdc.approve(hookAddress, premium * 110n / 100n)  // 10% 여유

// 2. Client가 잡 생성 (hook 주소 지정)
await acp.createJob(provider, evaluator, expiredAt, "작업 설명", hookAddress)

// 3. Provider가 예산 설정 + Tier 선택
const optParams = ethers.AbiCoder.defaultAbiCoder().encode(["uint8"], [2])  // Standard
await acp.connect(provider).setBudget(jobId, budget, optParams)
// → beforeAction에서 프리미엄 자동 징수, Bond 발행

// 4. Client 자금 공급
await usdc.approve(acpAddress, budget)
await acp.connect(client).fund(jobId, "0x")
```

---

## 미구현 / 확장 방향

| 기능 | 설명 |
|------|------|
| ReputationOracle | 온체인 `JobCompleted/Rejected` 이벤트 집계 → provider 완료율 자동 갱신 |
| LP 풀 모델 | 유동성 공급자가 자본 예치 → 프리미엄 수익 분배 (DeFi yield 결합) |
| 챌린지 중재 | Kleros / 멀티시그 관리자 → 분쟁 해결 |
| 티어별 SBT | 보험 가입 이력을 Soulbound Token으로 발행 |
| 크로스체인 | 단일 풀, 다중 ACP 인스턴스 지원 |

---

## 라이선스

MIT

---

*Built with ERC-8183 Reference Implementation · Powered by OpenClaw + Claude Sonnet*
