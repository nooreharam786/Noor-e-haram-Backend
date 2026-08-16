import { z } from "zod";
import { Role } from "@prisma/client";
import { prisma } from "../config/prisma";
import { asyncHandler } from "../utils/http";
import { joinGalleryUrls } from "../utils/gallery";

const settingsKeys = {
  resultsYoutubeUrl:      "RESULTS_YOUTUBE_URL",
  galleryImageUrls:       "GALLERY_IMAGE_URLS",
  termsDocumentUrl:       "TERMS_DOCUMENT_URL",
  umrahPackagePrice:      "UMRAH_PACKAGE_PRICE",
  socialFacebookUrl:      "SOCIAL_FACEBOOK_URL",
  socialInstagramUrl:     "SOCIAL_INSTAGRAM_URL",
  socialYoutubeUrl:       "SOCIAL_YOUTUBE_URL",
  socialWhatsappUrl:      "SOCIAL_WHATSAPP_URL",
  contactAddress:         "CONTACT_ADDRESS",
  contactPhone:           "CONTACT_PHONE",
  contactEmail:           "CONTACT_EMAIL",
  googleMapsUrl:          "GOOGLE_MAPS_URL",
  officialSealUrl:        "OFFICIAL_SEAL_URL",
  authorizedSignatureUrl: "AUTHORIZED_SIGNATURE_URL",
  razorpayPublicKey:      "RAZORPAY_PUBLIC_KEY",
  paymentMode:            "PAYMENT_MODE",
  defaultDrawAmount:      "DEFAULT_DRAW_AMOUNT",
  convenienceFeePercent:  "CONVENIENCE_FEE_PERCENT"
} as const;

const optionalUrl = z.preprocess((v) => {
  if (typeof v !== "string" || v.trim() === "") return undefined;
  let str = v.trim();
  if (!/^https?:\/\//i.test(str)) {
    if (str.includes("youtube.com") || str.includes("youtu.be")) {
      str = `https://${str}`;
    } else if (!str.includes(".")) {
      str = `https://www.youtube.com/watch?v=${str}`;
    } else {
      str = `https://${str}`;
    }
  }
  return str;
}, z.string().url().optional());
const optionalEmail = z.preprocess((v) => (v === "" ? undefined : v), z.string().trim().email().optional());
const optionalString = z.preprocess((v) => (v === "" ? undefined : v), z.string().trim().optional());

export const updateSettingsSchema = z.object({
  body: z.object({
    resultsYoutubeUrl:      optionalUrl,
    galleryImageUrls:       z.string().trim().max(5000).optional(),
    termsDocumentUrl:       z.string().trim().max(1000).optional(),
    umrahPackagePrice:      z.coerce.number().int().nonnegative().max(10000000).optional(),
    socialFacebookUrl:      optionalUrl,
    socialInstagramUrl:     optionalUrl,
    socialYoutubeUrl:       optionalUrl,
    socialWhatsappUrl:      z.string().trim().max(500).optional(),
    contactAddress:         z.string().trim().max(1000).optional(),
    contactPhone:           z.string().trim().max(120).optional(),
    contactEmail:           optionalEmail,
    googleMapsUrl:          z.string().trim().max(2000).optional(),
    officialSealUrl:        z.string().trim().max(500000).optional(), // base64 or URL
    authorizedSignatureUrl: z.string().trim().max(500000).optional(), // base64 or URL
    adminName:              z.string().trim().min(2).optional(),
    adminEmail:             z.string().trim().email().toLowerCase().optional(),
    razorpayPublicKey:      z.string().trim().max(200).optional(),
    paymentMode:            z.enum(["test", "live"]).optional(),
    defaultDrawAmount:      z.coerce.number().int().positive().max(100000).optional(),
    convenienceFeePercent:  z.coerce.number().nonnegative().max(100).optional()
  })
});

export const getSettings = asyncHandler(async (_req, res) => {
  const [settings, admin] = await Promise.all([
    prisma.setting.findMany(),
    prisma.user.findFirst({ where: { role: Role.admin }, select: { name: true, email: true } })
  ]);
  const values = Object.fromEntries(settings.map((s) => [s.key, s.value]));
  res.json({
    success: true,
    data: {
      resultsYoutubeUrl:      values.RESULTS_YOUTUBE_URL,
      galleryImageUrls:       joinGalleryUrls(values.GALLERY_IMAGE_URLS),
      termsDocumentUrl:       values.TERMS_DOCUMENT_URL,
      umrahPackagePrice:      Number(values.UMRAH_PACKAGE_PRICE ?? 0),
      socialFacebookUrl:      values.SOCIAL_FACEBOOK_URL,
      socialInstagramUrl:     values.SOCIAL_INSTAGRAM_URL,
      socialYoutubeUrl:       values.SOCIAL_YOUTUBE_URL,
      socialWhatsappUrl:      values.SOCIAL_WHATSAPP_URL,
      contactAddress:         values.CONTACT_ADDRESS,
      contactPhone:           values.CONTACT_PHONE,
      contactEmail:           values.CONTACT_EMAIL,
      googleMapsUrl:          values.GOOGLE_MAPS_URL,
      officialSealUrl:        values.OFFICIAL_SEAL_URL,
      authorizedSignatureUrl: values.AUTHORIZED_SIGNATURE_URL,
      razorpayPublicKey:      values.RAZORPAY_PUBLIC_KEY,
      paymentMode:            values.PAYMENT_MODE ?? "test",
      defaultDrawAmount:      Number(values.DEFAULT_DRAW_AMOUNT ?? 1499),
      convenienceFeePercent:  Number(values.CONVENIENCE_FEE_PERCENT ?? 1.25),
      admin
    }
  });
});

export const updateSettings = asyncHandler(async (req, res) => {
  const operations: any[] = [];

  for (const [bodyKey, settingKey] of Object.entries(settingsKeys)) {
    if (req.body[bodyKey] === undefined) continue;
    const value = bodyKey === "galleryImageUrls"
      ? joinGalleryUrls(req.body[bodyKey])
      : String(req.body[bodyKey] ?? "");
    operations.push(
      prisma.setting.upsert({ where: { key: settingKey }, update: { value }, create: { key: settingKey, value } })
    );
  }

  if (req.body.adminName || req.body.adminEmail) {
    operations.push(
      prisma.user.update({
        where: { id: req.user!.id },
        data: {
          ...(req.body.adminName  ? { name:  req.body.adminName }  : {}),
          ...(req.body.adminEmail ? { email: req.body.adminEmail } : {})
        }
      })
    );
  }

  if (operations.length > 0) {
    await prisma.$transaction(operations);
  }

  res.json({ success: true, message: "Settings updated" });
});
