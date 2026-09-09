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
