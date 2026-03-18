// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./interfaces/IPremiumCalculator.sol";

interface IReputationOracle {
    /// @return completionRate 0~10000 (bp, 10000 = 100%)
    function getCompletionRate(address provider) external view returns (uint256);
}

contract PremiumCalculator is IPremiumCalculator {
    IReputationOracle public immutable oracle;

    // Tier별 커버리지 비율 (bp): None=0, Basic=30%, Standard=60%, Premium=100%
    // 실제 지급 상한 80%는 PerformanceBondHook의 MAX_COVERAGE_BPS로 별도 적용
    uint256[4] public coverageRatios = [0, 3000, 6000, 10000];

    // 신규 provider 기본 완료율 (70%)
    uint256 public constant DEFAULT_COMPLETION_RATE = 7000;

    // 최소 프리미엄 비율 (0.5%)
    uint256 public constant MIN_PREMIUM_BPS = 50;

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
        uint256 failRateBP = 10000 - completionRate;
        uint256 covRatioBP = coverageRatios[tier];

        // durFactor: 1 + ln(days)/20, ×1000 스케일
        uint256 durFactor1000 = 1000 + (_lnApprox(durationDays) * 1000) / 20;

        // premiumBPS = failRate(bp) × covRatio(bp) / 10000 × 0.9 × durFactor
        uint256 premiumBPS = (failRateBP * covRatioBP / 10000)
            * 9 / 10
            * durFactor1000 / 1000;

        if (premiumBPS < MIN_PREMIUM_BPS) premiumBPS = MIN_PREMIUM_BPS;

        return budget * premiumBPS / 10000;
    }

    function getCoverage(uint256 budget, uint8 tier) external view override returns (uint256) {
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

    /// @dev ln(x) 정수 근사 (ln(2)≈0.693 ×1000 = 693)
    function _lnApprox(uint256 x) internal pure returns (uint256) {
        if (x <= 1) return 0;
        uint256 result = 0;
        while (x >= 2) {
            result += 693;
            x /= 2;
        }
        return result / 1000;
    }
}
