import { createInitialState, formatAED } from "./seed.js";
import { fingerprintPublicKey, verifySignature } from "./crypto.js";

const STORAGE_KEY = "harbor-bank-state-v1";
const clone = (value) => structuredClone(value);
const wait = () => new Promise((resolve) => setTimeout(resolve, 200 + Math.random() * 200));

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? { ...createInitialState(), ...JSON.parse(saved) } : createInitialState();
  } catch {
    return createInitialState();
  }
}

let state = loadState();

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function audit(time, text, kind) {
  state.audit.push({ id: `audit_${state.audit.length + 1}`, time, text, kind });
}

function apiError(status, code, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = details;
  return error;
}

function publicInvite(invite) {
  return {
    code: invite.code,
    deep_link: invite.deep_link,
    expires_at: invite.expires_at,
    expires_in: Math.max(0, Math.round((new Date(invite.expires_at).getTime() - Date.now()) / 1000)),
  };
}

function issueInvite() {
  const sequence = state.agent_card?.invite_sequence || 0;
  const code = sequence === 0 ? "BIND-7K2Q" : `BIND-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  return {
    code,
    deep_link: `harborbank://agent-card/bind?code=${code}`,
    expires_at: new Date(Date.now() + 600_000).toISOString(),
    used: false,
  };
}

function randomHex(bytes = 8) {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  return [...values].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function requireActiveCard(agentCardId) {
  const card = state.agent_card;
  if (!card || card.id !== agentCardId || card.status === "revoked") {
    throw apiError(403, "revoked", "This Agent Card has been revoked.");
  }
  if (new Date(card.mandate.valid_to).getTime() < Date.now()) {
    throw apiError(403, "expired", "This Agent Card has expired.");
  }
  if (card.status !== "active") throw apiError(409, "not_bound", "The Agent Card is awaiting its agent.");
  return card;
}

function issueChallenge(currentState, request) {
  const sequence = currentState.challenges.length + 1;
  const nonce = sequence === 1 ? "9c1e7a6b0d2f44aa" : randomHex();
  const challenge = {
    challenge_id: `chg_${String(sequence).padStart(2, "0")}`,
    nonce,
    canonical: `v1|${request.agent_card_id}|${nonce}|${request.amount}|${request.currency}|${request.merchant_id}|${request.cart.hash}|${request.user_request}`,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    used: false,
    request: clone(request),
  };
  currentState.challenges.push(challenge);
  return {
    challenge_id: challenge.challenge_id,
    nonce: challenge.nonce,
    canonical: challenge.canonical,
    expires_in: 60,
  };
}

export function assessCart(mandate, cart) {
  const names = cart.items.map((item) => item.name.toLowerCase()).join(" ");
  const forbidden = ["soundbar", "gift card", "giftcard"];
  const hit = forbidden.filter((word) => names.includes(word));
  if (cart.total > mandate.max_amount) hit.push("over_cap");
  if (hit.length) return { match: false, reasons: hit };
  return { match: true, reasons: [] };
}

export function getState() {
  return clone(state);
}

export async function createAgentCard(request) {
  await wait();
  if (!request.sca_assertion) throw apiError(401, "sca_required", "Face ID or document verification is required.");
  if (state.agent_card) throw apiError(409, "card_exists", "An Agent Card already exists for this debit card.");
  const mandate = clone(request.mandate);
  mandate.remaining_amount = mandate.max_amount;
  mandate.transactions_used = 0;
  mandate.mcc_allowlist = ["5722"];
  const invite = issueInvite();
  state.agent_card = {
    id: "AC-1842",
    card_id: request.card_id,
    agent_id: request.agent_id,
    agent_name: request.agent_name,
    public_key_jwk: {},
    fingerprint: "",
    status: "awaiting_agent",
    invite,
    invite_sequence: 1,
    mandate,
    created_at: "2026-11-21T14:58:00+04:00",
    revoked_at: null,
  };
  audit("14:58", "Agent Card created, Face ID, mandate hashed, status awaiting agent", "create");
  audit("14:58", `Invite ${invite.code} issued, 10 minutes`, "invite");
  saveState();
  return {
    id: state.agent_card.id,
    status: state.agent_card.status,
    invite: publicInvite(invite),
    created_at: state.agent_card.created_at,
  };
}

export async function regenerateInvite(cardId) {
  await wait();
  const card = state.agent_card;
  if (!card || card.id !== cardId) throw apiError(404, "not_found", "Agent Card not found.");
  if (card.status !== "awaiting_agent") throw apiError(409, "already_bound", "This card can no longer issue an invite.");
  card.invite = issueInvite();
  card.invite_sequence += 1;
  audit("14:58", `Invite ${card.invite.code} issued, 10 minutes`, "invite");
  saveState();
  return publicInvite(card.invite);
}

export async function bindAgentCard(cardId, request) {
  await wait();
  const card = state.agent_card;
  if (!card || card.id !== cardId) throw apiError(404, "not_found", "Agent Card not found.");
  if (card.status === "active") throw apiError(409, "already_bound", "This Agent Card is already bound.");
  if (card.status === "revoked") throw apiError(409, "already_bound", "A revoked Agent Card cannot be bound.");
  if (
    request.code !== card.invite.code ||
    card.invite.used ||
    new Date(card.invite.expires_at).getTime() <= Date.now()
  ) {
    throw apiError(401, "invalid_invite", "This invite is wrong, already used, or expired.");
  }
  if (request.agent_id !== card.agent_id) throw apiError(409, "agent_mismatch", "This invite belongs to another agent.");
  card.invite.used = true;
  card.public_key_jwk = clone(request.public_key_jwk);
  card.fingerprint = await fingerprintPublicKey(request.public_key_jwk);
  card.status = "active";
  audit("14:59", `${card.agent_name} bound, public key registered, card active`, "bind");
  saveState();
  return { id: card.id, status: card.status, fingerprint: card.fingerprint, agent_name: card.agent_name };
}

export async function paymentChallenge(request) {
  await wait();
  requireActiveCard(request.agent_card_id);
  const merchant = state.merchants.find((item) => item.id === request.merchant_id);
  if (!merchant) throw apiError(404, "merchant_not_found", "Merchant not found.");
  if (state.blocklist.includes(merchant.id)) {
    throw apiError(403, "merchant_blocked", "This shop is on the shared blocklist. No payment token was issued.");
  }
  if (!merchant.verified) {
    const pending = {
      pending_id: `pend_${String(state.pending_payments.length + 1).padStart(2, "0")}`,
      status: "paused_unverified_merchant",
      agent_card_id: request.agent_card_id,
      merchant_id: merchant.id,
      amount: request.amount,
      currency: request.currency,
      risk_score: merchant.risk_score,
      suggested_match: merchant.suggested_match
        ? { id: merchant.suggested_match, display_name: state.merchants.find((item) => item.id === merchant.suggested_match)?.display_name }
        : null,
      user_request: request.user_request,
      cart: clone(request.cart),
      mcc: request.mcc,
    };
    state.pending_payments.push(pending);
    audit("15:06", `${merchant.id} ${formatAED(request.amount)} — paused, unverified merchant`, "pause");
    saveState();
    return clone(pending);
  }
  return issueChallenge(state, request);
}

export async function authorizePayment(request) {
  await wait();
  const card = requireActiveCard(request.agent_card_id);
  const challenge = state.challenges.find((item) => item.challenge_id === request.challenge_id);
  if (!challenge) throw apiError(404, "challenge_not_found", "This payment challenge is unknown.");
  if (challenge.used) throw apiError(409, "nonce_replayed", "This challenge has already been used.");
  if (new Date(challenge.expires_at).getTime() <= Date.now()) {
    throw apiError(401, "challenge_expired", "This payment challenge has expired.");
  }
  const original = challenge.request;
  if (
    request.amount !== original.amount ||
    request.currency !== original.currency ||
    request.merchant_id !== original.merchant_id ||
    request.user_request !== original.user_request ||
    request.cart.hash !== original.cart.hash
  ) {
    throw apiError(409, "challenge_mismatch", "The authorisation does not match its challenge.");
  }
  const verified = await verifySignature(card.public_key_jwk, challenge.canonical, request.signature_b64);
  if (!verified) throw apiError(401, "invalid_signature", "Signature verification failed. No payment was made.");

  const merchant = state.merchants.find((item) => item.id === request.merchant_id);
  const reasons = [];
  if (request.amount > card.mandate.remaining_amount) reasons.push("over_remaining");
  if (card.mandate.transactions_used >= card.mandate.max_transactions) reasons.push("transaction_cap");
  if (card.mandate.merchant_allowlist.length && !card.mandate.merchant_allowlist.includes(request.merchant_id)) {
    reasons.push("merchant_not_allowed");
  }
  if (card.mandate.mcc_allowlist.length && !card.mandate.mcc_allowlist.includes(original.mcc)) {
    reasons.push("mcc_not_allowed");
  }
  const cartAssessment = assessCart(card.mandate, request.cart);
  reasons.push(...cartAssessment.reasons);
  if (reasons.length) {
    throw apiError(403, "mandate_divergence", "This basket does not match the mandate.", {
      reasons: [...new Set(reasons)],
      mandate: clone(card.mandate),
      cart: clone(request.cart),
      step_up_available: true,
    });
  }

  challenge.used = true;
  card.mandate.remaining_amount -= request.amount;
  card.mandate.transactions_used += 1;
  const payment = {
    payment_id: `pay_${String(state.payments.filter((item) => item.status === "authorised").length + 1).padStart(2, "0")}`,
    status: "authorised",
    network_token_hint: "tok_one_time_••9172",
    agent_card_id: card.id,
    agent_name: card.agent_name,
    merchant_id: merchant.id,
    merchant_name: merchant.display_name,
    amount: request.amount,
    currency: request.currency,
    remaining_amount: card.mandate.remaining_amount,
    challenge_id: challenge.challenge_id,
    signature_b64: request.signature_b64,
    canonical: challenge.canonical,
    cart: clone(request.cart),
    authorised_at: "2026-11-21T15:09:00+04:00",
    receipt: {
      fingerprint: card.fingerprint,
      nonce: challenge.nonce,
      mandate_match: true,
      legal_name: merchant.legal_name,
      user_request: request.user_request,
      dispute_window_days: 120,
    },
  };
  state.payments.push(payment);
  audit(
    "15:09",
    `${formatAED(request.amount)} ${merchant.display_name} (${merchant.legal_name}) — signed, matched, authorised · request attached: “${request.user_request}”`,
    "authorise",
  );
  saveState();
  return clone(payment);
}

export async function merchantDecision(cardId, request) {
  await wait();
  requireActiveCard(cardId);
  const pending = state.pending_payments.find((item) => item.pending_id === request.pending_id);
  if (!pending || pending.status !== "paused_unverified_merchant") {
    throw apiError(404, "pending_not_found", "This paused payment is no longer available.");
  }
  if (request.customer_id !== state.customer.id) throw apiError(403, "customer_mismatch", "Customer mismatch.");
  const merchant = state.merchants.find((item) => item.id === pending.merchant_id);

  if (request.decision === "decline") {
    merchant.risk_score += 15;
    pending.risk_score = merchant.risk_score;
    pending.status = "declined_by_customer";
    let blocklistAdded = false;
    if (merchant.risk_score >= 90 && !state.blocklist.includes(merchant.id)) {
      state.blocklist.push(merchant.id);
      blocklistAdded = true;
    }
    state.payments.push({
      payment_id: `declined_${state.pending_payments.length}`,
      status: "declined_by_customer",
      merchant_id: merchant.id,
      merchant_name: merchant.display_name,
      amount: pending.amount,
      currency: pending.currency,
      user_request: pending.user_request,
      declined_at: "2026-11-21T15:06:00+04:00",
    });
    audit("15:06", `${merchant.id} ${formatAED(pending.amount)} — declined by customer`, "decision");
    if (blocklistAdded) audit("15:06", `${merchant.id} — added to shared blocklist`, "block");
    saveState();
    return {
      pending_id: pending.pending_id,
      status: pending.status,
      merchant_id: merchant.id,
      risk_score: merchant.risk_score,
      blocklist_added: blocklistAdded,
      blocklist_line: blocklistAdded
        ? "Added to the shared blocklist. Automatically blocked for all agents and Harbor customers."
        : "",
    };
  }

  if (request.decision === "pay") {
    pending.status = "approved_by_customer";
    audit("15:06", `${merchant.id} ${formatAED(pending.amount)} — approved by customer`, "decision");
    const challenge = issueChallenge(state, {
      agent_card_id: cardId,
      amount: pending.amount,
      currency: pending.currency,
      merchant_id: pending.merchant_id,
      mcc: pending.mcc,
      user_request: pending.user_request,
      cart: pending.cart,
    });
    saveState();
    return challenge;
  }
  throw apiError(400, "invalid_decision", "Decision must be pay or decline.");
}

export async function revokeAgentCard(cardId, request = {}) {
  await wait();
  const card = state.agent_card;
  if (!card || card.id !== cardId) throw apiError(404, "not_found", "Agent Card not found.");
  if (card.status === "revoked") return { id: card.id, status: card.status, revoked_at: card.revoked_at };
  card.status = "revoked";
  card.revoked_at = "2026-11-21T15:12:00+04:00";
  card.revoke_reason = request.reason || "customer_revoked";
  audit("15:12", "Revoked by customer", "revoke");
  saveState();
  return { id: card.id, status: card.status, revoked_at: card.revoked_at };
}

export function resetBank() {
  localStorage.removeItem(STORAGE_KEY);
  state = createInitialState();
}

export const BankAPI = {
  createAgentCard,
  regenerateInvite,
  bindAgentCard,
  paymentChallenge,
  authorizePayment,
  merchantDecision,
  revokeAgentCard,
};
