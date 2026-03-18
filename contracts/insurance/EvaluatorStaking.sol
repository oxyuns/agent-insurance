// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title EvaluatorStaking
/// @notice Evaluator가 스테이킹하고, 부정 판정 시 슬래시 + 이상 패턴 감지
contract EvaluatorStaking is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;

    uint256 public constant MIN_EVALUATOR_STAKE = 1000e6; // 1000 USDC
    uint256 public constant REJECT_RATE_THRESHOLD = 3000; // 30% — 초과 시 심사
    uint256 public constant SLASH_BPS = 1000; // 슬래시 10%

    // Evaluator 스테이킹 정보
    struct StakeInfo {
        uint256 amount;       // 현재 스테이킹 잔액
        uint256 totalJobs;    // 총 처리 잡 수
        uint256 rejectCount;  // reject 횟수
        bool suspended;       // 심사 정지 상태
        uint256 stakedAt;     // 스테이킹 시작 시각
    }

    mapping(address => StakeInfo) public stakes;
    address public slashRecipient; // 슬래시된 토큰 수신자 (treasury)

    event Staked(address indexed evaluator, uint256 amount);
    event Unstaked(address indexed evaluator, uint256 amount);
    event Slashed(address indexed evaluator, uint256 amount, string reason);
    event EvaluatorSuspended(address indexed evaluator, uint256 rejectRate);
    event EvaluatorReinstated(address indexed evaluator);
    event JobRecorded(address indexed evaluator, bool rejected);

    error InsufficientStake();
    error EvaluatorSuspended_();
    error NotStaked();
    error StillActive();

    modifier onlyActive(address evaluator) {
        if (stakes[evaluator].suspended) revert EvaluatorSuspended_();
        if (stakes[evaluator].amount < MIN_EVALUATOR_STAKE) revert InsufficientStake();
        _;
    }

    constructor(address token_, address slashRecipient_) Ownable(msg.sender) {
        token = IERC20(token_);
        slashRecipient = slashRecipient_;
    }

    /// @notice Evaluator 스테이킹 (MIN_EVALUATOR_STAKE 이상)
    function stake(uint256 amount) external {
        require(amount >= MIN_EVALUATOR_STAKE, "Below minimum stake");
        token.safeTransferFrom(msg.sender, address(this), amount);
        stakes[msg.sender].amount += amount;
        if (stakes[msg.sender].stakedAt == 0) {
            stakes[msg.sender].stakedAt = block.timestamp;
        }
        emit Staked(msg.sender, amount);
    }

    /// @notice 스테이킹 해제 (활성 잡 없을 때만)
    function unstake(uint256 amount) external {
        StakeInfo storage s = stakes[msg.sender];
        require(s.amount >= amount, "Insufficient balance");
        s.amount -= amount;
        token.safeTransfer(msg.sender, amount);
        emit Unstaked(msg.sender, amount);
    }

    /// @notice ACP 훅에서 호출 — 잡 결과 기록 및 이상 패턴 감지
    /// @dev onlyOwner(=hook contract) 또는 별도 접근 제어
    function recordJob(address evaluator, bool rejected) external onlyOwner {
        StakeInfo storage s = stakes[evaluator];
        s.totalJobs++;
        if (rejected) s.rejectCount++;

        emit JobRecorded(evaluator, rejected);

        // 이상 패턴 감지: reject율 > 30% AND 최소 10개 처리
        if (s.totalJobs >= 10) {
            uint256 currentRejectRate = (s.rejectCount * 10000) / s.totalJobs;
            if (currentRejectRate > REJECT_RATE_THRESHOLD && !s.suspended) {
                s.suspended = true;
                emit EvaluatorSuspended(evaluator, currentRejectRate);
            }
        }
    }

    /// @notice 부정 판정 확인 시 슬래시 (Admin만)
    function slash(address evaluator, string calldata reason) external onlyOwner {
        StakeInfo storage s = stakes[evaluator];
        if (s.amount == 0) revert NotStaked();

        uint256 slashAmount = (s.amount * SLASH_BPS) / 10000;
        s.amount -= slashAmount;
        token.safeTransfer(slashRecipient, slashAmount);

        emit Slashed(evaluator, slashAmount, reason);
    }

    /// @notice 심사 후 복권 (Admin만)
    function reinstate(address evaluator) external onlyOwner {
        stakes[evaluator].suspended = false;
        emit EvaluatorReinstated(evaluator);
    }

    /// @notice Evaluator가 활성 상태인지 확인 (훅에서 before check용)
    function isActive(address evaluator) external view returns (bool) {
        StakeInfo storage s = stakes[evaluator];
        return !s.suspended && s.amount >= MIN_EVALUATOR_STAKE;
    }

    /// @notice reject율 조회 (bp)
    function rejectRate(address evaluator) external view returns (uint256) {
        StakeInfo storage s = stakes[evaluator];
        if (s.totalJobs == 0) return 0;
        return (s.rejectCount * 10000) / s.totalJobs;
    }

    function setSlashRecipient(address recipient) external onlyOwner {
        slashRecipient = recipient;
    }
}
