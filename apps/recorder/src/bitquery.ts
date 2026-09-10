import { createClient, type Client } from "graphql-ws";
import WebSocket from "ws";
import { config } from "./config.js";

type OAuthResponse = {
  access_token: string;
  expires_in: number;
  token_type: string;
};

export async function getAccessToken(): Promise<OAuthResponse> {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: config.BITQUERY_CLIENT_ID,
    client_secret: config.BITQUERY_CLIENT_SECRET,
    scope: "api",
  });

  const response = await fetch("https://oauth2.bitquery.io/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    throw new Error(`Bitquery OAuth failed with ${response.status}`);
  }

  return (await response.json()) as OAuthResponse;
}

export function createBitqueryClient(token: string, onConnected: () => void): Client {
  return createClient({
    url: `wss://streaming.bitquery.io/graphql?token=${encodeURIComponent(token)}`,
    webSocketImpl: WebSocket,
    keepAlive: 15_000,
    retryAttempts: Number.POSITIVE_INFINITY,
    retryWait: async (retries) => {
      const delay = Math.min(30_000, 1_000 * 2 ** Math.min(retries, 5));
      await new Promise((resolve) => setTimeout(resolve, delay));
    },
    on: { connected: onConnected },
  });
}

export async function queryBitquery<T>(token: string, query: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch("https://streaming.bitquery.io/graphql", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ query }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Bitquery query failed with ${response.status}`);
  }

  const payload = await response.json() as T & { errors?: Array<{ message?: string }> };
  if (payload.errors?.length) {
    throw new Error(`Bitquery query failed: ${payload.errors.map((error) => error.message ?? "Unknown error").join("; ")}`);
  }

  return payload;
}
