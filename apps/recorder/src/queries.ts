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
