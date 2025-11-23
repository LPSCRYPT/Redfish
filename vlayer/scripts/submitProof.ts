import { createWalletClient, createPublicClient, http, encodeAbiParameters, decodeAbiParameters, decodeErrorResult, type Address, type Hex } from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import * as dotenv from 'dotenv';
import { getNetworkConfig } from './config.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

interface ProofData {
  success: boolean;
  data?: {
    zkProof?: string;
    journalDataAbi?: string;
  };
  zkProof?: string;
  journalDataAbi?: string;
}

interface DeploymentInfo {
  contractAddress: Address;
}

export interface SubmitProofOptions {
  network: string;
  proofFile: string;
  contractAddress?: Address;
}

export interface SubmitProofResult {
  transactionHash: Hex;
  blockNumber: bigint;
  gasUsed: bigint;
  balance: string;
}

// Contract ABI - only the functions we need
const contractABI = [
  {
    inputs: [
      { name: 'journalData', type: 'bytes' },
      { name: 'seal', type: 'bytes' }
    ],
    name: 'submitBalance',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [],
    name: 'balance',
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function'
  },
  // Custom errors for better revert decoding
  { name: 'InvalidNotaryKeyFingerprint', type: 'error', inputs: [] },
  { name: 'InvalidQueriesHash', type: 'error', inputs: [] },
  { name: 'InvalidUrl', type: 'error', inputs: [] },
  { name: 'InvalidBalance', type: 'error', inputs: [] },
  { name: 'ZKProofVerificationFailed', type: 'error', inputs: [] },
  // Standard errors
  { name: 'Error', type: 'error', inputs: [{ name: 'message', type: 'string' }] },
  { name: 'Panic', type: 'error', inputs: [{ name: 'code', type: 'uint256' }] },
] as const;

function getRevertData(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null) {
    const top = err as Record<string, unknown>;
    if (typeof top.data === 'string') return top.data;
    if (typeof top.cause === 'object' && top.cause !== null) {
      const cause = top.cause as Record<string, unknown>;
      if (typeof cause.data === 'string') return cause.data;
    }
  }
  return undefined;
}

export async function submitProof(options: SubmitProofOptions): Promise<SubmitProofResult> {
  const { network, proofFile, contractAddress: overrideAddress } = options;

  console.log(`\n=== Submitting ZK Proof to ${network} ===\n`);

  // Get network configuration
  const networkConfig = getNetworkConfig(network);
  let rpcUrl = networkConfig.rpcUrl;
  if (network === 'sepolia') {
    const sepoliaRpcUrl = process.env.SEPOLIA_RPC_URL;
    if (sepoliaRpcUrl) {
      rpcUrl = sepoliaRpcUrl;
    }
  }

  // Load deployment info to get contract address
  const deploymentPath = path.join(__dirname, '../deployments', `${network}.json`);
  let contractAddress: Address;
  
  if (overrideAddress) {
    contractAddress = overrideAddress;
  } else if (fs.existsSync(deploymentPath)) {
    const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf-8')) as DeploymentInfo;
    contractAddress = deployment.contractAddress;
  } else {
    throw new Error(`Contract address not found. Either provide it as an argument or ensure ${deploymentPath} exists.`);
  }

  if (!contractAddress) {
    throw new Error(`Contract address not configured for network: ${network}`);
  }

  console.log(`Network: ${network}`);
  console.log(`Contract: ${contractAddress}`);
  console.log(`RPC URL: ${rpcUrl}`);

  // Setup wallet
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('PRIVATE_KEY not set in environment variables');
  }

  const account = privateKeyToAccount(privateKey as Hex);
  console.log(`\nWallet address: ${account.address}`);

  // Create clients
  const publicClient = createPublicClient({
    chain: networkConfig.chain,
    transport: http(rpcUrl),
  });

  const walletClient = createWalletClient({
    account,
    chain: networkConfig.chain,
    transport: http(rpcUrl),
  });

  // Load proof data from file
  const proofPath = path.resolve(proofFile);
  if (!fs.existsSync(proofPath)) {
    throw new Error(`Proof file not found: ${proofPath}`);
  }

  const proofData = JSON.parse(fs.readFileSync(proofPath, 'utf-8')) as ProofData;
  
  // Extract zkProof (seal) and journalDataAbi from compressed proof response
  // The response structure is: { success: true, data: { zkProof, journalDataAbi } }
  const zkProof = proofData.data?.zkProof || proofData.zkProof;
  const journalDataAbi = proofData.data?.journalDataAbi || proofData.journalDataAbi;

  if (!zkProof || !journalDataAbi) {
    throw new Error('Invalid proof file: missing zkProof or journalDataAbi');
  }

  console.log(`\nProof Details:`);
  console.log(`  ZK Proof (seal) length: ${zkProof.length} chars`);
  console.log(`  Journal Data ABI length: ${journalDataAbi.length} chars`);

  // Decode the journalDataAbi to extract the fields for logging
  // The journalDataAbi from the compression API is already ABI-encoded and ready to use
  // Format: (bytes32, string, string, uint256, bytes32, string)
  // Which is: (notaryKeyFingerprint, method, url, timestamp, queriesHash, balance)
  let decoded;
  try {
    decoded = decodeAbiParameters(
      [
        { type: 'bytes32' }, // notaryKeyFingerprint
        { type: 'string' },   // method
        { type: 'string' },   // url
        { type: 'uint256' },  // timestamp
        { type: 'bytes32' },  // queriesHash
        { type: 'string' }    // balance
      ],
      journalDataAbi as Hex
    );
  } catch (error) {
    console.error('Error decoding journalDataAbi:', error);
    throw new Error('Failed to decode journalDataAbi. Make sure the proof format matches the contract expectations.');
  }

  const [notaryKeyFingerprint, method, url, timestamp, queriesHash, balance] = decoded;

  console.log(`\nDecoded Journal Data:`);
  console.log(`  Notary Key Fingerprint: ${notaryKeyFingerprint}`);
  console.log(`  Method: ${method}`);
  console.log(`  URL: ${url}`);
  console.log(`  Timestamp: ${timestamp} (${new Date(Number(timestamp) * 1000).toISOString()})`);
  console.log(`  Queries Hash: ${queriesHash}`);
  console.log(`  Balance: ${balance}`);

  // Use journalDataAbi directly - it's already in the correct format for the contract
  // No need to re-encode since the compression API returns it in the exact format expected
  const journalData = journalDataAbi as Hex;

  console.log(`\nTransaction Details:`);
  console.log(`  Journal Data Length: ${journalData.length} chars`);
  console.log(`  Seal Length: ${zkProof.length} chars`);

  // Simulate transaction first
  console.log(`\nSimulating transaction...`);
  try {
    await publicClient.simulateContract({
      address: contractAddress,
      abi: contractABI,
      functionName: 'submitBalance',
      args: [journalData, zkProof as Hex],
      account: account.address,
    });
    console.log(`✓ Simulation successful`);
  } catch (error) {
    const err = error as Error;
    const message = err.message;
    // Try to decode custom error
    const revertData = getRevertData(error);
    if (revertData) {
      try {
        const decoded = decodeErrorResult({ abi: contractABI, data: revertData as Hex });
        console.error(`✗ Simulation failed: ${decoded.errorName}`, decoded.args ?? []);
      } catch {
        console.error(`✗ Simulation failed:`, message);
        console.error(`Revert data:`, revertData);
      }
    } else {
      console.error(`✗ Simulation failed:`, message);
    }
    throw error;
  }

  // Submit transaction
  console.log(`\nSubmitting transaction...`);
  let hash: Hex;
  try {
    hash = await walletClient.writeContract({
      address: contractAddress,
      abi: contractABI,
      functionName: 'submitBalance',
      args: [journalData, zkProof as Hex],
    });
  } catch (error) {
    const err = error as Error;
    const message = err.message;
    const revertData = getRevertData(error);
    if (revertData) {
      try {
        const decoded = decodeErrorResult({ abi: contractABI, data: revertData as Hex });
        console.error(`✗ Submission failed: ${decoded.errorName}`, decoded.args ?? []);
      } catch {
        console.error(`✗ Submission failed:`, message);
        console.error(`Revert data:`, revertData);
      }
    } else {
      console.error(`✗ Submission failed:`, message);
    }
    throw error;
  }

  console.log(`\nTransaction submitted: ${hash}`);
  console.log(`Waiting for confirmation...`);

  // Wait for transaction receipt
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  console.log(`\n✓ Transaction confirmed!`);
  console.log(`  Block: ${receipt.blockNumber}`);
  console.log(`  Gas used: ${receipt.gasUsed}`);
  console.log(`  Status: ${receipt.status}`);

  // Verify on-chain
  console.log(`\nVerifying on-chain data...`);
  const storedBalance = await publicClient.readContract({
    address: contractAddress,
    abi: contractABI,
    functionName: 'balance',
  }) as string;

  console.log(`\n✓ Verified on-chain:`);
  console.log(`  Balance: ${storedBalance}`);

  return {
    transactionHash: hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed,
    balance: storedBalance,
  };
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error(`
Usage: tsx scripts/submitProof.ts <network> <proofFile> [contractAddress]

Arguments:
  network         - Target network (sepolia)
  proofFile       - Path to JSON file containing compressed ZK proof data
  contractAddress - (Optional) Override contract address

Example:
  tsx scripts/submitProof.ts sepolia ../proof.json
  tsx scripts/submitProof.ts sepolia ../proof.json 0x1234...
`);
    process.exit(1);
  }

  const [network, proofFile, contractAddress] = args;

  try {
    const result = await submitProof({
      network,
      proofFile,
      contractAddress: contractAddress as Address | undefined,
    });

    console.log(`\n=== Submission Complete ===\n`);
    console.log(`Transaction: ${result.transactionHash}`);
    console.log(`Balance stored: ${result.balance}`);
    console.log(`View on explorer: https://sepolia.etherscan.io/tx/${result.transactionHash}`);

  } catch (error) {
    const err = error as Error;
    console.error(`\n✗ Error:`, err.message);
    process.exit(1);
  }
}

// Run if called directly
main();

