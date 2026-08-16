import { prisma } from "../config/prisma";

export interface OrgSettingsData {
  phone: string;
  email: string;
  website: string;
  address: string;
  logo_url: string | null;
  seal_image_url: string | null;
  signature_image_url: string | null;
  signatory_name: string | null;
}

export const DEFAULT_ORG_SETTINGS: OrgSettingsData = {
  phone: "+91 92134 08880 / +91 98258 61572 / +91 98258 61573",
  email: "support@nooreharam.in",
  website: "www.nooreharam.in",
  address: "AT. & PO. Umalla (Dumala), Vaghpura, Near Masjid, Main Road, Ta. Jhagadia, Dist. Bharuch - 393120, Gujarat, India",
  logo_url: null,
  seal_image_url: null,
  signature_image_url: "/signature.png",
  signatory_name: "Afzal Shaikh",
};

let cachedSettings: OrgSettingsData | null = null;
let cacheExpiry: number = 0;

/**
 * Retrieves the Organization Settings singleton.
 * Uses 5-minute in-memory caching and fallbacks if database row is missing.
 */
export async function getOrgSettings(): Promise<OrgSettingsData> {
  const now = Date.now();
  if (cachedSettings && now < cacheExpiry) {
    return cachedSettings;
  }

  try {
    const orgSettingsDelegate = (prisma as any).orgSettings;
    const row = orgSettingsDelegate ? await orgSettingsDelegate.findFirst() : null;

    if (!row) {
      cachedSettings = DEFAULT_ORG_SETTINGS;
    } else {
      cachedSettings = {
        phone: row.phone || DEFAULT_ORG_SETTINGS.phone,
        email: row.email || DEFAULT_ORG_SETTINGS.email,
        website: row.website || DEFAULT_ORG_SETTINGS.website,
        address: row.address || DEFAULT_ORG_SETTINGS.address,
        logo_url: row.logoUrl || null,
        seal_image_url: row.sealImageUrl || null,
        signature_image_url: row.signatureImageUrl || null,
        signatory_name: row.signatoryName || DEFAULT_ORG_SETTINGS.signatory_name,
      };
    }
    cacheExpiry = now + 5 * 60 * 1000; // 5 minute TTL
    return cachedSettings;
  } catch (err) {
    console.error("[orgSettings] Error fetching org settings:", err);
    return DEFAULT_ORG_SETTINGS;
  }
}

/**
 * Invalidates the 5-minute Organization Settings cache.
 */
export function invalidateOrgSettingsCache(): void {
  cachedSettings = null;
  cacheExpiry = 0;
}

/**
 * Upserts the singleton Organization Settings row and invalidates cache.
 */
export async function updateOrgSettings(data: Partial<OrgSettingsData>): Promise<OrgSettingsData> {
  const orgSettingsDelegate = (prisma as any).orgSettings;
  if (!orgSettingsDelegate) {
    return DEFAULT_ORG_SETTINGS;
  }

  const firstRow = await orgSettingsDelegate.findFirst();
  const targetId = firstRow?.id || "default";

  await orgSettingsDelegate.upsert({
    where: { id: targetId },
    create: {
      id: "default",
      phone: data.phone ?? DEFAULT_ORG_SETTINGS.phone,
      email: data.email ?? DEFAULT_ORG_SETTINGS.email,
      website: data.website ?? DEFAULT_ORG_SETTINGS.website,
      address: data.address ?? DEFAULT_ORG_SETTINGS.address,
      logoUrl: data.logo_url ?? null,
      sealImageUrl: data.seal_image_url ?? null,
      signatureImageUrl: data.signature_image_url ?? null,
      signatoryName: data.signatory_name ?? DEFAULT_ORG_SETTINGS.signatory_name,
    },
    update: {
      ...(data.phone !== undefined && { phone: data.phone }),
      ...(data.email !== undefined && { email: data.email }),
      ...(data.website !== undefined && { website: data.website }),
      ...(data.address !== undefined && { address: data.address }),
      ...(data.logo_url !== undefined && { logoUrl: data.logo_url }),
      ...(data.seal_image_url !== undefined && { sealImageUrl: data.seal_image_url }),
      ...(data.signature_image_url !== undefined && { signatureImageUrl: data.signature_image_url }),
      ...(data.signatory_name !== undefined && { signatoryName: data.signatory_name }),
    },
  });

  invalidateOrgSettingsCache();
  return getOrgSettings();
}
