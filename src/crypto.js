const DB_NAME = "harbor-agent-keys";
const STORE_NAME = "non-extractable-keys";
const memoryKeys = new Map();
let databasePromise;

function openDatabase() {
  if (!globalThis.indexedDB) return Promise.resolve(null);
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return databasePromise;
}

async function readKeyPair(agentId) {
  if (memoryKeys.has(agentId)) return memoryKeys.get(agentId);
  const db = await openDatabase();
  if (!db) return null;
  const pair = await new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(agentId);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
  if (pair) memoryKeys.set(agentId, pair);
  return pair;
}

async function writeKeyPair(agentId, pair) {
  memoryKeys.set(agentId, pair);
  const db = await openDatabase();
  if (!db) return;
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(pair, agentId);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function fingerprintPublicKey(publicKeyJwk) {
  const canonicalJwk = JSON.stringify({
    crv: publicKeyJwk.crv,
    kty: publicKeyJwk.kty,
    x: publicKeyJwk.x,
    y: publicKeyJwk.y,
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJwk));
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0"));
  return `SHA256:${hex.join(":")}`;
}

export async function generateAgentKey(agentId) {
  if (!crypto.subtle) throw new Error("WebCrypto is unavailable in this browser context.");
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"],
  );
  if (pair.privateKey.extractable !== false) throw new Error("Private key must be non-extractable.");
  await writeKeyPair(agentId, pair);
  const publicKeyJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const fingerprint = await fingerprintPublicKey(publicKeyJwk);
  return { publicKeyJwk, fingerprint, algorithm: pair.privateKey.algorithm };
}

export async function getAgentPublicKey(agentId) {
  const pair = await readKeyPair(agentId);
  if (!pair) return null;
  const publicKeyJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return { publicKeyJwk, fingerprint: await fingerprintPublicKey(publicKeyJwk) };
}

export async function signWithAgentKey(agentId, canonical) {
  const pair = await readKeyPair(agentId);
  if (!pair) throw new Error("The agent key is not available. Connect the Agent Card again.");
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    pair.privateKey,
    new TextEncoder().encode(canonical),
  );
  return bytesToBase64(new Uint8Array(signature));
}

export async function verifySignature(publicKeyJwk, canonical, signatureB64) {
  try {
    const publicKey = await crypto.subtle.importKey(
      "jwk",
      publicKeyJwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      base64ToBytes(signatureB64),
      new TextEncoder().encode(canonical),
    );
  } catch {
    return false;
  }
}

export function tamperSignature(signature) {
  const index = Math.min(12, signature.length - 1);
  const replacement = signature[index] === "A" ? "B" : "A";
  return `${signature.slice(0, index)}${replacement}${signature.slice(index + 1)}`;
}

export function shortFingerprint(fingerprint, leading = 4, trailing = 2) {
  if (!fingerprint) return "—";
  const parts = fingerprint.replace("SHA256:", "").split(":");
  return `SHA256: ${parts.slice(0, leading).join(":")}:…:${parts.slice(-trailing).join(":")}`;
}

export async function clearAgentKeys() {
  memoryKeys.clear();
  if (!globalThis.indexedDB) return;
  await new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  });
  databasePromise = undefined;
}
