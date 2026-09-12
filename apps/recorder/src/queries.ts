export const PONS_LAUNCH_ACTIVITY = `
  subscription PonsLaunchActivity {
    EVM(network: robinhood) {
      Calls(where: {Call: {
        To: {in: [
          "0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e",
          "0xe33e9e479df8802cb0866d5d05258bec4cf62948"
        ]}
        Input: {startsWith: ["0xf35abbcf", "0xa72101af", "0xf85f8e41"]}
        Success: true
      }}) {
        Block { Time Number }
        Transaction { Hash From }
        Call { To Value Input Output }
      }
      FactoryEvents: Events(where: {
        LogHeader: {Address: {is: "0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e"}}
        Log: {Signature: {Name: {in: ["TokenLaunched", "LaunchSwept", "PoolGraduated"]}}}
      }) {
        Block { Time Number }
        Transaction { Hash From }
        LogHeader { Address }
        Log { Signature { Name } }
        Arguments {
          Name
          Value {
            ... on EVM_ABI_Address_Value_Arg { address }
            ... on EVM_ABI_BigInt_Value_Arg { bigInteger }
            ... on EVM_ABI_Integer_Value_Arg { integer }
          }
        }
      }
    }
  }
`;

export function ponsLaunchHistory(since: string, till: string) {
  return `
    query PonsLaunchHistory {
      EVM(network: robinhood) {
        Calls(
          limit: {count: 10000}
          orderBy: {ascending: Block_Time}
          where: {
            Block: {Time: {since: "${since}", till: "${till}"}}
            Call: {
              To: {in: [
                "0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e",
                "0xe33e9e479df8802cb0866d5d05258bec4cf62948"
              ]}
              Input: {startsWith: ["0xf35abbcf", "0xa72101af", "0xf85f8e41"]}
              Success: true
            }
          }
        ) {
          Block { Time Number }
          Transaction { Hash From }
          Call { To Value Input Output }
        }
      }
    }
  `;
}

// Curve events are deliberately kept on their own subscription. Robinhood can
// produce enough curve traffic to build a processing queue, and launch discovery
// must never wait behind trade writes.
export const PONS_CURVE_ACTIVITY = `
  subscription PonsCurveActivity {
    EVM(network: robinhood) {
      CurveEvents: Events(where: {Log: {Signature: {Name: {in: ["CurveBuy", "CurveSell"]}}}}) {
        Block { Time Number }
        Transaction { Hash From }
        LogHeader { Address }
        Log { Signature { Name } }
        Arguments {
          Name
          Value {
            ... on EVM_ABI_Address_Value_Arg { address }
            ... on EVM_ABI_BigInt_Value_Arg { bigInteger }
          }
        }
      }
    }
  }
`;

const MARKET_TRADE_FIELDS = `
  Block { Time }
  Side
  Price
  PriceInUsd
  Amounts { Base Quote }
  AmountsInUsd { Base Quote }
  Trader { Address }
  TransactionHeader { Hash }
  Pair {
    Pool { Address }
    Token { Address Symbol }
    QuoteToken { Address Symbol }
    Market { Protocol }
  }
`;

export function marketTrades(tokenAddresses: string[]) {
  if (!tokenAddresses.length) throw new Error("Market feed requires at least one watched token");
  const addresses = tokenAddresses.map((address) => JSON.stringify(address.toLowerCase())).join(",");
  const poolTrades = `
      PoolTrades: Trades(where: {
        Pair: {
          Market: {Protocol: {is: "uniswap_v4"} Network: {is: "Robinhood"}}
          Token: {Address: {in: [${addresses}]}}
        }
      }) {
        ${MARKET_TRADE_FIELDS}
      }
  `;

  return `
    subscription PonsMarketTrades {
      Trading {
        CurveTrades: Trades(where: {
          Pair: {
            Market: {Protocol: {is: "pons_v2"} Network: {is: "Robinhood"}}
            Token: {Address: {in: [${addresses}]}}
          }
        }) {
          ${MARKET_TRADE_FIELDS}
        }
        ${poolTrades}
      }
    }
  `;
}

export function marketTradeHistory(tokenAddress: string, since: string, till: string) {
  const token = tokenAddress.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(token)) throw new Error(`Invalid market history token ${tokenAddress}`);
  const start = new Date(since);
  const end = new Date(till);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    throw new Error("Invalid market history window");
  }

  return `
    query PonsMarketHistory {
      Trading {
        Trades(
          limit: {count: 5000}
          orderBy: {ascending: Block_Time}
          where: {
            Pair: {
              Market: {Network: {is: "Robinhood"}}
              Token: {Address: {is: "${token}"}}
            }
            Block: {Time: {since: "${start.toISOString()}", till: "${end.toISOString()}"}}
          }
        ) {
          ${MARKET_TRADE_FIELDS}
        }
      }
    }
  `;
}
