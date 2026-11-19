import * as StellarSdk from '@stellar/stellar-sdk';
import { logger } from '../utils/logger.utils';

export class ReputationService {
  private static getRpcServer() {
    const sdkAny = StellarSdk as any;
    const serverUrl =
      process.env.SOROBAN_RPC_URL ||
      process.env.STELLAR_RPC_URL ||
      'https://soroban-testnet.stellar.org';

    const RpcServerCtor = sdkAny.SorobanRpc?.Server || sdkAny.rpc?.Server;
    return RpcServerCtor ? new RpcServerCtor(serverUrl) : null;
  }

  private static getContractAddress(): string {
    const addr = process.env.SOROBAN_REPUTATION_CONTRACT_ADDRESS;
    if (!addr) {
      throw new Error('SOROBAN_REPUTATION_CONTRACT_ADDRESS is not set');
    }
    return addr;
  }

  static async getOnChainLoyaltyPoints(stellarPublicKey: string): Promise<number> {
    const rpcServer = this.getRpcServer();
    if (!rpcServer) {
      throw new Error('Soroban RPC client not available');
    }

    const sdkAny = StellarSdk as any;
    const sourcePublicKey = process.env.PLATFORM_PUBLIC_KEY || StellarSdk.Keypair.random().publicKey();
    
    const account = await rpcServer.getAccount(sourcePublicKey);
    const contract = new sdkAny.Contract(this.getContractAddress());

    const arg = sdkAny.nativeToScVal(stellarPublicKey, { type: 'address' });

    const networkPassphrase = process.env.STELLAR_NETWORK === 'mainnet'
        ? sdkAny.Networks.PUBLIC
        : sdkAny.Networks.TESTNET;

    const tx = new sdkAny.TransactionBuilder(account, {
      fee: String(sdkAny.BASE_FEE || '100'),
      networkPassphrase,
    })
      .addOperation(contract.call('get_loyalty_points', arg))
      .setTimeout(30)
      .build();

    const simulation = await rpcServer.simulateTransaction(tx);
    if (simulation?.error) {
      throw new Error(String(simulation.error));
    }

    const SorobanRpc = sdkAny.SorobanRpc || sdkAny.rpc;
    const returnValue = simulation?.result?.retval;

    if (returnValue && sdkAny.scValToNative) {
      return Number(sdkAny.scValToNative(returnValue));
    }
    if (SorobanRpc?.scValToNative && returnValue) {
      return Number(SorobanRpc.scValToNative(returnValue));
    }

    return 0;
  }
}
