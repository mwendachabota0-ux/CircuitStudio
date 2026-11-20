import { randomUUID } from "node:crypto";
import {
  circuitAiReservations,
  circuitAiUsage,
  db,
} from "@workspace/db";
import { and, eq, lt, sql } from "drizzle-orm";
import { GoogleGenAI, type GenerateContentResponse } from "@google/genai";
import {
  getProviderErrorDiagnostics,
  type ProviderErrorDiagnostics,
} from "./providerErrorDiagnostics";
import { orderKeysAfter } from "./circuitAiKeySelection";

const MAX_CONFIGURED_KEYS = 10;
const STALE_RESERVATION_AGE_MS = 60 * 60 * 1000;
const GEMINI_API_VERSION = "v1beta";

export class CircuitAiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly retryable = false,
    readonly retryAfterMs?: number,
    readonly providerDiagnostics?: ProviderErrorDiagnostics,
  ) {
    super(message);
    this.name = "CircuitAiError";
  }
}

type ConfiguredKey = { number: number; apiKey: string };
type AiUsageSummary = {
  tokensUsed: number;
  tokensReserved: number;
  activeKeyNumber: number;
  configuredKeyNumbers: number[];
  canUseAi: boolean;
};
type AiStatusSummary = {
  available: boolean;
  canUseAi: boolean;
  latencyMs: number;
  checkedAt: string;
};
type ModelProbe = Omit<AiStatusSummary, "canUseAi">;

const AI_STATUS_MODEL = "gemini-2.5-flash";
const AI_STATUS_CACHE_TTL_MS = 15_000;
const aiStatusCache = new Map<
  number,
  { expiresAt: number; result: Promise<ModelProbe> }
>();

function getConfiguredKeys(): ConfiguredKey[] {
  const keys: ConfiguredKey[] = [];
  for (let number = 1; number <= MAX_CONFIGURED_KEYS; number += 1) {
    const variableName =
      number === 1 ? "GEMINI_API_KEY" : `GEMINI_API_KEY_${number}`;
    const apiKey = process.env[variableName]?.trim();
    if (apiKey) keys.push({ number, apiKey });
  }
  return keys;
}

function usageTotal(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

async function readReservedTokens(userId: string): Promise<number> {
  const [row] = await db
    .select({
      total: sql<string>`coalesce(sum(${circuitAiReservations.reservedTokens}), 0)`,
    })
    .from(circuitAiReservations)
    .where(eq(circuitAiReservations.userId, userId));
  return usageTotal(row?.total);
}

export async function getCircuitAiUsage(
  userId: string,
): Promise<AiUsageSummary> {
  const keys = getConfiguredKeys();
  const [[account], tokensReserved] = await Promise.all([
    db
      .select()
      .from(circuitAiUsage)
      .where(eq(circuitAiUsage.userId, userId))
      .limit(1),
    readReservedTokens(userId),
  ]);
  const tokensUsed = usageTotal(account?.tokensUsed);
  const activeKeyNumber =
    keys.find((key) => key.number === account?.selectedKeyNumber)?.number ??
    keys[0]?.number ??
    1;

  return {
    tokensUsed,
    tokensReserved,
    activeKeyNumber,
    configuredKeyNumbers: keys.map((key) => key.number),
    canUseAi: keys.length > 0,
  };
}

async function probeConfiguredKey(key: ConfiguredKey): Promise<ModelProbe> {
  const now = Date.now();
  const cached = aiStatusCache.get(key.number);
  if (cached && cached.expiresAt > now) return cached.result;

  const result = (async (): Promise<ModelProbe> => {
    const startedAt = Date.now();
    try {
      // This reads model metadata only. It does not send a prompt or generate
      // content, so it does not consume input or output tokens.
      const model = await new GoogleGenAI({
        apiKey: key.apiKey,
        apiVersion: GEMINI_API_VERSION,
      }).models.get({
          model: AI_STATUS_MODEL,
          config: { abortSignal: AbortSignal.timeout(5_000) },
        });
      return {
        available: model.supportedActions?.includes("generateContent") ?? false,
        latencyMs: Math.max(0, Date.now() - startedAt),
        checkedAt: new Date().toISOString(),
      };
    } catch {
      return {
        available: false,
        latencyMs: Math.max(0, Date.now() - startedAt),
        checkedAt: new Date().toISOString(),
      };
    }
  })();

  aiStatusCache.set(key.number, {
    expiresAt: now + AI_STATUS_CACHE_TTL_MS,
    result,
  });
  return result;
}

export async function getCircuitAiStatus(
  userId: string,
): Promise<AiStatusSummary> {
  const keys = getConfiguredKeys();
  let usage: AiUsageSummary | undefined;
  try {
    usage = await getCircuitAiUsage(userId);
  } catch {
    // Provider health is independent of account-usage storage. Keep the
    // token-free Gemini probe available even when the database is not.
  }
  const activeKey =
    keys.find((key) => key.number === usage?.activeKeyNumber) ?? keys[0];
  if (!activeKey) {
    return {
      available: false,
      canUseAi: false,
      latencyMs: 0,
      checkedAt: new Date().toISOString(),
    };
  }

  const probe = await probeConfiguredKey(activeKey);
  return { ...probe, canUseAi: usage?.canUseAi ?? false };
}

export async function selectCircuitAiKey(
  userId: string,
  keyNumber: number,
): Promise<AiUsageSummary> {
  const keys = getConfiguredKeys();
  if (!keys.some((key) => key.number === keyNumber)) {
    throw new CircuitAiError(
      "That Gemini key number is not configured for this app.",
      400,
    );
  }

  await db
    .insert(circuitAiUsage)
    .values({ userId, selectedKeyNumber: keyNumber })
    .onConflictDoUpdate({
      target: circuitAiUsage.userId,
      set: { selectedKeyNumber: keyNumber, updatedAt: new Date() },
    });

  return getCircuitAiUsage(userId);
}

async function reserveTokens(
  userId: string,
  reserve: number,
  availableKeys: ConfiguredKey[],
): Promise<{ requestId: string; keyNumber: number }> {
  const requestId = randomUUID();
  const firstConfiguredKey = availableKeys[0]?.number ?? 1;
  const staleBefore = new Date(Date.now() - STALE_RESERVATION_AGE_MS);

  await db
    .delete(circuitAiReservations)
    .where(
      and(
        eq(circuitAiReservations.userId, userId),
        lt(circuitAiReservations.createdAt, staleBefore),
      ),
    );

  return db.transaction(async (tx) => {
    await tx
      .insert(circuitAiUsage)
      .values({ userId, selectedKeyNumber: firstConfiguredKey })
      .onConflictDoNothing();

    const [account] = await tx
      .select()
      .from(circuitAiUsage)
      .where(eq(circuitAiUsage.userId, userId))
      .for("update")
      .limit(1);

    if (!account) {
      throw new CircuitAiError("Could not prepare your AI usage account.", 503);
    }

    const keyNumber =
      availableKeys.find((key) => key.number === account.selectedKeyNumber)
        ?.number ??
      firstConfiguredKey;

    await tx.insert(circuitAiReservations).values({
      requestId,
      userId,
      reservedTokens: reserve,
    });

    return { requestId, keyNumber };
  });
}

async function releaseReservation(requestId: string): Promise<void> {
  await db
    .delete(circuitAiReservations)
    .where(eq(circuitAiReservations.requestId, requestId));
}

async function settleReservation(
  userId: string,
  requestId: string,
  actualTokens: number,
  preferredKeyNumber: number,
  keyNumber: number,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [account] = await tx
      .select()
      .from(circuitAiUsage)
      .where(eq(circuitAiUsage.userId, userId))
      .for("update")
      .limit(1);
    await tx
      .update(circuitAiUsage)
      .set({
        tokensUsed: sql`${circuitAiUsage.tokensUsed} + ${actualTokens}`,
        selectedKeyNumber:
          account?.selectedKeyNumber === preferredKeyNumber
            ? keyNumber
            : (account?.selectedKeyNumber ?? preferredKeyNumber),
        updatedAt: new Date(),
      })
      .where(eq(circuitAiUsage.userId, userId));
    await tx
      .delete(circuitAiReservations)
      .where(eq(circuitAiReservations.requestId, requestId));
  });
}

function canFallbackToAnotherKey(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { status?: unknown; code?: unknown; message?: unknown };
  const status = Number(record.status);
  if (status === 429 || status === 503) return true;
  const code = `${record.code ?? ""} ${record.message ?? ""}`.toLowerCase();
  return /quota|rate.?limit|resource.?exhausted/.test(code);
}

function providerErrorText(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const record = error as { code?: unknown; message?: unknown; status?: unknown };
  return `${record.code ?? ""} ${record.message ?? ""} ${record.status ?? ""}`.toLowerCase();
}

function providerRetryAfterMs(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const record = error as {
    headers?: unknown;
    response?: { headers?: unknown };
  };
  const headerSources = [record.headers, record.response?.headers];
  let value: string | null = null;
  for (const source of headerSources) {
    if (!source || typeof source !== "object") continue;
    const get = (source as { get?: unknown }).get;
    if (typeof get === "function") {
      value = (get as (name: string) => string | null).call(source, "retry-after");
      if (value) break;
    }
    const entries = Object.entries(source as Record<string, unknown>);
    const header = entries.find(([name]) => name.toLowerCase() === "retry-after");
    if (typeof header?.[1] === "string" || typeof header?.[1] === "number") {
      value = String(header[1]);
      break;
    }
  }
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

function isProviderRateLimited(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { status?: unknown };
  return Number(record.status) === 429 ||
    /quota|rate.?limit|resource.?exhausted/.test(providerErrorText(error));
}

function isTransientProviderFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { status?: unknown };
  const status = Number(record.status);
  if (status === 408 || status === 425 || (status >= 500 && status <= 599)) {
    return true;
  }
  return /timeout|timed.?out|temporar|unavailable|network|connection reset|socket hang up|econnreset|etimedout|bad gateway/.test(
    providerErrorText(error),
  );
}

function tokenReservation(
  inputText: string,
  maxOutputTokens: number,
  imageTokenEstimate: number,
): number {
  // Keep a conservative usage estimate visible while the request is in flight.
  return inputText.length + imageTokenEstimate + maxOutputTokens + 512;
}

export async function generateWithAccountUsage(
  userId: string,
  options: {
    inputText: string;
    maxOutputTokens: number;
    imageTokenEstimate?: number;
    afterKeyNumber?: number;
    onKeyUsed?: (keyNumber: number) => void;
  },
  generate: (client: GoogleGenAI) => Promise<GenerateContentResponse>,
): Promise<GenerateContentResponse> {
  const keys = getConfiguredKeys();
  if (keys.length === 0) {
    throw new CircuitAiError(
      "Gemini is not configured for Circuit Studio.",
      503,
    );
  }

  const reserve = tokenReservation(
    options.inputText,
    options.maxOutputTokens,
    options.imageTokenEstimate ?? 0,
  );
  let reservation: { requestId: string; keyNumber: number };
  try {
    reservation = await reserveTokens(userId, reserve, keys);
  } catch (error) {
    if (error instanceof CircuitAiError) throw error;
    throw new CircuitAiError(
      "AI usage is temporarily unavailable. Please try again.",
      503,
      true,
    );
  }
  const orderedKeys = options.afterKeyNumber === undefined
    ? [
        ...keys.filter((key) => key.number === reservation.keyNumber),
        ...keys.filter((key) => key.number !== reservation.keyNumber),
      ]
    : orderKeysAfter(keys, options.afterKeyNumber);

  try {
    for (let index = 0; index < orderedKeys.length; index += 1) {
      const key = orderedKeys[index];
      let response: GenerateContentResponse;
      try {
        response = await generate(
          new GoogleGenAI({
            apiKey: key.apiKey,
            apiVersion: GEMINI_API_VERSION,
          }),
        );
      } catch (error) {
        if (index < orderedKeys.length - 1 && canFallbackToAnotherKey(error)) {
          continue;
        }
        const rateLimited = isProviderRateLimited(error);
        throw new CircuitAiError(
          "Gemini could not complete this request. Try again shortly or select another configured key.",
          502,
          rateLimited
            ? true
            : isTransientProviderFailure(error),
          providerRetryAfterMs(error),
          getProviderErrorDiagnostics(error, key.number),
        );
      }

      const reportedTokens = response.usageMetadata?.totalTokenCount;
      if (
        typeof reportedTokens !== "number" ||
        !Number.isSafeInteger(reportedTokens) ||
        reportedTokens < 1
      ) {
        throw new CircuitAiError(
          "Gemini did not return token usage, so this response could not be safely recorded.",
          502,
          false,
          undefined,
          {
            providerKeyNumber: key.number,
            failurePhase: "usage_metadata_missing",
          },
        );
      }

      await settleReservation(
        userId,
        reservation.requestId,
        reportedTokens,
        reservation.keyNumber,
        key.number,
      );
      options.onKeyUsed?.(key.number);
      return response;
    }
    throw new CircuitAiError(
      "No configured Gemini key could complete this request.",
      502,
    );
  } catch (error) {
    await releaseReservation(reservation.requestId).catch(() => undefined);
    if (error instanceof CircuitAiError) throw error;
    throw new CircuitAiError(
      "AI usage could not be recorded. Please try again.",
      503,
    );
  }
}
