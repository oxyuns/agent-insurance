# ERC-8183 Performance Bond Insurance — 구현 설계서

> Provider가 프리미엄을 납부하는 이행보증 모델  
> 기반 프로토콜: [ERC-8183 Agentic Commerce Protocol](https://eips.ethereum.org/EIPS/eip-8183)

---

## 목차

1. [개요 및 설계 원칙](#1-개요-및-설계-원칙)
2. [컨트랙트 구성](#2-컨트랙트-구성)
3. [자금 흐름](#3-자금-흐름)
4. [PerformanceBondHook.sol](#4-performancebondhooksol)
5. [BondPool.sol](#5-bondpoolsol)
6. [PremiumCalculator.sol](#6-premiumcalculatorsol)
7. [도덕적 해이 방지 설계](#7-도덕적-해이-방지-설계)
8. [배포 및 연동 순서](#8-배포-및-연동-순서)
9. [미해결 과제 및 확장 방향](#9-미해결-과제-및-확장-방향)

---

## 1. 개요 및 설계 원칙

### 왜 Provider가 프리미엄을 내는가

전통 보험에서 **Performance Bond(이행보증)**는 시공사(provider)가 발주처(client)를 위해 보증회사에 프리미엄을 납부하는 구조입니다. 이 모델이 client 납부 모델보다 우월한 이유는 세 가지입니다.

| 관점 | Client 납부 | Provider 납부 (이행보증) |
|---|---|---|
| 도덕적 해이 | client-evaluator 담합 가능 | provider에게 스킨인게임 발생 |
| 신뢰 신호 | 없음 | 프리미엄 납부 = 자신감 표현 |
| 시장 효과 | 가격 경쟁만 | 품질 경쟁 유도 |

### 핵심 설계 원칙

1. **코어 컨트랙트 무수정** — `AgenticCommerce.sol`을 변경하지 않음. 순수 훅으로 구현.
2. **파라메트릭 트리거** — `reject()` 호출 사실 자체가 보험금 지급 조건. 손실 증명 불필요.
3. **try/catch 격리** — 보험 풀 문제가 메인 트랜잭션(complete/reject)을 롤백시키지 않음.
4. **Provider 스테이킹** — 프리미엄 외 별도 스테이크로 도덕적 해이 억제.
5. **챌린지 기간** — 즉시 지급 대신 72시간 이의신청 창구 운영.

---

## 2. 컨트랙트 구성

```
contracts/
├── insurance/
│   ├── PerformanceBondHook.sol   # IACPHook 구현체 (ACP와의 유일한 접점)
│   ├── BondPool.sol              # 자본 풀 관리 및 지급 실행
│   ├── PremiumCalculator.sol     # 프리미엄 산정 로직
│   └── interfaces/
│       ├── IBondPool.sol
│       └── IPremiumCalculator.sol
```

### 컨트랙트 간 관계

```
AgenticCommerce
      │
      │  beforeAction / afterAction
      ▼
PerformanceBondHook ──── PremiumCalculator
      │                       │
      │  payout()             │  getPremium(budget, provider, duration, tier)
      ▼                       │
   BondPool ◄─────────────────┘
      │
      │  프리미엄 적립 / 보험금 지급
      ▼
  USDC / paymentToken
```

---

## 3. 자금 흐름

### 3-1. 정상 완료 (complete)

```
Provider ──[setBudget 시점]──► BondPool  (프리미엄 납부)
Client   ──[fund 시점]───────► ACP       (budget 에스크로)

complete() 호출
ACP ──► Provider  (net 지급)
ACP ──► Platform  (platformFee)
ACP ──► Evaluator (evaluatorFee)
BondPool 프리미엄: 풀 수익으로 유지
```

### 3-2. 거절 (reject → 보험 청구)

```
reject() 호출
ACP ──► Client    (budget 전액 환불)         ← ACP 자체 처리
BondPool ──► Client  (coverageAmt 추가 지급)  ← 훅이 처리 (72h 후)

Client 최종 수령 = budget + coverageAmt
                = budget × (1 + coverageRatio)
```

### 3-3. 프리미엄 산정 기준

```
failRate    = (100 - providerCompletionRate) / 100
covRatio    = tierCoverageRatio[tier]          // 예: Tier1=30%, Tier2=60%, Tier3=100%
durFactor   = 1 + ln(durationDays) / 20
basePct     = failRate × covRatio × 0.9 × durFactor
minPct      = 0.5%                             // 최소 프리미엄 보장
premiumPct  = max(basePct, minPct)
premium     = budget × premiumPct

coverage    = budget × covRatio
```

> **Tier 선택은 Provider가 결정합니다.** `setBudget()` 호출 시 `optParams`에 tier를 인코딩해서 전달합니다. 높은 tier를 선택할수록 프리미엄이 높고, client에 지급되는 보험금도 높아집니다. 이것이 "이행 자신감"의 온체인 시그널입니다.

---

## 4. PerformanceBondHook.sol

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import "../IACPHook.sol";
import "./IBondPool.sol";
import "./IPremiumCalculator.sol";

interface IAgenticCommerce {
    struct Job {
        uint256 id;
        address client;
        address provider;
        address evaluator;
        string description;
        uint256 budget;
        uint256 expiredAt;
        uint8 status;
        address hook;
    }
    function getJob(uint256 jobId) external view returns (Job memory);
    function setBudget(uint256, uint256, bytes calldata) external;
    function reject(uint256, bytes32, bytes calldata) external;
}

contract PerformanceBondHook is IACPHook, ERC165 {
    using SafeERC20 for IERC20;

    // ─── 상수 ───────────────────────────────────────────────
    uint256 public constant CHALLENGE_PERIOD = 72 hours;

    // ─── 외부 컨트랙트 ───────────────────────────────────────
    address public immutable acp;
    IBondPool public immutable pool;
    IPremiumCalculator public immutable calculator;
    IERC20 public immutable token;

    // ─── 데이터 구조 ─────────────────────────────────────────
    enum Tier { None, Basic, Standard, Premium }

    struct Policy {
        uint256 premium;          // 납부된 프리미엄
        uint256 coverageAmt;      // 최대 보험금
        Tier tier;                // 선택된 티어
        bool active;
        uint256 challengeExpiry;  // 챌린지 마감 타임스탬프 (reject 후 설정)
        bool payoutQueued;        // 지급 대기 상태
    }

    struct PendingClaim {
        address client;
        uint256 amount;
        uint256 claimableAt;
    }

    mapping(uint256 => Policy) public policies;          // jobId → Policy
    mapping(uint256 => PendingClaim) public pendingClaims; // 풀 부족 시 대기

    // ─── 이벤트 ──────────────────────────────────────────────
    event BondIssued(uint256 indexed jobId, address indexed provider, uint256 premium, uint256 coverage, Tier tier);
    event ClaimQueued(uint256 indexed jobId, address indexed client, uint256 amount, uint256 claimableAt);
    event ClaimPaid(uint256 indexed jobId, address indexed client, uint256 amount);
    event ClaimChallenged(uint256 indexed jobId, address indexed challenger);
    event BondReleased(uint256 indexed jobId);

    // ─── 에러 ────────────────────────────────────────────────
    error NotACP();
    error NotProvider();
    error NoPendingClaim();
    error ChallengePeriodActive();
    error AlreadyChallenged();
    error NoBond();

    modifier onlyACP() {
        if (msg.sender != acp) revert NotACP();
        _;
    }

    constructor(
        address acp_,
        address pool_,
        address calculator_,
        address token_
    ) {
        acp = acp_;
        pool = IBondPool(pool_);
        calculator = IPremiumCalculator(calculator_);
        token = IERC20(token_);
    }

    // ─────────────────────────────────────────────────────────
    // IACPHook 구현
    // ─────────────────────────────────────────────────────────

    function beforeAction(
        uint256 jobId,
        bytes4 selector,
        bytes calldata data
    ) external override onlyACP {
        // setBudget() 직전: 프리미엄 징수 및 Policy 발행
        bytes4 setBudgetSel = IAgenticCommerce.setBudget.selector;
        if (selector == setBudgetSel) {
            _handleBeforeSetBudget(jobId, data);
        }
    }

    function afterAction(
        uint256 jobId,
        bytes4 selector,
        bytes calldata data
    ) external override onlyACP {
        bytes4 rejectSel = IAgenticCommerce.reject.selector;
        bytes4 completeSel = bytes4(keccak256("complete(uint256,bytes32,bytes)"));

        if (selector == rejectSel) {
            _handleAfterReject(jobId);
        } else if (selector == completeSel) {
            _handleAfterComplete(jobId);
        }
    }

    // ─────────────────────────────────────────────────────────
    // 내부 로직
    // ─────────────────────────────────────────────────────────

    function _handleBeforeSetBudget(uint256 jobId, bytes calldata data) internal {
        (address caller, uint256 amount, bytes memory optParams) =
            abi.decode(data, (address, uint256, bytes));

        // optParams에서 Tier 파싱 (없으면 None = 보험 미가입)
        Tier tier = Tier.None;
        if (optParams.length >= 1) {
            uint8 tierRaw = abi.decode(optParams, (uint8));
            if (tierRaw >= 1 && tierRaw <= 3) tier = Tier(tierRaw);
        }

        if (tier == Tier.None) return; // 보험 미가입

        IAgenticCommerce.Job memory job = IAgenticCommerce(acp).getJob(jobId);

        // provider 본인인지 확인
        if (caller != job.provider) revert NotProvider();

        // 프리미엄 및 커버리지 산정
        uint256 durationDays = (job.expiredAt - block.timestamp) / 1 days + 1;
        uint256 premium = calculator.getPremium(
            amount,         // budget
            job.provider,
            durationDays,
            uint8(tier)
        );
        uint256 coverage = calculator.getCoverage(amount, uint8(tier));

        // provider 지갑에서 프리미엄 징수 (provider가 사전 approve 필요)
        token.safeTransferFrom(caller, address(pool), premium);
        pool.recordPremium(premium);

        // Policy 기록
        policies[jobId] = Policy({
            premium: premium,
            coverageAmt: coverage,
            tier: tier,
            active: true,
            challengeExpiry: 0,
            payoutQueued: false
        });

        emit BondIssued(jobId, caller, premium, coverage, tier);
    }

    function _handleAfterReject(uint256 jobId) internal {
        Policy storage p = policies[jobId];
        if (!p.active) return;

        p.active = false;
        p.payoutQueued = true;
        p.challengeExpiry = block.timestamp + CHALLENGE_PERIOD;

        IAgenticCommerce.Job memory job = IAgenticCommerce(acp).getJob(jobId);

        // 72시간 챌린지 기간 후 지급 가능하도록 큐에 등록
        pendingClaims[jobId] = PendingClaim({
            client: job.client,
            amount: p.coverageAmt,
            claimableAt: p.challengeExpiry
        });

        emit ClaimQueued(jobId, job.client, p.coverageAmt, p.challengeExpiry);
    }

    function _handleAfterComplete(uint256 jobId) internal {
        Policy storage p = policies[jobId];
        if (!p.active) return;

        p.active = false;
        // 프리미엄은 풀 수익으로 유지 (별도 처리 없음)
        emit BondReleased(jobId);
    }

    // ─────────────────────────────────────────────────────────
    // 외부 호출 함수
    // ─────────────────────────────────────────────────────────

    /// @notice 챌린지 기간 종료 후 보험금 청구 실행 (누구나 호출 가능)
    function executePayout(uint256 jobId) external {
        PendingClaim storage claim = pendingClaims[jobId];
        if (claim.client == address(0)) revert NoPendingClaim();
        if (block.timestamp < claim.claimableAt) revert ChallengePeriodActive();

        address client = claim.client;
        uint256 amount = claim.amount;
        delete pendingClaims[jobId];

        try pool.payout(client, amount) {
            emit ClaimPaid(jobId, client, amount);
        } catch {
            // 풀 부족: 재등록 (나중에 유동성 회복 시 재시도)
            pendingClaims[jobId] = PendingClaim({
                client: client,
                amount: amount,
                claimableAt: block.timestamp + 1 days
            });
        }
    }

    /// @notice Provider가 reject에 이의신청 (챌린지 기간 내)
    /// @dev 실제 구현에서는 중재 컨트랙트로 연결
    function challengeClaim(uint256 jobId) external {
        Policy storage p = policies[jobId];
        if (!p.payoutQueued) revert NoBond();
        if (block.timestamp >= p.challengeExpiry) revert ChallengePeriodActive();

        IAgenticCommerce.Job memory job = IAgenticCommerce(acp).getJob(jobId);
        if (msg.sender != job.provider) revert NotProvider();

        // 챌린지 시 지급 보류 (중재 컨트랙트로 이관)
        pendingClaims[jobId].claimableAt = type(uint256).max; // 중재 해결 전까지 무한 보류
        emit ClaimChallenged(jobId, msg.sender);
    }

    // ─────────────────────────────────────────────────────────
    // ERC165
    // ─────────────────────────────────────────────────────────

    function supportsInterface(bytes4 interfaceId)
        public view override returns (bool)
    {
        return interfaceId == type(IACPHook).interfaceId
            || super.supportsInterface(interfaceId);
    }
}
```

---

## 5. BondPool.sol

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./IBondPool.sol";

contract BondPool is IBondPool, Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    address public hook;

    uint256 public totalPremiums;   // 누적 수취 프리미엄
    uint256 public totalPayouts;    // 누적 지급 보험금
    uint256 public reserveRatio;    // 최소 지급 준비율 (bp, 예: 2000 = 20%)

    event PremiumRecorded(uint256 amount, uint256 poolBalance);
    event PayoutExecuted(address indexed client, uint256 amount);
    event HookUpdated(address newHook);

    error InsufficientReserve();
    error NotHook();

    modifier onlyHook() {
        if (msg.sender != hook) revert NotHook();
        _;
    }

    constructor(address token_, address owner_, uint256 reserveRatio_) Ownable(owner_) {
        token = IERC20(token_);
        reserveRatio = reserveRatio_;
    }

    function setHook(address hook_) external onlyOwner {
        hook = hook_;
        emit HookUpdated(hook_);
    }

    function recordPremium(uint256 amount) external override onlyHook {
        totalPremiums += amount;
        emit PremiumRecorded(amount, token.balanceOf(address(this)));
    }

    function payout(address client, uint256 amount) external override onlyHook {
        uint256 balance = token.balanceOf(address(this));
        uint256 minReserve = (totalPremiums * reserveRatio) / 10000;

        // 지급 후에도 최소 준비금 유지 여부 확인
        if (balance < amount + minReserve) revert InsufficientReserve();

        totalPayouts += amount;
        token.safeTransfer(client, amount);
        emit PayoutExecuted(client, amount);
    }

    /// @notice 지급 여력 비율 (%)
    function solvencyRatio() external view returns (uint256) {
        uint256 balance = token.balanceOf(address(this));
        if (totalPremiums == 0) return 100;
        return (balance * 100) / totalPremiums;
    }

    /// @notice 관리자가 추가 자본 투입 가능
    function depositCapital(uint256 amount) external onlyOwner {
        token.safeTransferFrom(msg.sender, address(this), amount);
    }
}
```

---

## 6. PremiumCalculator.sol

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./IPremiumCalculator.sol";

interface IReputationOracle {
    /// @return completionRate 0~10000 (bp, 10000 = 100%)
    function getCompletionRate(address provider) external view returns (uint256);
}

contract PremiumCalculator is IPremiumCalculator {
    IReputationOracle public immutable oracle;

    // Tier별 커버리지 비율 (bp)
    uint256[4] public coverageRatios = [0, 3000, 6000, 10000]; // None/Basic/Standard/Premium

    // 신규 provider (데이터 없음) 기본 완료율 가정
    uint256 public constant DEFAULT_COMPLETION_RATE = 7000; // 70%

    // 최소 프리미엄 비율 (bp)
    uint256 public constant MIN_PREMIUM_BPS = 50; // 0.5%

    constructor(address oracle_) {
        oracle = IReputationOracle(oracle_);
    }

    function getPremium(
        uint256 budget,
        address provider,
        uint256 durationDays,
        uint8 tier
    ) external view override returns (uint256) {
        if (tier == 0 || tier > 3) return 0;

        uint256 completionRate = _getCompletionRate(provider);
        uint256 failRateBP = 10000 - completionRate;         // 0~10000
        uint256 covRatioBP = coverageRatios[tier];           // 0~10000

        // durFactor: 1 + ln(days)/20 을 정수로 근사 (×1000 스케일)
        uint256 durFactor1000 = 1000 + _lnApprox(durationDays) * 1000 / 20;

        // premiumBPS = failRate(bp) × covRatio(bp) / 10000 × 0.9 × durFactor
        uint256 premiumBPS = failRateBP * covRatioBP / 10000
            * 9 / 10
            * durFactor1000 / 1000;

        if (premiumBPS < MIN_PREMIUM_BPS) premiumBPS = MIN_PREMIUM_BPS;

        return budget * premiumBPS / 10000;
    }

    function getCoverage(
        uint256 budget,
        uint8 tier
    ) external view override returns (uint256) {
        if (tier == 0 || tier > 3) return 0;
        return budget * coverageRatios[tier] / 10000;
    }

    function _getCompletionRate(address provider) internal view returns (uint256) {
        try oracle.getCompletionRate(provider) returns (uint256 rate) {
            return rate > 0 ? rate : DEFAULT_COMPLETION_RATE;
        } catch {
            return DEFAULT_COMPLETION_RATE;
        }
    }

    /// @dev ln(x) 정수 근사 (x <= 100 범위 실용적)
    /// ln(1)=0, ln(7)≈1.95, ln(30)≈3.40, ln(90)≈4.50
    function _lnApprox(uint256 x) internal pure returns (uint256) {
        if (x <= 1) return 0;
        uint256 result = 0;
        // 2의 거듭제곱으로 근사
        while (x >= 2) { result += 693; x /= 2; } // ln(2) ≈ 0.693, ×1000
        return result / 1000;
    }
}
```

---

## 7. 도덕적 해이 방지 설계

### 위협 모델

| 공격 시나리오 | 공격자 | 방어 수단 |
|---|---|---|
| client + evaluator 담합으로 가짜 reject | Client, Evaluator | 챌린지 기간 + provider 이의신청 |
| provider가 의도적으로 나쁜 결과물 제출 후 보험금 수령 시도 | — | 보험금은 client에게만 지급됨 |
| evaluator 매수 | Evaluator | 스테이킹 슬래시 |
| 반복 가짜 reject로 풀 고갈 | Client + Evaluator | 이상 패턴 감지 + 청구 상한 |

### 구현 수준별 방어

**Level 1 (MVP에서 구현)**

```solidity
// 1. 커버리지 상한 80% — client도 20% 손실 감수
uint256 constant MAX_COVERAGE_BPS = 8000;

// 2. 72시간 챌린지 기간 — provider 이의신청 창구
uint256 constant CHALLENGE_PERIOD = 72 hours;

// 3. 동일 client-evaluator 쌍 쿨다운
mapping(bytes32 => uint256) public lastClaimAt; // keccak(client, evaluator) → timestamp
uint256 constant CLAIM_COOLDOWN = 30 days;
```

**Level 2 (성숙 단계)**

```solidity
// 4. Evaluator 스테이킹 — 부정 판정 시 슬래시
mapping(address => uint256) public evaluatorStakes;
uint256 constant MIN_EVALUATOR_STAKE = 1000e6; // 1000 USDC

// 5. MultiSig Evaluator — 3명 중 2명 합의
contract MultiSigEvaluator {
    function confirmReject(uint256 jobId) external onlySigner {
        confirmations[jobId]++;
        if (confirmations[jobId] >= threshold)
            IAgenticCommerce(acp).reject(jobId, reason, "");
    }
}

// 6. 이상 패턴 감지
mapping(address => uint256) public rejectCount;
uint256 constant REJECT_RATE_THRESHOLD = 3000; // 30% 이상 reject 시 심사
```

---

## 8. 배포 및 연동 순서

```bash
# 1. BondPool 배포
BondPool.deploy(usdcAddress, adminAddress, reserveRatio=2000)

# 2. PremiumCalculator 배포
PremiumCalculator.deploy(reputationOracleAddress)

# 3. PerformanceBondHook 배포
PerformanceBondHook.deploy(acpAddress, bondPoolAddress, calculatorAddress, usdcAddress)

# 4. BondPool에 Hook 주소 등록
BondPool.setHook(performanceBondHookAddress)

# 5. ACP Admin이 Hook 화이트리스트 등록
AgenticCommerce.setHookWhitelist(performanceBondHookAddress, true)

# 6. 초기 자본 투입 (지급 여력 확보)
USDC.approve(bondPoolAddress, initialCapital)
BondPool.depositCapital(initialCapital)
```

### Provider 잡 생성 시 플로우

```javascript
// 1. Provider가 hook에 프리미엄 approve (setBudget 전에 미리)
//    최대 예상 프리미엄의 110% 정도로 여유있게
const estimatedPremium = await calculator.getPremium(budget, providerAddr, durationDays, tier)
await usdc.approve(hookAddress, estimatedPremium * 110n / 100n)

// 2. Client가 잡 생성 (hook 지정)
await acp.createJob(
  providerAddress,
  evaluatorAddress,
  expiredAt,
  "작업 설명",
  performanceBondHookAddress   // hook 주소
)

// 3. Provider가 예산 설정 + 보험 티어 선택
const tier = 2  // Standard (60% 커버리지)
const optParams = ethers.AbiCoder.defaultAbiCoder().encode(["uint8"], [tier])
await acp.connect(provider).setBudget(jobId, budget, optParams)
// → setBudget beforeAction에서 프리미엄 자동 징수

// 4. Client가 자금 공급
await usdc.approve(acpAddress, budget)
await acp.connect(client).fund(jobId, "0x")
```

---

## 9. 미해결 과제 및 확장 방향

### 즉시 해결이 필요한 것

- **ReputationOracle 구현**: 온체인 이벤트(`JobCompleted`, `JobRejected`)를 집계해 provider별 완료율을 계산하는 인덱서 또는 오라클 필요. 신규 provider의 cold start 문제 (기본값 70%로 시작하다가 데이터 누적 시 갱신).

- **챌린지 해소 메커니즘**: `challengeClaim()` 후 실제 중재를 누가 수행하는가? MVP에서는 멀티시그 관리자, 성숙 단계에서는 토큰 홀더 투표 또는 Kleros 같은 탈중앙 분쟁 해결 프로토콜 연동.

### 탐색할 가치가 있는 확장

| 확장 | 설명 |
|---|---|
| LP 풀 모델 | 유동성 공급자가 풀에 자본 예치, 프리미엄 수익 분배. DeFi yield와 결합. |
| 재보험 레이어 | 풀이 일정 규모 이상의 단일 청구를 재보험사(또는 다른 풀)에 전가. |
| 티어별 SBT | 보험 가입 티어를 Soulbound Token으로 발행. provider 신뢰도 시각화. |
| 구독형 연간 보증 | 잡 단위 대신 provider 주소 단위로 연간 보증 플랜 가입. 잡마다 setBudget 호출 불필요. |
| 크로스체인 | 동일 훅이 여러 체인의 ACP 인스턴스에 연결. 보험 풀은 단일 체인에서 관리. |

---

*작성일: 2026년 3월*  
*기반 프로토콜: ERC-8183 Reference Implementation (Sonnet 4.6)*
