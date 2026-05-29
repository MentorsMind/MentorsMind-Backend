import type { Horizon } from '@stellar/stellar-sdk';

export interface StellarAccountInfo {
  id: string;
  sequence: string;
  balances: StellarBalance[];
  subentryCount: number;
  lastModifiedLedger: number;
}

export interface StellarBalance {
  assetType: string;
  assetCode?: string;
  assetIssuer?: string;
  balance: string;
  limit?: string;
}

export interface StellarTransactionResult {
  hash: string;
  ledger: number;
  successful: boolean;
  resultXdr: string;
  envelopeXdr: string;
}

export interface StellarPaymentRecord {
  id: string;
  type: string;
  createdAt: string;
  transactionHash: string;
  ledgerSequence?: number;
  from: string;
  to: string;
  assetType: string;
  assetCode?: string;
  assetIssuer?: string;
  amount: string;
}

export interface StellarTransactionRecord {
  id: string;
  hash: string;
  ledger: number;
  createdAt: string;
  sourceAccount: string;
  operationCount: number;
  successful: boolean;
  memo?: string;
  memoType?: string;
}

export interface StellarOperationRecord {
  id: string;
  type: string;
  createdAt: string;
  transactionHash: string;
  sourceAccount?: string;
  [key: string]: any; // For operation-specific fields
}

export interface TrustlineOperation {
  assetCode: string;
  assetIssuer: string;
  limit?: string;
}

export interface AssetBalance {
  assetType: string;
  assetCode?: string;
  assetIssuer?: string;
  balance: string;
}

export type PaymentHandler = (payment: StellarPaymentRecord) => void;

export type HorizonPaymentRecord = Horizon.ServerApi.PaymentOperationRecord;
export type HorizonTransactionRecord = Horizon.ServerApi.TransactionRecord;
export type HorizonOperationRecord = Horizon.ServerApi.OperationRecord;
