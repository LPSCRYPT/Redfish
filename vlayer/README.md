# Redfish vlayer Integration

vlayer Web Proofs integration for trustless external data verification.

## Overview

This integration provides ZK proofs of wallet reputation data from Etherscan API.
The proven data feeds into the Redfish ZKML fraud detection model.

## Quick Start

```bash
# Install dependencies
npm install

# Configure credentials
cp .env.example .env
# Edit .env with your vlayer API keys

# Generate proof for a wallet
npm run prove 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb

# Deploy verifier contract
npm run deploy:verifier

# Submit proof on-chain
npm run submit:proof
```

## Architecture

1. **TLS Notarization**: vlayer web-prover creates cryptographic attestation of Etherscan API response
2. **Data Extraction**: Extract wallet balance using JMESPath queries
3. **ZK Compression**: Compress into RISC Zero proof via vlayer zk-prover
4. **On-Chain Verification**: WalletReputationVerifier.sol validates and stores reputation

## Files

- `scripts/prove_wallet_reputation.ts` - Proof generation
- `contracts/WalletReputationVerifier.sol` - On-chain verifier
- `proofs/` - Generated proof artifacts

## Integration with EZKL

Combines with EZKL ML proofs for hybrid fraud detection:
- EZKL: Proves ML model flagged transaction
- vlayer: Proves wallet has legitimate history
- Smart contract: Makes combined decision

See main README for full architecture details.
