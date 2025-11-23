import 'dotenv/config';
import * as fs from 'fs';
import { decodeAbiParameters } from 'viem';

interface Presentation {
  success: boolean;
  data: string;
  version?: string;
  meta?: {
    notaryUrl?: string;
  };
}

interface CompressedData {
  success: boolean;
  data: {
    zkProof: string;
    journalDataAbi: `0x${string}`;
  };
}

interface ProofData {
  success: boolean;
  data: {
    zkProof: string;
    journalDataAbi: string;
  };
}

const response = await fetch('https://web-prover.vlayer.xyz/api/v1/prove', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-client-id': process.env.WEB_PROVER_API_CLIENT_ID || '',
    'Authorization': 'Bearer ' + process.env.WEB_PROVER_API_SECRET,
  },
  body: JSON.stringify({
    url: (() => {
      const baseUrl = 'https://api.etherscan.io/v2/api?chainid=1&module=account&action=tokenbalance&contractaddress=0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48&address=0x4B808ec5A5d53871e0b7bf53bC2A4Ee89dd1ddB1';
      const apiKey = process.env.ETHERSCAN_API_KEY;
      return apiKey ? `${baseUrl}&apikey=${apiKey}` : baseUrl;
    })(),
    headers: []
  })
});

const data = await response.json() as Presentation;
console.log('Initial web proof response:', data);

// The entire response from web-prover is the presentation
// It contains: success, data (hex string), version, meta
const presentation = data;

if (!presentation || !presentation.data) {
  throw new Error('No presentation data found in response');
}

// Extract the "result" field from the response (like the original Etherscan contract)
// This will be a string value (the balance)
const extractConfig = {
  "response.body": {
    "jmespath": [
      `result`
    ]
  }
};

const requestBody = {
  presentation,
  extraction: extractConfig
};

console.log('Compressing web proof and extracting result field from Etherscan API');
console.log('Extract config:', JSON.stringify(extractConfig, null, 2));

const zkProverUrl = process.env.ZK_PROVER_API_URL || 'https://zk-prover.vlayer.xyz/api/v0';
const compressResponse = await fetch(`${zkProverUrl}/compress-web-proof`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-client-id': process.env.WEB_PROVER_API_CLIENT_ID || '',
    'Authorization': 'Bearer ' + process.env.WEB_PROVER_API_SECRET,
  },
  body: JSON.stringify(requestBody),
  // Add timeout to prevent hanging requests
  signal: AbortSignal.timeout(85000) // 85 seconds (less than maxDuration)
});

if (!compressResponse.ok) {
  const errorText = await compressResponse.text();
  console.error('ZK Prover API error response:', errorText);
  throw new Error(`HTTP error! status: ${compressResponse.status} - ${errorText}`);
}

const compressedData = await compressResponse.json() as CompressedData;

// Debug logging
console.log('=== ZK PROOF COMPRESSION RESPONSE ===');
console.log('Response status:', compressResponse.status);
console.log('Response data:', JSON.stringify(compressedData, null, 2));
console.log('=== END ZK PROOF RESPONSE ===');

// Decode journalDataAbi to see what balance was extracted
try {
  const journalDataAbi = compressedData.data.journalDataAbi;
  console.log('\n=== DECODING EXTRACTED BALANCE ===');
  
  const decoded = decodeAbiParameters(
    [
      { type: 'bytes32' }, // notaryKeyFingerprint
      { type: 'string' },   // method
      { type: 'string' },   // url
      { type: 'uint256' },  // timestamp
      { type: 'bytes32' },  // queriesHash
      { type: 'string' }    // balance
    ],
    journalDataAbi
  );
  
  const [notaryKeyFingerprint, method, url, timestamp, queriesHash, balance] = decoded;
  
  console.log('Decoded values:');
  console.log('  Notary Key Fingerprint:', notaryKeyFingerprint);
  console.log('  Method:', method);
  console.log('  URL:', url);
  console.log('  Timestamp:', timestamp.toString(), `(${new Date(Number(timestamp) * 1000).toISOString()})`);
  console.log('  Queries Hash:', queriesHash);
  console.log('  Extracted Data (balance field):', balance);
  console.log('  Data length:', balance.length, 'characters');
  console.log('=== END DECODING ===\n');
} catch (error) {
  const err = error as Error;
  console.error('Error decoding journalDataAbi:', err.message);
  console.log('Could not decode balance, but proof was generated successfully.');
}

// Save proof data to file for on-chain submission
const proofData: ProofData = {
  success: compressedData.success,
  data: {
    zkProof: compressedData.data.zkProof,
    journalDataAbi: compressedData.data.journalDataAbi
  }
};

const proofFilePath = './proof.json';
fs.writeFileSync(proofFilePath, JSON.stringify(proofData, null, 2));
console.log(`\n✓ Proof data saved to: ${proofFilePath}`);
console.log(`  You can now submit it on-chain using:`);
console.log(`  cd contracts && npm run submit sepolia ../proof.json`);

