// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseHook} from "v4-core/src/BaseHook.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "v4-core/src/types/BeforeSwapDelta.sol";

interface IHalo2Verifier {
    function verifyProof(
        bytes calldata proof,
        uint256[] calldata instances
    ) external returns (bool);
}

/// @title FraudDetectionHook
/// @notice Uniswap V4 hook that enforces fraud detection via hybrid zkTLS + ZK-ML proofs
/// @dev Integrates vlayer zkTLS + EZKL ZKML verification before allowing swaps
contract FraudDetectionHook is BaseHook {
    using PoolIdLibrary for PoolKey;

    // ============================================
    // State Variables
    // ============================================

    /// @notice Address of the ZK-ML Halo2 verifier contract
    IHalo2Verifier public immutable halo2Verifier;

    /// @notice Mapping to store verified addresses (address => timestamp)
    mapping(address => uint256) public verifiedAddresses;

    /// @notice Duration for which a verification is valid (default: 24 hours)
    uint256 public verificationValidityPeriod = 24 hours;

    /// @notice Maximum fraud score allowed to swap (0-100 scale)
    /// @dev Lower score = more trustworthy. Set to 80 = reject if fraud score > 80
    uint256 public maxAllowedFraudScore = 80;

    // ============================================
    // Events
    // ============================================

    event AddressVerified(address indexed user, uint256 timestamp);
    event SwapBlocked(address indexed user, uint256 fraudScore);
    event SwapAllowed(address indexed user, uint256 fraudScore);
    event DownstreamLogicExecuted(address indexed user, uint256 fraudScore);

    // ============================================
    // Errors
    // ============================================

    error ProofVerificationFailed();
    error FraudScoreTooHigh(uint256 score);
    error VerificationExpired();

    // ============================================
    // Constructor
    // ============================================

    constructor(
        IPoolManager _poolManager,
        address _halo2Verifier
    ) BaseHook(_poolManager) {
        halo2Verifier = IHalo2Verifier(_halo2Verifier);
    }

    // ============================================
    // Hook Configuration
    // ============================================

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: false,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,          // ✓ Verify before swap
            afterSwap: false,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    // ============================================
    // Core Hook Logic
    // ============================================

    /// @notice Hook called before each swap
    /// @dev Verifies hybrid zkTLS + ZK-ML proof of fraud detection before allowing swap
    function beforeSwap(
        address sender,
        PoolKey calldata key,
        IPoolManager.SwapParams calldata params,
        bytes calldata hookData
    ) external override returns (bytes4, BeforeSwapDelta, uint24) {
        // Check if address has recent valid verification
        uint256 lastVerified = verifiedAddresses[sender];

        if (lastVerified > 0 && block.timestamp - lastVerified < verificationValidityPeriod) {
            // Verification still valid, allow swap
            return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }

        // Decode hookData: proof + instances + fraudScore
        (bytes memory proof, uint256[] memory instances, uint256 fraudScore) =
            abi.decode(hookData, (bytes, uint256[], uint256));

        // Step 1: Check fraud score from ML model output
        if (fraudScore > maxAllowedFraudScore) {
            emit SwapBlocked(sender, fraudScore);
            revert FraudScoreTooHigh(fraudScore);
        }

        // Step 2: Verify the hybrid ZK proof (vlayer zkTLS + EZKL ZKML)
        bool proofValid = halo2Verifier.verifyProof(proof, instances);

        if (!proofValid) {
            emit SwapBlocked(sender, fraudScore);
            revert ProofVerificationFailed();
        }

        // Step 3: Store verification timestamp
        verifiedAddresses[sender] = block.timestamp;
        emit AddressVerified(sender, block.timestamp);
        emit SwapAllowed(sender, fraudScore);

        // Step 4: Execute downstream logic
        _executeDownstreamLogic(sender, key, params, fraudScore);

        // Allow swap to proceed
        return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    // ============================================
    // Downstream Logic (Placeholder)
    // ============================================

    /// @notice Placeholder for downstream Uniswap V4 logic after verification
    /// @dev Override this function to implement custom behavior after proof verification
    function _executeDownstreamLogic(
        address sender,
        PoolKey calldata key,
        IPoolManager.SwapParams calldata params,
        uint256 fraudScore
    ) internal virtual {
        // ========================================
        // PLACEHOLDER: Custom Logic Goes Here
        // ========================================

        // Examples of what could be implemented:
        // 1. Apply dynamic fees based on fraud score
        // 2. Adjust slippage tolerance
        // 3. Enforce transaction limits for risky addresses
        // 4. Trigger additional security checks
        // 5. Log metrics for monitoring

        // For now, just emit event for transparency
        emit DownstreamLogicExecuted(sender, fraudScore);
    }

    // ============================================
    // Admin Functions
    // ============================================

    /// @notice Update verification validity period
    /// @dev Only owner should call this in production
    function updateVerificationPeriod(uint256 newPeriod) external {
        verificationValidityPeriod = newPeriod;
    }

    /// @notice Update maximum allowed fraud score
    /// @dev Only owner should call this in production
    function updateMaxFraudScore(uint256 newMaxScore) external {
        maxAllowedFraudScore = newMaxScore;
    }

    // ============================================
    // View Functions
    // ============================================

    /// @notice Check if address has valid verification
    function isAddressVerified(address user) external view returns (bool) {
        uint256 lastVerified = verifiedAddresses[user];
        return lastVerified > 0 && block.timestamp - lastVerified < verificationValidityPeriod;
    }

    /// @notice Get time until verification expires
    function getTimeUntilExpiry(address user) external view returns (uint256) {
        uint256 lastVerified = verifiedAddresses[user];
        if (lastVerified == 0) return 0;

        uint256 expiryTime = lastVerified + verificationValidityPeriod;
        if (block.timestamp >= expiryTime) return 0;

        return expiryTime - block.timestamp;
    }
}
