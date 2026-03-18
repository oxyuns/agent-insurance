// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";

interface IAgenticCommerceReject {
    function reject(uint256 jobId, bytes32 reason, bytes calldata optParams) external;
}

/// @title MultiSigEvaluator
/// @notice 3명 중 2명 합의로 reject() 실행 — 단독 Evaluator 매수 방지
contract MultiSigEvaluator is Ownable {
    address public immutable acp;
    uint256 public threshold; // 기본 2
    address[] public signers;

    mapping(address => bool) public isSigner;
    // jobId → signer → confirmed
    mapping(uint256 => mapping(address => bool)) public confirmations;
    // jobId → confirmation count
    mapping(uint256 => uint256) public confirmationCount;
    // jobId → executed
    mapping(uint256 => bool) public executed;
    // jobId → reason
    mapping(uint256 => bytes32) public rejectReasons;

    event SignerAdded(address indexed signer);
    event SignerRemoved(address indexed signer);
    event RejectConfirmed(uint256 indexed jobId, address indexed signer, uint256 count);
    event RejectExecuted(uint256 indexed jobId, bytes32 reason);
    event ThresholdUpdated(uint256 newThreshold);

    error NotSigner();
    error AlreadyConfirmed();
    error AlreadyExecuted();
    error ThresholdNotMet();
    error InvalidThreshold();

    modifier onlySigner() {
        if (!isSigner[msg.sender]) revert NotSigner();
        _;
    }

    constructor(address acp_, address[] memory signers_, uint256 threshold_) Ownable(msg.sender) {
        if (threshold_ == 0 || threshold_ > signers_.length) revert InvalidThreshold();
        acp = acp_;
        threshold = threshold_;
        for (uint256 i = 0; i < signers_.length; i++) {
            _addSigner(signers_[i]);
        }
    }

    /// @notice Signer가 특정 jobId의 reject에 동의
    function confirmReject(uint256 jobId, bytes32 reason) external onlySigner {
        if (executed[jobId]) revert AlreadyExecuted();
        if (confirmations[jobId][msg.sender]) revert AlreadyConfirmed();

        confirmations[jobId][msg.sender] = true;
        confirmationCount[jobId]++;
        rejectReasons[jobId] = reason; // 마지막 signer의 reason 사용

        emit RejectConfirmed(jobId, msg.sender, confirmationCount[jobId]);

        if (confirmationCount[jobId] >= threshold) {
            _executeReject(jobId);
        }
    }

    /// @notice threshold 충족 시 ACP.reject() 실행
    function _executeReject(uint256 jobId) internal {
        executed[jobId] = true;
        bytes32 reason = rejectReasons[jobId];
        IAgenticCommerceReject(acp).reject(jobId, reason, "");
        emit RejectExecuted(jobId, reason);
    }

    /// @notice 수동 실행 (threshold 충족 후 자동 실행 안된 경우)
    function executeReject(uint256 jobId) external {
        if (executed[jobId]) revert AlreadyExecuted();
        if (confirmationCount[jobId] < threshold) revert ThresholdNotMet();
        _executeReject(jobId);
    }

    // ─── Admin ───────────────────────────────────────────────

    function addSigner(address signer) external onlyOwner {
        _addSigner(signer);
    }

    function removeSigner(address signer) external onlyOwner {
        require(isSigner[signer], "Not a signer");
        require(signers.length - 1 >= threshold, "Would break threshold");
        isSigner[signer] = false;
        for (uint256 i = 0; i < signers.length; i++) {
            if (signers[i] == signer) {
                signers[i] = signers[signers.length - 1];
                signers.pop();
                break;
            }
        }
        emit SignerRemoved(signer);
    }

    function setThreshold(uint256 newThreshold) external onlyOwner {
        if (newThreshold == 0 || newThreshold > signers.length) revert InvalidThreshold();
        threshold = newThreshold;
        emit ThresholdUpdated(newThreshold);
    }

    function _addSigner(address signer) internal {
        require(signer != address(0), "Zero address");
        require(!isSigner[signer], "Already signer");
        isSigner[signer] = true;
        signers.push(signer);
        emit SignerAdded(signer);
    }

    function getSigners() external view returns (address[] memory) {
        return signers;
    }
}
