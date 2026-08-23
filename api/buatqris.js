import { sql } from "@vercel/postgres";
import crypto from "node:crypto";
import { parse as parseQueryString } from "node:querystring";

export const config = {
  api: { bodyParser: false },
};

function readRawBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function constantTimeSignatureMatch(rawBody, signature, secret) {
  if (!signature || !secret) return false;
  const expected = `sha256=${crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex")}`;
  const actual = String(signature).toLowerCase();
  return actual.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

function parsePayload(rawBody, contentType = "") {
  const text = rawBody.toString("utf8");
  if (contentType.includes("application/x-www-form-urlencoded")) {
    return parseQueryString(text);
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizeStatus(payload) {
  const value = String(payload?.status || payload?.payment_status || "")
    .toLowerCase();
  if (["success", "paid", "settlement"].includes(value)) return "paid";
  if (["expired", "expire"].includes(value)) return "expired";
  if (["failed", "failure", "cancelled", "cancel"].includes(value)) {
    return "failed";
  }
  return "pending";
}

function botAuthorized(request) {
  const configured = String(process.env.BOT_POLL_TOKEN || "").trim();
  const supplied = String(request.headers["x-bot-poll-token"] || "").trim();
  return Boolean(configured && supplied && supplied === configured);
}

async function ensureTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS buatqris_callbacks (
      transaction_id TEXT PRIMARY KEY,
      order_id TEXT,
      amount NUMERIC,
      status TEXT NOT NULL,
      payload JSONB NOT NULL,
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

export default async function handler(request, response) {
  try {
    await ensureTable();

    if (request.method === "POST") {
      const rawBody = await readRawBody(request);
      if (!rawBody.length) {
        return response.status(400).json({ error: "Body webhook kosong" });
      }

      const secret = String(process.env.BUATQRIS_SECRET_TOKEN || "").trim();
      const signature = request.headers["x-buatqris-signature"];
      if (!constantTimeSignatureMatch(rawBody, signature, secret)) {
        return response.status(401).json({ error: "Signature tidak valid" });
      }

      const payload = parsePayload(
        rawBody,
        String(request.headers["content-type"] || "").toLowerCase(),
      );
      if (!payload || typeof payload !== "object") {
        return response.status(400).json({ error: "Payload tidak valid" });
      }

      const transactionId = String(
        payload.transaction_id || payload.id || "",
      ).trim();
      if (!transactionId) {
        return response.status(400).json({
          error: "Transaction ID tidak ditemukan",
        });
      }

      const status = normalizeStatus(payload);
      const orderId = String(payload.order_id || "").trim() || null;
      const amount = Number(payload.amount);
      const safeAmount = Number.isFinite(amount) ? amount : null;

      await sql`
        INSERT INTO buatqris_callbacks
          (transaction_id, order_id, amount, status, payload)
        VALUES
          (${transactionId}, ${orderId}, ${safeAmount}, ${status},
           ${JSON.stringify(payload)}::jsonb)
        ON CONFLICT (transaction_id) DO UPDATE SET
          order_id = COALESCE(EXCLUDED.order_id, buatqris_callbacks.order_id),
          amount = COALESCE(EXCLUDED.amount, buatqris_callbacks.amount),
          status = EXCLUDED.status,
          payload = EXCLUDED.payload,
          updated_at = NOW()
      `;

      return response.status(200).json({
        received: true,
        transaction_id: transactionId,
        status,
      });
    }

    if (request.method === "GET") {
      if (!botAuthorized(request)) {
        return response.status(401).json({ error: "Bot tidak terautorisasi" });
      }

      const transactionId = String(request.query.transaction_id || "").trim();
      const orderId = String(request.query.order_id || "").trim();
      if (!transactionId && !orderId) {
        return response.status(400).json({
          error: "transaction_id atau order_id wajib diisi",
        });
      }

      const result = transactionId
        ? await sql`SELECT * FROM buatqris_callbacks
                    WHERE transaction_id = ${transactionId} LIMIT 1`
        : await sql`SELECT * FROM buatqris_callbacks
                    WHERE order_id = ${orderId}
                    ORDER BY updated_at DESC LIMIT 1`;

      return response.status(200).json({
        found: result.rows.length > 0,
        payment: result.rows[0] || null,
      });
    }

    response.setHeader("Allow", "GET, POST");
    return response.status(405).json({ error: "Method Not Allowed" });
  } catch (error) {
    console.error("BuatQris Vercel endpoint error", error);
    return response.status(500).json({ error: "Internal server error" });
  }
}