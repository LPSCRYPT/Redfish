# Redfish vlayer Integration Guide

## Introduction

This document explains how Redfish integrates vlayer Web Proofs to create a hybrid ZKML + zkTLS fraud detection system.

## System Architecture

### Dual Proof System

Redfish uses TWO types of zero-knowledge proofs:

1. **EZKL Proof (Halo2)**: Proves ML model classified transaction
2. **vlayer Proof (RISC Zero)**: Proves wallet has verified external reputation

### Why Both?

**EZKL alone** can only prove: "My ML model flagged this transaction as suspicious"

**Problem**: False positives - legitimate users get blocked

**Solution**: Add reputation proof via vlayer

**vlayer** proves: "This wallet has 3+ years history with 100+ ETH balance verified via Etherscan"

**Result**: Even if ML flags transaction, allow it if reputation is strong

## Technical Implementation

### vlayer Web Proof Workflow

```
[1] User Submits Transaction
     |
     v
[2] Generate Reputation Proof
     |
     +-> Call vlayer web-prover API
     |   - Query: Etherscan API for wallet balance
     |   - Output: TLS-notarized web proof
     |
     +-> Extract Data (JMESPath)
     |   - Field: balance
     |   - Field: (future) tx count, age, etc.
     |
     +-> Compress via zk-prover API
         - Input: Web proof + extraction config
         - Output: RISC Zero ZK proof (seal + journal)
     |
     v
[3] Submit to WalletReputationVerifier.sol
     |
     +-> Validate notary key fingerprint
     +-> Validate URL pattern
     +-> Validate queries hash
     +-> Verify RISC Zero proof
     +-> Store reputation on-chain
     |
     v
[4] Combined Decision Logic
     |
     +-> Check EZKL proof (ML flagged?)
     +-> Check vlayer proof (good reputation?)
     |
     +-> Decision Matrix:
         - ML=safe, Rep=any     -> ALLOW
         - ML=fraud, Rep=high   -> ALLOW with monitoring
         - ML=fraud, Rep=medium -> REQUIRE_REVIEW
         - ML=fraud, Rep=low    -> BLOCK
```

### Contract Integration Example

```solidity
contract RedfishHybridDetector {
    EZKLVerifier public mlVerifier;
    WalletReputationVerifier public repVerifier;

    function processSwap(
        bytes calldata mlProof,
        uint256[] calldata mlInstances,
        bytes calldata repJournal,
        bytes calldata repSeal
    ) external {
        // Verify ML proof
        bool mlSafe = mlVerifier.verifyProof(mlProof, mlInstances);

        // Get reputation score
        repVerifier.submitReputation(msg.sender, repJournal, repSeal);
        uint256 repScore = repVerifier.getReputationScore(msg.sender);

        // Combined decision
        if (!mlSafe && repScore < 50) {
            revert("Blocked: Flagged + Low Reputation");
        }

        // Execute swap
        _executeSwap();
    }
}
```

## API Reference

### vlayer APIs

**Web Prover API**
- Endpoint: `https://web-prover.vlayer.xyz/api/v1/prove`
- Purpose: Create TLS-notarized proof of web data
- Auth: `x-client-id` + `Authorization: Bearer <token>`
- Input: URL + headers
- Output: Presentation (notarized proof)

**ZK Prover API**
- Endpoint: `https://zk-prover.vlayer.xyz/api/v0/compress-web-proof`
- Purpose: Compress web proof into RISC Zero ZK proof
- Auth: Same as web-prover
- Input: Presentation + extraction config
- Output: ZK proof (seal + journalDataAbi)

### Etherscan API Endpoints

**Current**: 
- `/api?module=account&action=balance` - Wallet ETH balance

**Future**:
- `/api?module=account&action=txlist` - Transaction history
- `/api?module=account&action=tokentx` - ERC20 transfers
- `/api?module=contract&action=getcontractcreation` - Contract deployments

## Cost Comparison

| Operation | EZKL (Halo2) | vlayer (RISC Zero) |
|-----------|--------------|-------------------|
| Proof Gen Time | 30-60s | 60-120s |
| Proof Size | 5-6 KB | 20-50 KB |
| Deploy Gas | 3-4M (~$50-100) | 500K (~$7-15) |
| Verify Gas | 2-5M (~$30-75) | 300-500K (~$5-10) |

**Key Insight**: vlayer is 5-10x cheaper on-chain but slower proof generation

**Best Practice**: 
- Use EZKL for per-transaction ML inference (frequent)
- Use vlayer for reputation updates (infrequent - once per hour/day)

## Security Model

### Trusted Components

1. **vlayer Notary**: Attests HTTPS responses
   - Current: Trust vlayer's notary
   - Future: Self-host or multi-notary

2. **vlayer APIs**: web-prover + zk-prover services
   - Alternative: Run locally via Docker

### Verified Components

1. **TLS Certificate Chain**: Validated by notary
2. **API Response Content**: Cryptographically attested
3. **Data Extraction**: Proven in ZK circuit
4. **URL Pattern**: Validated in smart contract
5. **ZK Proof**: Verified via RISC Zero on-chain

### Attack Resistance

- **API Spoofing**: TLS notary prevents
- **Data Tampering**: ZK proof would fail
- **Replay Attacks**: Timestamp validation in contract
- **URL Manipulation**: Pattern matching in contract

## Development Workflow

### 1. Local Testing

```bash
# Start local infrastructure
cd vlayer
docker-compose -f docker-compose.devnet.yaml up -d

# This starts:
# - Anvil (local blockchain)
# - Notary server
# - vlayer services
```

### 2. Generate Proof

```bash
npm run prove 0xYourWalletAddress
# -> Outputs: vlayer/proofs/wallet_reputation_proof.json
```

### 3. Deploy Verifier

```bash
cd ..  # Back to root
forge create vlayer/contracts/WalletReputationVerifier.sol \
  --constructor-args \
    $RISC_ZERO_VERIFIER \
    $IMAGE_ID \
    $NOTARY_KEY \
    $QUERIES_HASH \
    $URL_PATTERN
```

### 4. Submit Proof

```bash
cd vlayer
npm run submit:proof
```

### 5. Query Reputation

```bash
cast call $VERIFIER_ADDRESS \
  "getReputationScore(address)(uint256)" \
  0xYourWalletAddress
```

## Production Deployment

### Mainnet Checklist

- [ ] vlayer API keys configured
- [ ] Etherscan API key (optional, for rate limits)
- [ ] RISC Zero verifier deployed
- [ ] WalletReputationVerifier deployed
- [ ] IMAGE_ID matches vlayer program
- [ ] NOTARY_KEY matches current vlayer notary
- [ ] QUERIES_HASH matches extraction config
- [ ] URL_PATTERN validated
- [ ] Gas costs acceptable
- [ ] Monitoring setup for:
  - [ ] Proof generation failures
  - [ ] Verification failures
  - [ ] Reputation score distribution

### Monitoring

Key metrics to track:
1. **Proof Generation Success Rate**: Should be >99%
2. **Average Proof Gen Time**: Baseline ~90s
3. **On-Chain Verification Gas**: Track trends
4. **Reputation Score Distribution**: Detect anomalies
5. **False Positive Rate**: ML flags + high reputation

## Future Enhancements

### Multi-Source Reputation

Aggregate proofs from:
- Etherscan (on-chain)
- Coinbase (exchange balance via OAuth)
- Binance (trading volume)
- ENS (domain ownership)
- POAP (event attendance)

### Advanced Reputation Scoring

Current: Simple balance threshold

Future:
```
RepScore = weighted_sum([
    balance_score * 0.3,
    tx_count_score * 0.2,
    age_score * 0.2,
    contract_interactions * 0.15,
    token_diversity * 0.15
])
```

### Proof Aggregation

Instead of one proof per data point, aggregate multiple:
- Balance proof
- Tx history proof
- Token holdings proof

→ Single aggregated reputation proof

### Time-Decay

Reputation expires:
- Proofs older than 24h: 50% weight
- Proofs older than 7d: 25% weight
- Proofs older than 30d: Invalid

## Troubleshooting

### Proof Generation Fails

**Error**: "HTTP 401 Unauthorized"
- Check WEB_PROVER_API_CLIENT_ID
- Check WEB_PROVER_API_SECRET

**Error**: "Timeout after 120s"
- ZK prover overloaded
- Try again or increase timeout

**Error**: "Invalid API response"
- Check ETHERSCAN_API_KEY
- Check wallet address format

### Verification Fails

**Error**: "InvalidNotaryKeyFingerprint"
- Notary key changed
- Update EXPECTED_NOTARY_KEY_FINGERPRINT

**Error**: "InvalidQueriesHash"
- Extraction config mismatch
- Ensure proof uses same config as contract

**Error**: "ZKProofVerificationFailed"
- IMAGE_ID mismatch
- Check RISC Zero verifier version

## Resources

- vlayer Docs: https://book.vlayer.xyz
- Redfish Main: ../README.md
- EZKL Integration: ./agents.md
- Example Repo: https://github.com/writersblockchain/vlayer-etherscan-example
