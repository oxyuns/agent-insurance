// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IPremiumCalculator {
    function getPremium(
        uint256 budget,
        address provider,
        uint256 durationDays,
        uint8 tier
    ) external view returns (uint256);

    function getCoverage(uint256 budget, uint8 tier) external view returns (uint256);
}
