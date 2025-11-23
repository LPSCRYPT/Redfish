import { sepolia, type Chain } from 'viem/chains';

export interface NetworkConfig {
  chain: Chain;
  rpcUrl: string;
}

export function getNetworkConfig(network: string): NetworkConfig {
  const networkLower = network.toLowerCase();
  
  if (networkLower === 'sepolia') {
    return {
      chain: sepolia,
      rpcUrl: process.env.SEPOLIA_RPC_URL || 'https://rpc.sepolia.org',
    };
  }
  
  throw new Error(`Unsupported network: ${network}`);
}

