import { createHmac, timingSafeEqual } from "node:crypto";

export type TelegramUser = {
  id: number;
  firstName: string;
  lastName?: string;
  username?: string;
};

export function verifyInitData(initData: string, botToken: string, maxAgeSec = 86_400): TelegramUser | null {
  if (!initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const computed = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  if (!safeEqual(computed, hash)) return null;

  const authDate = Number(params.get("auth_date") ?? 0);
  if (!Number.isFinite(authDate) || Date.now() / 1000 - authDate > maxAgeSec) return null;

  const rawUser = params.get("user");
  if (!rawUser) return null;
  try {
    const parsed = JSON.parse(rawUser) as {
      id: number;
      first_name: string;
      last_name?: string;
      username?: string;
    };
    if (!Number.isSafeInteger(parsed.id)) return null;
    return {
      id: parsed.id,
      firstName: parsed.first_name,
      lastName: parsed.last_name,
      username: parsed.username,
    };
  } catch {
    return null;
  }
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
