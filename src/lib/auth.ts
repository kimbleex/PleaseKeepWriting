import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const JWT_SECRET = (import.meta.env ? import.meta.env.JWT_SECRET : process.env.JWT_SECRET) || 'default_super_secret_for_dev_only';

export function signToken(payload: any) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

export function verifyToken(token: string) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export function getUserFromCookie(cookies: any) {
  const token = cookies.get('auth_token')?.value;
  if (!token) return null;
  return verifyToken(token) as { id: string; username: string; role: string } | null;
}
