# Verification Contract Interface

This document describes the expected interface for the Soroban smart contract used for on-chain mentor verification in MentorMinds.

## Contract Interface

The Soroban contract must implement the following function:

### `verify_credential`

Stores a proof of verification for a mentor on the Stellar network.

**Arguments:**

- `data` (Map): A Soroban map containing the following keys:
  - `mentor_id` (String): The UUID of the mentor being verified.
  - `verified_at` (u64): The Unix timestamp (in seconds) of when the verification was approved.

**Returns:**
- `Void`: The contract does not need to return a value. The transaction hash is used as the proof of verification.

## Integration Details

- The backend invokes this contract during the `VerificationService.approve()` flow.
- If the backend is unable to connect to the Soroban RPC, or if the contract address (`VERIFICATION_CONTRACT_ADDRESS`) is not configured, the verification is marked as `on_chain_pending = true`.
- A background job (`VerificationService.retryPendingOnChainVerifications()`) periodically attempts to re-submit pending verifications.
- The transaction is signed using the `PLATFORM_SECRET_KEY` and requires a minimum fee of `200` stroops.
