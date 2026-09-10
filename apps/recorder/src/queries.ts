export const LAUNCH_ACTIVITY = `
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
      Events(where: {
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

export const CURVE_TRADES = `
  subscription PonsCurveTrades {
    EVM(network: robinhood) {
      Events(where: {Log: {Signature: {Name: {in: ["CurveBuy", "CurveSell"]}}}}) {
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

export const CURVE_MARKET_TRADES = `
  subscription PonsCurveMarketTrades {
    Trading {
      CurveTrades: Trades(where: {
        Pair: {Market: {Protocol: {is: "pons_v2"} Network: {is: "Robinhood"}}}
      }) {
        ${MARKET_TRADE_FIELDS}
      }
    }
  }
`;

export function poolMarketTrades(tokenAddresses: string[]) {
  if (!tokenAddresses.length) throw new Error("Pool market feed requires at least one token address");
  const addresses = tokenAddresses.map((address) => JSON.stringify(address.toLowerCase())).join(",");

  return `
    subscription PonsPoolMarketTrades {
      Trading {
        PoolTrades: Trades(where: {
          Pair: {
            Market: {Protocol: {is: "uniswap_v4"} Network: {is: "Robinhood"}}
            Token: {Address: {in: [${addresses}]}}
          }
        }) {
          ${MARKET_TRADE_FIELDS}
        }
      }
    }
  `;
}
