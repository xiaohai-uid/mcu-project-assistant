import { SignJWT, jwtVerify } from "jose";

const DEV_FALLBACK = "dev-jwt-secret-change-in-production";

const getSecret = () => {
  const s = process.env.JWT_SECRET || DEV_FALLBACK;
  return new TextEncoder().encode(s);
};

export interface JwtPayload {
  userId: string;
  email: string;
  membership: string;
}

export async function signToken(payload: JwtPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("7d")
    .sign(getSecret());
}

export async function verifyToken(
  token: string
): Promise<JwtPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return payload as unknown as JwtPayload;
  } catch {
    return null;
  }
}
