#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, token,
    Address, Env, String, Vec,
};

const MAX_BASIS_POINTS: u32 = 10_000;
const MAX_EXPIRY_SECONDS: u64 = 30 * 24 * 60 * 60;

// ─── Constants ───────────────────────────────────────────────────────────────

// Ledgers to extend TTL by (~60 days)
const ESCROW_BUMP_LEDGERS: u32 = 518_400;

// Min TTL threshold in ledgers (~24h) - only bump if remaining TTL is below this
const ESCROW_MIN_TTL: u32 = 17_280;

// Minimum lock amount in stroops (1 stroop = 0.0000001 USDC)
const MIN_LOCK_AMOUNT: i128 = 10_000; // 0.001 USDC

const MAX_BASIS_POINTS: u32 = 10_000;
const MAX_EXPIRY_SECONDS: u64 = 30 * 24 * 60 * 60;

// Safety cap on the platform fee: 2_000 bps = 20%. Applies to both the
// default fee and per-dataset overrides. Existing escrows are unaffected
// because each EscrowRecord snapshots its fee at lock time.
// Safety cap on the platform fee: 2_000 bps = 20%.
const MAX_FEE_BPS: u32 = 2_000;

// Circuit-breaker defaults (overridable by admin)
const DEFAULT_MAX_ESCROW_AMOUNT: i128 = 1_000_000_000_000;
const DEFAULT_MAX_ESCROWS_PER_LEDGER: u32 = 100;

// ─── Storage keys ────────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    Admin,
    Treasury,
    DefaultPlatformFee,
    EscrowCount,
    Paused,
    WhitelistEnforced,
    // Circuit-breaker config
    MaxEscrowAmount,
    MaxEscrowsPerLedger,
    EscrowsThisLedger,
    LastEscrowLedger,
    DatasetFee(String),
    Whitelisted(Address),
    Blacklisted(Address),
}

#[contracttype]
pub enum EscrowKey {
    Record(u64),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotAdmin = 2,
    EscrowNotFound = 3,
    AlreadyReleased = 4,
    AlreadyRefunded = 5,
    NotBuyer = 6,
    NotExpired = 7,
    InvalidInput = 8,
    BuyerNotConfirmed = 9,
    AlreadyConfirmed = 10,
    NotSeller = 11,
    Expired = 12,
    NotPaused = 13,
}

#[derive(Copy, Clone, Eq, PartialEq)]
#[repr(u32)]
pub enum HazinaEscrowError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    NotAdmin = 3,
    InvalidFeeBps = 4,
    InvalidAmount = 5,
    AlreadyReleased = 6,
    AlreadyRefunded = 7,
    EscrowNotFound = 8,
    AddressBlacklisted = 9,
    AddressNotWhitelisted = 10,
    EmptyDatasetId = 11,
    Paused = 12,
    AmountExceedsCircuitBreaker = 13,
    RateLimitExceeded = 14,
    Paused = 14,
    InvalidFeeBps = 15,
    InvalidAmount = 16,
    NotInitialized = 17,
    AddressBlacklisted = 18,
    AddressNotWhitelisted = 19,
    EmptyDatasetId = 20,
    AmountExceedsCircuitBreaker = 21,
    RateLimitExceeded = 22,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EscrowRecord {
    pub escrow_id: u64,
    pub dataset_id: String,
    pub buyer: Address,
    pub seller: Address,
    pub amount: i128,
    pub token: Address,
    pub deadline: u64,
    pub buyer_confirmed: bool,
    pub platform_fee_bps: u32,
    pub released: bool,
    pub refunded: bool,
}

#[contracttype]
#[derive(Clone, Eq, PartialEq)]
pub struct DatasetFeeConfig {
    pub default_fee_bps: u32,
    pub has_custom_fee: bool,
    pub dataset_fee_bps: u32,
    pub effective_fee_bps: u32,
}

#[contracttype]
#[derive(Clone, Eq, PartialEq)]
pub struct AddressPolicy {
    pub whitelisted: bool,
    pub blacklisted: bool,
    pub whitelist_enforced: bool,
    pub can_transact: bool,
}

#[contracttype]
#[derive(Clone, Eq, PartialEq)]
pub struct SellerShare {
    pub seller: Address,
    pub amount: i128,
}

#[contract]
pub struct HazinaEscrow;

#[contractimpl]
impl HazinaEscrow {
    pub fn initialize(env: Env, admin: Address, treasury: Address, platform_fee_bps: u32) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        Self::assert_valid_fee(&env, platform_fee_bps);

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Treasury, &treasury);
        env.storage()
            .instance()
            .set(&DataKey::DefaultPlatformFee, &platform_fee_bps);
        env.storage().instance().set(&DataKey::EscrowCount, &0u64);
        env.storage().instance().set(&DataKey::Paused, &false);
        Ok(())
    }

    // ─── Pause / unpause ─────────────────────────────────────────────────────

    pub fn pause(env: Env, admin: Address) {
        admin.require_auth();
        Self::assert_admin(&env, &admin);
        env.storage().instance().set(&DataKey::Paused, &true);
        env.events()
            .publish((soroban_sdk::symbol_short!("paused"),), admin);
    }

    pub fn unpause(env: Env, admin: Address) {
        admin.require_auth();
        Self::assert_admin(&env, &admin);
        env.storage().instance().set(&DataKey::Paused, &false);
        env.events()
            .publish((soroban_sdk::symbol_short!("unpaused"),), admin);
    }

    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
    }

    // ─── Fee management ──────────────────────────────────────────────────────

    pub fn set_default_fee(env: Env, admin: Address, fee_bps: u32) {
        admin.require_auth();
        Self::assert_admin(&env, &admin);
        Self::assert_valid_fee(&env, fee_bps);
        env.storage()
            .instance()
            .set(&DataKey::DefaultPlatformFee, &fee_bps);
        env.events()
            .publish((soroban_sdk::symbol_short!("fee_upd"),), (admin, fee_bps));
    }

    pub fn set_fee(env: Env, admin: Address, fee_bps: u32) {
        Self::set_default_fee(env, admin, fee_bps);
    }

    pub fn update_fee(env: Env, admin: Address, new_fee_bps: u32) {
        admin.require_auth();
        Self::assert_admin(&env, &admin);
        Self::assert_valid_fee(&env, new_fee_bps);

        env.storage()
            .instance()
            .set(&DataKey::DefaultPlatformFee, &new_fee_bps);

        env.events()
            .publish((soroban_sdk::symbol_short!("fee_upd"),), (admin, new_fee_bps));
    }

    pub fn get_fee(env: Env) -> u32 {
        Self::get_default_fee(env)
    }

    pub fn get_default_fee(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::DefaultPlatformFee)
            .unwrap_or(500)
    }

    pub fn set_dataset_fee(env: Env, admin: Address, dataset_id: String, fee_bps: u32) {
        admin.require_auth();
        Self::assert_admin(&env, &admin);
        Self::assert_valid_dataset_id(&env, &dataset_id);
        Self::assert_valid_fee(&env, fee_bps);
        env.storage()
            .persistent()
            .set(&DataKey::DatasetFee(dataset_id.clone()), &fee_bps);
        env.events().publish(
            (soroban_sdk::symbol_short!("dsf_upd"),),
            (dataset_id, fee_bps),
        );
    }

    pub fn clear_dataset_fee(env: Env, admin: Address, dataset_id: String) {
        admin.require_auth();
        Self::assert_admin(&env, &admin);
        Self::assert_valid_dataset_id(&env, &dataset_id);
        env.storage()
            .persistent()
            .remove(&DataKey::DatasetFee(dataset_id.clone()));
        env.events()
            .publish((soroban_sdk::symbol_short!("dsf_clr"),), dataset_id);
    }

    pub fn get_dataset_fee_config(env: Env, dataset_id: String) -> DatasetFeeConfig {
        Self::assert_valid_dataset_id(&env, &dataset_id);
        let default_fee_bps = Self::get_default_fee(env.clone());
        let dataset_fee_opt: Option<u32> = env
            .storage()
            .persistent()
            .get(&DataKey::DatasetFee(dataset_id));
        let effective_fee_bps = dataset_fee_opt.unwrap_or(default_fee_bps);
        DatasetFeeConfig {
            default_fee_bps,
            has_custom_fee: dataset_fee_opt.is_some(),
            dataset_fee_bps: dataset_fee_opt.unwrap_or(default_fee_bps),
            effective_fee_bps,
        }
    }

    // ─── Admin management ────────────────────────────────────────────────────

    pub fn transfer_admin(env: Env, admin: Address, new_admin: Address) {
        admin.require_auth();
        Self::assert_admin(&env, &admin);
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        env.events()
            .publish((soroban_sdk::symbol_short!("admin"),), (new_admin,));
    }

    pub fn upgrade(env: Env, admin: Address, new_wasm_hash: soroban_sdk::BytesN<32>) {
        admin.require_auth();
        Self::assert_admin(&env, &admin);
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }

    // ─── Address policy ──────────────────────────────────────────────────────

    pub fn set_whitelist_enforced(env: Env, admin: Address, enforced: bool) {
        admin.require_auth();
        Self::assert_admin(&env, &admin);
        env.storage()
            .instance()
            .set(&DataKey::WhitelistEnforced, &enforced);
        env.events()
            .publish((soroban_sdk::symbol_short!("wl_mode"),), (admin, enforced));
    }

    pub fn set_address_whitelisted(env: Env, admin: Address, address: Address, whitelisted: bool) {
        admin.require_auth();
        Self::assert_admin(&env, &admin);
        env.storage()
            .persistent()
            .set(&DataKey::Whitelisted(address.clone()), &whitelisted);
        env.events().publish(
            (soroban_sdk::symbol_short!("addr_wl"),),
            (address, whitelisted),
        );
    }

    pub fn set_address_blacklisted(env: Env, admin: Address, address: Address, blacklisted: bool) {
        admin.require_auth();
        Self::assert_admin(&env, &admin);
        env.storage()
            .persistent()
            .set(&DataKey::Blacklisted(address.clone()), &blacklisted);
        env.events().publish(
            (soroban_sdk::symbol_short!("addr_bl"),),
            (address, blacklisted),
        );
    }

    pub fn get_address_policy(env: Env, address: Address) -> AddressPolicy {
        let whitelist_enforced = env
            .storage()
            .instance()
            .get(&DataKey::WhitelistEnforced)
            .unwrap_or(false);
        let whitelisted = env
            .storage()
            .persistent()
            .get(&DataKey::Whitelisted(address.clone()))
            .unwrap_or(false);
        let blacklisted = env
            .storage()
            .persistent()
            .get(&DataKey::Blacklisted(address))
            .unwrap_or(false);
        AddressPolicy {
            whitelisted,
            blacklisted,
            whitelist_enforced,
            can_transact: !blacklisted && (!whitelist_enforced || whitelisted),
        }
    }

    // ─── Circuit-breaker config ───────────────────────────────────────────────

    pub fn set_max_escrow_amount(env: Env, admin: Address, max_amount: i128) {
        admin.require_auth();
        Self::assert_admin(&env, &admin);
        if max_amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        env.storage()
            .instance()
            .set(&DataKey::MaxEscrowAmount, &max_amount);
        env.events().publish(
            (soroban_sdk::symbol_short!("cb_amt"),),
            (admin, max_amount),
        );
    }

    pub fn set_max_escrows_per_ledger(env: Env, admin: Address, max_per_ledger: u32) {
        admin.require_auth();
        Self::assert_admin(&env, &admin);
        if max_per_ledger == 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        env.storage()
            .instance()
            .set(&DataKey::MaxEscrowsPerLedger, &max_per_ledger);
        env.events().publish(
            (soroban_sdk::symbol_short!("cb_rate"),),
            (admin, max_per_ledger),
        );
    }

    pub fn get_max_escrow_amount(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::MaxEscrowAmount)
            .unwrap_or(DEFAULT_MAX_ESCROW_AMOUNT)
    }

    pub fn get_max_escrows_per_ledger(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::MaxEscrowsPerLedger)
            .unwrap_or(DEFAULT_MAX_ESCROWS_PER_LEDGER)
    }

    // ─── Escrow lifecycle ────────────────────────────────────────────────────

    pub fn lock(
        env: Env,
        buyer: Address,
        seller: Address,
        token: Address,
        amount: i128,
        dataset_id: String,
        expiry_seconds: u64,
    ) -> u64 {
        buyer.require_auth();
        if amount <= 0 || expiry_seconds == 0 || expiry_seconds > MAX_EXPIRY_SECONDS {
            panic_with_error!(&env, Error::InvalidInput);
        }

        let now = env.ledger().timestamp();
        let deadline = now.saturating_add(expiry_seconds);
        if deadline <= now {
            panic_with_error!(&env, Error::InvalidInput);
        }

        Self::assert_not_paused(&env);
        Self::assert_valid_dataset_id(&env, &dataset_id);
        Self::assert_valid_token(&env, &token);
        Self::assert_valid_parties(&env, &buyer, &seller);
        Self::require_operational_address(&env, &buyer);
        Self::require_operational_address(&env, &seller);
        Self::check_amount_circuit_breaker(&env, amount);
        Self::check_rate_circuit_breaker_n(&env, 1);

        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&buyer, &env.current_contract_address(), &amount);

        let fee_bps = Self::resolve_fee_bps(&env, &dataset_id);
        let escrow_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::EscrowCount)
            .unwrap_or(0);

        let record = EscrowRecord {
            escrow_id,
            dataset_id,
            buyer: buyer.clone(),
            seller: seller.clone(),
            amount,
            token,
            deadline,
            buyer_confirmed: false,
            platform_fee_bps: fee_bps,
            released: false,
            refunded: false,
        };

        env.storage()
            .persistent()
            .set(&EscrowKey::Record(escrow_id), &record);
        env.storage().persistent().extend_ttl(
            &EscrowKey::Record(escrow_id),
            ESCROW_MIN_TTL,
            ESCROW_BUMP_LEDGERS,
        );
        env.storage()
            .instance()
            .set(&DataKey::EscrowCount, &(escrow_id + 1));

        env.events().publish(
            (symbol_short!("locked"),),
            (escrow_id, buyer, seller, amount, fee_bps),
        );
        escrow_id
    }

    pub fn confirm_delivery(env: Env, escrow_id: u64, buyer: Address) -> Result<(), Error> {
        buyer.require_auth();
        let mut record = Self::read_escrow(&env, escrow_id)?;
        if record.buyer != buyer {
            return Err(Error::NotBuyer);
        }
        if record.buyer_confirmed {
            return Err(Error::AlreadyConfirmed);
        }
        if record.released {
            return Err(Error::AlreadyReleased);
        }
        if record.refunded {
            return Err(Error::AlreadyRefunded);
        }
        record.buyer_confirmed = true;
        env.storage()
            .persistent()
            .set(&EscrowKey::Record(escrow_id), &record);
        env.events()
            .publish((symbol_short!("confirm"),), (escrow_id, buyer));
        Ok(())
    }

    pub fn lock_multi(
        env: Env,
        buyer: Address,
        token: Address,
        shares: Vec<SellerShare>,
        dataset_ids: Vec<String>,
    ) -> u64 {
        buyer.require_auth();
        Self::assert_not_paused(&env);
        if shares.is_empty() || shares.len() != dataset_ids.len() {
            panic_with_error!(&env, Error::InvalidInput);
        }
        Self::assert_valid_token(&env, &token);
        Self::require_operational_address(&env, &buyer);

        let mut total_amount: i128 = 0;
        let mut i: u32 = 0;
        while i < shares.len() {
            let share = shares
                .get(i)
                .unwrap_or_else(|| panic_with_error!(&env, Error::EscrowNotFound));
            if share.amount <= 0 {
                panic_with_error!(&env, Error::InvalidAmount);
            }
            Self::check_amount_circuit_breaker(&env, share.amount);
            Self::require_operational_address(&env, &share.seller);
            total_amount += share.amount;
            i += 1;
        }

        Self::check_rate_circuit_breaker_n(&env, shares.len());

        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&buyer, &env.current_contract_address(), &total_amount);

        let first_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::EscrowCount)
            .unwrap_or(0);
        let mut next_id = first_id;
        let now = env.ledger().timestamp();
        let deadline = now.saturating_add(3600u64);

        let mut j: u32 = 0;
        while j < shares.len() {
            let share = shares
                .get(j)
                .unwrap_or_else(|| panic_with_error!(&env, Error::EscrowNotFound));
            let dataset_id = dataset_ids
                .get(j)
                .unwrap_or_else(|| panic_with_error!(&env, Error::EscrowNotFound));
            Self::assert_valid_dataset_id(&env, &dataset_id);
            let fee_bps = Self::resolve_fee_bps(&env, &dataset_id);

            let record = EscrowRecord {
                escrow_id: next_id,
                dataset_id,
                buyer: buyer.clone(),
                seller: share.seller,
                amount: share.amount,
                token: token.clone(),
                deadline,
                buyer_confirmed: false,
                platform_fee_bps: fee_bps,
                released: false,
                refunded: false,
            };
            env.storage()
                .persistent()
                .set(&EscrowKey::Record(next_id), &record);
            env.storage().persistent().extend_ttl(
                &EscrowKey::Record(next_id),
                ESCROW_MIN_TTL,
                ESCROW_BUMP_LEDGERS,
            );
            next_id += 1;
            j += 1;
        }

        env.storage()
            .instance()
            .set(&DataKey::EscrowCount, &next_id);
        first_id
    }

    pub fn release(env: Env, admin: Address, escrow_id: u64) {
        admin.require_auth();
        Self::assert_admin(&env, &admin);
        Self::assert_not_paused(&env);
        Self::release_one(&env, &admin, escrow_id);
    }

    pub fn release_multi(env: Env, admin: Address, escrow_ids: Vec<u64>) {
        admin.require_auth();
        Self::assert_admin(&env, &admin);
        Self::assert_not_paused(&env);
        let mut i: u32 = 0;
        while i < escrow_ids.len() {
            let escrow_id = escrow_ids
                .get(i)
                .unwrap_or_else(|| panic_with_error!(&env, Error::EscrowNotFound));
            Self::release_one(&env, &admin, escrow_id);
            i += 1;
        }
    }

    pub fn refund(env: Env, admin: Address, escrow_id: u64) {
        admin.require_auth();
        Self::assert_admin(&env, &admin);
        Self::assert_not_paused(&env);

        env.storage().persistent().extend_ttl(
            &EscrowKey::Record(escrow_id),
            ESCROW_MIN_TTL,
            ESCROW_BUMP_LEDGERS,
        );

        let mut record = Self::read_escrow(&env, escrow_id)
            .unwrap_or_else(|_| panic_with_error!(&env, Error::EscrowNotFound));

        if record.released {
            panic_with_error!(&env, Error::AlreadyReleased);
        }
        if record.refunded {
            panic_with_error!(&env, Error::AlreadyRefunded);
        }

        let token_client = token::Client::new(&env, &record.token);
        token_client.transfer(&env.current_contract_address(), &record.buyer, &record.amount);

        record.refunded = true;
        env.storage()
            .persistent()
            .set(&EscrowKey::Record(escrow_id), &record);

        env.events().publish(
            (symbol_short!("refunded"),),
            (escrow_id, record.buyer, record.amount),
        );
    }

    pub fn claim_expired(env: Env, escrow_id: u64, seller: Address) -> Result<(), Error> {
        seller.require_auth();
        let mut record = Self::read_escrow(&env, escrow_id)?;
        if record.seller != seller {
            return Err(Error::NotSeller);
        }
        if record.released {
            return Err(Error::AlreadyReleased);
        }
        if record.refunded {
            return Err(Error::AlreadyRefunded);
        }
        if env.ledger().timestamp() <= record.deadline {
            return Err(Error::NotExpired);
        }

        let calculated_platform_cut =
            record.amount * record.platform_fee_bps as i128 / MAX_BASIS_POINTS as i128;
        let platform_cut =
            if calculated_platform_cut == 0 && record.amount > 0 && record.platform_fee_bps > 0 {
                1
            } else {
                calculated_platform_cut
            };
        let seller_cut = record.amount - platform_cut;

        let token_client = token::Client::new(&env, &record.token);
        token_client.transfer(&env.current_contract_address(), &record.seller, &seller_cut);

        record.released = true;
        env.storage()
            .persistent()
            .set(&EscrowKey::Record(escrow_id), &record);

        env.events().publish(
            (symbol_short!("claimed"),),
            (escrow_id, seller, seller_cut),
        );
        Ok(())
    }

    pub fn get_escrow(env: Env, escrow_id: u64) -> EscrowRecord {
        env.storage().persistent().extend_ttl(
            &EscrowKey::Record(escrow_id),
            ESCROW_MIN_TTL,
            ESCROW_BUMP_LEDGERS,
        );
        Self::read_escrow(&env, escrow_id)
            .unwrap_or_else(|_| panic_with_error!(&env, Error::EscrowNotFound))
    }

    pub fn get_escrow_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::EscrowCount)
            .unwrap_or(0)
    }

    pub fn emergency_withdraw(
        env: Env,
        admin: Address,
        token: Address,
        to: Address,
        amount: i128,
    ) -> Result<(), Error> {
        admin.require_auth();
        Self::assert_admin(&env, &admin);
        if amount <= 0 {
            return Err(Error::InvalidInput);
        }
        if !Self::is_paused(env.clone()) {
            return Err(Error::NotPaused);
        }
        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&env.current_contract_address(), &to, &amount);
        env.events()
            .publish((symbol_short!("emerg_wd"),), (token, to, amount));
        Ok(())
    }

    // ─── Private helpers ─────────────────────────────────────────────────────

    pub fn get_fee(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::DefaultPlatformFee)
            .unwrap_or(500)
    }

    fn distribute_locked_funds(env: &Env, admin: &Address, record: &mut EscrowRecord) {
        let fee_bps = Self::get_fee(env.clone());
        let platform_cut = record.amount * fee_bps as i128 / MAX_BASIS_POINTS as i128;
        let seller_cut = record.amount - platform_cut;
        let token_client = token::Client::new(env, &record.token);
        token_client.transfer(&env.current_contract_address(), &record.seller, &seller_cut);
        if platform_cut > 0 {
            let treasury: Address = env
                .storage()
                .instance()
                .get(&DataKey::Treasury)
                .unwrap_or(admin.clone());
            token_client.transfer(&env.current_contract_address(), &treasury, &platform_cut);
    fn assert_valid_amount(env: &Env, amount: i128) {
        if amount < MIN_LOCK_AMOUNT {
            panic_with_error!(env, HazinaEscrowError::InvalidAmount);
    fn assert_valid_fee(env: &Env, fee_bps: u32) {
        if fee_bps > MAX_FEE_BPS {
            panic_with_error!(env, Error::InvalidFeeBps);
        }
    }

    fn assert_valid_dataset_id(env: &Env, dataset_id: &String) {
        if dataset_id.is_empty() {
            panic_with_error!(env, Error::EmptyDatasetId);
        }
    }

    fn assert_valid_token(env: &Env, token: &Address) {
        let token_client = token::Client::new(env, token);
        let _ = token_client.decimals();
    }

    fn assert_valid_parties(env: &Env, buyer: &Address, seller: &Address) {
        if buyer == seller {
            panic_with_error!(env, Error::InvalidInput);
        }
        if seller == &env.current_contract_address() {
            panic_with_error!(env, Error::InvalidInput);
        }
    }

    fn assert_not_paused(env: &Env) {
        if env
            .storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
        {
            panic_with_error!(env, Error::Paused);
        }
    }

    fn assert_admin(env: &Env, caller: &Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized));
        if admin != *caller {
            panic_with_error!(env, Error::NotAdmin);
        }
    }

    fn read_escrow(env: &Env, escrow_id: u64) -> Result<EscrowRecord, Error> {
        env.storage()
            .persistent()
            .get(&EscrowKey::Record(escrow_id))
            .ok_or(Error::EscrowNotFound)
    }

    fn resolve_fee_bps(env: &Env, dataset_id: &String) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::DatasetFee(dataset_id.clone()))
            .unwrap_or_else(|| {
                env.storage()
                    .instance()
                    .get(&DataKey::DefaultPlatformFee)
                    .unwrap_or(500)
            })
    }

    fn require_operational_address(env: &Env, address: &Address) {
        let blacklisted: bool = env
            .storage()
            .persistent()
            .get(&DataKey::Blacklisted(address.clone()))
            .unwrap_or(false);
        if blacklisted {
            panic_with_error!(env, Error::AddressBlacklisted);
        }
        let whitelist_enforced: bool = env
            .storage()
            .instance()
            .get(&DataKey::WhitelistEnforced)
            .unwrap_or(false);
        if whitelist_enforced {
            let whitelisted: bool = env
                .storage()
                .persistent()
                .get(&DataKey::Whitelisted(address.clone()))
                .unwrap_or(false);
            if !whitelisted {
                panic_with_error!(env, Error::AddressNotWhitelisted);
            }
        }
    }

    fn release_one(env: &Env, admin: &Address, escrow_id: u64) {
        let mut record = Self::read_escrow(env, escrow_id)
            .unwrap_or_else(|_| panic_with_error!(env, Error::EscrowNotFound));
        if record.released {
            panic_with_error!(env, Error::AlreadyReleased);
        }
        if record.refunded {
            panic_with_error!(env, Error::AlreadyRefunded);
        }
        if !record.buyer_confirmed {
            panic_with_error!(env, Error::BuyerNotConfirmed);
        }

        let calculated_platform_cut =
            record.amount * record.platform_fee_bps as i128 / MAX_BASIS_POINTS as i128;
        let platform_cut =
            if calculated_platform_cut == 0 && record.amount > 0 && record.platform_fee_bps > 0 {
                1
            } else {
                calculated_platform_cut
            };
        let seller_cut = record.amount - platform_cut;

        let token_client = token::Client::new(env, &record.token);
        token_client.transfer(&env.current_contract_address(), &record.seller, &seller_cut);
        
        let treasury: Address = env
            .storage()
            .instance()
            .get(&DataKey::Treasury)
            .unwrap_or(admin.clone());
        token_client.transfer(&env.current_contract_address(), &treasury, &platform_cut);

        record.released = true;
        env.storage()
            .persistent()
            .set(&EscrowKey::Record(escrow_id), &record);
        env.events().publish(
            (symbol_short!("released"),),
            (record.escrow_id, record.seller.clone(), seller_cut, platform_cut),
        );
    }

    fn check_amount_circuit_breaker(env: &Env, amount: i128) {
        let max: i128 = env
            .storage()
            .instance()
            .get(&DataKey::MaxEscrowAmount)
            .unwrap_or(DEFAULT_MAX_ESCROW_AMOUNT);
        if amount > max {
            env.events().publish(
                (soroban_sdk::symbol_short!("cb_amt"),),
                (amount, max),
            );
            panic_with_error!(env, Error::AmountExceedsCircuitBreaker);
        }
    }

    fn check_rate_circuit_breaker_n(env: &Env, n: u32) {
        let max: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MaxEscrowsPerLedger)
            .unwrap_or(DEFAULT_MAX_ESCROWS_PER_LEDGER);

        let current_ledger = env.ledger().sequence();
        let last_ledger: u32 = env
            .storage()
            .instance()
            .get(&DataKey::LastEscrowLedger)
            .unwrap_or(0);

        let current_count: u32 = if current_ledger != last_ledger {
            0
        } else {
            env.storage()
                .instance()
                .get(&DataKey::EscrowsThisLedger)
                .unwrap_or(0)
        };

        let new_count = current_count + n;
        if new_count > max {
            env.events().publish(
                (soroban_sdk::symbol_short!("cb_rate"),),
                (new_count, max, current_ledger),
            );
            panic_with_error!(env, Error::RateLimitExceeded);
        }

        env.storage()
            .instance()
            .set(&DataKey::EscrowsThisLedger, &new_count);
        env.storage()
            .instance()
            .set(&DataKey::LastEscrowLedger, &current_ledger);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Events, Ledger},
        token::{Client as TokenClient, StellarAssetClient},
        Address, Env, String, Vec,
    };

    const INITIAL_BUYER_BALANCE: i128 = 10_000_000_000;

    fn setup() -> (Env, HazinaEscrowClient<'static>, Address, Address, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1000);

        let admin = Address::generate(&env);
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);

        let token_id = env.register_stellar_asset_contract_v2(admin.clone());
        let usdc = token_id.address();
        let usdc_admin = StellarAssetClient::new(&env, &usdc);
        usdc_admin.mint(&buyer, &INITIAL_BUYER_BALANCE);
        usdc_admin.mint(&admin, &1_000_0000000);

        let contract_id = env.register(HazinaEscrow, ());
        let client = HazinaEscrowClient::new(&env, &contract_id);
        client.initialize(&admin, &500);

        (env, client, admin, buyer, seller, usdc)
    }

    fn dataset_id(env: &Env, value: &str) -> String {
        String::from_str(env, value)
    }

    #[test]
    fn release_fails_without_confirmation() {
        let (env, client, admin, buyer, seller, usdc) = setup();
        let escrow_id = client.lock(
            &buyer,
            &seller,
            &usdc,
            &2_000_000,
            &dataset_id(&env, "ds-2"),
            &3600,
        );
        let result = client.try_release(&admin, &escrow_id);
        assert!(result.is_err());
    }

    #[test]
    fn test_initialize_sets_default_config() {
        let (env, client, _admin, buyer, seller, usdc) = setup();
        assert_eq!(client.get_fee(), 500);

        let policy = client.get_address_policy(&buyer);
        assert!(!policy.whitelist_enforced);
        assert!(policy.can_transact);

        let escrow_id = client.lock(
            &buyer,
            &seller,
            &usdc,
            &1_000_000,
            &dataset_id(&env, "ds-init"),
            &3600,
        );
        let record = client.get_escrow(&escrow_id);
        assert_eq!(record.platform_fee_bps, 500);
    }

    #[test]
    #[should_panic]
    fn test_initialize_fails_when_called_twice() {
        let (_env, client, admin, _buyer, _seller, _usdc) = setup();
        client.initialize(&admin, &500);
    }

    #[test]
    fn test_set_default_fee_updates_contract_fee() {
        let (_env, client, admin, _buyer, _seller, _usdc) = setup();
        client.set_default_fee(&admin, &750);
        assert_eq!(client.get_default_fee(), 750);
        assert_eq!(client.get_fee(), 750);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #15)")]
    fn test_set_default_fee_rejects_fee_above_cap() {
        let (_env, client, admin, _buyer, _seller, _usdc) = setup();
        client.set_default_fee(&admin, &(MAX_FEE_BPS + 1));
    }

    #[test]
    fn test_set_and_clear_dataset_fee() {
        let (env, client, admin, _buyer, _seller, _usdc) = setup();
        let ds = dataset_id(&env, "ds-custom-fee");

        client.set_dataset_fee(&admin, &ds, &900);
        let custom = client.get_dataset_fee_config(&ds);
        assert!(custom.has_custom_fee);
        assert_eq!(custom.dataset_fee_bps, 900);
        assert_eq!(custom.effective_fee_bps, 900);

        client.clear_dataset_fee(&admin, &ds);
        let cleared = client.get_dataset_fee_config(&ds);
        assert!(!cleared.has_custom_fee);
        assert_eq!(cleared.dataset_fee_bps, 500);
        assert_eq!(cleared.effective_fee_bps, 500);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #20)")]
    fn test_set_dataset_fee_requires_non_empty_dataset_id() {
        let (env, client, admin, _buyer, _seller, _usdc) = setup();
        client.set_dataset_fee(&admin, &dataset_id(&env, ""), &900);
    }

    #[test]
    fn test_set_address_policies_and_read_them_back() {
        let (_env, client, admin, buyer, _seller, _usdc) = setup();
        client.set_whitelist_enforced(&admin, &true);
        client.set_address_whitelisted(&admin, &buyer, &true);
        client.set_address_blacklisted(&admin, &buyer, &false);

        let policy = client.get_address_policy(&buyer);
        assert!(policy.whitelist_enforced);
        assert!(policy.whitelisted);
        assert!(!policy.blacklisted);
        assert!(policy.can_transact);
    }

    #[test]
    fn test_lock_and_release_use_snapshot_fee() {
        let (env, client, admin, buyer, seller, usdc) = setup();
        let token_client = TokenClient::new(&env, &usdc);
        let ds = dataset_id(&env, "ds-snapshotted-fee");
        let amount: i128 = 2_000_000;

        client.set_dataset_fee(&admin, &ds, &900);
        let escrow_id = client.lock(&buyer, &seller, &usdc, &amount, &ds, &3600);
        client.confirm_delivery(&escrow_id, &buyer);
        client.set_dataset_fee(&admin, &ds, &100);
        client.release(&admin, &escrow_id);

        let record = client.get_escrow(&escrow_id);
        assert_eq!(record.platform_fee_bps, 900);
        assert!(record.released);

        let admin_expected = amount * 900i128 / 10_000i128;
        let seller_expected = amount - admin_expected;
        assert_eq!(token_client.balance(&seller), seller_expected);
    }

    #[test]
    fn release_succeeds_after_buyer_confirmation() {
        let (env, client, admin, buyer, seller, usdc) = setup();
        let token_client = TokenClient::new(&env, &usdc);
        let amount: i128 = 2_000_000;
        let escrow_id = client.lock(
            &buyer,
            &seller,
            &usdc,
            &amount,
            &dataset_id(&env, "ds-2"),
            &3600,
        );
        client.confirm_delivery(&escrow_id, &buyer);
        client.release(&admin, &escrow_id);

        let fee = amount * 500 / 10_000;
        let seller_expected = amount - fee;
        assert_eq!(token_client.balance(&seller), seller_expected);
    }

    #[test]
    fn confirm_delivery_rejects_non_buyer() {
        let (env, client, _admin, buyer, seller, usdc) = setup();
        let escrow_id = client.lock(
            &buyer,
            &seller,
            &usdc,
            &2_000_000,
            &dataset_id(&env, "ds-3"),
            &3600,
        );
        let result = client.try_confirm_delivery(&escrow_id, &seller);
        assert_eq!(result, Err(Ok(crate::Error::NotBuyer)));
    }

    #[test]
    fn claim_expired_fails_before_deadline() {
        let (env, client, _admin, buyer, seller, usdc) = setup();
        let escrow_id = client.lock(
            &buyer,
            &seller,
            &usdc,
            &5_000_000,
            &dataset_id(&env, "ds-expired"),
            &3600,
        );
        let result = client.try_claim_expired(&escrow_id, &seller);
        assert_eq!(result, Err(Ok(crate::Error::NotExpired)));
    }

    #[test]
    fn seller_can_claim_after_deadline() {
        let (env, client, _admin, buyer, seller, usdc) = setup();
        let token_client = TokenClient::new(&env, &usdc);
        let amount: i128 = 2_000_000;

        let escrow_id = client.lock(
            &buyer,
            &seller,
            &usdc,
            &amount,
            &dataset_id(&env, "ds-expired-claim"),
            &3600,
        );
        env.ledger().set_timestamp(env.ledger().timestamp() + 4000);
        client.claim_expired(&escrow_id, &seller);

        let record = client.get_escrow(&escrow_id);
        assert!(record.released);
        let fee = amount * 500 / 10_000;
        assert_eq!(token_client.balance(&seller), amount - fee);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #8)")]
    fn test_lock_rejects_invalid_amount() {
        let (env, client, _admin, buyer, seller, usdc) = setup();
        client.lock(&buyer, &seller, &usdc, &0, &dataset_id(&env, "ds-invalid"), &3600);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #20)")]
    fn test_lock_rejects_empty_dataset_id() {
        let (env, client, _admin, buyer, seller, usdc) = setup();
        client.lock(&buyer, &seller, &usdc, &1_000_000, &dataset_id(&env, ""), &3600);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #8)")]
    fn test_lock_rejects_same_buyer_and_seller() {
        let (env, client, _admin, buyer, _seller, usdc) = setup();
        client.lock(&buyer, &buyer, &usdc, &1_000_000, &dataset_id(&env, "ds-same"), &3600);
    }

    #[test]
    #[should_panic]
    fn test_lock_rejects_invalid_token_contract() {
        let (env, client, _admin, buyer, seller, _usdc) = setup();
        let invalid_token = Address::generate(&env);
        client.lock(&buyer, &seller, &invalid_token, &1_000_000, &dataset_id(&env, "ds-bad-token"), &3600);
    }

    #[test]
    fn test_refund_marks_record_and_restores_buyer_balance() {
        let (env, client, admin, buyer, seller, usdc) = setup();
        let token_client = TokenClient::new(&env, &usdc);
        let amount: i128 = 5_000_000;
        let buyer_before = token_client.balance(&buyer);

        let escrow_id = client.lock(
            &buyer,
            &seller,
            &usdc,
            &amount,
            &dataset_id(&env, "ds-refund"),
            &3600,
        );
        client.refund(&admin, &escrow_id);

        let record = client.get_escrow(&escrow_id);
        assert!(record.refunded);
        assert_eq!(token_client.balance(&buyer), buyer_before);
    }

    #[test]
    #[should_panic]
    fn test_release_cannot_be_called_twice() {
        let (env, client, admin, buyer, seller, usdc) = setup();
        let escrow_id = client.lock(
            &buyer,
            &seller,
            &usdc,
            &1_000_000,
            &dataset_id(&env, "ds-release-twice"),
            &3600,
        );
        client.confirm_delivery(&escrow_id, &buyer);
        client.release(&admin, &escrow_id);
        client.release(&admin, &escrow_id);
    }

    #[test]
    #[should_panic]
    fn test_release_requires_admin() {
        let (env, client, _admin, buyer, seller, usdc) = setup();
        let outsider = Address::generate(&env);
        let escrow_id = client.lock(
            &buyer,
            &seller,
            &usdc,
            &1_000_000,
            &dataset_id(&env, "ds-admin-check"),
            &3600,
        );
        client.confirm_delivery(&escrow_id, &buyer);
        client.release(&outsider, &escrow_id);
    }

    #[test]
    #[should_panic]
    fn test_get_escrow_fails_for_unknown_id() {
        let (_env, client, _admin, _buyer, _seller, _usdc) = setup();
        client.get_escrow(&99);
    }

    #[test]
    fn formal_release_conserves_locked_value() {
        let (env, client, admin, buyer, seller, usdc) = setup();
        let token_client = TokenClient::new(&env, &usdc);
        let amount: i128 = 3_500_000;
        let buyer_before = token_client.balance(&buyer);
        let admin_before = token_client.balance(&admin);

        let escrow_id = client.lock(
            &buyer,
            &seller,
            &usdc,
            &amount,
            &dataset_id(&env, "ds-formal-conservation"),
            &3600,
        );
        client.confirm_delivery(&escrow_id, &buyer);
        client.release(&admin, &escrow_id);

        let seller_balance = token_client.balance(&seller);
        let admin_gained = token_client.balance(&admin) - admin_before;
        assert_eq!(buyer_before - token_client.balance(&buyer), amount);
        assert_eq!(seller_balance + admin_gained, amount);
    }

    #[test]
    fn formal_refund_returns_all_locked_value_to_buyer() {
        let (env, client, admin, buyer, seller, usdc) = setup();
        let token_client = TokenClient::new(&env, &usdc);
        let amount: i128 = 4_200_000;
        let buyer_before = token_client.balance(&buyer);

        let escrow_id = client.lock(
            &buyer,
            &seller,
            &usdc,
            &amount,
            &dataset_id(&env, "ds-formal-refund"),
            &3600,
        );
        client.refund(&admin, &escrow_id);

        assert_eq!(token_client.balance(&buyer), buyer_before);
        assert_eq!(token_client.balance(&seller), 0);
    }

    #[test]
    fn test_lock_multi_and_release_multi() {
        let (env, client, admin, buyer, _seller, usdc) = setup();
        let token_client = TokenClient::new(&env, &usdc);

        let seller_1 = Address::generate(&env);
        let seller_2 = Address::generate(&env);
        let seller_3 = Address::generate(&env);
        let seller_4 = Address::generate(&env);

        let amount_1: i128 = 1_000_000;
        let amount_2: i128 = 2_000_000;
        let amount_3: i128 = 3_000_000;
        let amount_4: i128 = 4_000_000;
        let total = amount_1 + amount_2 + amount_3 + amount_4;

        let mut shares = Vec::new(&env);
        shares.push_back(SellerShare { seller: seller_1.clone(), amount: amount_1 });
        shares.push_back(SellerShare { seller: seller_2.clone(), amount: amount_2 });
        shares.push_back(SellerShare { seller: seller_3.clone(), amount: amount_3 });
        shares.push_back(SellerShare { seller: seller_4.clone(), amount: amount_4 });

        let mut dataset_ids = Vec::new(&env);
        dataset_ids.push_back(dataset_id(&env, "ds-001"));
        dataset_ids.push_back(dataset_id(&env, "ds-002"));
        dataset_ids.push_back(dataset_id(&env, "ds-003"));
        dataset_ids.push_back(dataset_id(&env, "ds-004"));

        let first_id = client.lock_multi(&buyer, &usdc, &shares, &dataset_ids);
        assert_eq!(first_id, 0);
        assert_eq!(token_client.balance(&buyer), INITIAL_BUYER_BALANCE - total);

        // Confirm delivery for each escrow
        client.confirm_delivery(&first_id, &buyer);
        client.confirm_delivery(&(first_id + 1), &buyer);
        client.confirm_delivery(&(first_id + 2), &buyer);
        client.confirm_delivery(&(first_id + 3), &buyer);

        let mut escrow_ids = Vec::new(&env);
        escrow_ids.push_back(first_id);
        escrow_ids.push_back(first_id + 1);
        escrow_ids.push_back(first_id + 2);
        escrow_ids.push_back(first_id + 3);

        client.release_multi(&admin, &escrow_ids);

        let fee_bps: i128 = 500;
        let s1_expected = amount_1 - (amount_1 * fee_bps / 10_000);
        let s2_expected = amount_2 - (amount_2 * fee_bps / 10_000);
        let s3_expected = amount_3 - (amount_3 * fee_bps / 10_000);
        let s4_expected = amount_4 - (amount_4 * fee_bps / 10_000);

        assert_eq!(token_client.balance(&seller_1), s1_expected);
        assert_eq!(token_client.balance(&seller_2), s2_expected);
        assert_eq!(token_client.balance(&seller_3), s3_expected);
        assert_eq!(token_client.balance(&seller_4), s4_expected);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #8)")]
    fn test_lock_multi_empty_shares() {
        let (env, client, _admin, buyer, _seller, usdc) = setup();
        let shares: Vec<SellerShare> = Vec::new(&env);
        let dataset_ids: Vec<String> = Vec::new(&env);
        let _ = client.lock_multi(&buyer, &usdc, &shares, &dataset_ids);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #8)")]
    fn test_lock_multi_mismatched_lengths() {
        let (env, client, _admin, buyer, _seller, usdc) = setup();
        let mut shares = Vec::new(&env);
        shares.push_back(SellerShare { seller: Address::generate(&env), amount: 1_000_000 });
        let dataset_ids: Vec<String> = Vec::new(&env);
        let _ = client.lock_multi(&buyer, &usdc, &shares, &dataset_ids);
    }

    #[test]
    fn test_set_fee() {
        let (_, client, admin, _, _, _) = setup();
        client.set_fee(&admin, &300);
        assert_eq!(client.get_fee(), 300);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn test_set_fee_requires_admin() {
        let (env, client, _, _, _, _) = setup();
        let impostor = Address::generate(&env);
        client.set_fee(&impostor, &300);
    }

    #[test]
    fn test_update_fee_accepts_max_boundary() {
        let (_, client, admin, _, _, _) = setup();
        client.update_fee(&admin, &MAX_FEE_BPS);
        assert_eq!(client.get_fee(), MAX_FEE_BPS);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #4)")]
    fn test_update_fee_rejects_above_cap() {
        let (_, client, admin, _, _, _) = setup();
        client.update_fee(&admin, &(MAX_FEE_BPS + 1));
    }

    #[test]
    fn test_set_fee_does_not_affect_existing_escrows() {
        let (env, client, admin, buyer, seller, usdc) = setup();
        let escrow_id = client.lock(
            &buyer,
            &seller,
            &usdc,
            &1_000_000,
            &dataset_id(&env, "ds-fee-snapshot"),
            &3600,
        );
        client.set_fee(&admin, &MAX_FEE_BPS);
        let record = client.get_escrow(&escrow_id);
        assert_eq!(record.platform_fee_bps, 500);
    }

    #[test]
    fn emergency_withdraw_requires_pause_and_admin() {
        let (env, client, admin, _buyer, seller, usdc) = setup();
        let token_client = TokenClient::new(&env, &usdc);
        let token_admin = StellarAssetClient::new(&env, &usdc);
        token_admin.mint(&client.address, &1_000_000);

        let not_paused = client.try_emergency_withdraw(&admin, &usdc, &seller, &100_000);
        assert_eq!(not_paused, Err(Ok(crate::Error::NotPaused)));

        client.pause(&admin);
        client.emergency_withdraw(&admin, &usdc, &seller, &100_000);
        assert_eq!(token_client.balance(&seller), 100_000);
    }

    #[test]
    fn emergency_withdraw_rejects_non_admin() {
        let (env, client, admin, _buyer, seller, usdc) = setup();
        let outsider = Address::generate(&env);
        client.pause(&admin);
        let result = client.try_emergency_withdraw(&outsider, &usdc, &seller, &500_000);
        assert_eq!(result, Err(Ok(crate::Error::NotAdmin)));
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn test_upgrade_requires_admin() {
        let (env, client, _admin, _, _, _) = setup();
        let outsider = Address::generate(&env);
        let dummy_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
        client.upgrade(&outsider, &dummy_hash);
    }

    #[test]
    #[ignore]
    fn test_upgrade_preserves_escrow_state() {
        let (env, client, _admin, buyer, seller, usdc) = setup();
        let escrow_id = client.lock(
            &buyer,
            &seller,
            &usdc,
            &1_000_000,
            &dataset_id(&env, "ds-upgrade-preserve"),
            &3600,
        );
        let before = client.get_escrow(&escrow_id);
        let contract_addr = client.address.clone();
        let after: EscrowRecord = env.as_contract(&contract_addr, || {
            env.storage()
                .persistent()
                .get(&EscrowKey::Record(escrow_id))
                .unwrap()
        });
        assert_eq!(before, after);
    }

    #[test]
    fn test_pause_and_unpause_toggles_state() {
        let (_env, client, admin, _buyer, _seller, _usdc) = setup();
        assert!(!client.is_paused());
        client.pause(&admin);
        assert!(client.is_paused());
        client.unpause(&admin);
        assert!(!client.is_paused());
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn test_pause_requires_admin() {
        let (env, client, _admin, _buyer, _seller, _usdc) = setup();
        let outsider = Address::generate(&env);
        client.pause(&outsider);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #14)")]
    fn test_lock_fails_when_paused() {
        let (env, client, admin, buyer, seller, usdc) = setup();
        client.pause(&admin);
        client.lock(&buyer, &seller, &usdc, &1_000_000, &dataset_id(&env, "ds-paused-lock"), &3600);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #14)")]
    fn test_release_fails_when_paused() {
        let (env, client, admin, buyer, seller, usdc) = setup();
        let escrow_id = client.lock(
            &buyer,
            &seller,
            &usdc,
            &1_000_000,
            &dataset_id(&env, "ds-paused-release"),
            &3600,
        );
        client.confirm_delivery(&escrow_id, &buyer);
        client.pause(&admin);
        client.release(&admin, &escrow_id);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #14)")]
    fn test_refund_fails_when_paused() {
        let (env, client, admin, buyer, seller, usdc) = setup();
        let escrow_id = client.lock(
            &buyer,
            &seller,
            &usdc,
            &1_000_000,
            &dataset_id(&env, "ds-paused-refund"),
            &3600,
        );
        client.pause(&admin);
        client.refund(&admin, &escrow_id);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn test_unpause_requires_admin() {
        let (env, client, admin, _buyer, _seller, _usdc) = setup();
        let outsider = Address::generate(&env);
        client.pause(&admin);
        client.unpause(&outsider);
    }

    #[test]
    fn test_get_escrow_works_while_paused() {
        let (env, client, admin, buyer, seller, usdc) = setup();
        let escrow_id = client.lock(
            &buyer,
            &seller,
            &usdc,
            &1_000_000,
            &dataset_id(&env, "ds-read-while-paused"),
            &3600,
        );
        client.pause(&admin);
        let record = client.get_escrow(&escrow_id);
        assert_eq!(record.escrow_id, escrow_id);
    }

    #[test]
    fn test_pause_emits_event() {
        let (env, client, admin, _buyer, _seller, _usdc) = setup();
        assert_eq!(env.events().all().len(), 0);
        client.pause(&admin);
        assert_eq!(env.events().all().len(), 1);
    }

    #[test]
    fn test_unpause_emits_event() {
        let (env, client, admin, _buyer, _seller, _usdc) = setup();
        client.pause(&admin);
        let _ = env.events().all();
        client.unpause(&admin);
        assert_eq!(env.events().all().len(), 1);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #14)")]
    fn test_lock_multi_fails_when_paused() {
        let (env, client, admin, buyer, _seller, usdc) = setup();
        let seller_1 = Address::generate(&env);
        client.pause(&admin);
        let mut shares = Vec::new(&env);
        shares.push_back(SellerShare { seller: seller_1, amount: 1_000_000 });
        let mut dataset_ids = Vec::new(&env);
        dataset_ids.push_back(dataset_id(&env, "ds-multi-paused"));
        client.lock_multi(&buyer, &usdc, &shares, &dataset_ids);
    }

    #[test]
    fn test_get_escrow_count_returns_correct_number() {
        let (env, client, _admin, buyer, seller, usdc) = setup();
        assert_eq!(client.get_escrow_count(), 0);

        let id1 = client.lock(&buyer, &seller, &usdc, &1_000_000, &dataset_id(&env, "ds-count-1"), &3600);
        assert_eq!(id1, 0);
        assert_eq!(client.get_escrow_count(), 1);

        let id2 = client.lock(&buyer, &seller, &usdc, &2_000_000, &dataset_id(&env, "ds-count-2"), &3600);
        assert_eq!(id2, 1);
        assert_eq!(client.get_escrow_count(), 2);

        let id3 = client.lock(&buyer, &seller, &usdc, &3_000_000, &dataset_id(&env, "ds-count-3"), &3600);
        assert_eq!(id3, 2);
        assert_eq!(client.get_escrow_count(), 3);
    }
}
