// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IRiscZeroVerifier} from "risc0-ethereum-3.0.0/src/IRiscZeroVerifier.sol";

/// @title EtherscanVerifier
/// @notice Verifies and stores Etherscan balance proofs using ZK proofs from vlayer
/// @dev Uses RISC Zero verifier to validate ZK proofs generated from Etherscan API data
contract EtherscanVerifier {
    /// @notice RISC Zero verifier contract
    IRiscZeroVerifier public immutable VERIFIER;

    /// @notice ZK proof program identifier
    /// @dev This should match the IMAGE_ID from your ZK proof program
    bytes32 public immutable IMAGE_ID;

    /// @notice Expected notary key fingerprint from vlayer
    bytes32 public immutable EXPECTED_NOTARY_KEY_FINGERPRINT;

    /// @notice Expected queries hash - validates correct fields are extracted
    /// @dev Computed from the JMESPath queries used to extract balance
    bytes32 public immutable EXPECTED_QUERIES_HASH;

    /// @notice Expected URL pattern for Etherscan API
    string public expectedUrlPattern;

    /// @notice Verified balance from the proof
    string public balance;

    /// @notice Emitted when a balance is successfully verified
    event BalanceVerified(
        string balance,
        string url,
        uint256 timestamp,
        uint256 blockNumber
    );

    /// @notice Custom errors
    error InvalidNotaryKeyFingerprint();
    error InvalidQueriesHash();
    error InvalidUrl();
    error ZKProofVerificationFailed();
    error InvalidBalance();

    /// @notice Contract constructor
    /// @param _verifier Address of the RISC Zero verifier contract
    /// @param _imageId ZK proof program identifier (IMAGE_ID)
    /// @param _expectedNotaryKeyFingerprint Expected notary key fingerprint from vlayer
    /// @param _expectedQueriesHash Expected hash of extraction queries
    /// @param _expectedUrlPattern Expected Etherscan API URL pattern
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

    /// @notice Submit and verify an Etherscan balance proof
    /// @param journalData Encoded proof data containing public outputs
    /// @param seal ZK proof seal for verification
    /// @dev Journal data should be abi.encoded as: (notaryKeyFingerprint, method, url, timestamp, queriesHash, balance)
    function submitBalance(
        bytes calldata journalData,
        bytes calldata seal
    ) external {
        // Decode the journal data
        (
            bytes32 notaryKeyFingerprint,
            string memory method,
            string memory url,
            uint256 timestamp,
            bytes32 queriesHash,
            string memory _balance
        ) = abi.decode(journalData, (bytes32, string, string, uint256, bytes32, string));

        // Validate notary key fingerprint
        if (notaryKeyFingerprint != EXPECTED_NOTARY_KEY_FINGERPRINT) {
            revert InvalidNotaryKeyFingerprint();
        }

        // Validate method is GET (expected for API calls)
        if (keccak256(bytes(method)) != keccak256(bytes("GET"))) {
            revert InvalidUrl();
        }

        // Validate queries hash
        if (queriesHash != EXPECTED_QUERIES_HASH) {
            revert InvalidQueriesHash();
        }

        // Validate URL matches the expected endpoint pattern provided at deployment
        // The URL may include an API key parameter, so we check if it starts with the expected pattern
        bytes memory urlBytes = bytes(url);
        bytes memory patternBytes = bytes(expectedUrlPattern);
        
        // Check if URL starts with the expected pattern
        if (urlBytes.length < patternBytes.length) {
            revert InvalidUrl();
        }
        
        // Compare the first part of the URL with the expected pattern
        for (uint256 i = 0; i < patternBytes.length; i++) {
            if (urlBytes[i] != patternBytes[i]) {
                revert InvalidUrl();
            }
        }
        
        // If URL is longer than the pattern, it should only have &apikey=... appended
        // We allow this since API keys are required for the API call but shouldn't affect validation

        // Validate balance is not empty
        if (bytes(_balance).length == 0) {
            revert InvalidBalance();
        }

        // Verify the ZK proof
        try VERIFIER.verify(seal, IMAGE_ID, sha256(journalData)) {
            // Proof verified successfully
        } catch {
            revert ZKProofVerificationFailed();
        }

        // Store the verified balance
        balance = _balance;

        emit BalanceVerified(
            _balance,
            url,
            timestamp,
            block.number
        );
    }
}