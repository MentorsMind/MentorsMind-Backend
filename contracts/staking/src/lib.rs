#![no_std]

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env, Symbol};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Minimum lock period for staking (7 days)
const MIN_LOCK_DAYS: u32 = 7;

/// Seconds per day
const SECONDS_PER_DAY: u64 = 86_400;

// ---------------------------------------------------------------------------
// Error enum
// ---------------------------------------------------------------------------

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    InsufficientBalance = 4,
    StakeNotFound = 5,
    StakeNotUnlocked = 6,
    InvalidLockPeriod = 7,
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug)]
pub struct StakeInfo {
    pub mentor: Address,
    pub amount: i128,
    pub lock_period_days: u32,
    pub staked_at: u64,
    pub unlock_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    Token,
    Stake(Address),
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[contract]
pub struct StakingContract;

#[contractimpl]
impl StakingContract {
    /// Initialize the staking contract with admin and token addresses.
    pub fn initialize(env: Env, admin: Address, token: Address) {
        if env.storage().persistent().has(&DataKey::Admin) {
            panic!("Already initialized");
        }

        env.storage().persistent().set(&DataKey::Admin, &admin);
        env.storage().persistent().set(&DataKey::Token, &token);
    }

    /// Stake tokens for a mentor with a lock period.
    ///
    /// # Security
    /// - `lock_period_days` must be at least `MIN_LOCK_DAYS` (7 days) to prevent
    ///   immediate unstaking and tier manipulation.
    ///
    /// Panics if:
    /// - Contract is not initialized
    /// - `lock_period_days` < MIN_LOCK_DAYS
    /// - Caller is not the mentor
    /// - Caller fails authorization check
    /// - Insufficient token balance
    pub fn stake(
        env: Env,
        mentor: Address,
        amount: i128,
        lock_period_days: u32,
    ) -> Result<(), Error> {
        // Validate minimum lock period
        if lock_period_days < MIN_LOCK_DAYS {
            return Err(Error::InvalidLockPeriod);
        }

        // Auth: caller must be mentor
        mentor.require_auth();

        // Get token address
        let token: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Token)
            .map_err(|_| Error::NotInitialized)?;

        // Calculate unlock timestamp
        let now = env.ledger().timestamp();
        let lock_seconds = (lock_period_days as u64) * SECONDS_PER_DAY;
        let unlock_at = now.checked_add(lock_seconds).expect("Timestamp overflow");

        // Transfer tokens from mentor to contract
        let token_client = soroban_sdk::token::Client::new(&env, &token);
        token_client.transfer(&mentor, &env.current_contract_address(), &amount);

        // Store stake info
        let stake_info = StakeInfo {
            mentor: mentor.clone(),
            amount,
            lock_period_days,
            staked_at: now,
            unlock_at,
        };
        env.storage().persistent().set(&DataKey::Stake(mentor.clone()), &stake_info);

        // Emit event
        env.events().publish(
            (symbol_short!("stake"), Symbol::new(&env, "staked")),
            (mentor, amount, lock_period_days, unlock_at),
        );

        Ok(())
    }

    /// Unstake tokens for a mentor.
    ///
    /// Panics if:
    /// - Contract is not initialized
    /// - Caller is not the mentor
    /// - Caller fails authorization check
    /// - Stake not found
    /// - Stake not yet unlocked
    pub fn unstake(env: Env, mentor: Address) -> Result<(), Error> {
        // Auth: caller must be mentor
        mentor.require_auth();

        // Get stake info
        let stake_info: StakeInfo = env
            .storage()
            .persistent()
            .get(&DataKey::Stake(mentor.clone()))
            .ok_or(Error::StakeNotFound)?;

        // Check if unlocked
        let now = env.ledger().timestamp();
        if now < stake_info.unlock_at {
            return Err(Error::StakeNotUnlocked);
        }

        // Get token address
        let token: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Token)
            .map_err(|_| Error::NotInitialized)?;

        // Transfer tokens back to mentor
        let token_client = soroban_sdk::token::Client::new(&env, &token);
        token_client.transfer(&env.current_contract_address(), &mentor, &stake_info.amount);

        // Remove stake info
        env.storage().persistent().remove(&DataKey::Stake(mentor));

        // Emit event
        env.events().publish(
            (symbol_short!("stake"), Symbol::new(&env, "unstaked")),
            (mentor, stake_info.amount),
        );

        Ok(())
    }

    /// Get stake info for a mentor.
    pub fn get_stake(env: Env, mentor: Address) -> Result<StakeInfo, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Stake(mentor))
            .ok_or(Error::StakeNotFound)
    }

    /// Check if a stake is unlocked.
    pub fn is_stake_unlocked(env: Env, mentor: Address) -> Result<bool, Error> {
        let stake_info: StakeInfo = env
            .storage()
            .persistent()
            .get(&DataKey::Stake(mentor))
            .ok_or(Error::StakeNotFound)?;

        let now = env.ledger().timestamp();
        Ok(now >= stake_info.unlock_at)
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger};
    use soroban_sdk::token::TokenInterface;

    fn create_mock_token(env: &Env) -> Address {
        let token_contract_id = env.register_contract(None, MockToken);
        let token_client = MockTokenClient::new(env, &token_contract_id);

        let admin = Address::generate(env);
        token_client.initialize(&admin);

        token_contract_id
    }

    fn create_staking_contract(env: &Env, token: Address, admin: Address) -> Address {
        let staking_contract_id = env.register_contract(None, StakingContract);
        let staking_client = StakingContractClient::new(env, &staking_contract_id);

        staking_client.initialize(&admin, &token);

        staking_contract_id
    }

    #[test]
    fn test_stake_success() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let mentor = Address::generate(&env);
        let token = create_mock_token(&env);
        let staking_contract_id = create_staking_contract(&env, token.clone(), admin.clone());
        let staking_client = StakingContractClient::new(&env, &staking_contract_id);
        let token_client = MockTokenClient::new(&env, &token);

        // Mint tokens to mentor
        token_client.mint(&mentor, &1000);

        // Stake with valid lock period (7 days)
        staking_client.stake(&mentor, &1000, &7).unwrap();

        let stake_info = staking_client.get_stake(&mentor).unwrap();
        assert_eq!(stake_info.amount, 1000);
        assert_eq!(stake_info.lock_period_days, 7);
    }

    #[test]
    fn test_stake_invalid_lock_period() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let mentor = Address::generate(&env);
        let token = create_mock_token(&env);
        let staking_contract_id = create_staking_contract(&env, token, admin);
        let staking_client = StakingContractClient::new(&env, &staking_contract_id);

        // Try to stake with lock period less than minimum (6 days)
        let result = staking_client.stake(&mentor, &1000, &6);
        assert_eq!(result, Err(Error::InvalidLockPeriod));
    }

    #[test]
    fn test_stake_zero_lock_period() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let mentor = Address::generate(&env);
        let token = create_mock_token(&env);
        let staking_contract_id = create_staking_contract(&env, token, admin);
        let staking_client = StakingContractClient::new(&env, &staking_contract_id);

        // Try to stake with zero lock period
        let result = staking_client.stake(&mentor, &1000, &0);
        assert_eq!(result, Err(Error::InvalidLockPeriod));
    }

    #[test]
    fn test_unstake_not_unlocked() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let mentor = Address::generate(&env);
        let token = create_mock_token(&env);
        let staking_contract_id = create_staking_contract(&env, token.clone(), admin.clone());
        let staking_client = StakingContractClient::new(&env, &staking_contract_id);
        let token_client = MockTokenClient::new(&env, &token);

        // Mint and stake
        token_client.mint(&mentor, &1000);
        staking_client.stake(&mentor, &1000, &7).unwrap();

        // Try to unstake immediately (should fail)
        let result = staking_client.unstake(&mentor);
        assert_eq!(result, Err(Error::StakeNotUnlocked));
    }

    #[test]
    fn test_unstake_after_unlock() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let mentor = Address::generate(&env);
        let token = create_mock_token(&env);
        let staking_contract_id = create_staking_contract(&env, token.clone(), admin.clone());
        let staking_client = StakingContractClient::new(&env, &staking_contract_id);
        let token_client = MockTokenClient::new(&env, &token);

        // Mint and stake
        token_client.mint(&mentor, &1000);
        staking_client.stake(&mentor, &1000, &7).unwrap();

        // Advance time past unlock period
        let unlock_seconds = 7 * 86_400;
        env.ledger().set_timestamp(unlock_seconds + 1);

        // Unstake should succeed
        staking_client.unstake(&mentor).unwrap();

        // Stake should be removed
        let result = staking_client.get_stake(&mentor);
        assert_eq!(result, Err(Error::StakeNotFound));
    }
}

// Mock token contract for testing
#[contract]
pub struct MockToken;

#[contractimpl]
impl MockToken {
    pub fn initialize(env: Env, admin: Address) {
        env.storage().persistent().set(&symbol_short!("ADMIN"), &admin);
    }

    pub fn mint(env: Env, to: Address, amount: &i128) {
        let admin: Address = env
            .storage()
            .persistent()
            .get(&symbol_short!("ADMIN"))
            .expect("Not initialized");
        admin.require_auth();

        let token_client = soroban_sdk::token::Client::new(&env, &env.current_contract_address());
        token_client.mint(&to, amount);
    }
}
