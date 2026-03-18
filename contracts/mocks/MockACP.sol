// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../IACPHook.sol";

/// @notice Minimal ACP mock for testing hook integration
contract MockACP {
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

    mapping(uint256 => Job) public jobs;
    uint256 public jobCounter;

    function createJob(
        address provider,
        address evaluator,
        uint256 expiredAt,
        string calldata description,
        address hook_,
        uint256 budget
    ) external returns (uint256) {
        jobCounter++;
        jobs[jobCounter] = Job({
            id: jobCounter,
            client: msg.sender,
            provider: provider,
            evaluator: evaluator,
            description: description,
            budget: budget,
            expiredAt: expiredAt,
            status: 0, // Open
            hook: hook_
        });
        return jobCounter;
    }

    function getJob(uint256 jobId) external view returns (Job memory) {
        return jobs[jobId];
    }

    /// @notice Simulate setBudget — calls hook beforeAction
    function setBudget(uint256 jobId, uint256 amount, bytes calldata optParams) external {
        Job storage job = jobs[jobId];
        bytes memory data = abi.encode(msg.sender, amount, optParams);
        if (job.hook != address(0)) {
            IACPHook(job.hook).beforeAction(jobId, this.setBudget.selector, data);
        }
        job.budget = amount;
        if (job.hook != address(0)) {
            IACPHook(job.hook).afterAction(jobId, this.setBudget.selector, data);
        }
    }

    /// @notice Simulate complete — calls hook afterAction
    function complete(uint256 jobId, bytes32 reason, bytes calldata optParams) external {
        Job storage job = jobs[jobId];
        job.status = 3; // Completed
        bytes memory data = abi.encode(msg.sender, reason, optParams);
        if (job.hook != address(0)) {
            IACPHook(job.hook).beforeAction(jobId, this.complete.selector, data);
            IACPHook(job.hook).afterAction(jobId, this.complete.selector, data);
        }
    }

    /// @notice Simulate reject — calls hook afterAction
    function reject(uint256 jobId, bytes32 reason, bytes calldata optParams) external {
        Job storage job = jobs[jobId];
        job.status = 4; // Rejected
        bytes memory data = abi.encode(msg.sender, reason, optParams);
        if (job.hook != address(0)) {
            IACPHook(job.hook).beforeAction(jobId, this.reject.selector, data);
            IACPHook(job.hook).afterAction(jobId, this.reject.selector, data);
        }
    }
}
