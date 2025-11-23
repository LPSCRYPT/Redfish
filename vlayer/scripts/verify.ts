import { exec } from 'child_process';
import { promisify } from 'util';
import * as dotenv from 'dotenv';
import { getNetworkConfig } from './config.js';

dotenv.config();

const execAsync = promisify(exec);

export interface VerifyOptions {
  network: string;
  contractAddress: string;
  constructorArgs?: string[];
}

export async function verify(options: VerifyOptions): Promise<{ success: boolean }> {
  const { network, contractAddress, constructorArgs = [] } = options;

  console.log(`\n=== Verifying Contract on ${network} ===\n`);

  // Get network configuration to validate
  const networkConfig = getNetworkConfig(network);

  console.log(`Network: ${network}`);
  console.log(`Chain ID: ${networkConfig.chain.id}`);
  console.log(`Contract: ${contractAddress}`);

  // Build forge verify command
  const args = [
    'forge',
    'verify-contract',
    contractAddress,
    'src/EtherscanVerifier.sol:EtherscanVerifier',
    '--chain',
    network,
    '--watch',
  ];

  // Add constructor args if provided
  if (constructorArgs.length > 0) {
    args.push('--constructor-args');
    args.push(...constructorArgs);
  }

  const command = args.join(' ');

  console.log(`\nRunning verification command:`);
  console.log(`${command}\n`);

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: process.cwd(),
      env: { ...process.env },
    });

    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);

    console.log(`\n✓ Contract verified successfully!`);

    return { success: true };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string };
    console.error(`\n✗ Verification failed:`);
    if (err.stdout) console.log(err.stdout);
    if (err.stderr) console.error(err.stderr);
    throw error;
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error(`
Usage: npm run verify <network> <contractAddress> [constructorArgs...]

Arguments:
  network         - Target network (sepolia)
  contractAddress - Deployed contract address
  constructorArgs - (Optional) Constructor arguments if needed

Examples:
  npm run verify sepolia 0x1234...
  npm run verify sepolia 0x1234... 0xverifier... 0ximageId... 0xnotary... 0xhash... "url"
`);
    process.exit(1);
  }

  const [network, contractAddress, ...constructorArgs] = args;

  try {
    await verify({
      network,
      contractAddress,
      constructorArgs,
    });

    console.log(`\n=== Verification Complete ===`);
  } catch (error) {
    const err = error as Error;
    console.error(`\nVerification error:`, err.message);
    process.exit(1);
  }
}

// Run if called directly
main();

