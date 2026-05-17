import { NextRequest, NextResponse } from "next/server";
import {
  getTranslationVersions,
  insertTranslationVersion,
  updateTranslationVersionLabel,
  deleteTranslationVersion,
} from "@/lib/db/queries";
import { getActiveWorkspaceId } from "@/lib/workspace";

export const dynamic = "force-dynamic";

/** GET ?translationId=&osisRef= → { versions: TranslationVersion[] } */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const translationId = parseInt(searchParams.get("translationId") ?? "0", 10);
  const osisRef       = searchParams.get("osisRef") ?? "";
  const versions = await getTranslationVersions(translationId, osisRef);
  return NextResponse.json({ versions });
}

/** POST { translationId, osisRef, text, label? } → { version: TranslationVersion } */
export async function POST(req: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  const { translationId, osisRef, text, label } = await req.json();
  const version = await insertTranslationVersion(
    workspaceId, translationId, osisRef, text, label ?? undefined,
  );
  return NextResponse.json({ version });
}

/** PATCH { id, label } → { success: true } */
export async function PATCH(req: NextRequest) {
  const { id, label } = await req.json();
  await updateTranslationVersionLabel(id as number, label ?? null);
  return NextResponse.json({ success: true });
}

/** DELETE { id } → { success: true } */
export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  await deleteTranslationVersion(id as number);
  return NextResponse.json({ success: true });
}
