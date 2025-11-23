// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IRiscZeroVerifier} from "risc0-ethereum-3.0.0/src/IRiscZeroVerifier.sol";

/// @title WalletReputationVerifier
/// @notice Verifies wallet reputation proofs from Etherscan API via vlayer Web Proofs
/// @dev Part of the Redfish ZKML fraud detection system
contract WalletReputationVerifier {
    /// @notice RISC Zero verifier contract
    IRiscZeroVerifier public immutable VERIFIER;

    /// @notice ZK proof program identifier
    bytes32 public immutable IMAGE_ID;

    /// @notice Expected notary key fingerprint from vlayer
    bytes32 public immutable EXPECTED_NOTARY_KEY_FINGERPRINT;

    /// @notice Expected queries hash
    bytes32 public immutable EXPECTED_QUERIES_HASH;

    /// @notice Expected URL pattern for Etherscan API
    string public expectedUrlPattern;

    /// @notice Mapping of wallet address to verified reputation data
    mapping(address => WalletReputation) public walletReputations;

    /// @notice Wallet reputation data structure
    struct WalletReputation {
        string balance;
        uint256 timestamp;
        uint256 blockNumber;
        bool verified;
    }

    /// @notice Emitted when wallet reputation is verified
    event ReputationVerified(
        address indexed wallet,
        string balance,
        uint256 timestamp,
        uint256 blockNumber
    );

    /// @notice Custom errors
    error InvalidNotaryKeyFingerprint();
    error InvalidQueriesHash();
    error InvalidUrl();
    error ZKProofVerificationFailed();
    error InvalidBalance();

    constructor(
        address _verifier,
        bytes32 _imageId,
        bytes32 _expectedNotaryKeyFingerprint,
        bytes32 _expectedQueriesHash,
        string memory _expectedUrlPattern
    ) {
        VERIFIER = IRiscZeroVerifier(_verifier);
        IMAGE_ID = _imageId;
        EXPECTED_NOTARY_KEY_FINGERPRINT = _expectedNotaryKeyFingerprint;
        EXPECTED_QUERIES_HASH = _expectedQueriesHash;
        expectedUrlPattern = _expectedUrlPattern;
    }

    /// @notice Submit and verify wallet reputation proof
    /// @param walletAddress The wallet address being proven
    /// @param journalData Encoded proof data
    /// @param seal ZK proof seal
    function submitReputation(
        address walletAddress,
        bytes calldata journalData,
        bytes calldata seal
    ) external {
        (
            bytes32 notaryKeyFingerprint,
            string memory method,
            string memory url,
            uint256 timestamp,
            bytes32 queriesHash,
            string memory balance
        ) = abi.decode(journalData, (bytes32, string, string, uint256, bytes32, string));

        // Validate notary key fingerprint
        if (notaryKeyFingerprint != EXPECTED_NOTARY_KEY_FINGERPRINT) {
            revert InvalidNotaryKeyFingerprint();
        }

        // Validate method is GET
        if (keccak256(bytes(method)) != keccak256(bytes("GET"))) {
            revert InvalidUrl();
        }

        // Validate queries hash
        if (queriesHash != EXPECTED_QUERIES_HASH) {
            revert InvalidQueriesHash();
        }

        // Validate URL pattern
        bytes memory urlBytes = bytes(url);
        bytes memory patternBytes = bytes(expectedUrlPattern);
        
        if (urlBytes.length < patternBytes.length) {
            revert InvalidUrl();
        }
        
        for (uint256 i = 0; i < patternBytes.length; i++) {
            if (urlBytes[i] != patternBytes[i]) {
                revert InvalidUrl();
            }
        }

        // Validate balance is not empty
        if (bytes(balance).length == 0) {
            revert InvalidBalance();
        }

        // Verify ZK proof
        try VERIFIER.verify(seal, IMAGE_ID, sha256(journalData)) {
            // Success
        } catch {
            revert ZKProofVerificationFailed();
        }

        // Store verified reputation
        walletReputations[walletAddress] = WalletReputation({
            balance: balance,
            timestamp: timestamp,
            blockNumber: block.number,
            verified: true
        });

        emit ReputationVerified(walletAddress, balance, timestamp, block.number);
    }

    /// @notice Get wallet reputation score (simplified)
    /// @param walletAddress The wallet to check
    /// @return score Reputation score (0-100)
    function getReputationScore(address walletAddress) external view returns (uint256 score) {
        WalletReputation memory rep = walletReputations[walletAddress];
        
        if (!rep.verified) {
            return 0;
        }

        // Simple scoring: higher balance = higher score
        // In production, combine with: tx count, age, contract interactions, etc.
        uint256 balanceWei = parseBalance(rep.balance);
        
        // Score tiers (simplified for demo)
        if (balanceWei >= 10 ether) return 100;
        if (balanceWei >= 1 ether) return 75;
        if (balanceWei >= 0.1 ether) return 50;
        if (balanceWei >= 0.01 ether) return 25;
        return 10;
    }

    /// @notice Parse balance string to uint256
    function parseBalance(string memory balanceStr) internal pure returns (uint256) {
        bytes memory b = bytes(balanceStr);
        uint256 result = 0;
        
        for (uint256 i = 0; i < b.length; i++) {
            uint8 digit = uint8(b[i]) - 48;
            if (digit > 9) continue;
            result = result * 10 + digit;
        }
        
        return result;
    }
}
