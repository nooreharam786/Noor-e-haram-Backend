import crypto from "crypto";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { env } from "../config/env";
import { asyncHandler, HttpError } from "../utils/http";
import { comparePassword, createResetToken, hashPassword, signAccessToken } from "../utils/security";
import { strongPassword } from "../utils/validation";
import { sendPasswordResetEmail } from "../services/email.service";

const publicUserSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  createdAt: true
} as const;

type OAuthProvider = "google" | "apple";

function apiBaseUrl(req: any) {
  return env.API_PUBLIC_URL ?? `${req.protocol}://${req.get("host")}`;
}

function redirectUri(req: any, provider: OAuthProvider) {
  return `${apiBaseUrl(req)}/api/auth/oauth/${provider}/callback`;
}

function createState(provider: OAuthProvider) {
  const payload = Buffer.from(JSON.stringify({ provider, nonce: crypto.randomBytes(16).toString("hex") })).toString("base64url");
  const signature = crypto.createHmac("sha256", env.JWT_SECRET).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function verifyState(value: string, provider: OAuthProvider) {
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return false;

  const expected = crypto.createHmac("sha256", env.JWT_SECRET).update(payload).digest("base64url");
  const received = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (received.length !== expectedBuffer.length || !crypto.timingSafeEqual(received, expectedBuffer)) return false;

  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString()) as { provider?: string };
  return parsed.provider === provider;
}

function decodeJwtPayload<T>(token: string) {
  const payload = token.split(".")[1];
  if (!payload) throw new HttpError(401, "OAuth provider did not return a valid identity token");
  return JSON.parse(Buffer.from(payload, "base64url").toString()) as T;
}

async function issueOAuthSession(email: string, name?: string) {
  const normalizedEmail = email.toLowerCase();
  const user = await prisma.user.upsert({
    where: { email: normalizedEmail },
    update: {},
    create: {
      email: normalizedEmail,
      name: name?.trim() || normalizedEmail.split("@")[0],
      password: await hashPassword(`${crypto.randomBytes(24).toString("hex")}Aa1!`)
    },
    select: publicUserSelect
  });

  const token = signAccessToken({ sub: user.id, email: user.email, role: user.role });
  return { user, token };
}

export const registerSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2),
    email: z.string().trim().email().toLowerCase(),
    password: strongPassword
  })
});

export const loginSchema = z.object({
  body: z.object({
    email: z.string().trim().email().toLowerCase(),
    password: z.string().min(1)
  })
});

export const forgotPasswordSchema = z.object({
  body: z.object({
    email: z.string().trim().email().toLowerCase()
  })
});

export const resetPasswordSchema = z.object({
  body: z.object({
    token: z.string().min(32),
    password: strongPassword
  })
});

export const register = asyncHandler(async (req, res) => {
  const existing = await prisma.user.findUnique({ where: { email: req.body.email } });
  if (existing) {
    throw new HttpError(409, "Email is already registered");
  }

  const user = await prisma.user.create({
    data: {
      name: req.body.name,
      email: req.body.email,
      password: await hashPassword(req.body.password)
    },
    select: publicUserSelect
  });

  const token = signAccessToken({ sub: user.id, email: user.email, role: user.role });
  res.status(201).json({ success: true, data: { user, token } });
});

export const login = asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { email: req.body.email } });
  if (!user) {
    throw new HttpError(401, "Invalid email or password");
  }

  if (!(await comparePassword(req.body.password, user.password))) {
    throw new HttpError(401, "Invalid email or password");
  }

  const token = signAccessToken({ sub: user.id, email: user.email, role: user.role });
  res.json({
    success: true,
    data: {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt
      },
      token
    }
  });
});

export const startOAuth = asyncHandler(async (req, res) => {
  const provider = req.params.provider as OAuthProvider;
  if (!["google", "apple"].includes(provider)) {
    throw new HttpError(404, "OAuth provider is not supported");
  }

  const callbackUrl = redirectUri(req, provider);
  const state = createState(provider);

  if (provider === "google") {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
      throw new HttpError(503, "Google sign-in is not configured");
    }

    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
    url.searchParams.set("redirect_uri", callbackUrl);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("state", state);
    res.redirect(url.toString());
    return;
  }

  if (!env.APPLE_CLIENT_ID || !env.APPLE_CLIENT_SECRET) {
    throw new HttpError(503, "Apple sign-in is not configured");
  }

  const url = new URL("https://appleid.apple.com/auth/authorize");
  url.searchParams.set("client_id", env.APPLE_CLIENT_ID);
  url.searchParams.set("redirect_uri", callbackUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "name email");
  url.searchParams.set("response_mode", "form_post");
  url.searchParams.set("state", state);
  res.redirect(url.toString());
});

export const finishOAuth = asyncHandler(async (req, res) => {
  const provider = req.params.provider as OAuthProvider;
  const code = String(req.body.code ?? req.query.code ?? "");
  const state = String(req.body.state ?? req.query.state ?? "");

  if (!["google", "apple"].includes(provider) || !code || !verifyState(state, provider)) {
    throw new HttpError(400, "OAuth sign-in could not be verified");
  }

  if (provider === "google") {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID!,
        client_secret: env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: redirectUri(req, provider),
        grant_type: "authorization_code"
      })
    });
    const tokenData = (await tokenResponse.json()) as { id_token?: string; error_description?: string };
    if (!tokenResponse.ok || !tokenData.id_token) {
      throw new HttpError(401, tokenData.error_description ?? "Google sign-in failed");
    }

    const profileResponse = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${tokenData.id_token}`);
    const profile = (await profileResponse.json()) as { email?: string; name?: string };
    if (!profileResponse.ok || !profile.email) throw new HttpError(401, "Google did not return an email address");

    const { token } = await issueOAuthSession(profile.email, profile.name);
    res.redirect(`${env.FRONTEND_URL}/oauth/callback?token=${encodeURIComponent(token)}`);
    return;
  }

  const tokenResponse = await fetch("https://appleid.apple.com/auth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.APPLE_CLIENT_ID!,
      client_secret: env.APPLE_CLIENT_SECRET!,
      redirect_uri: redirectUri(req, provider),
      grant_type: "authorization_code"
    })
  });
  const tokenData = (await tokenResponse.json()) as { id_token?: string; error?: string };
  if (!tokenResponse.ok || !tokenData.id_token) {
    throw new HttpError(401, tokenData.error ?? "Apple sign-in failed");
  }

  const profile = decodeJwtPayload<{ email?: string }>(tokenData.id_token);
  if (!profile.email) throw new HttpError(401, "Apple did not return an email address");

  const { token } = await issueOAuthSession(profile.email);
  res.redirect(`${env.FRONTEND_URL}/oauth/callback?token=${encodeURIComponent(token)}`);
});

export const me = asyncHandler(async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: req.user!.id },
    select: { ...publicUserSelect, applications: true }
  });
  res.json({ success: true, data: user });
});

export const forgotPassword = asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { email: req.body.email } });
  if (user) {
    const { token, tokenHash } = createResetToken();
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000)
      }
    });

    await sendPasswordResetEmail(user.email, `${env.FRONTEND_URL}/reset-password?token=${token}`);
  }

  res.json({ success: true, message: "If the email exists, a reset link has been sent" });
});

export const resetPassword = asyncHandler(async (req, res) => {
  const tokenHash = crypto.createHash("sha256").update(req.body.token).digest("hex");
  const resetToken = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });

  if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
    throw new HttpError(400, "Reset token is invalid or expired");
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: resetToken.userId },
      data: { password: await hashPassword(req.body.password) }
    }),
    prisma.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { usedAt: new Date() }
    })
  ]);

  res.json({ success: true, message: "Password reset successful" });
});
