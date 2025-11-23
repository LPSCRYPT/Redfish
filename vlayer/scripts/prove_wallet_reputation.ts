import "dotenv/config";
import * as fs from "fs";
import { decodeAbiParameters } from "viem";

/**
 * Redfish - Wallet Reputation Proof Generator
 * 
 * This script generates ZK proofs of wallet reputation data from Etherscan API.
 * The proven data serves as inputs to the Redfish ZKML fraud detection model.
 */

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
    journalDataAbi: \`0x\${string}\`;
  };
}

interface ProofData {
  success: boolean;
  data: {
    zkProof: string;
    journalDataAbi: string;
  };
}

const walletAddress = process.argv[2] || process.env.TARGET_WALLET_ADDRESS;

if (!walletAddress) {
  console.error("Error: No wallet address provided");
  console.log("Usage: npm run prove <wallet_address>");
  process.exit(1);
}

console.log(\`\\n=== Generating Wallet Reputation Proof ===\`);
console.log(\`Target Wallet: \${walletAddress}\`);

const etherscanApiUrl = (() => {
  const baseUrl = \`https://api.etherscan.io/v2/api?chainid=1&module=account&action=balance&address=\${walletAddress}&tag=latest\`;
  const apiKey = process.env.ETHERSCAN_API_KEY;
  return apiKey ? \`\${baseUrl}&apikey=\${apiKey}\` : baseUrl;
})();

const response = await fetch("https://web-prover.vlayer.xyz/api/v1/prove", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-client-id": process.env.WEB_PROVER_API_CLIENT_ID || "",
    "Authorization": "Bearer " + process.env.WEB_PROVER_API_SECRET,
  },
  body: JSON.stringify({
    url: etherscanApiUrl,
    headers: []
  })
});

const data = await response.json() as Presentation;
const presentation = data;

if (!presentation || !presentation.data) {
  throw new Error("No presentation data found in response");
}

const extractConfig = {
  "response.body": {
    "jmespath": ["result"]
  }
};

const requestBody = {
  presentation,
  extraction: extractConfig
};

const zkProverUrl = process.env.ZK_PROVER_API_URL || "https://zk-prover.vlayer.xyz/api/v0";
const compressResponse = await fetch(\`\${zkProverUrl}/compress-web-proof\`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-client-id": process.env.WEB_PROVER_API_CLIENT_ID || "",
    "Authorization": "Bearer " + process.env.WEB_PROVER_API_SECRET,
  },
  body: JSON.stringify(requestBody),
  signal: AbortSignal.timeout(120000)
});

if (!compressResponse.ok) {
  const errorText = await compressResponse.text();
  throw new Error(\`HTTP error! status: \${compressResponse.status}\`);
}

const compressedData = await compressResponse.json() as CompressedData;

fs.mkdirSync("./vlayer/proofs", { recursive: true });
fs.writeFileSync("./vlayer/proofs/wallet_reputation_proof.json", JSON.stringify(compressedData, null, 2));

console.log("Proof generated and saved to vlayer/proofs/wallet_reputation_proof.json");
