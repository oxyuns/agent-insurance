// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import "../IACPHook.sol";
import "./interfaces/IBondPool.sol";
import "./interfaces/IPremiumCalculator.sol";

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

    uint256 public constant CHALLENGE_PERIOD = 72 hours;
    uint256 public constant CLAIM_COOLDOWN = 30 days;
    uint256 public constant MAX_COVERAGE_BPS = 8000; // 80% cap

    address public immutable acp;
    IBondPool public immutable pool;
    IPremiumCalculator public immutable calculator;
    IERC20 public immutable token;

    enum Tier { None, Basic, Standard, Premium }

    struct Policy {
        uint256 premium;
        uint256 coverageAmt;
        Tier tier;
        bool active;
        uint256 challengeExpiry;
        bool payoutQueued;
    }

    struct PendingClaim {
        address client;
        uint256 amount;
        uint256 claimableAt;
    }

    mapping(uint256 => Policy) public policies;
    mapping(uint256 => PendingClaim) public pendingClaims;
    // keccak256(client, evaluator) → last claim timestamp
    mapping(bytes32 => uint256) public lastClaimAt;

    event BondIssued(uint256 indexed jobId, address indexed provider, uint256 premium, uint256 coverage, Tier tier);
    event ClaimQueued(uint256 indexed jobId, address indexed client, uint256 amount, uint256 claimableAt);
    event ClaimPaid(uint256 indexed jobId, address indexed client, uint256 amount);
    event ClaimChallenged(uint256 indexed jobId, address indexed challenger);
    event BondReleased(uint256 indexed jobId);

    error NotACP();
    error NotProvider();
    error NoPendingClaim();
    error ChallengePeriodActive();
    error NoBond();
    error CooldownActive();

    modifier onlyACP() {
        if (msg.sender != acp) revert NotACP();
        _;
    }

    constructor(address acp_, address pool_, address calculator_, address token_) {
        acp = acp_;
        pool = IBondPool(pool_);
        calculator = IPremiumCalculator(calculator_);
        token = IERC20(token_);
    }

    // ─── IACPHook ────────────────────────────────────────────

    function beforeAction(
        uint256 jobId,
        bytes4 selector,
        bytes calldata data
    ) external override onlyACP {
        // interface.selector와 동일 값이지만 interface를 직접 참조
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
        // complete은 IAgenticCommerce에 없으므로 keccak 유지
        bytes4 completeSel = bytes4(keccak256("complete(uint256,bytes32,bytes)"));

        if (selector == rejectSel) {
            _handleAfterReject(jobId);
        } else if (selector == completeSel) {
            _handleAfterComplete(jobId);
        }
    }

    // ─── Internal ────────────────────────────────────────────

    function _handleBeforeSetBudget(uint256 jobId, bytes calldata data) internal {
        (address caller, uint256 amount, bytes memory optParams) =
            abi.decode(data, (address, uint256, bytes));

        // optParams >= 1 byte면 tier 파싱 (ABI encode는 32바이트이지만 설계 명세 준수)
        Tier tier = Tier.None;
        if (optParams.length >= 1) {
            uint8 tierRaw = abi.decode(optParams, (uint8));
            if (tierRaw >= 1 && tierRaw <= 3) tier = Tier(tierRaw);
        }

        if (tier == Tier.None) return;

        IAgenticCommerce.Job memory job = IAgenticCommerce(acp).getJob(jobId);
        if (caller != job.provider) revert NotProvider();

        uint256 durationDays = job.expiredAt > block.timestamp
            ? (job.expiredAt - block.timestamp) / 1 days + 1
            : 1;

        uint256 premium = calculator.getPremium(amount, job.provider, durationDays, uint8(tier));
        uint256 rawCoverage = calculator.getCoverage(amount, uint8(tier));

        // 80% 커버리지 상한 적용
        uint256 maxCov = amount * MAX_COVERAGE_BPS / 10000;
        uint256 coverage = rawCoverage > maxCov ? maxCov : rawCoverage;

        token.safeTransferFrom(caller, address(pool), premium);
        pool.recordPremium(premium);

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

        IAgenticCommerce.Job memory job = IAgenticCommerce(acp).getJob(jobId);

        // 설계 원칙 3번: try/catch로 격리 — cooldown 위반해도 reject() 롤백 금지
        // cooldown 초과 시 보험금 지급 없이 조용히 종료 (revert 금지)
        bytes32 pairKey = keccak256(abi.encode(job.client, job.evaluator));
        if (block.timestamp < lastClaimAt[pairKey] + CLAIM_COOLDOWN) {
            // 쿨다운 중 → 보험금 미지급, policy 비활성화만
            p.active = false;
            return;
        }

        p.active = false;
        p.payoutQueued = true;
        p.challengeExpiry = block.timestamp + CHALLENGE_PERIOD;
        lastClaimAt[pairKey] = block.timestamp;

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
        emit BondReleased(jobId);
    }

    // ─── External ────────────────────────────────────────────

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
            // 풀 부족 시 1일 후 재시도
            pendingClaims[jobId] = PendingClaim({
                client: client,
                amount: amount,
                claimableAt: block.timestamp + 1 days
            });
        }
    }

    /// @notice Provider가 reject에 이의신청 (챌린지 기간 내)
    function challengeClaim(uint256 jobId) external {
        Policy storage p = policies[jobId];
        if (!p.payoutQueued) revert NoBond();
        if (block.timestamp >= p.challengeExpiry) revert ChallengePeriodActive();

        IAgenticCommerce.Job memory job = IAgenticCommerce(acp).getJob(jobId);
        if (msg.sender != job.provider) revert NotProvider();

        // 중재 해결 전까지 무한 보류
        pendingClaims[jobId].claimableAt = type(uint256).max;
        emit ClaimChallenged(jobId, msg.sender);
    }

    // ─── ERC165 ──────────────────────────────────────────────

    function supportsInterface(bytes4 interfaceId)
        public view override(ERC165, IERC165) returns (bool)
    {
        return interfaceId == type(IACPHook).interfaceId
            || super.supportsInterface(interfaceId);
    }
}
