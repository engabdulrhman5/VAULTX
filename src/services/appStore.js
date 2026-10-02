const {
  ADMIN_ID,
  USERS_DB_PATH,
  CONFIG_DB_PATH,
  TRANSACTIONS_DB_PATH,
  STORE_DB_PATH,
  STATE_SNAPSHOT_PATH,
  DATA_DIR,
} = require("../config");
const { loadData, saveData } = require("./jsonStorage");
const fs = require("fs");
const path = require("path");
const { normalizeCurrency, currencyToRub, rubToCurrency, convert, canConvert, CURRENCY_CODES } = require("./currencyService");

class AppStore {
  constructor() {
    this.users = [];
    this.config = this.getDefaultConfig();
    this.transactions = [];
    global.__VAULTX_APP_STORE = this;
    this.loadAll();
  }

  getDefaultConfig() {
    return {
      services: {
        virtual_numbers: { price: 1, enabled: true },
        social_boost: { price: 2, enabled: true },
        game_topup: { price: 3, enabled: true },
        social_accounts: { price: 2.5, enabled: true },
        pro_accounts: { price: 4, enabled: true },
        cloud_services: { price: 5, enabled: true },
        virtual_visa: { price: 6, enabled: true },
        temporary_emails: { price: 0.5, enabled: true },
        other_services: { price: 1.5, enabled: true },
        balance_topup: { price: 0, enabled: true },
      },
      botStats: {
        totalRequests: 0,
        totalProfits: 0,
        todayProfits: 0,
        todayDate: new Date().toISOString().slice(0, 10),
      },
      giftCodes: {},
      temporaryEmailInventory: {},
    };
  }

  loadAll() {
    const snapshot = loadData(STATE_SNAPSHOT_PATH, null, { strict: true });
    if (snapshot && (snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.users) || !Array.isArray(snapshot.transactions) || !snapshot.config || typeof snapshot.config !== "object")) {
      throw new Error("Invalid wallet snapshot; refusing to overwrite customer balances");
    }
    const hasLegacyStore = fs.existsSync(STORE_DB_PATH);
    const parts = [USERS_DB_PATH, CONFIG_DB_PATH, TRANSACTIONS_DB_PATH];
    const presentParts = parts.filter((file) => fs.existsSync(file)).length;
    if (process.env.VAULTX_DATA_DIR && !snapshot && !hasLegacyStore && presentParts !== parts.length &&
        !(presentParts === 0 && process.env.VAULTX_BOOTSTRAP_FROM_BUNDLE === "1")) {
      throw new Error(`Incomplete wallet data in ${DATA_DIR}. Restore all three latest JSON files or explicitly seed an empty disk after reconciling balances.`);
    }
    const strictLegacy = Boolean(process.env.VAULTX_DATA_DIR);
    const legacyStore = snapshot ? null : loadData(STORE_DB_PATH, null, { strict: strictLegacy });
    const bundledDir = process.env.VAULTX_BOOTSTRAP_FROM_BUNDLE === "1" ? path.resolve(__dirname, "../../data") : null;
    const bundled = bundledDir ? Object.fromEntries(["users", "config", "transactions"].map((name) => [name, path.join(bundledDir, `${name}.json`)])) : {};
    this.users = (snapshot?.users || loadData(USERS_DB_PATH, legacyStore?.users || (bundled.users ? loadData(bundled.users, []) : []), { strict: strictLegacy })).map((user) => this.normalizeUser(user));
    const defaults = this.getDefaultConfig();
    const loaded = snapshot?.config || loadData(
      CONFIG_DB_PATH,
      legacyStore ? { services: legacyStore.services, botStats: legacyStore.botStats } : (bundled.config ? loadData(bundled.config, defaults) : defaults),
      { strict: strictLegacy }
    ) || {};
    const configSource = snapshot?.config || loaded;

    this.config = {
      ...defaults,
      ...configSource,
      services: { ...defaults.services, ...(configSource.services || {}) },
      botStats: { ...defaults.botStats, ...(configSource.botStats || {}) },
      temporaryEmailInventory: { ...(configSource.temporaryEmailInventory || {}) },
    };
    for (const service of Object.values(this.config.services)) {
      // Existing configured prices are RUB; keep the field for older admin
      // controls and persist the canonical USD value alongside it.
      const legacyRub = Number(service.price || 0);
      service.priceUsd = Number((legacyRub / 30).toFixed(6));
    }
    this.transactions = snapshot?.transactions || loadData(TRANSACTIONS_DB_PATH, legacyStore?.transactions || (bundled.transactions ? loadData(bundled.transactions, []) : []), { strict: strictLegacy });
    this.persistAll();
  }

  persistAll() {
    saveData(STATE_SNAPSHOT_PATH, { schemaVersion: 1, users: this.users, config: this.config, transactions: this.transactions });
  }

  persistWalletMutation(users, mutate) {
    const originals = users.map((user) => ({ user, balances: { ...user.balances },
      lastSeenAt: user.lastSeenAt, transactionsCount: user.transactionsCount, totalDeposits: user.totalDeposits }));
    const originalTransactions = this.transactions.map((entry) => ({ ...entry }));
    try {
      const result = mutate();
      this.persistAll();
      return result;
    } catch (error) {
      for (const { user, ...original } of originals) Object.assign(user, original);
      this.transactions = originalTransactions;
      throw error;
    }
  }

  transactionEntry(entry) {
    return { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, createdAt: new Date().toISOString(), ...entry };
  }

  settleTopup(pendingId, entry, updates = {}) {
    const pending = this.getTransactionById(pendingId);
    const user = this.findUserById(pending?.userId);
    const amount = Number(pending?.amount);
    if (!pending || !user || !["topup_crypto_pending", "topup_cryptomus_pending"].includes(pending.type) ||
        pending.status === "paid" || !Number.isFinite(amount) || amount <= 0) return null;
    return this.persistWalletMutation([user], () => {
      const currency = CURRENCY_CODES.includes(pending.walletCurrency) ? pending.walletCurrency : user.currency;
      user.balances[currency] = Number((this.getBalance(user.userId, currency) + rubToCurrency(amount, currency)).toFixed(6));
      user.totalDeposits = Number((user.totalDeposits + amount).toFixed(2));
      user.transactionsCount += 1;
      user.lastSeenAt = new Date().toISOString();
      Object.assign(pending, updates, { status: "paid", paidAt: new Date().toISOString() });
      this.transactions.push(this.transactionEntry({ ...entry, userId: user.userId, amount, currency: "RUB", walletCurrency: currency, status: "completed" }));
      return user;
    });
  }

  reservePurchase(userId, amountRub, entry) {
    const user = this.findUserById(userId);
    const amount = Number(amountRub);
    const debit = user ? Number(rubToCurrency(amount, user.currency).toFixed(6)) : 0;
    if (!user || !Number.isFinite(amount) || amount <= 0 || debit <= 0 || this.getBalance(userId) + 1e-8 < debit) return null;
    return this.persistWalletMutation([user], () => {
      user.balances[user.currency] = Number((this.getBalance(userId) - debit).toFixed(6));
      const pending = this.transactionEntry({ ...entry, userId: user.userId, amount, currency: "RUB", walletCurrency: user.currency, reservedAmount: debit, status: "pending" });
      this.transactions.push(pending);
      return pending;
    });
  }

  resolvePendingPurchase(id, fields) {
    const pending = this.getTransactionById(id);
    const user = this.findUserById(pending?.userId);
    if (!pending || !user || !["pending", "provider_unconfirmed"].includes(pending.status)) return null;
    return this.persistWalletMutation([user], () => {
      if (fields.status === "refunded") {
        user.balances[pending.walletCurrency] = Number((this.getBalance(user.userId, pending.walletCurrency) + pending.reservedAmount).toFixed(6));
      } else if (["completed", "active"].includes(fields.status)) user.transactionsCount += 1;
      Object.assign(pending, fields, { updatedAt: new Date().toISOString() });
      return pending;
    });
  }

  normalizeUser(user) {
    const selectedCurrency = normalizeCurrency(user?.currency || "USD");
    const legacyBalance = Number(user?.balance || 0);
    const storedBalances = user?.balances && typeof user.balances === "object" ? { ...user.balances } : {};
    const balances = {};
    for (const code of CURRENCY_CODES) {
      const value = Number(storedBalances[code] || 0);
      balances[code] = Number.isFinite(value) && value >= 0 ? value : 0;
    }
    if (!user?.balances || typeof user.balances !== "object") {
      // Existing VAULTX balances were RUB. Preserve them as RUB during migration.
      balances.RUB = Number.isFinite(legacyBalance) && legacyBalance > 0 ? legacyBalance : 0;
    }

    const normalized = {
      userId: Number(user.userId),
      username: user.username || "",
      firstName: user.firstName || "",
      balances,
      totalDeposits: Number(user.totalDeposits || 0),
      currency: selectedCurrency,
      level: user.level || "Newbie",
      language: user.language || "ar",
      role: user.role || (Number(user.userId) === ADMIN_ID ? "admin" : "user"),
      isActive: user.isActive !== false,
      isVerified: Boolean(user.isVerified),
      transactionsCount: Number(user.transactionsCount || 0),
      invitedBy: user.invitedBy || null,
      referralRewarded: Boolean(user.referralRewarded),
      referralCommissionCount: Number(user.referralCommissionCount || 0),
      notifyPromotions: user.notifyPromotions !== false,
      redeemedGiftCodes: Array.isArray(user.redeemedGiftCodes) ? user.redeemedGiftCodes : [],
      lastSeenAt: user.lastSeenAt || new Date().toISOString(),
      createdAt: user.createdAt || new Date().toISOString(),
    };

    // Compatibility layer: all legacy purchase code still deals in RUB base prices.
    // The persisted wallets themselves are independent balances in the four currencies.
    Object.defineProperty(normalized, "balance", {
      enumerable: true,
      configurable: true,
      get() {
        return currencyToRub(this.balances[this.currency] || 0, this.currency);
      },
      set(value) {
        this.balances[this.currency] = rubToCurrency(Number(value || 0), this.currency);
      },
    });

    return normalized;
  }

  getUsers() { return this.users; }

  findUserById(userId) { return this.users.find((user) => user.userId === Number(userId)); }

  getBalance(userId, currency = null) {
    const user = this.findUserById(userId);
    if (!user) return 0;
    const code = normalizeCurrency(currency || user.currency);
    return Number(user.balances?.[code] || 0);
  }

  getBalanceInBase(userId) {
    const user = this.findUserById(userId);
    return user ? Number(user.balance || 0) : 0;
  }

  getAllBalances(userId) {
    const user = this.findUserById(userId);
    if (!user) return { USD: 0, RUB: 0, YER: 0, SAR: 0 };
    return Object.fromEntries(CURRENCY_CODES.map((code) => [code, this.getBalance(userId, code)]));
  }

  createUser(telegramUser, invitedBy = null) {
    const user = this.normalizeUser({
      userId: telegramUser.id,
      username: telegramUser.username || "",
      firstName: telegramUser.first_name || "",
      invitedBy,
    });
    this.users.push(user);
    this.persistAll();
    return user;
  }

  getOrCreateUser(telegramUser, options = {}) {
    const invitedBy = options.invitedBy ? Number(options.invitedBy) : null;
    const existing = this.findUserById(telegramUser.id);
    if (existing) {
      const username = telegramUser.username || existing.username;
      const firstName = telegramUser.first_name || existing.firstName;
      const referral = existing.invitedBy || invitedBy || null;
      const lastSeen = Date.parse(existing.lastSeenAt || 0);
      if (existing.username === username && existing.firstName === firstName && existing.invitedBy === referral &&
          existing.isActive && Date.now() - lastSeen < 5 * 60 * 1000) return existing;
      return this.updateUser(existing.userId, { username, firstName, invitedBy: referral, lastSeenAt: new Date().toISOString(), isActive: true });
    }
    return this.createUser(telegramUser, invitedBy);
  }

  updateUser(userId, updates) {
    const index = this.users.findIndex((user) => user.userId === Number(userId));
    if (index === -1) return null;
    this.users[index] = this.normalizeUser({ ...this.users[index], ...updates });
    this.persistAll();
    return this.users[index];
  }

  setCurrency(userId, currency) {
    const user = this.findUserById(userId);
    if (!user) return null;
    const code = normalizeCurrency(currency);
    user.currency = code;
    if (!user.balances || typeof user.balances !== "object") user.balances = {};
    for (const c of CURRENCY_CODES) user.balances[c] = Number(user.balances[c] || 0);
    this.persistAll();
    return user;
  }

  addBalance(userId, amountRub) {
    const user = this.findUserById(userId);
    if (!user) return null;
    const base = Number(amountRub || 0);
    if (!Number.isFinite(base) || base <= 0) return null;
    return this.persistWalletMutation([user], () => {
      user.balances[user.currency] = Number((user.balances[user.currency] + rubToCurrency(base, user.currency)).toFixed(6));
      user.lastSeenAt = new Date().toISOString();
      return user;
    });
  }

  addBalanceInCurrency(userId, amount, currency) {
    const user = this.findUserById(userId);
    if (!user) return null;
    if (!CURRENCY_CODES.includes(currency)) return null;
    const code = normalizeCurrency(currency);
    const value = Number(amount);
    const next = Number(user.balances[code] || 0) + value;
    if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(next)) return null;
    return this.persistWalletMutation([user], () => {
      user.balances[code] = Number(Math.max(0, next).toFixed(6));
      user.lastSeenAt = new Date().toISOString();
      return user;
    });
  }

  deductBalance(userId, amountRub) {
    const user = this.findUserById(userId);
    if (!user) return null;
    const base = Number(amountRub || 0);
    const current = currencyToRub(user.balances[user.currency] || 0, user.currency);
    if (!Number.isFinite(base) || base <= 0 || current + 1e-8 < base) return null;
    return this.persistWalletMutation([user], () => {
      user.balances[user.currency] = Number(Math.max(0, rubToCurrency(current - base, user.currency)).toFixed(6));
      user.lastSeenAt = new Date().toISOString();
      return user;
    });
  }

  addUsdBalance(userId, amount) { return this.addBalanceInCurrency(userId, amount, "USD"); }
  deductUsdBalance(userId, amount) {
    const user = this.findUserById(userId);
    if (!user) return null;
    const current = Number(user.balances.USD || 0);
    if (!Number.isFinite(Number(amount)) || Number(amount) <= 0 || current + 1e-8 < Number(amount)) return null;
    user.balances.USD = Number(Math.max(0, current - Number(amount)).toFixed(6));
    this.persistAll();
    return user;
  }

  transferInCurrency(senderId, receiverId, amount, currency) {
    const sender = this.findUserById(senderId);
    const receiver = this.findUserById(receiverId);
    const value = Number(amount);
    if (!sender || !receiver || sender === receiver || !CURRENCY_CODES.includes(currency) ||
        !Number.isFinite(value) || value <= 0 || Number(value.toFixed(6)) <= 0 || Math.abs(value - Number(value.toFixed(6))) > 1e-12 ||
        this.getBalance(senderId, currency) + 1e-8 < value) return false;
    return this.commitTransfer(sender, receiver, value, value, currency, currency);
  }

  transferPreferred(senderId, receiverId, amountRub, from, to) {
    const sender = this.findUserById(senderId);
    const receiver = this.findUserById(receiverId);
    const base = Number(amountRub);
    if (!sender || !receiver || sender === receiver || !CURRENCY_CODES.includes(from) || !CURRENCY_CODES.includes(to) ||
        !Number.isFinite(base) || base <= 0) return false;
    const debit = rubToCurrency(base, from);
    const credit = Math.floor(rubToCurrency(base, to) * 1e6 + 1e-9) / 1e6;
    if (Number(debit.toFixed(6)) <= 0 || Math.abs(debit - Number(debit.toFixed(6))) > 1e-12 || credit <= 0 || this.getBalance(senderId, from) + 1e-8 < debit) return false;
    return this.commitTransfer(sender, receiver, Number(debit.toFixed(6)), credit, from, to);
  }

  commitTransfer(sender, receiver, debit, credit, from, to) {
    return this.persistWalletMutation([sender, receiver], () => {
      sender.balances[from] = Number((this.getBalance(sender.userId, from) - debit).toFixed(6));
      receiver.balances[to] = Number((this.getBalance(receiver.userId, to) + credit).toFixed(6));
      sender.transactionsCount += 1;
      receiver.transactionsCount += 1;
      this.transactions.push(
        this.transactionEntry({ type: "transfer_out", userId: sender.userId, targetUserId: receiver.userId, amount: debit, currency: from, targetCurrency: to, convertedAmount: credit, status: "completed" }),
        this.transactionEntry({ type: "transfer_in", userId: receiver.userId, sourceUserId: sender.userId, amount: credit, currency: to, sourceCurrency: from, sourceAmount: debit, status: "completed" })
      );
      return true;
    });
  }

  convertBalance(userId, amount, from, to) {
    const user = this.findUserById(userId);
    const value = Number(amount);
    if (!user || !canConvert(from, to) ||
        !Number.isFinite(value) || value <= 0 || Number(value.toFixed(6)) <= 0 || Math.abs(value - Number(value.toFixed(6))) > 1e-12 ||
        this.getBalance(userId, from) + 1e-8 < value) return null;
    const converted = Math.floor(convert(value, from, to) * 1e6 + 1e-9) / 1e6;
    if (!Number.isFinite(converted) || converted <= 0) return null;
    const originalFrom = this.getBalance(userId, from);
    const originalTo = this.getBalance(userId, to);
    user.balances[from] = Number((originalFrom - value).toFixed(6));
    user.balances[to] = Number((originalTo + converted).toFixed(6));
    const entry = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, createdAt: new Date().toISOString(), type: "currency_conversion", userId: user.userId, amount: value, currency: from, targetCurrency: to, convertedAmount: converted, status: "completed" };
    this.transactions.push(entry);
    try { this.persistAll(); }
    catch (error) {
      user.balances[from] = originalFrom;
      user.balances[to] = originalTo;
      this.transactions.pop();
      throw error;
    }
    return converted;
  }

  addDeposit(userId, amount) {
    const user = this.findUserById(userId);
    if (!user) return null;
    user.totalDeposits = Number((user.totalDeposits + Number(amount)).toFixed(2));
    this.persistAll();
    return user;
  }

  incrementTransactions(userId) {
    const user = this.findUserById(userId);
    if (!user) return null;
    user.transactionsCount += 1;
    this.persistAll();
    return user;
  }

  addTransaction(entry) {
    this.transactions.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, createdAt: new Date().toISOString(), ...entry });
    this.persistAll();
    return this.transactions[this.transactions.length - 1];
  }

  getRecentTransactionsForUser(userId, limit = 5) {
    return this.transactions.filter((tx) => Number(tx.userId) === Number(userId) || Number(tx.targetUserId) === Number(userId)).slice(-limit).reverse();
  }

  getLatestTransactionByActivationId(activationId) {
    return [...this.transactions].reverse().find((tx) => String(tx.activationId || "") === String(activationId || ""));
  }
  getTransactionById(transactionId) { return this.transactions.find((tx) => String(tx.id) === String(transactionId)) || null; }

  updateTransactionById(transactionId, updates = {}) {
    const index = this.transactions.findIndex((tx) => String(tx.id) === String(transactionId));
    if (index === -1) return null;
    this.transactions[index] = { ...this.transactions[index], ...updates };
    this.persistAll();
    return this.transactions[index];
  }

  markActivationNotified(activationId) {
    const index = [...this.transactions].map((tx, idx) => ({ tx, idx })).reverse().find((item) => String(item.tx.activationId || "") === String(activationId || ""))?.idx;
    if (index === undefined) return null;
    this.transactions[index] = { ...this.transactions[index], activationNotified: true };
    this.persistAll();
    return this.transactions[index];
  }

  getServices() { return this.config.services; }
  updateServicePrice(serviceKey, price) {
    if (!this.config.services[serviceKey]) return null;
    const amountRub = Number(price);
    if (!Number.isFinite(amountRub) || amountRub < 0) return null;
    this.config.services[serviceKey].price = amountRub;
    this.config.services[serviceKey].priceUsd = Number((amountRub / 30).toFixed(6));
    this.persistAll();
    return this.config.services[serviceKey];
  }
  toggleService(serviceKey) {
    if (!this.config.services[serviceKey]) return null;
    this.config.services[serviceKey].enabled = !this.config.services[serviceKey].enabled;
    this.persistAll();
    return this.config.services[serviceKey];
  }
  incrementRequestCount() {
    this.config.botStats.totalRequests += 1;
    if (!this.lastStatsPersistAt || Date.now() - this.lastStatsPersistAt > 30 * 1000) {
      this.lastStatsPersistAt = Date.now();
      this.persistAll();
    }
  }

  addProfit(amount) {
    const normalized = Number(amount || 0);
    const today = new Date().toISOString().slice(0, 10);
    if (this.config.botStats.todayDate !== today) { this.config.botStats.todayDate = today; this.config.botStats.todayProfits = 0; }
    this.config.botStats.totalProfits = Number((this.config.botStats.totalProfits + normalized).toFixed(2));
    this.config.botStats.todayProfits = Number((this.config.botStats.todayProfits + normalized).toFixed(2));
    this.persistAll();
  }

  getPublicStats() {
    return { totalUsers: this.users.length, totalTransactions: this.transactions.length, activeServices: Object.values(this.config.services).filter((service) => service.enabled).length };
  }

  getDetailedStats() {
    const usage = {};
    for (const tx of this.transactions) if (tx.serviceKey) usage[tx.serviceKey] = (usage[tx.serviceKey] || 0) + 1;
    const mostUsedServiceKey = Object.keys(usage).sort((a, b) => usage[b] - usage[a])[0] || null;
    return { totalUsers: this.users.length, totalRequests: this.config.botStats.totalRequests, mostUsedServiceKey };
  }

  getEarningsStats() { return { totalProfits: this.config.botStats.totalProfits, todayProfits: this.config.botStats.todayProfits, totalTransactions: this.transactions.length }; }

  redeemGiftCode(userId, rawCode) {
    const user = this.findUserById(userId);
    if (!user) return { ok: false, reason: "USER_NOT_FOUND" };
    const code = String(rawCode || "").trim().toUpperCase();
    if (!code) return { ok: false, reason: "INVALID_CODE" };
    const giftCodes = this.config.giftCodes || {};
    const gift = giftCodes[code];
    if (!gift || gift.active === false) return { ok: false, reason: "NOT_FOUND" };
    if (Array.isArray(user.redeemedGiftCodes) && user.redeemedGiftCodes.includes(code)) return { ok: false, reason: "ALREADY_REDEEMED" };
    const maxUses = Number(gift.maxUses || 0);
    const usedBy = Array.isArray(gift.usedBy) ? gift.usedBy : [];
    if (maxUses > 0 && usedBy.length >= maxUses) return { ok: false, reason: "EXHAUSTED" };
    const amount = Number(gift.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, reason: "INVALID_AMOUNT" };
    this.addBalance(userId, amount);
    user.redeemedGiftCodes = [...(user.redeemedGiftCodes || []), code];
    gift.usedBy = [...usedBy, Number(user.userId)];
    this.config.giftCodes = { ...giftCodes, [code]: gift };
    this.addTransaction({ type: "gift_code_redeem", userId: user.userId, amount, code, status: "completed", currency: user.currency });
    this.persistAll();
    return { ok: true, amount, code };
  }

  getTemporaryEmailAccounts(sku) {
    const rows = (this.config.temporaryEmailInventory || {})[sku];
    return Array.isArray(rows) ? rows : [];
  }
  addTemporaryEmailAccount(sku, email, password, addedBy = null) {
    const inventory = this.config.temporaryEmailInventory || {};
    const rows = Array.isArray(inventory[sku]) ? inventory[sku] : [];
    const account = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`, email: String(email || "").trim(), password: String(password || "").trim(), addedBy: addedBy ? Number(addedBy) : null, createdAt: new Date().toISOString() };
    this.config.temporaryEmailInventory = { ...inventory, [sku]: [...rows, account] };
    this.persistAll();
    return account;
  }
  consumeTemporaryEmailAccount(sku, accountId) {
    const inventory = this.config.temporaryEmailInventory || {};
    const rows = Array.isArray(inventory[sku]) ? inventory[sku] : [];
    const index = rows.findIndex((row) => String(row.id) === String(accountId));
    if (index === -1) return null;
    const [selected] = rows.splice(index, 1);
    this.config.temporaryEmailInventory = { ...inventory, [sku]: rows };
    this.persistAll();
    return selected;
  }
}

module.exports = { AppStore };
