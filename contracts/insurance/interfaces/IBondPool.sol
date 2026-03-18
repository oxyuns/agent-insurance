// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IBondPool {
    function recordPremium(uint256 amount) external;
    function payout(address client, uint256 amount) external;
}
