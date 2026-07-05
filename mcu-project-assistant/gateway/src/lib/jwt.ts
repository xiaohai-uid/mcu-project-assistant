import jwt from "jsonwebtoken";

const SECRET = () => {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET not configured");
  return s;
};

export interface JwtPayload {
  userId: string;
  email: string;
  membership: string;
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, SECRET(), { expiresIn: "7d" });
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    const decoded = jwt.verify(token, SECRET()) as JwtPayload;
    return decoded;
  } catch {
    return null;
  }
}
