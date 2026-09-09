import { createHash } from "node:crypto";
import { decodeFunctionData, type Hex } from "viem";

type Argument = {
  Name: string;
  Value: { address?: string; bigInteger?: string; integer?: number };
};

export function argumentMap(args: Argument[] = []) {
  return Object.fromEntries(
    args.map((arg) => [
      arg.Name,
      arg.Value.address ?? arg.Value.bigInteger ?? arg.Value.integer ?? null,
    ]),
  );
}

export function launchAddresses(output: string) {
  const clean = output.replace(/^0x/, "");
  if (clean.length < 128) throw new Error("Launch call output is too short");
  return {
    tokenAddress: `0x${clean.slice(24, 64)}`.toLowerCase(),
    curveAddress: `0x${clean.slice(88, 128)}`.toLowerCase(),
  };
}

const launchParams = [
  { name: "name", type: "string" },
  { name: "symbol", type: "string" },
  { name: "logo", type: "string" },
  { name: "description", type: "string" },
  {
    name: "socials",
    type: "tuple",
    components: [
      { name: "twitter", type: "string" },
      { name: "telegram", type: "string" },
      { name: "discord", type: "string" },
      { name: "website", type: "string" },
      { name: "farcaster", type: "string" },
    ],
  },
  { name: "creatorFeeRecipient", type: "address" },
  { name: "creatorTaxBps", type: "uint16" },
  { name: "buybackEnabled", type: "bool" },
  { name: "expectedEconomics", type: "bytes32" },
  { name: "salt", type: "bytes32" },
] as const;

const launchAbi = [
  {
    type: "function",
    name: "launchToken",
    stateMutability: "payable",
    inputs: [
      { name: "params", type: "tuple", components: launchParams },
      { name: "launchConfigId", type: "uint256" },
      { name: "pairToken", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "launchToken",
    stateMutability: "payable",
    inputs: [
      { name: "params", type: "tuple", components: launchParams },
      { name: "launchConfigId", type: "uint256" },
      { name: "pairToken", type: "address" },
      { name: "snipeTaxExemptions", type: "address[]" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "launchAndBuy",
    stateMutability: "payable",
    inputs: [
      { name: "params", type: "tuple", components: launchParams },
      { name: "launchConfigId", type: "uint256" },
      { name: "pairToken", type: "address" },
      { name: "quoteIn", type: "uint256" },
      { name: "minTokensOut", type: "uint256" },
      { name: "recipient", type: "address" },
      { name: "snipeTaxExemptions", type: "address[]" },
    ],
    outputs: [],
  },
] as const;

type LaunchMetadata = {
  name?: string;
  symbol?: string;
  logo?: string;
  description?: string;
  twitter?: string;
  telegram?: string;
  discord?: string;
  website?: string;
  farcaster?: string;
  creatorFeeRecipient?: string;
  creatorTaxBps?: string;
  buybackEnabled?: boolean;
  pairToken?: string;
  launchConfigId?: string;
  initialQuoteIn?: string;
};

export function decodeLaunchMetadata(input: string): LaunchMetadata {
  try {
    const decoded = decodeFunctionData({ abi: launchAbi, data: input as Hex });
    const values = decoded.args as readonly unknown[];
    const params = values[0] as readonly unknown[] & {
      name?: string;
      symbol?: string;
      logo?: string;
      description?: string;
      socials?: readonly string[];
      creatorFeeRecipient?: string;
      creatorTaxBps?: bigint;
      buybackEnabled?: boolean;
    };
    const socials = (params.socials ?? params[4] ?? {}) as
      | readonly string[]
      | { twitter?: string; telegram?: string; discord?: string; website?: string; farcaster?: string };
    const social = (name: "twitter" | "telegram" | "discord" | "website" | "farcaster", index: number) =>
      Array.isArray(socials) ? socials[index] : (socials as Record<string, string | undefined>)[name];
    return {
      name: params.name ?? (params[0] as string),
      symbol: params.symbol ?? (params[1] as string),
      logo: params.logo ?? (params[2] as string),
      description: params.description ?? (params[3] as string),
      twitter: social("twitter", 0),
      telegram: social("telegram", 1),
      discord: social("discord", 2),
      website: social("website", 3),
      farcaster: social("farcaster", 4),
      creatorFeeRecipient: params.creatorFeeRecipient ?? (params[5] as string),
      creatorTaxBps: String(params.creatorTaxBps ?? params[6]),
      buybackEnabled: params.buybackEnabled ?? (params[7] as boolean),
      launchConfigId: String(values[1]),
      pairToken: String(values[2]).toLowerCase(),
      initialQuoteIn: decoded.functionName === "launchAndBuy" ? String(values[3]) : undefined,
    };
  } catch {
    return {};
  }
}

export function eventId(parts: unknown[]) {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

export function ipfsUrl(uri?: string) {
  if (!uri) return null;
  return uri.startsWith("ipfs://")
    ? `https://ipfs.io/ipfs/${uri.slice("ipfs://".length)}`
    : uri;
}
