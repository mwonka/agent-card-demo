import {
  AGENTS,
  DEFAULT_REQUEST,
  HAPPY_CART,
  UNKNOWN_CART,
  agentById,
  defaultMandate,
  formatAED,
} from "./seed.js";
import {
  authorizePayment,
  bindAgentCard,
  createAgentCard,
  getState,
  merchantDecision,
  paymentChallenge,
  resetBank,
  revokeAgentCard,
} from "./bank.js";
import {
  clearAgentKeys,
  generateAgentKey,
  shortFingerprint,
  signWithAgentKey,
  tamperSignature,
} from "./crypto.js";

const phone = document.querySelector("#phone");
const view = document.querySelector("#app-view");
const overlayRoot = document.querySelector("#overlay-root");
const liveRegion = document.querySelector("#live-region");
const toastRoot = document.createElement("div");
toastRoot.id = "toast-root";
phone.insertBefore(toastRoot, overlayRoot);

const initialUi = () => ({
  app: "bank",
  screen: "home",
  selectedAgentId: "grok-bot",
  scaAssertion: null,
  mandate: { ...defaultMandate(), max_transactions: 5 },
  keyDraft: null,
  busy: false,
  documentType: "Emirates ID",
  documentAccepted: false,
  toast: null,
  autoplay: false,
  detailsUnlocked: false,
  userRequest: DEFAULT_REQUEST,
});

let ui = initialUi();
let toastTimer;
let activeFace = null;
let overlayDismiss = null;
let overlayReturnFocus = null;

const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "'": "&#39;",
  '"': "&quot;",
}[character]));
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function icon(name, size = 20) {
  const paths = {
    back: '<path d="m15 18-6-6 6-6"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    card: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18"/>',
    wallet: '<path d="M4 6h14a2 2 0 0 1 2 2v10H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h12"/><path d="M15 11h7v5h-7a2.5 2.5 0 0 1 0-5Z"/>',
    agent: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9m-3 3 3 3m-6 0 3 3"/>',
    shield: '<path d="M12 3 4 6v6c0 5 3.4 8.2 8 9 4.6-.8 8-4 8-9V6l-8-3Z"/><path d="m9 12 2 2 4-4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    send: '<path d="m5 12 14-7-4 14-3-6-7-1Z"/><path d="m12 13 7-8"/>',
    upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.info}</svg>`;
}

function currentAgent() {
  const card = getState().agent_card;
  return agentById(card?.agent_id || ui.selectedAgentId);
}

function statusChip(status) {
  const label = status === "active" ? "Active" : status === "revoked" ? "Revoked" : "Awaiting agent";
  return `<span class="chip ${status === "awaiting_agent" ? "awaiting" : status}">${label}</span>`;
}

function bankHeader(title = "Harbor Bank", backAction = "") {
  return `<header class="bank-header">
    ${backAction
      ? `<button class="back-button" type="button" data-action="${backAction}" aria-label="Back">${icon("back")}<span class="back-label">Back</span></button>`
      : `<div class="bank-brand"><span class="hb-mark" aria-hidden="true">HB</span><span>${title}</span></div>`}
    ${backAction ? `<span class="caption">${title}</span>` : '<span class="caption">Visa Debit</span>'}
  </header>`;
}

function debitCard() {
  return `<div class="physical-card" aria-label="Visa Debit ending 4410">
    <div class="card-brand"><span>Harbor Bank</span><span class="agent-badge">DEBIT</span></div>
    <div class="card-pan">•• 4410</div>
    <div class="card-meta">Visa Debit · MAXIM S.</div>
  </div>`;
}

function agentCardVisual(card) {
  const agent = agentById(card.agent_id);
  const parts = (card.fingerprint || "").replace("SHA256:", "").split(":").filter(Boolean);
  const fingerprint = parts.length ? `${parts.slice(0, 4).join(":").toUpperCase()} ·· ${parts.slice(4, 6).join(":").toUpperCase()}` : "PUBLIC KEY PENDING";
  return `<div class="agent-card-wrap">
    <div class="physical-card agent-card-visual" aria-label="Agent Card ${card.id}">
      <div class="card-brand"><span>Harbor Bank</span><span class="card-agent-brand"><span class="agent-avatar agent-${agent.id}">${agent.initials}</span><span>Agent Card</span></span></div>
      <div class="card-key-row"><span class="card-key-icon">${icon("key", 24)}</span><span class="card-fingerprint">${fingerprint}</span></div>
      <div class="card-bottom"><span>${escapeHtml(card.agent_name)}</span><span class="card-limit">${formatAED(card.mandate.max_amount)}<small>${card.mandate.valid_days === 0 ? "Until revoked" : "Expires 28 Nov 2026"}</small></span></div>
    </div>
    <p class="caption card-caption">Public key · private key never leaves ${escapeHtml(card.agent_name)}</p>
    <p class="caption card-funded">Funded by Visa Debit •• 4410</p>
  </div>`;
}

function agentCardRow(card, action = "show-card") {
  return `<button class="list-row" type="button" data-action="${action}">
    <span class="agent-avatar agent-${currentAgent().id}">${currentAgent().initials}</span>
    <span class="row-copy"><span class="row-title">${escapeHtml(card.agent_name)} · ${card.id}</span><span class="row-subtitle">Visa Debit •• 4410</span></span>
    <span class="row-trailing">${statusChip(card.status)}${icon("chevron", 18)}</span>
  </button>`;
}

function renderHome() {
  const state = getState();
  const card = state.agent_card;
  const activeCount = card?.status === "active" ? 1 : 0;
  return `<section class="screen">
    <div class="screen-scroll">
      ${bankHeader()}
      <div class="stack-large">
        <div><h1 class="large-title">Cards</h1></div>
        ${card ? agentCardVisual(card) : debitCard()}
        <button class="wallet-button" type="button" data-action="add-wallet">${icon("wallet", 22)}<span>Add to Apple Wallet</span></button>
        <div class="group" aria-label="Debit card options">
          <div class="list-row static-row"><span class="row-icon">${icon("card")}</span><span class="row-copy"><span class="row-title">Card details</span><span class="row-subtitle">Visa Debit •• 4410</span></span></div>
          <button class="list-row" type="button" data-action="agent-cards">
            <span class="avatar-stack">${card ? `<span class="agent-avatar agent-${card.agent_id}">${currentAgent().initials}</span>` : `<span class="agent-avatar agent-${currentAgent().id}">${icon("plus", 18)}</span>`}</span>
            <span class="row-copy"><span class="row-title">Agent Cards</span><span class="row-subtitle">${activeCount} active · Let an AI agent pay without your password</span></span>
            <span class="row-trailing">${icon("chevron", 18)}</span>
          </button>
        </div>
        ${card ? `<div><p class="section-title">Agent Cards</p><div class="group">${agentCardRow(card)}</div></div>` : ""}
      </div>
    </div>
  </section>`;
}

function renderAgentCards() {
  const card = getState().agent_card;
  if (card) {
    return `<section class="screen">
      <div class="screen-scroll">
        ${bankHeader("Agent Cards", "home")}
        <div class="stack-large">
          <div><h1 class="large-title">Agent Cards</h1><p class="hero-copy">Temporary keys, locked to rules you set.</p></div>
          <div class="group">${agentCardRow(card)}</div>
          <p class="helper">Your password and your real card number never leave the bank.</p>
        </div>
      </div>
    </section>`;
  }
  return `<section class="screen">
    <div class="screen-scroll">
      ${bankHeader("Agent Cards", "home")}
      <div class="empty-state stack-large">
        <h1 class="title">Give an agent a card, not your login.</h1>
        <p class="body">An Agent Card is a temporary key, locked to this card and to rules you set. You can revoke it in one tap. Your password and your real card number never leave the bank.</p>
      </div>
    </div>
    <div class="bottom-action stack-small">
      <button class="btn" type="button" data-action="create-card">Create Agent Card</button>
      <button class="text-button" type="button" data-action="start-agent-path">Connect from an agent instead</button>
    </div>
  </section>`;
}

function renderCreate() {
  return `<section class="screen">
    <div class="screen-scroll">
      ${bankHeader("Create Agent Card", "agent-cards")}
      <div class="stack-large">
        <div><h1 class="large-title">Create Agent Card</h1><p class="hero-copy">On Visa Debit •• 4410</p></div>
        <div class="info-block stack-small"><p class="body">This is a card for your agent, not a copy of your card.</p><p class="body muted">Choose an agent to continue with Face ID.</p></div>
        <div><p class="section-title">Example agents</p><div class="agent-grid">${AGENTS.map((agent) => `<button class="agent-choice" type="button" data-action="select-agent" data-agent-id="${agent.id}" aria-pressed="${agent.id === ui.selectedAgentId}">
          <span class="agent-avatar large agent-${agent.id}">${agent.initials}</span><span class="agent-choice-name">${agent.name}</span><span class="agent-choice-subtitle">${agent.subtitle}</span>
        </button>`).join("")}</div></div>
      </div>
    </div>
    <div class="bottom-action stack-small"><button class="btn" type="button" data-action="create-face-id">Continue with Face ID</button></div>
  </section>`;
}

function mandateFields(compact = false) {
  const paymentOptions = [[1, "1"], [5, "5"], [20, "20"], [999999, "Unlimited"]];
  const validOptions = [[1, "24h"], [7, "7 days"], [30, "30 days"], [365, "1 year"], [0, "Until revoked"]];
  return `<div class="stack-large">
    <label class="field"><span class="field-label">Max amount</span><span class="amount-field"><span class="currency-prefix">AED</span><input class="input amount-input" data-field="max_amount" type="number" min="1" step="1" value="${ui.mandate.max_amount}" inputmode="decimal"></span></label>
    <div class="field"><span class="field-label">Max payments</span><div class="segmented">${paymentOptions.map(([value, label]) => `<button type="button" data-action="set-max-payments" data-value="${value}" aria-pressed="${ui.mandate.max_transactions === value}">${label}</button>`).join("")}</div></div>
    <div class="field"><span class="field-label">Valid for</span><div class="segmented segmented-wrap">${validOptions.map(([value, label]) => `<button type="button" data-action="set-valid" data-value="${value}" aria-pressed="${ui.mandate.valid_days === value}">${label}</button>`).join("")}</div></div>
    <div class="group">
      <div class="list-row static-row"><span class="row-copy"><span class="row-title">Trusted merchants only</span><span class="row-subtitle">Electronics retailers on the bank’s trusted list</span></span><button class="toggle" type="button" role="switch" aria-checked="${ui.mandate.merchant_allowlist.length > 0}" aria-label="Trusted merchants only" data-action="toggle-trusted"></button></div>
      <div class="list-row static-row"><span class="row-copy"><span class="row-title">If basket doesn’t match</span><span class="row-subtitle">Pause and ask me</span></span><span class="row-trailing">${icon("shield")}</span></div>
    </div>
    ${compact ? "" : '<p class="helper">The agent can only spend inside these rules. Each purchase request is attached to its receipt.</p>'}
  </div>`;
}

function renderMandate(agentStarted = false) {
  const agent = currentAgent();
  return `<section class="screen">
    <div class="screen-scroll">
      ${bankHeader(agentStarted ? "Agent request" : "Set the mandate", agentStarted ? "cancel-agent-request" : "create")}
      <div class="stack-large">
        <div><h1 class="large-title">${agentStarted ? `${agent.name} wants an Agent Card` : "Set the mandate"}</h1>${agentStarted ? `<p class="hero-copy mono">${shortFingerprint(ui.keyDraft?.fingerprint, 4, 2)}</p>` : ""}</div>
        ${mandateFields(agentStarted)}
      </div>
    </div>
    <div class="bottom-action">
      <button class="btn" type="button" data-action="${agentStarted ? "agent-request-face-id" : "submit-mandate"}" ${ui.busy ? "disabled" : ""}>${ui.busy ? "Creating…" : agentStarted ? "Continue with Face ID" : "Create Agent Card"}</button>
    </div>
  </section>`;
}

function renderPairing() {
  const card = getState().agent_card;
  const agent = currentAgent();
  return `<section class="screen">
    <div class="screen-scroll">
      ${bankHeader("Connect agent", "agent-cards")}
      <div class="stack-large">
        <div class="stack-small"><h1 class="large-title">Connect ${agent.name}</h1>${statusChip(card.status)}</div>
        <div class="invite-code">${card.invite.code}</div>
        <p class="caption">One-time link, expires in 10 minutes</p>
        <p class="body muted">We’ll open the agent on this phone and pass a one-time invite. The agent creates its own key. The private key stays in the agent. Harbor Bank only stores the public key.</p>
      </div>
    </div>
    <div class="bottom-action"><button class="btn" type="button" data-action="open-agent">Open ${agent.name}</button></div>
  </section>`;
}

function renderPairSuccess() {
  const card = getState().agent_card;
  return `<section class="screen">
    <div class="screen-scroll">
      ${bankHeader("Agent Card")}
      <div class="stack-large">
        <div class="success-icon">${icon("check", 30)}</div>
        <div><h1 class="title">Agent Card ${card.id} is live</h1><p class="hero-copy">Visa Debit •• 4410 · ${escapeHtml(card.agent_name)}</p></div>
        ${agentCardVisual(card)}
        <div class="info-block"><p class="row-title">Up to ${formatAED(card.mandate.max_amount)} · ${card.mandate.max_transactions} payments · expires 28 Nov 2026</p></div>
      </div>
    </div>
    <div class="bottom-action"><button class="btn" type="button" data-action="done-pairing">Done</button></div>
  </section>`;
}

function agentHeader(subtitle = "Not connected to Harbor Bank") {
  const agent = currentAgent();
  return `<header class="agent-header"><span class="agent-avatar agent-${currentAgent().id}">${agent.initials}</span><div class="agent-header-copy"><div class="agent-header-title">${agent.name}</div><div class="connection-line">${subtitle}</div></div></header>`;
}

function renderAgentStart() {
  const agent = currentAgent();
  return `<section class="screen agent-screen">
    ${agentHeader()}
    <div class="screen-scroll"><div class="chat">
      <div class="message system">You can start from the bank or from the agent. Same keys, same limits.</div>
      ${ui.busy ? '<div class="message agent">Generating key…</div>' : ""}
      ${ui.keyDraft ? `<div class="message agent">Public key ready. Fingerprint:<br><span class="mono">${shortFingerprint(ui.keyDraft.fingerprint)}</span><br>The private key never leaves this agent.</div>` : ""}
    </div></div>
    <div class="bottom-action"><button class="btn" type="button" data-action="connect-from-agent" ${ui.busy ? "disabled" : ""}>${ui.busy ? "Generating key…" : "Connect to Harbor Bank"}</button></div>
  </section>`;
}

function renderAgentPair() {
  const card = getState().agent_card;
  const agent = currentAgent();
  return `<section class="screen agent-screen">
    ${agentHeader("Harbor Bank invite · AC-1842")}
    <div class="screen-scroll"><div class="chat">
      <div class="message system">Harbor Bank wants to issue you an Agent Card.<br>Invite <span class="mono">${card.invite.code}</span> · expires in 10 minutes.</div>
      ${ui.busy ? '<div class="message agent">Generating key…</div>' : ""}
      ${!ui.keyDraft && !ui.busy ? `<button class="btn secondary chat-action" type="button" data-action="generate-key">Create my key and connect</button>` : ""}
      ${ui.keyDraft ? `<div class="message agent">Public key ready. Fingerprint:<br><span class="mono">${shortFingerprint(ui.keyDraft.fingerprint, 4, 2)}</span><br><span class="mono">Algorithm: ECDSA P-256 (stand-in for Ed25519 in production)</span><br>The private key never leaves this agent.</div>` : ""}
    </div></div>
    ${ui.keyDraft ? `<div class="bottom-action"><button class="btn" type="button" data-action="send-public-key" ${ui.busy ? "disabled" : ""}>${ui.busy ? "Connecting…" : "Send public key to Harbor Bank"}</button></div>` : ""}
  </section>`;
}

function renderAgentConnected() {
  const agent = currentAgent();
  return `<section class="screen agent-screen">
    ${agentHeader("Connected to Harbor Bank · AC-1842")}
    <div class="screen-scroll"><div class="chat">
      <div class="message system">You can start from the bank or from the agent. Same keys, same limits.</div>
      <div class="message agent"><span class="chip success">${icon("check", 14)} Connected to Harbor Bank · AC-1842</span></div>
      <div class="message agent">Your public key is registered. The private key never leaves this agent.</div>
    </div></div>
    <div class="bottom-action"><button class="btn" type="button" data-action="done-agent-connect">Done</button></div>
  </section>`;
}

function renderPaymentChat() {
  const agent = currentAgent();
  const card = getState().agent_card;
  const stage = ui.paymentStage || "idle";
  const laterMessages = [];
  if (["unknown-offer", "declined", "blocked"].includes(stage) || ui.hasDeclined) {
    laterMessages.push(`<div class="message agent"><span class="message-label">${agent.name}</span>I can check out at electrohub-pay.com for <strong>AED 1,790</strong>.</div>`);
  }
  if (stage === "declined" || ui.hasDeclined) {
    laterMessages.push(`<div class="message system">Payment declined. Your real card was not charged.<br>electrohub-pay.com risk score updated.<br><strong>Added to the shared blocklist. Automatically blocked for all agents and Harbor customers.</strong></div>`);
  }
  if (stage === "blocked") {
    laterMessages.push(`<div class="message agent"><span class="message-label">${agent.name}</span>This shop is on the shared blocklist. No payment token was issued.</div>`);
  }
  if (["good-offer", "paid-good"].includes(stage)) {
    laterMessages.push(`<div class="message agent"><span class="message-label">${agent.name}</span>I found a Samsung 55&quot; CU8000 at ElectroHub for <strong>AED 1,790</strong>. It matches your Agent Card. Paying now.</div>`);
  }
  if (stage === "revoked") {
    laterMessages.push(`<div class="message agent"><span class="message-label">${agent.name}</span>This Agent Card has been revoked. Visa Debit •• 4410 is unchanged.</div>`);
  }
  return `<section class="screen agent-screen">
    ${agentHeader(card?.status === "active" ? "Connected to Harbor Bank · AC-1842" : "Agent Card AC-1842 · Revoked")}
    <div class="screen-scroll"><div class="chat">
      <div class="message user"><span class="message-label">You</span>${escapeHtml(ui.userRequest)}</div>
      <div class="message agent"><span class="message-label">${agent.name}</span>I’ll look for a match on your Agent Card.</div>
      ${laterMessages.join("")}
      ${ui.busy ? '<div class="message system">Checking with Harbor Bank…</div>' : ""}
    </div></div>
    <div class="bottom-action stack-small">
      <div class="button-pair">
        <button class="btn secondary small" type="button" data-action="try-unknown" ${ui.busy ? "disabled" : ""}>Try electrohub-pay.com</button>
        <button class="btn small" type="button" data-action="pay-good" ${ui.busy ? "disabled" : ""}>Pay ElectroHub</button>
      </div>
      <div class="composer"><span class="composer-plus" aria-hidden="true">${icon("plus")}</span><textarea class="composer-input" data-field="user-request" aria-label="Your request">${escapeHtml(ui.userRequest)}</textarea><button class="composer-send" type="button" data-action="send-request" aria-label="Send request">${icon("send", 18)}</button></div>
    </div>
  </section>`;
}

function renderReceipt() {
  const state = getState();
  const payment = ui.lastPayment || [...state.payments].reverse().find((item) => item.status === "authorised");
  if (!payment) return renderHome();
  const agent = agentById(state.agent_card.agent_id);
  const nonce = payment.receipt.nonce;
  return `<section class="screen">
    <div class="screen-scroll">
      ${bankHeader("Payment", "receipt-back")}
      <div class="receipt-hero">
        <div class="receipt-amount">${formatAED(payment.amount)}</div>
        <div class="receipt-merchant">${escapeHtml(payment.merchant_name)}</div>
        <p class="caption section-gap">Statement name: <strong>${escapeHtml(payment.receipt.legal_name)}</strong></p>
        <div class="inline section-gap" style="justify-content:center"><span class="chip success">Authorised</span><span class="caption">Agent Card AC-1842</span></div>
      </div>
      <div class="request-block">
        <div class="inline"><span class="agent-avatar agent-${currentAgent().id}">${agent.initials}</span><span class="row-title">You asked:</span></div>
        <p class="request-text">${escapeHtml(payment.receipt.user_request)}</p>
      </div>
      <div class="group section-gap">
        <div class="list-row static-row"><span class="row-copy"><span class="row-title">Signed by ${agent.name} key ${shortFingerprint(payment.receipt.fingerprint, 2, 1)}</span><span class="row-subtitle">Verified by Harbor Bank</span></span><span class="success">${icon("shield")}</span></div>
        <div class="list-row static-row"><span class="row-copy"><span class="row-title">Challenge nonce <span class="mono">${escapeHtml(nonce.slice(0, 4))}…</span> used once</span><span class="row-subtitle">Mandate match: yes</span></span></div>
        <div class="list-row static-row"><span class="row-copy"><span class="row-title">Remaining ${formatAED(payment.remaining_amount)}</span><span class="row-subtitle">${state.agent_card.mandate.max_transactions - state.agent_card.mandate.transactions_used} payment left</span></span></div>
      </div>
      <p class="body section-gap">You can dispute a completed agent payment for <strong>120 days</strong>.</p>
      <p class="fine section-gap">Mandate check: keyword + cap + merchant</p>
    </div>
  </section>`;
}

function renderCardDetails() {
  const state = getState();
  const card = state.agent_card;
  const paid = state.payments.filter((payment) => payment.status === "authorised").length;
  const declined = state.payments.filter((payment) => payment.status === "declined_by_customer").length;
  return `<section class="screen"><div class="screen-scroll">${bankHeader("Agent Card", "agent-cards")}<div class="stack-large">
    ${agentCardVisual(card)}
    <div class="row-between"><div><h1 class="title">Agent Card ${card.id}</h1><p class="hero-copy">Linked agent: ${escapeHtml(card.agent_name)}</p></div>${statusChip(card.status)}</div>
    <div class="group">
      <div class="list-row static-row"><span class="row-copy"><span class="row-title">Key fingerprint</span><span class="row-subtitle mono">${shortFingerprint(card.fingerprint, 4, 2)}</span></span></div>
      <div class="list-row static-row"><span class="row-copy"><span class="row-title">Limits</span><span class="row-subtitle">${formatAED(card.mandate.remaining_amount)} remaining · ${Math.max(0, card.mandate.max_transactions - card.mandate.transactions_used)} payments left · expires 28 Nov 2026</span></span></div>
      <div class="list-row static-row"><span class="row-copy"><span class="row-title">Payments</span><span class="row-subtitle">${paid} paid · ${declined} declined</span></span></div>
    </div>
    ${card.status !== "revoked" ? '<button class="btn destructive" type="button" data-action="revoke-card">Revoke Agent Card</button>' : '<div class="notice"><strong>AC-1842 revoked at 15:12.</strong><p class="caption">Visa Debit •• 4410 is unchanged.</p></div>'}
    <div><p class="section-title">Audit log</p><div class="group">${state.audit.map((item) => `<div class="list-row static-row audit-item"><span class="audit-time">${item.time}</span><span class="audit-copy">${escapeHtml(item.text)}</span></div>`).join("")}</div></div>
  </div></div></section>`;
}

function render() {
  const state = getState();
  let markup;
  if (ui.app === "agent") {
    if (ui.screen === "agent-pair") markup = renderAgentPair();
    else if (ui.screen === "agent-connected") markup = renderAgentConnected();
    else if (ui.screen === "payment") markup = renderPaymentChat();
    else markup = renderAgentStart();
  } else {
    if (ui.screen === "agent-cards") markup = renderAgentCards();
    else if (ui.screen === "create") markup = renderCreate();
    else if (ui.screen === "mandate") markup = renderMandate(false);
    else if (ui.screen === "agent-request") markup = renderMandate(true);
    else if (ui.screen === "pairing") markup = renderPairing();
    else if (ui.screen === "pair-success") markup = renderPairSuccess();
    else if (ui.screen === "receipt") markup = renderReceipt();
    else if (ui.screen === "card-details") markup = renderCardDetails();
    else markup = renderHome();
  }
  view.innerHTML = markup;
  document.querySelector("#status-time").textContent = state.audit.at(-1)?.time || "14:58";
  renderToast();
}

async function navigate(screen, app = ui.app) {
  const changedApp = app !== ui.app;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (changedApp && !reduceMotion) {
    const exit = view.animate(
      [{ opacity: 1, transform: "translateX(0)" }, { opacity: 0, transform: `translateX(${app === "agent" ? "-24px" : "24px"})` }],
      { duration: 160, easing: "ease-in", fill: "forwards" },
    );
    await exit.finished;
  }
  ui.screen = screen;
  ui.app = app;
  render();
  if (changedApp && !reduceMotion) {
    await view.animate(
      [{ opacity: 0, transform: `translateX(${app === "agent" ? "24px" : "-24px"})` }, { opacity: 1, transform: "translateX(0)" }],
      { duration: 220, easing: "ease-out", fill: "forwards" },
    ).finished;
  }
}

function renderToast() {
  if (!ui.toast) {
    toastRoot.innerHTML = "";
    return;
  }
  toastRoot.innerHTML = `<div class="toast-stack"><div class="toast" role="status">
    <span class="success-icon">${icon(ui.toast.kind === "error" ? "info" : "check", 24)}</span>
    <div class="toast-copy"><div class="toast-title">${escapeHtml(ui.toast.title)}</div>${ui.toast.body ? `<div class="toast-body">${escapeHtml(ui.toast.body)}</div>` : ""}</div>
    ${ui.toast.action ? `<button class="toast-action" type="button" data-action="${ui.toast.action}">${escapeHtml(ui.toast.actionLabel || "Open")}</button>` : ""}
  </div></div>`;
}

function showToast(title, body = "", options = {}) {
  clearTimeout(toastTimer);
  ui.toast = { title, body, ...options };
  renderToast();
  liveRegion.textContent = `${title} ${body}`;
  toastTimer = setTimeout(() => {
    ui.toast = null;
    renderToast();
  }, options.duration || 5000);
}

function closeOverlay() {
  if (activeFace) {
    clearTimeout(activeFace.scanTimer);
    clearTimeout(activeFace.doneTimer);
    activeFace.resolve(false);
    activeFace = null;
  }
  overlayRoot.innerHTML = "";
  document.removeEventListener("keydown", onOverlayKeydown);
  if (overlayDismiss) {
    const dismiss = overlayDismiss;
    overlayDismiss = null;
    dismiss();
  }
  overlayReturnFocus?.focus?.();
  overlayReturnFocus = null;
}

function onOverlayKeydown(event) {
  if (event.key === "Escape") closeOverlay();
}

function mountOverlay(markup, dismiss = null) {
  overlayReturnFocus = document.activeElement;
  overlayDismiss = dismiss;
  overlayRoot.innerHTML = markup;
  document.addEventListener("keydown", onOverlayKeydown);
  requestAnimationFrame(() => overlayRoot.querySelector("button")?.focus());
}

function faceGlyph() {
  return `<div class="face-glyph" aria-hidden="true">
    <span class="face-ring"><svg viewBox="0 0 88 88"><circle cx="44" cy="44" r="41"/></svg></span>
    <span class="face"><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 16V10a6 6 0 0 1 6-6h6M30 4h6a6 6 0 0 1 6 6v6M42 32v6a6 6 0 0 1-6 6h-6M18 44h-6a6 6 0 0 1-6-6v-6"/><path d="M18 20v3M30 20v3M18 31c3.2 3.2 8.8 3.2 12 0"/></svg></span>
    <span class="check"><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="24" cy="24" r="20"/><path d="M15 25l6 6 13-14"/></svg></span>
  </div>`;
}

function openFaceID(reason, successMessage) {
  closeOverlay();
  return new Promise((resolve) => {
    mountOverlay(`<div class="overlay" role="dialog" aria-modal="true" aria-label="Face ID">
      <div class="face-sheet" id="face-sheet">
        <div class="face-sheet-body">${faceGlyph()}<div class="face-reason">${escapeHtml(reason)}</div><div class="face-status" id="face-status">Look at the front of the phone</div></div>
        <div class="face-actions"><button class="face-action" type="button" data-action="face-cancel">Cancel</button><button class="face-action" type="button" data-action="face-authenticate">Authenticate</button></div>
      </div>
    </div>`, () => resolve(false));
    const complete = () => {
      if (!activeFace || activeFace.completed) return;
      activeFace.completed = true;
      clearTimeout(activeFace.scanTimer);
      document.querySelector("#face-sheet")?.classList.add("ok");
      document.querySelector("#face-status").textContent = successMessage;
      activeFace.doneTimer = setTimeout(() => {
        const current = activeFace;
        activeFace = null;
        overlayDismiss = null;
        closeOverlay();
        current.resolve(true);
      }, 850);
    };
    activeFace = { resolve, complete, completed: false, scanTimer: null, doneTimer: null };
    activeFace.scanTimer = setTimeout(complete, 1600);
  });
}

function openDocumentUpload() {
  ui.documentAccepted = false;
  renderDocumentSheet();
}

function renderDocumentSheet() {
  const content = `<div class="overlay sheet-overlay" role="dialog" aria-modal="true" aria-label="Verify it’s you">
    <div class="bottom-sheet">
      <div class="sheet-grabber"></div>
      <div class="sheet-header"><h2 class="sheet-title">Verify it’s you</h2><button class="icon-button" type="button" data-action="close-overlay" aria-label="Close">${icon("close")}</button></div>
      <p class="sheet-body-copy">Upload an ID photo</p>
      <div class="group section-gap">
        ${["Emirates ID", "Passport"].map((type) => `<button class="list-row" type="button" data-action="document-type" data-document-type="${type}" aria-pressed="${ui.documentType === type}"><span class="row-icon">${icon("card")}</span><span class="row-copy"><span class="row-title">${type}</span></span><span class="radio-mark">${ui.documentType === type ? icon("check", 14) : ""}</span></button>`).join("")}
      </div>
      ${ui.documentAccepted ? `<div class="notice success section-gap"><div class="inline success">${icon("check")}<strong>Document accepted</strong></div><p class="caption section-gap">${ui.documentType} · Ready to continue</p></div>` : `<div class="notice section-gap"><div class="inline">${icon("upload")}<span>Upload an ID photo</span></div></div>`}
      <div class="sheet-actions"><button class="btn" type="button" data-action="document-continue">Continue</button></div>
    </div>
  </div>`;
  if (overlayRoot.innerHTML) overlayRoot.innerHTML = content;
  else mountOverlay(content);
}

function mandatePayload() {
  const mandate = structuredClone(ui.mandate);
  if (mandate.valid_days !== 7) mandate.valid_to = new Date(Date.now() + mandate.valid_days * 86_400_000).toISOString();
  return mandate;
}

async function submitMandate() {
  if (ui.busy) return;
  if (!ui.scaAssertion) {
    const verified = await openFaceID("Harbor Bank is requesting Face ID to create an Agent Card.", "It’s you. Now set what the agent is allowed to buy.");
    if (!verified) return;
    ui.scaAssertion = "mock-webauthn-ok";
  }
  ui.busy = true;
  render();
  try {
    const agent = currentAgent();
    await createAgentCard({
      card_id: "card_4410",
      agent_id: agent.id,
      agent_name: agent.name,
      mandate: mandatePayload(),
      sca_assertion: ui.scaAssertion,
    });
    ui.keyDraft = null;
    ui.busy = false;
    await navigate("pairing", "bank");
  } catch (error) {
    ui.busy = false;
    render();
    showToast("Could not create Agent Card", error.message, { kind: "error" });
  }
}

async function connectFromAgent() {
  if (ui.busy) return;
  ui.busy = true;
  render();
  try {
    ui.keyDraft = await generateAgentKey(ui.selectedAgentId);
    ui.busy = false;
    await navigate("agent-request", "bank");
  } catch (error) {
    ui.busy = false;
    render();
    showToast("Could not generate key", error.message, { kind: "error" });
  }
}

async function approveAgentRequest() {
  const verified = await openFaceID(`Harbor Bank wants to use Face ID to create an Agent Card for ${currentAgent().name}.`, "It’s you. Your agent can now connect.");
  if (!verified) return;
  ui.scaAssertion = "mock-webauthn-ok";
  ui.busy = true;
  render();
  try {
    const agent = currentAgent();
    const created = await createAgentCard({
      card_id: "card_4410",
      agent_id: agent.id,
      agent_name: agent.name,
      mandate: mandatePayload(),
      sca_assertion: ui.scaAssertion,
    });
    await bindAgentCard(created.id, {
      code: created.invite.code,
      agent_id: agent.id,
      public_key_jwk: ui.keyDraft.publicKeyJwk,
    });
    ui.busy = false;
    await navigate("agent-connected", "agent");
    showToast(`${agent.name} connected`, "Agent Card AC-1842 is active on Visa Debit •• 4410.");
  } catch (error) {
    ui.busy = false;
    render();
    showToast("Could not connect agent", error.message, { kind: "error" });
  }
}

async function generatePairingKey() {
  if (ui.busy) return;
  ui.busy = true;
  render();
  try {
    await wait(500);
    ui.keyDraft = await generateAgentKey(ui.selectedAgentId);
  } catch (error) {
    showToast("Could not generate key", error.message, { kind: "error" });
  } finally {
    ui.busy = false;
    render();
  }
}

async function sendPublicKey() {
  if (ui.busy || !ui.keyDraft) return;
  ui.busy = true;
  render();
  try {
    const card = getState().agent_card;
    const agent = currentAgent();
    await bindAgentCard(card.id, {
      code: card.invite.code,
      agent_id: agent.id,
      public_key_jwk: ui.keyDraft.publicKeyJwk,
    });
    ui.busy = false;
    await navigate("pair-success", "bank");
    showToast(`${agent.name} connected`, "Agent Card AC-1842 is active on Visa Debit •• 4410.");
  } catch (error) {
    ui.busy = false;
    render();
    showToast("Could not connect agent", error.message, { kind: "error" });
  }
}

function newPaymentRequest(merchantId) {
  const card = getState().agent_card;
  return {
    agent_card_id: card.id,
    amount: 1790,
    currency: "AED",
    merchant_id: merchantId,
    mcc: "5722",
    user_request: ui.userRequest,
    cart: structuredClone(merchantId === "electrohub.ae" ? HAPPY_CART : UNKNOWN_CART),
  };
}

async function tryUnknownPayment() {
  if (ui.busy) return;
  ui.busy = true;
  ui.paymentStage = "unknown-offer";
  render();
  await wait(650);
  const request = newPaymentRequest("electrohub-pay.com");
  ui.activePaymentRequest = request;
  try {
    const result = await paymentChallenge(request);
    ui.busy = false;
    ui.pendingPayment = result;
    await navigate("home", "bank");
    openUnknownSheet(result);
  } catch (error) {
    ui.busy = false;
    ui.paymentStage = error.code === "merchant_blocked" ? "blocked" : error.code === "revoked" ? "revoked" : "unknown-offer";
    render();
    showToast(error.code === "merchant_blocked" ? "Payment blocked" : "Payment unavailable", error.message, { kind: "error", duration: 6500 });
  }
}

function openUnknownSheet(pending) {
  const agent = currentAgent();
  mountOverlay(`<div class="overlay sheet-overlay" role="dialog" aria-modal="true" aria-label="Unknown merchant decision">
    <div class="bottom-sheet">
      <div class="sheet-grabber"></div>
      <div class="sheet-header"><span class="chip warning">Unknown merchant</span><button class="icon-button" type="button" data-action="close-overlay" aria-label="Close">${icon("close")}</button></div>
      <h2 class="sheet-title section-gap">This shop is not on the verified list</h2>
      <p class="sheet-body-copy">${agent.name} wants to pay <strong>electrohub-pay.com</strong> <strong>AED 1,790</strong>.</p>
      <div class="group section-gap"><div class="list-row static-row"><span class="row-copy"><span class="row-title">Merchant risk score</span></span><span class="chip danger">${pending.risk_score} / 100</span></div></div>
      <button class="btn secondary verified-alternative" type="button" data-action="pay-verified-instead">Pay verified ElectroHub instead</button>
      <p class="caption section-gap">Did you mean ElectroHub (electrohub.ae)?</p>
      <div class="notice section-gap"><span class="caption">You asked:</span><p class="body"> <em>${escapeHtml(pending.user_request)}</em></p></div>
      <div class="sheet-actions"><div class="button-pair"><button class="btn destructive" type="button" data-action="decline-merchant">Decline</button><button class="btn" type="button" data-action="pay-merchant">Pay this shop</button></div></div>
    </div>
  </div>`);
}

async function declineUnknownPayment() {
  const pending = ui.pendingPayment;
  if (!pending) return;
  const button = overlayRoot.querySelector('[data-action="decline-merchant"]');
  if (button) { button.disabled = true; button.textContent = "Declining…"; }
  try {
    const result = await merchantDecision(getState().agent_card.id, {
      pending_id: pending.pending_id,
      decision: "decline",
      customer_id: "cus_01",
    });
    ui.lastDecline = result;
    ui.hasDeclined = true;
    ui.paymentStage = "declined";
    closeOverlay();
    render();
    showToast("Payment declined. Your real card was not charged.", "", { duration: 6500 });
    mountOverlay(`<div class="overlay sheet-overlay" role="dialog" aria-modal="true" aria-label="Payment blocked">
      <div class="bottom-sheet">
        <div class="sheet-grabber"></div>
        <div class="blocked-icon">${icon("shield", 28)}</div>
        <h2 class="sheet-title section-gap">Payment blocked</h2>
        <p class="sheet-body-copy">You declined electrohub-pay.com · AED 1,790 was not charged.</p>
        <div class="stack-small section-gap"><span class="chip danger">Blocklisted</span><p class="body">Added to the shared blocklist. Future attempts are blocked for all agents and Harbor Bank customers.</p></div>
        <div class="sheet-actions"><button class="btn" type="button" data-action="close-decline">Done</button></div>
      </div>
    </div>`);
  } catch (error) {
    showToast("Could not decline payment", error.message, { kind: "error" });
    if (button) { button.disabled = false; button.textContent = "Decline"; }
  }
}

async function authorizeChallenge(challenge, request) {
  const agent = currentAgent();
  const signature = await signWithAgentKey(agent.id, challenge.canonical);
  const authorization = {
    agent_card_id: request.agent_card_id,
    challenge_id: challenge.challenge_id,
    signature_b64: signature,
    amount: request.amount,
    currency: request.currency,
    merchant_id: request.merchant_id,
    user_request: request.user_request,
    cart: request.cart,
  };
  const payment = await authorizePayment(authorization);
  ui.lastPayment = payment;
  ui.lastAuthorization = { challenge, request, authorization };
  return payment;
}

async function approveUnknownPayment() {
  const pending = ui.pendingPayment;
  if (!pending) return;
  closeOverlay();
  const verified = await openFaceID("Harbor Bank wants to use Face ID to approve this payment.", "It’s you. Approving this shop.");
  if (!verified) { openUnknownSheet(pending); return; }
  ui.busy = true;
  try {
    const challenge = await merchantDecision(getState().agent_card.id, {
      pending_id: pending.pending_id,
      decision: "pay",
      customer_id: "cus_01",
    });
    const request = newPaymentRequest(pending.merchant_id);
    await authorizeChallenge(challenge, request);
    ui.paymentStage = "paid-unknown";
    ui.busy = false;
    await navigate("home", "bank");
    showToast("Paid with Agent Card AC-1842", `electrohub-pay.com · AED 1,790 · Mandate match: yes · Remaining: AED 210 · 1 payment left`, { action: "see-receipt", actionLabel: "See receipt", duration: 8000 });
  } catch (error) {
    ui.busy = false;
    render();
    showToast("Payment failed", error.message, { kind: "error" });
  }
}

async function startGoodPayment() {
  if (ui.busy) return;
  ui.busy = true;
  ui.paymentStage = "good-offer";
  render();
  await wait(650);
  const request = newPaymentRequest("electrohub.ae");
  ui.activePaymentRequest = request;
  try {
    const challenge = await paymentChallenge(request);
    const payment = await authorizeChallenge(challenge, request);
    ui.paymentStage = "paid-good";
    ui.busy = false;
    await navigate("home", "bank");
    showToast(
      "Paid with Agent Card AC-1842",
      `ElectroHub · Samsung 55" CU8000 · AED 1,790 · Mandate match: yes · Remaining: ${formatAED(payment.remaining_amount)} · 1 payment left`,
      { action: "see-receipt", actionLabel: "See receipt", duration: 10000 },
    );
  } catch (error) {
    ui.busy = false;
    ui.paymentStage = error.code === "revoked" ? "revoked" : "good-offer";
    render();
    showToast("Payment failed", error.message, { kind: "error", duration: 6500 });
  }
}

async function openCardDetails() {
  const verified = await openFaceID("Harbor Bank wants to use Face ID to reveal Agent Card details.", "Agent Card details unlocked.");
  if (verified) await navigate("card-details", "bank");
}

function openRevokeConfirm() {
  mountOverlay(`<div class="overlay sheet-overlay" role="dialog" aria-modal="true" aria-label="Revoke Agent Card"><div class="bottom-sheet"><div class="sheet-grabber"></div><h2 class="sheet-title">Revoke Agent Card</h2><p class="sheet-body-copy">The agent will not be able to pay with this card. Your Visa Debit •• 4410 is unchanged.</p><div class="sheet-actions"><button class="btn destructive" type="button" data-action="confirm-revoke">Revoke Agent Card</button><button class="btn secondary" type="button" data-action="close-overlay">Cancel</button></div></div></div>`);
}

async function confirmRevoke() {
  closeOverlay();
  const verified = await openFaceID("Harbor Bank wants to use Face ID to revoke this Agent Card.", "Face ID confirmed.");
  if (!verified) return;
  await revokeAgentCard("AC-1842", { reason: "customer_revoked" });
  render();
  mountOverlay(`<div class="overlay sheet-overlay" role="dialog" aria-modal="true" aria-label="Agent Card revoked"><div class="bottom-sheet"><div class="sheet-grabber"></div><div class="success-icon">${icon("check", 28)}</div><h2 class="sheet-title section-gap">Agent Card revoked</h2><p class="sheet-body-copy">AC-1842 revoked at 15:12.</p><div class="sheet-actions"><button class="btn" type="button" data-action="close-overlay">Done</button></div></div></div>`);
}

async function resetDemo() {
  closeOverlay();
  clearTimeout(toastTimer);
  resetBank();
  localStorage.clear();
  await clearAgentKeys();
  ui = initialUi();
  render();
}

view.addEventListener("input", (event) => {
  const field = event.target.dataset.field;
  if (!field) return;
  if (field === "user-request") {
    ui.userRequest = event.target.value;
  } else if (["max_amount", "max_transactions", "valid_days"].includes(field)) {
    ui.mandate[field] = Math.max(1, Number(event.target.value) || 1);
  } else {
    ui.mandate[field] = event.target.value;
  }
});

view.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  if (action === "home") await navigate("home", "bank");
  else if (action === "agent-cards") await navigate("agent-cards", "bank");
  else if (action === "create-card") { ui.scaAssertion = null; await navigate("create", "bank"); }
  else if (action === "create") await navigate("create", "bank");
  else if (action === "select-agent") { ui.selectedAgentId = button.dataset.agentId; ui.keyDraft = null; render(); }
  else if (action === "create-face-id") {
    const verified = await openFaceID("Harbor Bank is requesting Face ID to create an Agent Card.", "It’s you. Now set what the agent is allowed to buy.");
    if (verified) { ui.scaAssertion = "mock-webauthn-ok"; await navigate("mandate", "bank"); }
  }
  else if (action === "document-upload") openDocumentUpload();
  else if (action === "document-type") { ui.documentType = button.dataset.documentType; renderDocumentSheet(); }
  else if (action === "document-continue") {
    if (!ui.documentAccepted) { ui.documentAccepted = true; renderDocumentSheet(); }
    else { ui.scaAssertion = "mock-document-ok"; closeOverlay(); await navigate("mandate", "bank"); }
  }
  else if (action === "close-overlay" || action === "face-cancel") closeOverlay();
  else if (action === "face-authenticate") activeFace?.complete();
  else if (action === "toggle-trusted") { ui.mandate.merchant_allowlist = ui.mandate.merchant_allowlist.length ? [] : ["electrohub.ae"]; render(); }
  else if (action === "set-max-payments") { ui.mandate.max_transactions = Number(button.dataset.value); render(); }
  else if (action === "set-valid") { ui.mandate.valid_days = Number(button.dataset.value); render(); }
  else if (action === "add-wallet") showToast("Added to Apple Wallet");
  else if (action === "receipt-back") await navigate("home", "bank");
  else if (action === "submit-mandate") await submitMandate();
  else if (action === "open-agent") await navigate("agent-pair", "agent");
  else if (action === "generate-key") await generatePairingKey();
  else if (action === "send-public-key") await sendPublicKey();
  else if (action === "done-pairing" || action === "done-agent-connect") { ui.paymentStage = "idle"; await navigate("payment", "agent"); }
  else if (action === "start-agent-path") { ui.keyDraft = null; ui.scaAssertion = null; await navigate("agent-start", "agent"); }
  else if (action === "connect-from-agent") await connectFromAgent();
  else if (action === "agent-request-face-id") await approveAgentRequest();
  else if (action === "cancel-agent-request") await navigate("agent-start", "agent");
  else if (action === "try-unknown") await tryUnknownPayment();
  else if (action === "send-request") {
    if (!ui.userRequest.trim()) showToast("Add a request", "Tell the agent what you want to buy.", { kind: "error" });
    else { ui.paymentStage = "idle"; render(); }
  }
  else if (action === "pay-good") await startGoodPayment();
  else if (action === "show-card") await openCardDetails();
  else if (action === "revoke-card") openRevokeConfirm();
});

overlayRoot.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  if (action === "face-cancel" || action === "close-overlay") closeOverlay();
  else if (action === "face-authenticate") activeFace?.complete();
  else if (action === "document-type") { ui.documentType = button.dataset.documentType; renderDocumentSheet(); }
  else if (action === "document-continue") {
    if (!ui.documentAccepted) { ui.documentAccepted = true; renderDocumentSheet(); }
    else { ui.scaAssertion = "mock-document-ok"; closeOverlay(); await navigate("mandate", "bank"); }
  }
  else if (action === "decline-merchant") await declineUnknownPayment();
  else if (action === "pay-merchant") await approveUnknownPayment();
  else if (action === "pay-verified-instead") { closeOverlay(); await navigate("payment", "agent"); await startGoodPayment(); }
  else if (action === "confirm-revoke") await confirmRevoke();
  else if (action === "close-decline") { closeOverlay(); await navigate("payment", "agent"); }
});

toastRoot.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (button?.dataset.action === "see-receipt") {
    ui.toast = null;
    renderToast();
    await navigate("receipt", "bank");
  }
});

document.querySelector("#reset-demo").addEventListener("click", resetDemo);
document.querySelector("#try-demo").addEventListener("click", () => { ui.autoplay = false; });
document.querySelector("#play-demo").addEventListener("click", () => showToast("Agent Card", "Complete the pairing flow, then try the payment journey."));

render();
