/**
 * Thin Mercury Banking REST helpers (Node 18+ fetch).
 * Zero npm runtime deps. API-token org via MERCURY_API_TOKEN.
 * Distinct from the stock Mercury OAuth MCP.
 */

import { requireApiToken, safeErrorMessage } from "./secrets.js";

export const DEFAULT_BASE_URL = "https://api.mercury.com/api/v1";

export const SEND_PAYMENT_METHODS = ["ach", "check", "domesticWire"];
export const REQUEST_SEND_PAYMENT_METHODS = [
  "ach",
  "check",
  "domesticWire",
  "internationalWire",
];

export const PURPOSE_CATEGORIES = [
  "employee",
  "landlord",
  "vendor",
  "contractor",
  "subsidiary",
  "transferToMyExternalAccount",
  "familyMemberOrFriend",
  "forGoodsOrServices",
  "angelInvestment",
  "savingsOrInvestments",
  "expenses",
  "travel",
  "other",
];

const ADDITIONAL_INFO_REQUIRED = new Set(["vendor", "contractor", "other"]);
const ADDITIONAL_INFO_ALLOWED = new Set([
  "vendor",
  "contractor",
  "other",
  "subsidiary",
]);

export const ELECTRONIC_ACCOUNT_TYPES = [
  "businessChecking",
  "businessSavings",
  "personalChecking",
  "personalSavings",
];

export const MAX_NOTE_CHARS = 1000;
export const MAX_IDEMPOTENCY_CHARS = 256;
export const MAX_AMOUNT = 10_000_000;
export const MIN_AMOUNT = 0.01;

export const TRANSACTION_STATUSES = [
  "pending",
  "sent",
  "cancelled",
  "failed",
  "reversed",
  "blocked",
];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/;

const ALLOWED_PATHS = [
  /^\/accounts$/,
  /^\/account\/[^/]+$/,
  /^\/account\/[^/]+\/transactions$/,
  /^\/account\/[^/]+\/request-send-money$/,
  /^\/transactions$/,
  /^\/transaction\/[^/]+$/,
  /^\/transfer$/,
  /^\/request-transfer$/,
  /^\/recipients$/,
  /^\/recipient\/[^/]+$/,
  /^\/categories$/,
  /^\/categories\/[^/]+$/,
  /^\/transaction\/[^/]+\/attachments$/,
];

export class MercuryError extends Error {
  /**
   * @param {string} message
   * @param {{ status?: number, code?: string }} [extra]
   */
  constructor(message, extra = {}) {
    super(message);
    this.name = "MercuryError";
    this.status = extra.status;
    this.code = extra.code;
  }
}

/**
 * @param {string} raw
 * @returns {string}
 */
export function resolveBaseUrl(raw) {
  const base = String(raw || "").trim() || DEFAULT_BASE_URL;
  return base.replace(/\/+$/, "");
}

/**
 * @param {string} pathname
 */
export function assertAllowedPath(pathname) {
  const pathOnly = pathname.split("?")[0];
  if (!ALLOWED_PATHS.some((re) => re.test(pathOnly))) {
    throw new MercuryError(`Refusing to call unwrapped Mercury path: ${pathOnly}`, {
      code: "forbidden_path",
    });
  }
}

/**
 * @param {unknown} value
 * @param {string} name
 * @param {{ max?: number }} [opts]
 * @returns {string}
 */
export function requireString(value, name, opts = {}) {
  const text = value == null ? "" : String(value).trim();
  if (!text) {
    throw new MercuryError(`${name} is required`, { code: "validation" });
  }
  const max = opts.max ?? 256;
  if (text.length > max) {
    throw new MercuryError(
      `${name} is ${text.length} characters; max is ${max}`,
      { code: "oversize" }
    );
  }
  return text;
}

/**
 * @param {unknown} value
 * @param {string} name
 * @param {{ max?: number }} [opts]
 * @returns {string|undefined}
 */
export function optionalString(value, name, opts = {}) {
  if (value == null || String(value).trim() === "") return undefined;
  return requireString(value, name, opts);
}

/**
 * Positive dollar amount with at least 1 cent.
 * @param {unknown} value
 * @param {string} [name]
 * @returns {number}
 */
export function requireAmount(value, name = "amount") {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) {
    throw new MercuryError(`${name} must be a finite number`, { code: "validation" });
  }
  if (num < MIN_AMOUNT) {
    throw new MercuryError(
      `${name} must be at least ${MIN_AMOUNT}`,
      { code: "validation" }
    );
  }
  if (num > MAX_AMOUNT) {
    throw new MercuryError(
      `${name} exceeds the connector maximum of ${MAX_AMOUNT}. Split the payment or confirm the figure before sending.`,
      { code: "oversize" }
    );
  }
  return num;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function requireIdempotencyKey(value) {
  return requireString(value, "idempotencyKey", { max: MAX_IDEMPOTENCY_CHARS });
}

/**
 * @param {unknown} value
 * @param {string[]} allowed
 * @param {string} name
 * @returns {string}
 */
export function requireEnum(value, allowed, name) {
  const text = requireString(value, name);
  if (!allowed.includes(text)) {
    throw new MercuryError(
      `${name} must be one of: ${allowed.join(", ")}`,
      { code: "validation" }
    );
  }
  return text;
}

/**
 * Normalize purpose to Mercury `{ simple: { category, additionalInfo? } }`.
 * Accepts that shape or a flat `{ category, additionalInfo }`.
 *
 * @param {unknown} purpose
 * @param {{ required?: boolean, paymentMethod?: string }} [opts]
 * @returns {{ simple: { category: string, additionalInfo?: string } }|undefined}
 */
export function normalizePurpose(purpose, opts = {}) {
  const required = Boolean(opts.required);
  const paymentMethod = opts.paymentMethod || "this payment method";
  if (purpose == null || purpose === "") {
    if (required) {
      throw new MercuryError(
        `purpose is required when paymentMethod is ${paymentMethod}`,
        { code: "validation" }
      );
    }
    return undefined;
  }
  if (typeof purpose !== "object") {
    throw new MercuryError(
      "purpose must be an object { simple: { category, additionalInfo? } }",
      { code: "validation" }
    );
  }
  const rec = /** @type {Record<string, unknown>} */ (purpose);
  const simple =
    rec.simple && typeof rec.simple === "object"
      ? /** @type {Record<string, unknown>} */ (rec.simple)
      : rec;
  const category = requireEnum(simple.category, PURPOSE_CATEGORIES, "purpose.simple.category");
  const additionalInfo = optionalString(simple.additionalInfo, "purpose.simple.additionalInfo", {
    max: MAX_NOTE_CHARS,
  });
  if (ADDITIONAL_INFO_REQUIRED.has(category) && !additionalInfo) {
    throw new MercuryError(
      `purpose.simple.additionalInfo is required for category ${category}`,
      { code: "validation" }
    );
  }
  if (additionalInfo && !ADDITIONAL_INFO_ALLOWED.has(category)) {
    throw new MercuryError(
      `purpose.simple.additionalInfo is not accepted for category ${category}`,
      { code: "validation" }
    );
  }
  /** @type {{ simple: { category: string, additionalInfo?: string } }} */
  const out = { simple: { category } };
  if (additionalInfo) out.simple.additionalInfo = additionalInfo;
  return out;
}

/**
 * @param {string} paymentMethod
 * @returns {boolean}
 */
export function purposeRequiredFor(paymentMethod) {
  return paymentMethod === "domesticWire" || paymentMethod === "internationalWire";
}

/**
 * @param {unknown} args
 * @param {{ allowInternationalWire?: boolean }} [opts]
 */
export function buildSendMoneyBody(args, opts = {}) {
  const input = args && typeof args === "object" ? args : {};
  const allowed = opts.allowInternationalWire
    ? REQUEST_SEND_PAYMENT_METHODS
    : SEND_PAYMENT_METHODS;
  const recipientId = requireString(input.recipientId, "recipientId");
  const amount = requireAmount(input.amount);
  const paymentMethod = requireEnum(input.paymentMethod, allowed, "paymentMethod");
  const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);
  const note = optionalString(input.note, "note", { max: MAX_NOTE_CHARS });
  const externalMemo = optionalString(input.externalMemo, "externalMemo", {
    max: MAX_NOTE_CHARS,
  });
  const purpose = normalizePurpose(input.purpose, {
    required: purposeRequiredFor(paymentMethod),
    paymentMethod,
  });

  /** @type {Record<string, unknown>} */
  const body = {
    recipientId,
    amount,
    paymentMethod,
    idempotencyKey,
  };
  if (note !== undefined) body.note = note;
  if (externalMemo !== undefined) body.externalMemo = externalMemo;
  if (purpose !== undefined) body.purpose = purpose;
  return body;
}

/**
 * @param {unknown} args
 */
export function buildTransferBody(args) {
  const input = args && typeof args === "object" ? args : {};
  const sourceAccountId = requireString(input.sourceAccountId, "sourceAccountId");
  const destinationAccountId = requireString(
    input.destinationAccountId,
    "destinationAccountId"
  );
  if (sourceAccountId === destinationAccountId) {
    throw new MercuryError(
      "sourceAccountId and destinationAccountId must be different",
      { code: "validation" }
    );
  }
  const amount = requireAmount(input.amount);
  const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);
  const note = optionalString(input.note, "note", { max: MAX_NOTE_CHARS });
  /** @type {Record<string, unknown>} */
  const body = {
    sourceAccountId,
    destinationAccountId,
    amount,
    idempotencyKey,
  };
  if (note !== undefined) body.note = note;
  return body;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
export function normalizeEmails(value) {
  if (value == null || value === "") {
    throw new MercuryError("emails is required", { code: "validation" });
  }
  const list = Array.isArray(value)
    ? value
    : String(value)
        .split(",")
        .map((part) => part.trim());
  const emails = list.map((item) => String(item || "").trim()).filter(Boolean);
  if (emails.length === 0) {
    throw new MercuryError("emails is required", { code: "validation" });
  }
  return emails;
}

/**
 * @param {unknown} address
 * @param {string} name
 */
export function requireAddress(address, name) {
  if (!address || typeof address !== "object") {
    throw new MercuryError(`${name} is required`, { code: "validation" });
  }
  const rec = /** @type {Record<string, unknown>} */ (address);
  /** @type {Record<string, unknown>} */
  const out = {
    address1: requireString(rec.address1, `${name}.address1`),
    city: requireString(rec.city, `${name}.city`),
    region: requireString(rec.region ?? rec.state, `${name}.region`),
    postalCode: requireString(rec.postalCode, `${name}.postalCode`),
    country: requireString(rec.country, `${name}.country`, { max: 8 }),
  };
  const address2 = optionalString(rec.address2, `${name}.address2`);
  if (address2 !== undefined) out.address2 = address2;
  return out;
}

/**
 * @param {unknown} info
 */
export function normalizeElectronicRoutingInfo(info) {
  if (info == null) return undefined;
  if (typeof info !== "object") {
    throw new MercuryError("electronicRoutingInfo must be an object", {
      code: "validation",
    });
  }
  const rec = /** @type {Record<string, unknown>} */ (info);
  /** @type {Record<string, unknown>} */
  const out = {
    accountNumber: requireString(rec.accountNumber, "electronicRoutingInfo.accountNumber"),
    routingNumber: requireString(rec.routingNumber, "electronicRoutingInfo.routingNumber"),
    electronicAccountType: requireEnum(
      rec.electronicAccountType,
      ELECTRONIC_ACCOUNT_TYPES,
      "electronicRoutingInfo.electronicAccountType"
    ),
    address: requireAddress(rec.address, "electronicRoutingInfo.address"),
  };
  return out;
}

/**
 * @param {unknown} info
 */
export function normalizeDomesticWireRoutingInfo(info) {
  if (info == null) return undefined;
  if (typeof info !== "object") {
    throw new MercuryError("domesticWireRoutingInfo must be an object", {
      code: "validation",
    });
  }
  const rec = /** @type {Record<string, unknown>} */ (info);
  return {
    accountNumber: requireString(rec.accountNumber, "domesticWireRoutingInfo.accountNumber"),
    routingNumber: requireString(rec.routingNumber, "domesticWireRoutingInfo.routingNumber"),
    address: requireAddress(rec.address, "domesticWireRoutingInfo.address"),
  };
}

/**
 * @param {unknown} info
 */
export function normalizeCheckInfo(info) {
  if (info == null) return undefined;
  if (typeof info !== "object") {
    throw new MercuryError("checkInfo must be an object", { code: "validation" });
  }
  const rec = /** @type {Record<string, unknown>} */ (info);
  return { address: requireAddress(rec.address, "checkInfo.address") };
}

/**
 * POST /recipients body. Name + emails required. Routing blocks optional.
 * Linked external banks (e.g. Chase) typically use electronicRoutingInfo.
 *
 * @param {unknown} args
 */
export function buildCreateRecipientBody(args) {
  const input = args && typeof args === "object" ? args : {};
  const name = requireString(input.name, "name", { max: 256 });
  const emails = normalizeEmails(input.emails);
  const nickname = optionalString(input.nickname, "nickname");
  const contactEmail = optionalString(input.contactEmail, "contactEmail");
  const electronicRoutingInfo = normalizeElectronicRoutingInfo(
    input.electronicRoutingInfo
  );
  const domesticWireRoutingInfo = normalizeDomesticWireRoutingInfo(
    input.domesticWireRoutingInfo
  );
  const checkInfo = normalizeCheckInfo(input.checkInfo);

  /** @type {Record<string, unknown>} */
  const body = { name, emails };
  if (nickname !== undefined) body.nickname = nickname;
  if (contactEmail !== undefined) body.contactEmail = contactEmail;
  if (electronicRoutingInfo) body.electronicRoutingInfo = electronicRoutingInfo;
  if (domesticWireRoutingInfo) body.domesticWireRoutingInfo = domesticWireRoutingInfo;
  if (checkInfo) body.checkInfo = checkInfo;
  return body;
}

/**
 * PATCH /transaction/{id} — set category (and optional note) AFTER create.
 * createTransaction does not accept categoryId.
 *
 * @param {unknown} args
 */
export function buildUpdateTransactionBody(args) {
  const input = args && typeof args === "object" ? args : {};
  const categoryId = requireString(input.categoryId, "categoryId");
  /** @type {Record<string, unknown>} */
  const body = { categoryId };
  if (Object.prototype.hasOwnProperty.call(input, "note")) {
    if (input.note == null || String(input.note).trim() === "") {
      body.note = null;
    } else {
      body.note = requireString(input.note, "note", { max: MAX_NOTE_CHARS });
    }
  }
  return body;
}

/**
 * Cursor pagination shared by GET /accounts, /recipients, /categories, /transactions.
 *
 * @param {unknown} args
 * @param {{ allowStartAt?: boolean }} [opts]
 * @returns {Record<string, string>}
 */
export function buildCursorQuery(args, opts = {}) {
  const input = args && typeof args === "object" ? args : {};
  /** @type {Record<string, string>} */
  const query = {};
  if (input.limit != null && input.limit !== "") {
    const limit = Number(input.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
      throw new MercuryError("limit must be an integer from 1 to 1000", {
        code: "validation",
      });
    }
    query.limit = String(limit);
  }
  if (input.order != null && String(input.order).trim() !== "") {
    query.order = requireEnum(input.order, ["asc", "desc"], "order");
  }
  const startAfter = optionalString(input.start_after ?? input.startAfter, "start_after");
  const endBefore = optionalString(input.end_before ?? input.endBefore, "end_before");
  const startAt = opts.allowStartAt
    ? optionalString(input.start_at ?? input.startAt, "start_at")
    : undefined;
  const cursors = [startAfter, endBefore, startAt].filter(Boolean);
  if (cursors.length > 1) {
    throw new MercuryError(
      opts.allowStartAt
        ? "start_at, start_after, and end_before cannot be combined"
        : "start_after and end_before cannot be combined",
      { code: "validation" }
    );
  }
  if (startAfter) query.start_after = startAfter;
  if (endBefore) query.end_before = endBefore;
  if (startAt) query.start_at = startAt;
  return query;
}

/**
 * @param {unknown} args
 */
export function buildListCategoriesQuery(args) {
  return buildCursorQuery(args);
}

/**
 * @param {unknown} args
 */
export function buildListAccountsQuery(args) {
  return buildCursorQuery(args);
}

/**
 * @param {unknown} args
 */
export function buildListRecipientsQuery(args) {
  return buildCursorQuery(args);
}

/**
 * YYYY-MM-DD or ISO 8601 datetime, matching Mercury listTransactions.
 *
 * @param {unknown} value
 * @param {string} name
 * @returns {string|undefined}
 */
export function optionalDate(value, name) {
  const text = optionalString(value, name, { max: 64 });
  if (text === undefined) return undefined;
  if (!ISO_DATE.test(text)) {
    throw new MercuryError(
      `${name} must be YYYY-MM-DD or an ISO 8601 datetime`,
      { code: "validation" }
    );
  }
  return text;
}

/**
 * Accept an array, a single string, or a comma-separated string.
 *
 * @param {unknown} value
 * @param {string} name
 * @returns {string[]|undefined}
 */
export function optionalRepeatableIds(value, name) {
  if (value == null || value === "") return undefined;
  const list = Array.isArray(value)
    ? value
    : String(value)
        .split(",")
        .map((part) => part.trim());
  const ids = list.map((item) => String(item || "").trim()).filter(Boolean);
  if (ids.length === 0) return undefined;
  for (const id of ids) {
    requireString(id, name, { max: 256 });
  }
  return ids;
}

/**
 * GET /transactions (listTransactions) query. Org-level; optional accountId filter.
 * Alternate Mercury path GET /account/{accountId}/transactions (offset pagination)
 * is not wrapped — use accountId here instead.
 *
 * @param {unknown} args
 * @returns {Record<string, string | string[]>}
 */
export function buildListTransactionsQuery(args) {
  const input = args && typeof args === "object" ? args : {};
  /** @type {Record<string, string | string[]>} */
  const query = { ...buildCursorQuery(input, { allowStartAt: true }) };

  const search = optionalString(input.search, "search", { max: MAX_NOTE_CHARS });
  if (search) query.search = search;

  const start = optionalDate(input.start, "start");
  const end = optionalDate(input.end, "end");
  const postedStart = optionalDate(input.postedStart ?? input.posted_start, "postedStart");
  const postedEnd = optionalDate(input.postedEnd ?? input.posted_end, "postedEnd");
  if (start) query.start = start;
  if (end) query.end = end;
  if (postedStart) query.postedStart = postedStart;
  if (postedEnd) query.postedEnd = postedEnd;

  const mercuryCategory = optionalString(input.mercuryCategory, "mercuryCategory");
  if (mercuryCategory) query.mercuryCategory = mercuryCategory;
  const categoryId = optionalString(input.categoryId, "categoryId");
  if (categoryId) query.categoryId = categoryId;

  const statuses = optionalRepeatableIds(input.status, "status");
  if (statuses) {
    for (const status of statuses) {
      requireEnum(status, TRANSACTION_STATUSES, "status");
    }
    query.status = statuses;
  }

  const accountIds = optionalRepeatableIds(input.accountId, "accountId");
  if (accountIds) query.accountId = accountIds;

  const cardIds = optionalRepeatableIds(input.cardId, "cardId");
  if (cardIds) query.cardId = cardIds;

  return query;
}

export const ATTACHMENT_TYPES = ["receipt", "bill", "other"];
export const MAX_ATTACHMENT_BYTES = 32 * 1024 * 1024;
export const MAX_FILENAME_CHARS = 299;

const BLOCKED_ATTACHMENT_EXTS = new Set([
  "exe",
  "bat",
  "cmd",
  "com",
  "scr",
  "pif",
  "msi",
  "dll",
]);

/**
 * @param {unknown} value
 * @param {string} name
 * @returns {boolean|undefined}
 */
export function optionalBoolean(value, name) {
  if (value == null || value === "") return undefined;
  if (typeof value === "boolean") return value;
  const text = String(value).trim().toLowerCase();
  if (text === "true" || text === "1" || text === "yes") return true;
  if (text === "false" || text === "0" || text === "no") return false;
  throw new MercuryError(`${name} must be a boolean`, { code: "validation" });
}

/**
 * POST /categories (createCategory). Visibility flags default true for Books.
 *
 * @param {unknown} args
 */
export function buildCreateCategoryBody(args) {
  const input = args && typeof args === "object" ? args : {};
  return {
    name: requireString(input.name, "name"),
    visibleForCardSpend:
      optionalBoolean(input.visibleForCardSpend, "visibleForCardSpend") ?? true,
    visibleForOther: optionalBoolean(input.visibleForOther, "visibleForOther") ?? true,
    visibleForReimbursements:
      optionalBoolean(input.visibleForReimbursements, "visibleForReimbursements") ??
      true,
  };
}

/**
 * POST /categories/{id} (editCategory). At least one field required.
 *
 * @param {unknown} args
 */
export function buildEditCategoryBody(args) {
  const input = args && typeof args === "object" ? args : {};
  /** @type {Record<string, unknown>} */
  const body = {};
  const name = optionalString(input.name, "name");
  if (name !== undefined) body.name = name;
  const card = optionalBoolean(input.visibleForCardSpend, "visibleForCardSpend");
  const other = optionalBoolean(input.visibleForOther, "visibleForOther");
  const reimb = optionalBoolean(
    input.visibleForReimbursements,
    "visibleForReimbursements"
  );
  if (card !== undefined) body.visibleForCardSpend = card;
  if (other !== undefined) body.visibleForOther = other;
  if (reimb !== undefined) body.visibleForReimbursements = reimb;
  if (Object.keys(body).length === 0) {
    throw new MercuryError(
      "edit_category requires at least one of name, visibleForCardSpend, visibleForOther, visibleForReimbursements",
      { code: "validation" }
    );
  }
  return body;
}

/**
 * Decode a receipt/bill file for multipart upload. Never logs content.
 *
 * @param {unknown} args
 */
export function buildTransactionAttachment(args) {
  const input = args && typeof args === "object" ? args : {};
  const filename = requireString(input.filename, "filename", {
    max: MAX_FILENAME_CHARS,
  });
  if (/[/\\]/.test(filename) || filename.includes("..")) {
    throw new MercuryError(
      "filename must be a basename without path separators",
      { code: "validation" }
    );
  }
  const ext = filename.includes(".")
    ? filename.split(".").pop().toLowerCase()
    : "";
  if (BLOCKED_ATTACHMENT_EXTS.has(ext)) {
    throw new MercuryError(`filename extension .${ext} is not allowed`, {
      code: "validation",
    });
  }
  const b64 = requireString(input.contentBase64 ?? input.content, "contentBase64", {
    max: Math.ceil((MAX_ATTACHMENT_BYTES * 4) / 3) + 128,
  });
  const buffer = Buffer.from(b64, "base64");
  if (buffer.length === 0) {
    throw new MercuryError("file is empty", { code: "validation" });
  }
  if (buffer.length > MAX_ATTACHMENT_BYTES) {
    throw new MercuryError("file exceeds Mercury maximum of 32MB", {
      code: "oversize",
    });
  }
  const attachmentType =
    input.attachmentType == null || input.attachmentType === ""
      ? "receipt"
      : requireEnum(input.attachmentType, ATTACHMENT_TYPES, "attachmentType");
  const contentType =
    optionalString(input.contentType ?? input.mimeType, "contentType") ||
    "application/octet-stream";
  return { filename, buffer, attachmentType, contentType };
}

/**
 * Inspect a captured fetch call for tests. Never returns the raw token.
 * @param {{ url: string, init?: RequestInit }} call
 */
export function inspectMercuryCall(call) {
  const url = String(call.url);
  const init = call.init || {};
  const headers = /** @type {Record<string, string>} */ (init.headers || {});
  const auth = String(headers.Authorization || headers.authorization || "");
  const parsed = new URL(url);
  const apiPath = parsed.pathname.replace(/^\/api\/v1/, "") || "/";
  let body = null;
  if (typeof init.body === "string" && init.body.length > 0) {
    try {
      body = JSON.parse(init.body);
    } catch {
      body = null;
    }
  }
  /** @type {Record<string, string | string[]>} */
  const query = {};
  for (const [key, value] of parsed.searchParams.entries()) {
    if (query[key] === undefined) {
      query[key] = value;
    } else if (Array.isArray(query[key])) {
      query[key].push(value);
    } else {
      query[key] = [query[key], value];
    }
  }
  return {
    url,
    method: String(init.method || "GET").toUpperCase(),
    path: apiPath,
    fullPath: parsed.pathname,
    query,
    authScheme: auth.startsWith("Bearer ") ? "Bearer" : "",
    authHasSecretPrefix: auth.startsWith("Bearer secret-token:"),
    contentType: String(headers["Content-Type"] || headers["content-type"] || ""),
    body,
    form:
      typeof FormData !== "undefined" && init.body instanceof FormData
        ? {
            hasFile: init.body.has("file"),
            attachmentType: String(init.body.get("attachmentType") || ""),
            filename: (() => {
              const file = init.body.get("file");
              return file && typeof file === "object" && "name" in file
                ? String(file.name)
                : "";
            })(),
          }
        : null,
  };
}

/**
 * @param {object} [opts]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {typeof fetch} [opts.fetchImpl]
 */
export function createMercuryClient({
  env = process.env,
  fetchImpl = fetch,
} = {}) {
  /**
   * @param {string} pathname
   * @param {{ method?: string, query?: Record<string, string | string[]>, json?: unknown, formData?: FormData }} [opts]
   */
  async function mercuryFetch(pathname, opts = {}) {
    const token = requireApiToken(env);
    const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
    assertAllowedPath(path);

    const url = new URL(`${resolveBaseUrl(env.MERCURY_API_BASE_URL)}${path}`);
    if (opts.query) {
      for (const [key, value] of Object.entries(opts.query)) {
        if (value === undefined || value === null || value === "") continue;
        const values = Array.isArray(value) ? value : [value];
        for (const item of values) {
          if (item === undefined || item === null || item === "") continue;
          url.searchParams.append(key, String(item));
        }
      }
    }

    /** @type {Record<string, string>} */
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    };
    /** @type {RequestInit} */
    const init = {
      method: opts.method ?? "GET",
      headers,
    };
    if (opts.json !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(opts.json);
    } else if (opts.formData) {
      init.body = opts.formData;
    }

    let response;
    try {
      response = await fetchImpl(url.toString(), init);
    } catch (err) {
      throw new MercuryError(
        `Mercury request failed: ${safeErrorMessage(err, env)}`,
        { code: "network" }
      );
    }

    const text = await response.text();
    const safeText = safeErrorMessage(text, env);
    if (!response.ok) {
      throw new MercuryError(
        `Mercury API ${response.status} on ${opts.method ?? "GET"} ${path}: ${safeText || response.statusText}`,
        { status: response.status, code: "http_error" }
      );
    }
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return { raw: safeText };
    }
  }

  return {
    /**
     * GET /accounts (getAccounts). Cursor-paginated.
     */
    async listAccounts(args) {
      const query = buildListAccountsQuery(args);
      return mercuryFetch("/accounts", { query });
    },

    /**
     * GET /account/{accountId} (getAccount).
     */
    async getAccount(args) {
      const accountId = requireString(args && args.accountId, "accountId");
      return mercuryFetch(`/account/${encodeURIComponent(accountId)}`);
    },

    /**
     * GET /transactions (listTransactions). Org-level with optional accountId[].
     */
    async listTransactions(args) {
      const query = buildListTransactionsQuery(args);
      return mercuryFetch("/transactions", { query });
    },

    /**
     * GET /transaction/{transactionId} (getTransactionById).
     * Alternate GET /account/{accountId}/transaction/{transactionId} is not wrapped.
     */
    async getTransaction(args) {
      const transactionId = requireString(
        args && args.transactionId,
        "transactionId"
      );
      return mercuryFetch(`/transaction/${encodeURIComponent(transactionId)}`);
    },

    /**
     * GET /recipients (getRecipients). Cursor-paginated.
     */
    async listRecipients(args) {
      const query = buildListRecipientsQuery(args);
      return mercuryFetch("/recipients", { query });
    },

    /**
     * POST /account/{accountId}/transactions (createTransaction).
     * Requires Send Money scope + IP whitelist.
     */
    async sendMoney(args) {
      const accountId = requireString(args && args.accountId, "accountId");
      const body = buildSendMoneyBody(args, { allowInternationalWire: false });
      return mercuryFetch(`/account/${encodeURIComponent(accountId)}/transactions`, {
        method: "POST",
        json: body,
      });
    },

    /**
     * POST /account/{accountId}/request-send-money (approval queue).
     * May not need IP whitelist. paymentMethod may include internationalWire.
     */
    async requestSendMoney(args) {
      const accountId = requireString(args && args.accountId, "accountId");
      const body = buildSendMoneyBody(args, { allowInternationalWire: true });
      return mercuryFetch(
        `/account/${encodeURIComponent(accountId)}/request-send-money`,
        { method: "POST", json: body }
      );
    },

    /**
     * POST /transfer (createInternalTransfer).
     */
    async transferMoney(args) {
      const body = buildTransferBody(args);
      return mercuryFetch("/transfer", { method: "POST", json: body });
    },

    /**
     * POST /request-transfer (requestTransferMoney) — approval queue.
     */
    async requestTransferMoney(args) {
      const body = buildTransferBody(args);
      return mercuryFetch("/request-transfer", { method: "POST", json: body });
    },

    /**
     * POST /recipients
     */
    async createRecipient(args) {
      const body = buildCreateRecipientBody(args);
      return mercuryFetch("/recipients", { method: "POST", json: body });
    },

    /**
     * GET /recipient/{id} (getRecipient).
     */
    async getRecipient(args) {
      const recipientId = requireString(args && args.recipientId, "recipientId");
      return mercuryFetch(`/recipient/${encodeURIComponent(recipientId)}`);
    },

    /**
     * GET /categories — Mercury custom categories for update_transaction_category.
     */
    async listCategories(args) {
      const query = buildListCategoriesQuery(args);
      return mercuryFetch("/categories", { query });
    },

    /**
     * POST /categories (createCategory).
     */
    async createCategory(args) {
      const body = buildCreateCategoryBody(args);
      return mercuryFetch("/categories", { method: "POST", json: body });
    },

    /**
     * POST /categories/{expenseCategoryId} (editCategory).
     */
    async editCategory(args) {
      const categoryId = requireString(
        args && (args.categoryId ?? args.expenseCategoryId),
        "categoryId"
      );
      const body = buildEditCategoryBody(args);
      return mercuryFetch(`/categories/${encodeURIComponent(categoryId)}`, {
        method: "POST",
        json: body,
      });
    },

    /**
     * DELETE /categories/{expenseCategoryId} (deleteCategory).
     */
    async deleteCategory(args) {
      const categoryId = requireString(
        args && (args.categoryId ?? args.expenseCategoryId),
        "categoryId"
      );
      return mercuryFetch(`/categories/${encodeURIComponent(categoryId)}`, {
        method: "DELETE",
      });
    },

    /**
     * POST /transaction/{id}/attachments (uploadTransactionAttachment).
     */
    async uploadTransactionAttachment(args) {
      const transactionId = requireString(
        args && args.transactionId,
        "transactionId"
      );
      const file = buildTransactionAttachment(args);
      const formData = new FormData();
      formData.append(
        "file",
        new Blob([file.buffer], { type: file.contentType }),
        file.filename
      );
      formData.append("attachmentType", file.attachmentType);
      return mercuryFetch(
        `/transaction/${encodeURIComponent(transactionId)}/attachments`,
        { method: "POST", formData }
      );
    },

    /**
     * PATCH /transaction/{transactionId} (updateTransaction).
     * Set Mercury custom category after createTransaction (no categoryId on create).
     */
    async updateTransactionCategory(args) {
      const transactionId = requireString(
        args && args.transactionId,
        "transactionId"
      );
      const body = buildUpdateTransactionBody(args);
      return mercuryFetch(`/transaction/${encodeURIComponent(transactionId)}`, {
        method: "PATCH",
        json: body,
      });
    },
  };
}
