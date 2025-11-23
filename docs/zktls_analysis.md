# Redfish zkTLS Branch: Web Proofs Integration Analysis

**Date:** 2025-11-23
**Branch:** zktls (commit 376d735)
**Purpose:** Investigation of vlayer Web Proofs integration for proving external API data

---

## Executive Summary

The zktls branch is an experimental integration of **vlayer's Web Proofs system** into the Redfish fraud detection platform. While the main branch uses EZKL + Halo2 to prove XGBoost ML model inference, the zktls branch adds the capability to **prove external web data** (like Etherscan API balances) using **RISC Zero + TLS-Notary protocol**.

### Key Differences from Main Branch

| Aspect | Main Branch (EZKL) | zkTLS Branch (vlayer) |
|--------|-------------------|---------------------|
| **Purpose** | Prove ML model inference | Prove external API data |
| **Proof System** | Halo2 (PLONK-based) | RISC Zero (STARK-based) |
| **Verifier Contract** | src/Verifier.sol (106 KB Halo2) | src/EtherscanVerifier.sol (140 lines) |
| **Data Source** | Local: network.onnx model + input.json | Remote: Etherscan API (or any HTTPS endpoint) |
| **Attestation Method** | Cryptographic proof of computation | TLS-Notary + ZK proof of web content |
| **Use Case** | "Did this transaction get flagged as fraud?" | "Does this address have X token balance?" |
| **Integration Complexity** | Self-contained EZKL pipeline | Requires vlayer infrastructure (notary, prover) |

### What This Enables

The zktls branch could enable **hybrid fraud detection**:
1. **ML Proof (EZKL):** Prove the fraud detection model flagged a transaction
2. **Web Proof (vlayer):** Prove the user has legitimate KYC/balance on an exchange
3. **Combined Result:** On-chain decision using both proofs

Example: "This transaction is flagged as suspicious, but the user can prove they have a verified Coinbase account with sufficient history" → Allow transaction.

---

## Technical Architecture

### What is vlayer Web Proofs?

vlayer enables **proving web data to smart contracts** using three components:

1. **TLS-Notary:** Cryptographic protocol that creates attestations of TLS sessions (HTTPS responses) without trusting the website
2. **Web Prover API:** Service that generates "presentations" (web proofs) of HTTP responses
3. **ZK Prover API:** Compresses web proofs into succinct ZK proofs verifiable on-chain

### Complete Workflow

```
┌─────────────────────────────────────────────────────────────────────┐
│ 1. WEB DATA ATTESTATION (TLS-Notary)                               │
└─────────────────────────────────────────────────────────────────────┘
User wants to prove: "Etherscan shows I have 1000 USDC"

prove.ts ──(HTTP GET)──> Etherscan API ──(Response)──> TLS-Notary
                          ├── URL: api.etherscan.io/...
                          ├── Method: GET
                          └── Response: {"result": "1000000000"}

TLS-Notary creates cryptographic attestation:
  - Notary key fingerprint (identifies notary)
  - Timestamp
  - URL + method
  - Response body

┌─────────────────────────────────────────────────────────────────────┐
│ 2. DATA EXTRACTION (JMESPath Queries)                              │
└─────────────────────────────────────────────────────────────────────┘
Extract specific fields from the attested response:

extractConfig = {
  "response.body": {
    "jmespath": ["result"]  // Extract just the balance field
  }
}

Result: balance = "1000000000"
Queries hash: 0xABCD... (commitment to extraction queries)

┌─────────────────────────────────────────────────────────────────────┐
│ 3. ZK PROOF COMPRESSION (RISC Zero)                                │
└─────────────────────────────────────────────────────────────────────┘
vlayer's zk-prover API compresses the web proof into a RISC Zero proof:

Input (Journal Data - public):
  - notaryKeyFingerprint: 0x1234...
  - method: "GET"
  - url: "https://api.etherscan.io/..."
  - timestamp: 1700000000
  - queriesHash: 0xABCD... (proves correct extraction)
  - balance: "1000000000"

Output:
  - zkProof (seal): succinct RISC Zero proof
  - journalDataAbi: ABI-encoded public inputs

┌─────────────────────────────────────────────────────────────────────┐
│ 4. ON-CHAIN VERIFICATION (EtherscanVerifier.sol)                   │
└─────────────────────────────────────────────────────────────────────┘
Smart contract verifies the ZK proof and validates constraints:

function submitBalance(bytes calldata journalData, bytes calldata seal) {
  // Decode public inputs
  (notaryKey, method, url, timestamp, queriesHash, balance) =
    abi.decode(journalData, (...))

  // Validate constraints
  require(notaryKey == EXPECTED_NOTARY_KEY)
  require(method == "GET")
  require(url starts with expectedUrlPattern)
  require(queriesHash == EXPECTED_QUERIES_HASH)
  require(balance not empty)

  // Verify ZK proof using RISC Zero verifier
  VERIFIER.verify(seal, IMAGE_ID, sha256(journalData))

  // Store verified balance
  balance = _balance
  emit BalanceVerified(balance, url, timestamp, block.number)
}
```

---

## Files Added in zktls Branch

### Core Smart Contract

**`src/EtherscanVerifier.sol`** (140 lines)
- Uses RISC Zero verifier (not Halo2)
- Validates web proof constraints:
  - Notary key fingerprint (proves notary identity)
  - URL pattern (proves correct API endpoint)
  - Queries hash (proves correct data extraction)
  - Method = "GET"
- Stores verified balance on-chain
- Emits `BalanceVerified` event with URL, timestamp, block number

### TypeScript Scripts (vlayer/ directory)

**`vlayer/prove.ts`** (151 lines)
- Main proof generation script
- Workflow:
  1. Call web-prover API → get presentation (web proof)
  2. Define JMESPath extraction queries
  3. Call zk-prover API → compress into ZK proof
  4. Save proof.json for on-chain submission

**`vlayer/scripts/deploy.ts`** (315 lines)
- Deploy EtherscanVerifier to testnet (Sepolia) or devnet (Anvil)
- Can deploy RiscZeroMockVerifier for testing
- Loads parameters from environment:
  - `ZK_PROVER_GUEST_ID` - ZK program identifier
  - `NOTARY_KEY_FINGERPRINT` - Expected notary
  - `QUERIES_HASH` - Expected extraction queries
  - `EXPECTED_URL` - API endpoint pattern
- Saves deployment info to `deployments/{network}.json`

**`vlayer/scripts/submitProof.ts`** (332 lines)
- Submit compressed ZK proof to deployed verifier
- Decodes journalDataAbi to display proof contents
- Simulates transaction before submitting
- Verifies on-chain data after submission
- Example output:
```
Decoded Journal Data:
  Notary Key Fingerprint: 0x1234...
  Method: GET
  URL: https://api.etherscan.io/...
  Timestamp: 1700000000 (2023-11-14T22:13:20.000Z)
  Queries Hash: 0xABCD...
  Balance: 1000000000

✓ Transaction confirmed!
  Block: 12345
  Gas used: 450000

✓ Verified on-chain:
  Balance: 1000000000
```

**`vlayer/scripts/verify.ts`** (110 lines)
- Read stored balance from contract
- Verify proof was submitted correctly

### Infrastructure (Docker Compose)

**`vlayer/docker-compose.devnet.yaml`**
Defines local development infrastructure:
- **anvil** - Foundry local testnet (port 8545)
- **vdns_server** - vlayer DNS resolution
- **call_server** - vlayer RPC proxy
- **notary-server** - TLS-Notary server (port 7047)
- **websockify** - WebSocket proxy for browser extension
- **websockify-test-client** - Test client

### Configuration

**`vlayer/.env.dev`**
```bash
CHAIN_NAME=anvil
PROVER_URL=http://127.0.0.1:3000
JSON_RPC_URL=http://127.0.0.1:8545
# Anvil test private key (for testing only)
EXAMPLES_TEST_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

**`vlayer/notary-config/config.yaml`**
```yaml
host: "0.0.0.0"
port: 7047
notarization:
  max_sent_data: 14096
  max_recv_data: 16384
  timeout: 1800
  private_key_path: "/root/.notary/notary.key"
  signature_algorithm: secp256k1
  allow_extensions: false
```

### Dependencies (package.json)

```json
{
  "dependencies": {
    "@vlayer/sdk": "1.5.1",
    "viem": "2.27.0",
    "@vlayer/react": "1.5.1"
  },
  "scripts": {
    "prove:mainnet": "VLAYER_ENV=mainnet bun run prove.ts",
    "prove:testnet": "VLAYER_ENV=testnet bun run prove.ts",
    "prove:dev": "VLAYER_ENV=dev bun run prove.ts"
  }
}
```

---

## How to Use zktls Branch

### 1. Start Local Infrastructure

```bash
cd vlayer
docker compose --file docker-compose.devnet.yaml up --build -d
```

This starts:
- Anvil testnet (localhost:8545)
- Notary server (localhost:7047)
- Call server, vDNS, websockify

### 2. Generate Web Proof

```bash
cd vlayer
VLAYER_ENV=dev bun run prove.ts
```

**What happens:**
1. Calls Etherscan API: `https://api.etherscan.io/v2/api?chainid=1&module=account&action=tokenbalance&contractaddress=0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48&address=0x4B808ec5A5d53871e0b7bf53bC2A4Ee89dd1ddB1`
2. Gets TLS-Notary attestation via vlayer web-prover API
3. Extracts `result` field (token balance) using JMESPath
4. Compresses into RISC Zero proof via vlayer zk-prover API
5. Saves to `proof.json`:
```json
{
  "success": true,
  "data": {
    "zkProof": "0x...",  // RISC Zero seal
    "journalDataAbi": "0x..."  // ABI-encoded public inputs
  }
}
```

### 3. Deploy Verifier Contract

```bash
cd vlayer

# Set environment variables
export PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
export ZK_PROVER_GUEST_ID=0xFFFFFFFF  # Mock for testing
export NOTARY_KEY_FINGERPRINT=0x1234...
export QUERIES_HASH=0xABCD...
export EXPECTED_URL="https://api.etherscan.io/v2/api"

# Deploy
tsx scripts/deploy.ts sepolia

# Or deploy to local Anvil
tsx scripts/deploy.ts anvil
```

**Output:**
```
=== Deploying to anvil ===

Network: anvil
Chain ID: 31337
RPC URL: http://127.0.0.1:8545

Deployer address: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
Balance: 10000 ETH

No verifier address provided. Deploying RiscZeroMockVerifier...
RiscZeroMockVerifier deployed at: 0x5FbDB2315678afecb367f032d93F642f64180aa3
⚠️  WARNING: This is a MOCK verifier for testing only. Do NOT use in production!

Deployment Parameters:
  Verifier: 0x5FbDB2315678afecb367f032d93F642f64180aa3
  Image ID: 0xFFFFFFFF
  Notary Key Fingerprint: 0x1234...
  Queries Hash: 0xABCD...
  Expected URL: https://api.etherscan.io/v2/api

✓ Contract deployed successfully!
  Address: 0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512
  Block: 1
  Gas used: 1500000

Deployment info saved to: deployments/anvil.json
```

### 4. Submit Proof On-Chain

```bash
cd vlayer
tsx scripts/submitProof.ts anvil ./proof.json
```

**Output:**
```
=== Submitting ZK Proof to anvil ===

Network: anvil
Contract: 0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512
RPC URL: http://127.0.0.1:8545

Wallet address: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266

Proof Details:
  ZK Proof (seal) length: 2048 chars
  Journal Data ABI length: 512 chars

Decoded Journal Data:
  Notary Key Fingerprint: 0x1234...
  Method: GET
  URL: https://api.etherscan.io/v2/api?chainid=1&module=account&action=tokenbalance...
  Timestamp: 1700000000 (2023-11-14T22:13:20.000Z)
  Queries Hash: 0xABCD...
  Balance: 1000000000

Simulating transaction...
✓ Simulation successful

Submitting transaction...

Transaction submitted: 0x789...
Waiting for confirmation...

✓ Transaction confirmed!
  Block: 2
  Gas used: 450000
  Status: success

Verifying on-chain data...

✓ Verified on-chain:
  Balance: 1000000000

=== Submission Complete ===

Transaction: 0x789...
Balance stored: 1000000000
View on explorer: https://sepolia.etherscan.io/tx/0x789...
```

### 5. Verify On-Chain

```bash
cd vlayer
tsx scripts/verify.ts anvil
```

Reads the stored balance from the contract.

---

## Key Differences: RISC Zero vs Halo2

### Proof Systems

| Feature | Halo2 (Main Branch) | RISC Zero (zkTLS Branch) |
|---------|-------------------|-------------------------|
| **Type** | PLONK-based SNARK | STARK |
| **Trusted Setup** | None (uses KZG with SRS) | None |
| **Proof Size** | Small (~5-6 KB) | Larger (~20-50 KB typical) |
| **Verification Cost** | High gas (~2-5M gas) | Lower gas (~500K gas) |
| **Proving Time** | Fast for specific circuits | Slower, general-purpose VM |
| **Use Case** | ML model inference (fixed circuit) | Web data attestation (dynamic) |
| **Circuit Flexibility** | Fixed: Must recompile for model changes | Flexible: Same prover for any web data |

### Verifier Contracts

**Halo2Verifier (Main Branch)**
```solidity
// src/Verifier.sol (106 KB source, 21 KB bytecode)
contract Halo2Verifier {
  function verifyProof(
    bytes calldata proof,
    uint256[] calldata instances
  ) public returns (bool)
}
```
- Generated by EZKL from specific circuit
- Contains hardcoded pairing parameters
- Optimized for one model architecture
- Heavy assembly code (EC pairing operations)

**RiscZeroVerifier (zkTLS Branch)**
```solidity
// src/EtherscanVerifier.sol (140 lines source)
contract EtherscanVerifier {
  IRiscZeroVerifier public immutable VERIFIER;
  bytes32 public immutable IMAGE_ID;

  function submitBalance(
    bytes calldata journalData,
    bytes calldata seal
  ) external {
    // Validate constraints
    // Verify ZK proof
    VERIFIER.verify(seal, IMAGE_ID, sha256(journalData));
  }
}
```
- Reuses generic RISC Zero verifier contract
- IMAGE_ID identifies the ZK program
- Lighter weight (~3-5 KB bytecode)
- Can verify any RISC Zero program (not model-specific)

---

## Integration Possibilities

### Scenario 1: Enhanced Fraud Detection with KYC

**Problem:** ML model flags transaction as suspicious, but user is legitimate.

**Solution:** Combine EZKL ML proof + vlayer KYC proof

```solidity
contract EnhancedFraudDetector {
  Halo2Verifier public mlVerifier;
  EtherscanVerifier public kycVerifier;

  function processTransaction(
    bytes calldata mlProof,
    uint256[] calldata mlInstances,
    bytes calldata kycJournalData,
    bytes calldata kycSeal
  ) external {
    // 1. Verify ML model output
    bool isFraudulent = mlVerifier.verifyProof(mlProof, mlInstances);

    // 2. If flagged, check KYC proof
    if (isFraudulent) {
      kycVerifier.submitBalance(kycJournalData, kycSeal);

      // Check if user has verified balance/history
      string memory balance = kycVerifier.balance();

      // Allow transaction if user can prove legitimacy
      if (parseBalance(balance) > THRESHOLD) {
        // Override fraud flag based on KYC
        return allowTransaction();
      }
    }

    // Execute transaction
    executeTransaction();
  }
}
```

### Scenario 2: Real-Time Risk Scoring

**Use Case:** Calculate risk score using on-chain ML + off-chain data

**Architecture:**
```
┌──────────────────┐
│ User Transaction │
└────────┬─────────┘
         │
         ├─> EZKL Proof: ML model risk score (0-100)
         │   Input: Transaction features
         │   Output: Risk score = 85 (high risk)
         │
         └─> vlayer Proof: User reputation from exchange API
             Input: Etherscan/exchange balance history
             Output: Account age = 3 years, volume = $1M

Combined Decision:
  Risk score: 85 (high)
  But: Proven account history shows legitimacy
  Result: ALLOW with monitoring
```

### Scenario 3: Compliant DeFi

**Use Case:** DeFi protocol needs to verify users without centralized KYC

**Flow:**
1. User proves they have verified Coinbase/Binance account (vlayer Web Proof)
2. User proves transaction passes fraud detection (EZKL ML Proof)
3. Smart contract allows DeFi interaction

This provides:
- **Privacy:** No personal data revealed, just ZK proofs
- **Compliance:** Can prove user passed KYC somewhere
- **Security:** ML model prevents fraudulent transactions

---

## Limitations and Considerations

### 1. Infrastructure Dependency

**Main Branch (EZKL):** Self-contained
- All proof generation happens locally
- Only needs Foundry/Anvil for testing
- No external services

**zkTLS Branch (vlayer):** Requires external infrastructure
- web-prover API (vlayer service)
- zk-prover API (vlayer service)
- Notary server (can self-host or use vlayer's)
- More complex deployment

### 2. Proof Generation Time

**EZKL:**
- Prove: ~30-60 seconds for XGBoost model
- Verify: ~1 second on-chain

**vlayer:**
- Prove: ~60-120 seconds (includes TLS attestation + ZK compression)
- Verify: ~1 second on-chain

### 3. Cost Comparison

**EZKL Halo2 Verifier:**
- Deployment: ~21 KB contract = ~3-4M gas = ~$50-100 (at 50 gwei, $3000 ETH)
- Verification: ~2-5M gas per proof = ~$30-75

**vlayer RISC Zero Verifier:**
- Deployment: ~5 KB contract = ~500K gas = ~$7-15
- Verification: ~300-500K gas per proof = ~$5-10

**Winner for on-chain cost:** vlayer (RISC Zero)

### 4. Use Case Fit

**When to use EZKL (Main Branch):**
- Fixed ML model that doesn't change often
- Local data (transaction features)
- Maximum decentralization (no external deps)
- Optimized for specific model architecture

**When to use vlayer (zkTLS Branch):**
- Need to prove external API data
- Web data (prices, balances, KYC status)
- Dynamic queries (different endpoints per user)
- Lower on-chain verification cost

**Best approach:** Use both!
- EZKL for ML inference proof
- vlayer for external data proof
- Combine in smart contract for enhanced decisions

---

## Next Steps for Integration

### 1. Hybrid Verifier Contract

Create a contract that accepts both proof types:

```solidity
contract HybridFraudDetector {
  Halo2Verifier public mlVerifier;
  IRiscZeroVerifier public webVerifier;

  struct Transaction {
    bytes mlProof;
    uint256[] mlInstances;
    bytes webProofJournal;
    bytes webProofSeal;
  }

  function verifyTransaction(Transaction calldata tx) external returns (bool) {
    // Verify ML proof
    bool mlResult = mlVerifier.verifyProof(tx.mlProof, tx.mlInstances);

    // Verify web proof
    try webVerifier.verify(tx.webProofSeal, IMAGE_ID, sha256(tx.webProofJournal)) {
      // Both proofs valid
      return processWithWebData(tx);
    } catch {
      // Only ML proof valid
      return processMlOnly(tx);
    }
  }
}
```

### 2. Unified Proof Generation Pipeline

```bash
# Generate both proofs for a transaction
./scripts/generate_hybrid_proof.sh <transaction_data>

# Step 1: Generate EZKL ML proof
cd ezkl
python3 gen_input.py --transaction $TX_DATA
ezkl prove
# → ezkl/build/proof.json

# Step 2: Generate vlayer Web Proof (user's exchange balance)
cd vlayer
VLAYER_ENV=mainnet bun run prove.ts --user $USER_ADDRESS
# → vlayer/proof.json

# Step 3: Submit both to hybrid verifier
cd scripts
tsx submit_hybrid_proof.ts \
  --ml-proof ../ezkl/build/proof.json \
  --web-proof ../vlayer/proof.json \
  --network sepolia
```

### 3. Testing Strategy

**Unit Tests:**
- `test/Verifier.t.sol` - Test EZKL ML verifier
- `test/EtherscanVerifier.t.sol` - Test vlayer web verifier
- `test/HybridVerifier.t.sol` - Test combined system

**Integration Tests:**
1. Generate real ML proof with known transaction
2. Generate real web proof with test Etherscan API call
3. Submit both to hybrid contract on Anvil
4. Verify correct decision logic

**Deployment:**
1. Deploy to Sepolia testnet first
2. Test with real API calls (testnet Etherscan)
3. Deploy to mainnet after thorough testing

---

## Branch Status

**Commit:** 376d735 - "Initial ethereum verifier example trial with vlayer"
**Parent:** 79ffdcb (same as main branch origin)
**Divergence:** +13,945 lines (vlayer integration), -2,055 lines (removed old artifacts)

**Files Changed:**
- 44 files modified
- Key additions: vlayer/ directory, EtherscanVerifier.sol, soldeer.lock
- Key removals: src/Verifier.sol moved, Counter example removed

**Branch Relationships:**
```
* 149b5b5 (origin/main, main) chore: Rebuild proof pipeline
| * 376d735 (origin/zktls, zktls) Initial ethereum verifier example trial
|/
* 79ffdcb chore: Add circuit artifacts, proof generation script
```

**Status:** Experimental, not merged to main

---

## Conclusion

The zktls branch demonstrates a **complementary approach** to the main EZKL fraud detection system:

- **Main Branch (EZKL):** Proves "This ML model classified this transaction"
- **zkTLS Branch (vlayer):** Proves "This API returned this data for this user"

**Potential Combined System:**
```
┌─────────────────────────────────────────────────────────────┐
│ Redfish: Hybrid ZK Fraud Detection + Web Proof System      │
└─────────────────────────────────────────────────────────────┘

Input: Transaction to verify

Step 1: ML Fraud Detection (EZKL)
  └─> Generate XGBoost inference proof
  └─> Output: Fraud score = 0.85 (high risk)

Step 2: User Reputation Proof (vlayer)
  └─> Generate web proof of user's exchange balance/history
  └─> Output: Verified 3-year account with $1M volume

Step 3: Smart Contract Decision
  └─> Combine both proofs
  └─> Logic: High risk score BUT proven legitimate history
  └─> Result: ALLOW with monitoring

Benefits:
  ✓ Privacy: No raw data revealed
  ✓ Decentralized: Verifiable on-chain
  ✓ Accurate: ML + external data = better decisions
  ✓ Compliant: Can prove KYC without revealing identity
```

**Recommendation:** Merge approaches by creating a hybrid verifier contract that accepts both EZKL ML proofs and vlayer Web Proofs, enabling more sophisticated fraud detection with external reputation data.

---

**Investigation Status:** COMPLETE ✓
**Architecture:** FULLY DOCUMENTED ✓
**Integration Path:** DEFINED ✓
