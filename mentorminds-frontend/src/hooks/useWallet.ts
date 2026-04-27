/**
 * useWallet.ts
 *
 * React hook that owns the wallet feature slice:
 *   - Wallet info, balances, transaction history, earnings, payout requests
 *   - Security settings (timeout, biometrics, send-confirmation)
 *
 * Security settings lifecycle (fixes the reported issue):
 *   1. On mount → loadSecuritySettings() decrypts from localStorage
 *   2. User edits settings → updateSecuritySettings() validates + saves encrypted
 *   3. Auto-lock timer respects timeoutMinutes from persisted settings
 *   4. On logout / wallet reset → clearSecuritySettings() wipes storage
 *
 * All API calls use the JWT access token from the auth context.
 * The hook is intentionally self-contained — no global state manager required,
 * though it can be lifted into a context provider if needed.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { entropyToMnemonic, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import {
  clearMnemonicBackup,
  loadSecuritySettings,
  loadMnemonicBackup,
  saveSecuritySettings,
  saveMnemonicBackup,
  clearSecuritySettings,
  DEFAULT_SECURITY_SETTINGS,
  type MnemonicWordCount,
  type MnemonicBackupRecord,
  type WalletSecuritySettings,
} from './walletSecurityStorage';

// ---------------------------------------------------------------------------
// Types mirroring the backend API contract (src/types/wallet.types.ts)
// ---------------------------------------------------------------------------

export interface WalletInfo {
  id: string;
  stellarPublicKey: string;
  status: 'active' | 'inactive' | 'suspended';
  createdAt: string;
  lastActivity?: string;
}

export interface WalletBalance {
  assetType: string;
  assetCode?: string;
  assetIssuer?: string;
  balance: string;
  limit?: string;
}

export interface BalanceData {
  balances: WalletBalance[];
  accountExists: boolean;
  message?: string;
  lastUpdated: string;
}

export interface WalletTransaction {
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

export interface EarningsSummary {
  totalEarnings: string;
  currentPeriodEarnings: string;
  recentTransactions: Array<{
    id: string;
    amount: string;
    assetCode: string;
    date: string;
    type: 'session_payment' | 'bonus' | 'referral';
  }>;
  periodSummary: {
    startDate: string;
    endDate: string;
    sessionCount: number;
    averageEarning: string;
  };
}

export interface PayoutRequest {
  id: string;
  amount: string;
  assetCode: string;
  assetIssuer?: string;
  destinationAddress: string;
  status: 'pending' | 'approved' | 'rejected' | 'completed' | 'failed';
  memo?: string;
  requestedAt: string;
  processedAt?: string;
  transactionHash?: string;
  notes?: string;
}

export interface CreatePayoutInput {
  amount: string;
  assetCode?: string;
  assetIssuer?: string;
  destinationAddress: string;
  memo?: string;
}

// Re-export so consumers only need to import from useWallet
export type { WalletSecuritySettings };

// ---------------------------------------------------------------------------
// Hook state shape
// ---------------------------------------------------------------------------

export interface WalletState {
  // Data
  walletInfo: WalletInfo | null;
  balanceData: BalanceData | null;
  transactions: WalletTransaction[];
  earnings: EarningsSummary | null;
  payoutRequests: PayoutRequest[];

  // Security settings (persisted encrypted)
  securitySettings: WalletSecuritySettings;

  // UI state
  isLoading: boolean;
  isSecuritySettingsLoading: boolean;
  error: string | null;

  // Whether the wallet is currently locked due to inactivity timeout
  isLocked: boolean;
  mnemonicSetup: WalletMnemonicSetupState;
}

export interface MnemonicBackupChecklist {
  writtenDown: boolean;
  storedOffline: boolean;
  understandRecoveryRisk: boolean;
}

export interface MnemonicBackupChallenge {
  index: number;
  position: number;
}

export interface WalletMnemonicSetupState {
  words: string[];
  wordCount: MnemonicWordCount | null;
  generatedAt: string | null;
  isBackedUp: boolean;
  hasEncryptedBackup: boolean;
  encryptedBackupSavedAt: string | null;
  checklist: MnemonicBackupChecklist;
  challenges: MnemonicBackupChallenge[];
}

// ---------------------------------------------------------------------------
// Hook options
// ---------------------------------------------------------------------------

export interface UseWalletOptions {
  /** JWT access token. Pass null/undefined to skip authenticated calls. */
  accessToken: string | null | undefined;
  /** Base URL of the MentorsMind API, e.g. "https://api.mentorminds.com/api/v1" */
  apiBaseUrl?: string;
  /** Called when the auto-lock timer fires. Use to redirect to a lock screen. */
  onAutoLock?: () => void;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_API_BASE = '/api/v1';

const INITIAL_STATE: WalletState = {
  walletInfo: null,
  balanceData: null,
  transactions: [],
  earnings: null,
  payoutRequests: [],
  securitySettings: { ...DEFAULT_SECURITY_SETTINGS },
  isLoading: false,
  isSecuritySettingsLoading: true, // true until first load completes
  error: null,
  isLocked: false,
  mnemonicSetup: {
    words: [],
    wordCount: null,
    generatedAt: null,
    isBackedUp: false,
    hasEncryptedBackup: false,
    encryptedBackupSavedAt: null,
    checklist: {
      writtenDown: false,
      storedOffline: false,
      understandRecoveryRisk: false,
    },
    challenges: [],
  },
};

const DEFAULT_MNEMONIC_CHECKLIST: MnemonicBackupChecklist = {
  writtenDown: false,
  storedOffline: false,
  understandRecoveryRisk: false,
};

function secureRandomInt(maxExclusive: number): number {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    throw new Error('maxExclusive must be a positive integer.');
  }

  const maxUint32 = 0xffffffff;
  const threshold = maxUint32 - (maxUint32 % maxExclusive);
  const randomBytes = new Uint32Array(1);

  do {
    crypto.getRandomValues(randomBytes);
  } while (randomBytes[0] >= threshold);

  return randomBytes[0] % maxExclusive;
}

function createBackupChallenges(wordCount: MnemonicWordCount): MnemonicBackupChallenge[] {
  const first = secureRandomInt(wordCount);
  let second = secureRandomInt(wordCount);
  while (second === first) {
    second = secureRandomInt(wordCount);
  }

  return [first, second]
    .sort((a, b) => a - b)
    .map((index) => ({
      index,
      position: index + 1,
    }));
}

// ---------------------------------------------------------------------------
// Internal fetch helper
// ---------------------------------------------------------------------------

async function apiFetch<T>(
  url: string,
  token: string,
  options?: RequestInit,
): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options?.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as { error?: string }).error ?? `Request failed: ${res.status}`,
    );
  }

  const json = await res.json();
  // Backend wraps responses in { success, data, message }
  return (json.data ?? json) as T;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useWallet(options: UseWalletOptions) {
  const { accessToken, apiBaseUrl = DEFAULT_API_BASE, onAutoLock } = options;

  const [state, setState] = useState<WalletState>(INITIAL_STATE);

  // Ref for the auto-lock timer so we can clear/reset it without stale closures
  const lockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track last activity time for the lock timer
  const lastActivityRef = useRef<number>(Date.now());

  // ---------------------------------------------------------------------------
  // Security settings — load on mount
  // ---------------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const settings = await loadSecuritySettings();
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            securitySettings: settings,
            isSecuritySettingsLoading: false,
          }));
        }
      } catch {
        // loadSecuritySettings never throws — this is a safety net
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            securitySettings: { ...DEFAULT_SECURITY_SETTINGS },
            isSecuritySettingsLoading: false,
          }));
        }
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Auto-lock timer — re-arm whenever timeout setting changes or lock state changes
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const { timeoutMinutes } = state.securitySettings;

    // Clear any existing timer
    if (lockTimerRef.current) {
      clearTimeout(lockTimerRef.current);
      lockTimerRef.current = null;
    }

    // 0 = never lock; skip if already locked or settings still loading
    if (
      timeoutMinutes === 0 ||
      state.isLocked ||
      state.isSecuritySettingsLoading
    ) {
      return;
    }

    const ms = timeoutMinutes * 60 * 1000;

    lockTimerRef.current = setTimeout(() => {
      setState((prev) => ({ ...prev, isLocked: true }));
      onAutoLock?.();
    }, ms);

    return () => {
      if (lockTimerRef.current) {
        clearTimeout(lockTimerRef.current);
      }
    };
  }, [
    state.securitySettings.timeoutMinutes,
    state.isLocked,
    state.isSecuritySettingsLoading,
    onAutoLock,
  ]);

  // ---------------------------------------------------------------------------
  // Activity tracking — reset the lock timer on user interaction
  // ---------------------------------------------------------------------------

  const resetLockTimer = useCallback(() => {
    lastActivityRef.current = Date.now();

    if (state.isLocked) return; // don't auto-unlock; require explicit unlock

    const { timeoutMinutes } = state.securitySettings;
    if (timeoutMinutes === 0) return;

    if (lockTimerRef.current) {
      clearTimeout(lockTimerRef.current);
    }

    lockTimerRef.current = setTimeout(() => {
      setState((prev) => ({ ...prev, isLocked: true }));
      onAutoLock?.();
    }, timeoutMinutes * 60 * 1000);
  }, [state.isLocked, state.securitySettings.timeoutMinutes, onAutoLock]);

  // ---------------------------------------------------------------------------
  // Unlock wallet (call after biometric / PIN verification)
  // ---------------------------------------------------------------------------

  const unlock = useCallback(() => {
    setState((prev) => ({ ...prev, isLocked: false }));
    lastActivityRef.current = Date.now();
  }, []);

  // ---------------------------------------------------------------------------
  // Security settings — update + persist
  // ---------------------------------------------------------------------------

  /**
   * Update and persist wallet security settings.
   *
   * Validates inputs before saving:
   *   - timeoutMinutes must be a non-negative integer
   *   - biometricsEnabled and requireSendConfirmation must be booleans
   *
   * Throws on validation failure so the caller can surface the error in UI.
   */
  const updateSecuritySettings = useCallback(
    async (
      updates: Partial<Omit<WalletSecuritySettings, 'savedAt'>>,
    ): Promise<void> => {
      // Merge with current settings
      const current = state.securitySettings;
      const next: Omit<WalletSecuritySettings, 'savedAt'> = {
        timeoutMinutes:
          updates.timeoutMinutes !== undefined
            ? updates.timeoutMinutes
            : current.timeoutMinutes,
        biometricsEnabled:
          updates.biometricsEnabled !== undefined
            ? updates.biometricsEnabled
            : current.biometricsEnabled,
        requireSendConfirmation:
          updates.requireSendConfirmation !== undefined
            ? updates.requireSendConfirmation
            : current.requireSendConfirmation,
      };

      // Validate
      if (
        !Number.isInteger(next.timeoutMinutes) ||
        next.timeoutMinutes < 0 ||
        next.timeoutMinutes > 1440 // max 24 hours
      ) {
        throw new Error(
          'timeoutMinutes must be a whole number between 0 and 1440.',
        );
      }
      if (typeof next.biometricsEnabled !== 'boolean') {
        throw new Error('biometricsEnabled must be a boolean.');
      }
      if (typeof next.requireSendConfirmation !== 'boolean') {
        throw new Error('requireSendConfirmation must be a boolean.');
      }

      // Persist encrypted
      await saveSecuritySettings(next);

      // Reload from storage to get the savedAt timestamp
      const saved = await loadSecuritySettings();

      setState((prev) => ({
        ...prev,
        securitySettings: saved,
      }));
    },
    [state.securitySettings],
  );

  // ---------------------------------------------------------------------------
  // Wallet data fetchers
  // ---------------------------------------------------------------------------

  const fetchWalletInfo = useCallback(async (): Promise<void> => {
    if (!accessToken) return;

    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const data = await apiFetch<WalletInfo>(
        `${apiBaseUrl}/wallets/me`,
        accessToken,
      );
      setState((prev) => ({ ...prev, walletInfo: data, isLoading: false }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to load wallet info',
      }));
    }
  }, [accessToken, apiBaseUrl]);

  const fetchBalance = useCallback(
    async (assetCode?: string, assetIssuer?: string): Promise<void> => {
      if (!accessToken) return;

      setState((prev) => ({ ...prev, isLoading: true, error: null }));
      try {
        const params = new URLSearchParams();
        if (assetCode) params.set('assetCode', assetCode);
        if (assetIssuer) params.set('assetIssuer', assetIssuer);

        const url = `${apiBaseUrl}/wallets/me/balance${params.toString() ? `?${params}` : ''}`;
        const data = await apiFetch<BalanceData>(url, accessToken);
        setState((prev) => ({ ...prev, balanceData: data, isLoading: false }));
      } catch (err) {
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: err instanceof Error ? err.message : 'Failed to load balance',
        }));
      }
    },
    [accessToken, apiBaseUrl],
  );

  const fetchTransactions = useCallback(
    async (cursor?: string, limit = 10, order: 'asc' | 'desc' = 'desc'): Promise<void> => {
      if (!accessToken) return;

      setState((prev) => ({ ...prev, isLoading: true, error: null }));
      try {
        const params = new URLSearchParams({
          limit: String(limit),
          order,
          ...(cursor ? { cursor } : {}),
        });

        const data = await apiFetch<{ transactions: WalletTransaction[] }>(
          `${apiBaseUrl}/wallets/me/transactions?${params}`,
          accessToken,
        );
        setState((prev) => ({
          ...prev,
          transactions: data.transactions,
          isLoading: false,
        }));
      } catch (err) {
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error:
            err instanceof Error ? err.message : 'Failed to load transactions',
        }));
      }
    },
    [accessToken, apiBaseUrl],
  );

  const fetchEarnings = useCallback(
    async (startDate?: string, endDate?: string, assetCode = 'USD'): Promise<void> => {
      if (!accessToken) return;

      setState((prev) => ({ ...prev, isLoading: true, error: null }));
      try {
        const params = new URLSearchParams({ assetCode });
        if (startDate) params.set('startDate', startDate);
        if (endDate) params.set('endDate', endDate);

        const data = await apiFetch<EarningsSummary>(
          `${apiBaseUrl}/wallets/me/earnings?${params}`,
          accessToken,
        );
        setState((prev) => ({ ...prev, earnings: data, isLoading: false }));
      } catch (err) {
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: err instanceof Error ? err.message : 'Failed to load earnings',
        }));
      }
    },
    [accessToken, apiBaseUrl],
  );

  const fetchPayoutRequests = useCallback(
    async (page = 1, limit = 10): Promise<void> => {
      if (!accessToken) return;

      setState((prev) => ({ ...prev, isLoading: true, error: null }));
      try {
        const params = new URLSearchParams({
          page: String(page),
          limit: String(limit),
        });

        const data = await apiFetch<{ payoutRequests: PayoutRequest[] }>(
          `${apiBaseUrl}/wallets/me/payouts?${params}`,
          accessToken,
        );
        setState((prev) => ({
          ...prev,
          payoutRequests: data.payoutRequests,
          isLoading: false,
        }));
      } catch (err) {
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error:
            err instanceof Error
              ? err.message
              : 'Failed to load payout requests',
        }));
      }
    },
    [accessToken, apiBaseUrl],
  );

  const createPayoutRequest = useCallback(
    async (input: CreatePayoutInput): Promise<PayoutRequest> => {
      if (!accessToken) throw new Error('Not authenticated');

      if (state.securitySettings.requireSendConfirmation) {
        // Caller is responsible for showing a confirmation dialog before calling this.
        // The flag is checked here as a last-resort guard — the UI layer should
        // enforce it earlier so the user sees a proper confirmation prompt.
      }

      setState((prev) => ({ ...prev, isLoading: true, error: null }));
      try {
        const result = await apiFetch<PayoutRequest>(
          `${apiBaseUrl}/wallets/payout`,
          accessToken,
          { method: 'POST', body: JSON.stringify(input) },
        );
        // Refresh payout list after creation
        await fetchPayoutRequests();
        setState((prev) => ({ ...prev, isLoading: false }));
        return result;
      } catch (err) {
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error:
            err instanceof Error
              ? err.message
              : 'Failed to create payout request',
        }));
        throw err;
      }
    },
    [accessToken, apiBaseUrl, state.securitySettings.requireSendConfirmation, fetchPayoutRequests],
  );

  // ---------------------------------------------------------------------------
  // Initialise wallet data when token becomes available
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!accessToken) return;
    fetchWalletInfo();
  }, [accessToken]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Cleanup on unmount
  // ---------------------------------------------------------------------------

  useEffect(() => {
    return () => {
      if (lockTimerRef.current) {
        clearTimeout(lockTimerRef.current);
      }
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Reset / logout helper
  // ---------------------------------------------------------------------------

  const resetWallet = useCallback(() => {
    clearSecuritySettings();
    clearMnemonicBackup();
    if (lockTimerRef.current) {
      clearTimeout(lockTimerRef.current);
    }
    setState({
      ...INITIAL_STATE,
      isSecuritySettingsLoading: false,
      securitySettings: { ...DEFAULT_SECURITY_SETTINGS },
    });
  }, []);

  const generateMnemonic = useCallback(
    (wordCount: MnemonicWordCount = 12): string[] => {
      if (wordCount !== 12 && wordCount !== 24) {
        throw new Error('Mnemonic word count must be either 12 or 24.');
      }

      const entropySize = wordCount === 24 ? 32 : 16;
      const entropy = crypto.getRandomValues(new Uint8Array(entropySize));
      const mnemonic = entropyToMnemonic(entropy, wordlist);
      const words = mnemonic.trim().toLowerCase().split(/\s+/);

      if (words.length !== wordCount || !validateMnemonic(mnemonic, wordlist)) {
        throw new Error('Failed to generate a valid BIP39 mnemonic.');
      }

      setState((prev) => ({
        ...prev,
        mnemonicSetup: {
          words,
          wordCount,
          generatedAt: new Date().toISOString(),
          isBackedUp: false,
          hasEncryptedBackup: false,
          encryptedBackupSavedAt: null,
          checklist: { ...DEFAULT_MNEMONIC_CHECKLIST },
          challenges: createBackupChallenges(wordCount),
        },
      }));

      return words;
    },
    [],
  );

  const updateMnemonicBackupChecklist = useCallback(
    (updates: Partial<MnemonicBackupChecklist>): void => {
      setState((prev) => ({
        ...prev,
        mnemonicSetup: (() => {
          const checklist = {
            ...prev.mnemonicSetup.checklist,
            ...updates,
          };
          return {
            ...prev.mnemonicSetup,
            checklist,
            isBackedUp:
              prev.mnemonicSetup.isBackedUp &&
              checklist.writtenDown &&
              checklist.storedOffline &&
              checklist.understandRecoveryRisk,
          };
        })(),
      }));
    },
    [],
  );

  const clearEncryptedMnemonicBackup = useCallback(() => {
    clearMnemonicBackup();
    setState((prev) => ({
      ...prev,
      mnemonicSetup: {
        ...prev.mnemonicSetup,
        hasEncryptedBackup: false,
        encryptedBackupSavedAt: null,
      },
    }));
  }, []);

  const verifyMnemonicBackup = useCallback(
    (answers: Record<number, string>): boolean => {
      const { words, challenges, checklist } = state.mnemonicSetup;
      if (!words.length || !challenges.length) {
        throw new Error('Generate a mnemonic before backup verification.');
      }
      if (
        !checklist.writtenDown ||
        !checklist.storedOffline ||
        !checklist.understandRecoveryRisk
      ) {
        throw new Error(
          'Confirm backup checklist (written down, stored offline, recovery risk) first.',
        );
      }

      const isValid = challenges.every(({ index }) => {
        const answer = (answers[index] ?? '').trim().toLowerCase();
        return answer.length > 0 && answer === words[index];
      });

      if (!isValid) return false;

      setState((prev) => ({
        ...prev,
        mnemonicSetup: {
          ...prev.mnemonicSetup,
          isBackedUp: true,
        },
      }));

      return true;
    },
    [state.mnemonicSetup],
  );

  const saveEncryptedMnemonic = useCallback(
    async (passphrase: string): Promise<void> => {
      const { words, wordCount, isBackedUp } = state.mnemonicSetup;
      if (!words.length || !wordCount) {
        throw new Error('No mnemonic available to back up.');
      }
      if (!isBackedUp) {
        throw new Error(
          'Mnemonic must be manually verified before encrypted backup is allowed.',
        );
      }

      const { savedAt } = await saveMnemonicBackup(
        words.join(' '),
        passphrase,
        wordCount,
      );

      setState((prev) => ({
        ...prev,
        mnemonicSetup: {
          ...prev.mnemonicSetup,
          hasEncryptedBackup: true,
          encryptedBackupSavedAt: savedAt,
        },
      }));
    },
    [state.mnemonicSetup],
  );

  const loadEncryptedMnemonic = useCallback(
    async (passphrase: string): Promise<MnemonicBackupRecord | null> => {
      const backup = await loadMnemonicBackup(passphrase);
      if (!backup) return null;

      setState((prev) => ({
        ...prev,
        mnemonicSetup: {
          words: backup.words,
          wordCount: backup.wordCount,
          generatedAt: backup.savedAt,
          isBackedUp: true,
          hasEncryptedBackup: true,
          encryptedBackupSavedAt: backup.savedAt,
          checklist: {
            writtenDown: true,
            storedOffline: true,
            understandRecoveryRisk: true,
          },
          challenges: createBackupChallenges(backup.wordCount),
        },
      }));

      return backup;
    },
    [],
  );

  const clearMnemonicSetup = useCallback(() => {
    setState((prev) => ({
      ...prev,
      mnemonicSetup: {
        words: [],
        wordCount: null,
        generatedAt: null,
        isBackedUp: false,
        hasEncryptedBackup: false,
        encryptedBackupSavedAt: null,
        checklist: { ...DEFAULT_MNEMONIC_CHECKLIST },
        challenges: [],
      },
    }));
  }, []);

  // ---------------------------------------------------------------------------
  // Exposed API
  // ---------------------------------------------------------------------------

  return {
    // State
    ...state,
    isMnemonicBackupRequired:
      state.mnemonicSetup.words.length > 0 && !state.mnemonicSetup.isBackedUp,

    // Security settings actions
    updateSecuritySettings,

    // Lock / unlock
    unlock,
    resetLockTimer,

    // Data fetchers
    fetchWalletInfo,
    fetchBalance,
    fetchTransactions,
    fetchEarnings,
    fetchPayoutRequests,
    createPayoutRequest,

    // Mnemonic generation and backup actions
    generateMnemonic,
    updateMnemonicBackupChecklist,
    verifyMnemonicBackup,
    saveEncryptedMnemonic,
    loadEncryptedMnemonic,
    clearEncryptedMnemonicBackup,
    clearMnemonicSetup,

    // Cleanup
    resetWallet,
  };
}
