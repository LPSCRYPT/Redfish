import { createWalletClient, createPublicClient, http, type WalletClient, type PublicClient, type Address } from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import * as dotenv from 'dotenv';
import { getNetworkConfig, type NetworkConfig } from './config.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type Hex = `0x${string}`;

interface ContractArtifact {
  abi: any[];
  bytecode: string;
}

interface DeploymentInfo {
  network: string;
  chainId: number;
  contractAddress: Address;
  deployer: Address;
  transactionHash: Hex;
  blockNumber: number;
  gasUsed: string;
  timestamp: number;
  parameters: {
    verifierAddress: Address;
    imageId: Hex;
    notaryKeyFingerprint: Hex;
    queriesHash: Hex;
    expectedUrl: string;
  };
}

export interface DeployOptions {
  network: string;
  verify?: boolean;
  verifierAddress?: Address;
}

export interface DeployResult {
  address: Address;
  transactionHash: Hex;
  deploymentInfo: DeploymentInfo;
}

dotenv.config();

// Contract bytecode and ABI (will be loaded from forge artifacts)
function loadContractArtifact(): ContractArtifact {
  const artifactPath = path.join(__dirname, '../out/EtherscanVerifier.sol/EtherscanVerifier.json');

  if (!fs.existsSync(artifactPath)) {
    throw new Error('Contract not compiled. Run: forge build');
  }

  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf-8'));
  return {
    abi: artifact.abi,
    bytecode: artifact.bytecode.object,
  };
}

// Load RiscZeroMockVerifier artifact (from risc0-ethereum library)
// This gets compiled when test files import it
function loadMockVerifierArtifact(): ContractArtifact {
  const artifactPath = path.join(
    __dirname,
    '../out/RiscZeroMockVerifier.sol/RiscZeroMockVerifier.json'
  );

  if (!fs.existsSync(artifactPath)) {
    throw new Error('Mock verifier not compiled. Run: forge build (make sure test files import RiscZeroMockVerifier)');
  }

  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf-8'));
  return {
    abi: artifact.abi,
    bytecode: artifact.bytecode.object,
  };
}

async function deployMockVerifier(
  walletClient: WalletClient,
  publicClient: PublicClient,
  account: PrivateKeyAccount
): Promise<Address> {
  const { abi, bytecode } = loadMockVerifierArtifact();
  const hash = await walletClient.deployContract({
    abi,
    bytecode: bytecode as Hex,
    account,
    chain: walletClient.chain,
    args: ['0xFFFFFFFF' as Hex],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (!receipt.contractAddress) {
    throw new Error('Mock verifier deployment failed - no contract address in receipt');
  }
  return receipt.contractAddress;
}

export async function deploy(options: DeployOptions): Promise<DeployResult> {
  const { network, verify = false, verifierAddress: providedVerifier } = options;

  console.log(`\n=== Deploying to ${network} ===\n`);

  // Get network configuration
  const networkConfig = getNetworkConfig(network);

  // Use SEPOLIA_RPC_URL from .env if deploying to sepolia
  let rpcUrl = networkConfig.rpcUrl;
  if (network === 'sepolia') {
    const sepoliaRpcUrl = process.env.SEPOLIA_RPC_URL;
    if (sepoliaRpcUrl) {
      rpcUrl = sepoliaRpcUrl;
      console.log(`Using SEPOLIA_RPC_URL from .env`);
    } else {
      console.log(`SEPOLIA_RPC_URL not set in .env, using default: ${rpcUrl}`);
    }
  }

  console.log(`Network: ${network}`);
  console.log(`Chain ID: ${networkConfig.chain.id}`);
  console.log(`RPC URL: ${rpcUrl}`);

  // Setup wallet
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('PRIVATE_KEY not set in environment variables');
  }

  const account = privateKeyToAccount(privateKey as Hex);

  console.log(`\nDeployer address: ${account.address}`);

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

  // Check balance
  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`Balance: ${balance} wei (${Number(balance) / 1e18} ETH)`);

  if (balance === BigInt(0)) {
    throw new Error('Deployer has no funds');
  }

  // Get or deploy verifier
  let verifierAddress = providedVerifier;
  if (!verifierAddress) {
    console.log(`\nNo verifier address provided. Deploying RiscZeroMockVerifier...`);
    verifierAddress = await deployMockVerifier(walletClient, publicClient, account);
    console.log(`RiscZeroMockVerifier deployed at: ${verifierAddress}`);
    console.log(`⚠️  WARNING: This is a MOCK verifier for testing only. Do NOT use in production!`);
  }

  const imageId = process.env.ZK_PROVER_GUEST_ID as Hex | undefined;
  const notaryKeyFingerprint = process.env.NOTARY_KEY_FINGERPRINT as Hex | undefined;
  const queriesHash = process.env.QUERIES_HASH as Hex | undefined;
  const expectedUrl = process.env.EXPECTED_URL || 'https://data-api.binance.vision/api/v3/exchangeInfo?symbol=ETHUSDC';

  if (!imageId || imageId === '0x0000000000000000000000000000000000000000000000000000000000000000') {
    throw new Error('ZK_PROVER_GUEST_ID not set');
  }

  if (!notaryKeyFingerprint || notaryKeyFingerprint === '0x0000000000000000000000000000000000000000000000000000000000000000') {
    throw new Error('NOTARY_KEY_FINGERPRINT not set');
  }

  if (!queriesHash || queriesHash === '0x0000000000000000000000000000000000000000000000000000000000000000') {
    throw new Error('QUERIES_HASH not set');
  }

  console.log(`\nDeployment Parameters:`);
  console.log(`  Verifier: ${verifierAddress}`);
  console.log(`  Image ID: ${imageId}`);
  console.log(`  Notary Key Fingerprint: ${notaryKeyFingerprint}`);
  console.log(`  Queries Hash: ${queriesHash}`);
  console.log(`  Expected URL: ${expectedUrl}`);

  // Load contract artifact
  const { abi, bytecode } = loadContractArtifact();
  console.log(`\nContract bytecode loaded (${bytecode.length} bytes)`);

  // Deploy contract
  console.log(`\nDeploying contract...`);

  const hash = await walletClient.deployContract({
    abi,
    bytecode: bytecode as Hex,
    account,
    chain: walletClient.chain,
    args: [verifierAddress, imageId, notaryKeyFingerprint, queriesHash, expectedUrl],
  });

  console.log(`\nTransaction hash: ${hash}`);
  console.log(`Waiting for confirmation...`);

  // Wait for transaction receipt
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  if (!receipt.contractAddress) {
    throw new Error('Contract deployment failed - no contract address in receipt');
  }

  console.log(`\n✓ Contract deployed successfully!`);
  console.log(`  Address: ${receipt.contractAddress}`);
  console.log(`  Block: ${receipt.blockNumber}`);
  console.log(`  Gas used: ${receipt.gasUsed}`);

  // Create deployments directory if it doesn't exist
  const deploymentsDir = path.join(__dirname, '../deployments');
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  // Save deployment info
  const deploymentInfo: DeploymentInfo = {
    network,
    chainId: networkConfig.chain.id,
    contractAddress: receipt.contractAddress,
    deployer: account.address,
    transactionHash: hash,
    blockNumber: Number(receipt.blockNumber),
    gasUsed: receipt.gasUsed.toString(),
    timestamp: Date.now(),
    parameters: {
      verifierAddress,
      imageId,
      notaryKeyFingerprint,
      queriesHash,
      expectedUrl,
    },
  };

  const deploymentPath = path.join(deploymentsDir, `${network}.json`);
  fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));
  console.log(`\nDeployment info saved to: ${deploymentPath}`);

  // Verify contract if requested
  if (verify) {
    console.log(`\n=== Contract Verification ===`);
    console.log(`To verify on block explorer, run:`);
    console.log(`forge verify-contract ${receipt.contractAddress} EtherscanVerifier --chain ${network} --watch`);
  }

  return {
    address: receipt.contractAddress,
    transactionHash: hash,
    deploymentInfo,
  };
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.error(`
Usage: tsx scripts/deploy.ts <network> [verifierAddress] [--verify]

Networks:
  sepolia

Options:
  --verify    Request contract verification after deployment

Examples:
  tsx scripts/deploy.ts sepolia                      # deploys mock verifier first
  tsx scripts/deploy.ts sepolia 0x... --verify       # uses provided verifier
`);
    process.exit(1);
  }

  const network = args[0];
  const shouldVerify = args.includes('--verify');
  const potentialAddressArg = args.find((a) => a.startsWith('0x') && a.length === 42) as Address | undefined;

  try {
    const result = await deploy({
      network,
      verify: shouldVerify,
      verifierAddress: potentialAddressArg,
    });

    console.log(`\n=== Deployment Complete ===`);
    console.log(`Contract Address: ${result.address}`);
    console.log(`Transaction: ${result.transactionHash}`);
    console.log(`\nNext steps:`);
    console.log(`2. Test the contract with your proof data`);

  } catch (error) {
    const err = error as Error;
    console.error(`\n✗ Deployment failed:`, err.message);
    process.exit(1);
  }
}

// Run if called directly
main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});

