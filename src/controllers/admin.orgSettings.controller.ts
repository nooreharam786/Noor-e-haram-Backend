import { Request, Response } from "express";
import { asyncHandler, HttpError } from "../utils/http";
import { getOrgSettings, updateOrgSettings } from "../services/orgSettings.service";
import { logAdminAction } from "../services/audit.service";
import { prisma } from "../config/prisma";

export const getAdminOrgSettings = asyncHandler(async (_req: Request, res: Response) => {
  const settings = await getOrgSettings();
  res.json({ success: true, data: settings });
});

export const updateAdminOrgSettings = asyncHandler(async (req: Request, res: Response) => {
  const updated = await updateOrgSettings(req.body);
  if (req.user?.id) {
    await logAdminAction(req.user.id, "UPDATE_ORG_SETTINGS", "OrgSettings", undefined, req.body);
  }
  res.json({ success: true, data: updated });
});

export const uploadOrgSettingAsset = asyncHandler(async (req: Request, res: Response) => {
  const file = req.file as Express.Multer.File | undefined;
  if (!file) {
    throw new HttpError(422, "Please choose an image file to upload");
  }

  // Save image as base64 data URL or stored asset
  const dataUrl = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;

  // Optionally store record in GalleryItem table for persistence tracking
  await prisma.galleryItem.create({
    data: {
      imageUrl: dataUrl,
      caption: file.originalname,
      category: "OrgSettings",
      isVisible: true,
    },
  }).catch(() => undefined);

  res.status(201).json({
    success: true,
    data: { url: dataUrl }
  });
});
