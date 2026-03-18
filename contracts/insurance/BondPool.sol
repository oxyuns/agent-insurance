// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/IBondPool.sol";

contract BondPool is IBondPool, Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    address public hook;

    uint256 public totalPremiums;
    uint256 public totalPayouts;
    uint256 public reserveRatio; // bp (e.g. 2000 = 20%)

    event PremiumRecorded(uint256 amount, uint256 poolBalance);
    event PayoutExecuted(address indexed client, uint256 amount);
    event HookUpdated(address newHook);

    error InsufficientReserve();
    error NotHook();
    error ZeroAddress();

    modifier onlyHook() {
        if (msg.sender != hook) revert NotHook();
        _;
    }

    constructor(address token_, address owner_, uint256 reserveRatio_) Ownable(owner_) {
        if (token_ == address(0)) revert ZeroAddress();
        token = IERC20(token_);
        reserveRatio = reserveRatio_;
    }

    function setHook(address hook_) external onlyOwner {
        if (hook_ == address(0)) revert ZeroAddress();
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

    /// @notice 관리자 추가 자본 투입
    function depositCapital(uint256 amount) external onlyOwner {
        token.safeTransferFrom(msg.sender, address(this), amount);
    }
}
