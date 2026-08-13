import { NextRequest, NextResponse } from "next/server";
import { activateAuthenticatedRequestContext, requireAdmin } from "@/lib/api-auth";
import { getCachedWbPhoto } from "@/lib/wb-photo-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ nmId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  activateAuthenticatedRequestContext(request);

  const nmId = Number((await params).nmId);
  if (!Number.isSafeInteger(nmId) || nmId <= 0) {
    return NextResponse.json({ error: "Некорректный артикул WB" }, { status: 400 });
  }

  const photo = await getCachedWbPhoto(nmId);
  if (!photo) {
    return NextResponse.json({ error: "У карточки WB нет доступной фотографии" }, { status: 404 });
  }

  const body = photo.bytes.buffer.slice(
    photo.bytes.byteOffset,
    photo.bytes.byteOffset + photo.bytes.byteLength,
  ) as ArrayBuffer;
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "private, max-age=86400, stale-while-revalidate=604800",
      "X-MpHub-Image-Cache": photo.cacheState,
    },
  });
}
