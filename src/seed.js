export const CUSTOMER = { id: "cus_01", name: "Maxim S.", device: "iPhone" };
export const DEBIT_CARD = {
  id: "card_4410",
  last4: "4410",
  scheme: "Visa",
  label: "Visa Debit",
  holder: "MAXIM S.",
};

export const AGENTS = [
  { id: "grok-bot", name: "Grok Bot", initials: "GB", subtitle: "Default. Pays with Vault, X Money, Shop Pay or Link." },
  { id: "dots", name: "Dots", initials: "DT", subtitle: "ChatGPT Wallet. Approves each purchase with Face ID." },
  { id: "muse", name: "Muse", initials: "MU", subtitle: "Meta’s agent. Pays with Link, Shop Pay or a saved card." },
  { id: "hermes", name: "Hermes", initials: "HE", subtitle: "Nous Research agent. Can pay via Stripe skills." },
  { id: "perplexity", name: "Perplexity", initials: "PX", subtitle: "Instant Buy in chat, via PayPal (US)." },
  { id: "buy-for-me", name: "Buy for Me", initials: "BF", subtitle: "Amazon’s agent. Buys on brand sites after you confirm." },
  { id: "gemini", name: "Gemini", initials: "GM", subtitle: "Universal Cart in the US. Checkout with Google Pay." },
];

export const DEFAULT_REQUEST = "Buy me a Samsung 55-inch TV, under 2,000 dirhams.";
export const DEFAULT_BRIEF = "Samsung TV, 55-inch or smaller, under AED 2,000. Do not buy soundbars, cables, or gift cards.";

export const MERCHANTS = [
  {
    id: "electrohub.ae",
    display_name: "ElectroHub",
    legal_name: "EHUB TRADING LLC DXB",
    verified: true,
    risk_score: 12,
    mcc: "5722",
  },
  {
    id: "electrohub-pay.com",
    display_name: "electrohub-pay.com",
    legal_name: "EHUB PAY LTD",
    verified: false,
    risk_score: 81,
    suggested_match: "electrohub.ae",
    mcc: "5722",
  },
];

export const HAPPY_CART = {
  items: [{ sku: "CU8000", name: "Samsung 55\" CU8000", amount: 1790 }],
  total: 1790,
  hash: "sha256-cart-happy",
};

export const UNKNOWN_CART = {
  items: [{ sku: "CU8000", name: "Samsung 55\" CU8000", amount: 1790 }],
  total: 1790,
  hash: "sha256-cart-unknown",
};

export function defaultMandate() {
  return {
    brief: DEFAULT_BRIEF,
    currency: "AED",
    max_amount: 2000,
    remaining_amount: 2000,
    max_transactions: 2,
    transactions_used: 0,
    merchant_allowlist: ["electrohub.ae"],
    mcc_allowlist: ["5722"],
    valid_days: 7,
    valid_to: "2026-11-28T23:59:59+04:00",
    divergence_policy: "step_up",
  };
}

export function createInitialState() {
  return {
    customer: { ...CUSTOMER },
    card: { ...DEBIT_CARD },
    agent_card: null,
    merchants: MERCHANTS.map((merchant) => ({ ...merchant })),
    blocklist: [],
    payments: [],
    pending_payments: [],
    challenges: [],
    audit: [],
  };
}

export function agentById(id) {
  return AGENTS.find((agent) => agent.id === id) || AGENTS[0];
}

export function formatAED(amount) {
  return `AED ${Number(amount).toLocaleString("en-US")}`;
}
