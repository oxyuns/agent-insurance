// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract MockReputationOracle {
    mapping(address => uint256) private rates;

    function setCompletionRate(address provider, uint256 rate) external {
        rates[provider] = rate;
    }

    function getCompletionRate(address provider) external view returns (uint256) {
        return rates[provider];
    }
}
