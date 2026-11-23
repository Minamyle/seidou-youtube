import { NextRequest, NextResponse } from "next/server"
import { isAsos, scrapeAsos } from "@/lib/product-collector/asos"
import { scrapeGeneric } from "@/lib/product-collector/generic"
import { isCollectableUrl } from "@/lib/product-collector/safety"

// Product Collector, merged from the for_amina repository:
// GET /api/products/collect?url=<shop link>&limit=48&offset=0&details=1

export const runtime = "nodejs"
export const maxDuration = 60
export const dynamic = "force-dynamic"

function clamp(value: string | null, fallback: number, min: number, max: number) {
  const n = Number(value)
  if (!Number.isFinite(n) || value === null || value === "") return fallback
  return Math.min(max, Math.max(min, Math.floor(n)))
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const raw = searchParams.get("url")

  if (!raw) return NextResponse.json({ error: "Missing url parameter" }, { status: 400 })

  let target: URL
  try {
    target = new URL(raw.trim())
  } catch {
    return NextResponse.json({ error: "That is not a valid link" }, { status: 400 })
  }

  if (!isCollectableUrl(target)) {
    return NextResponse.json({ error: "That link cannot be collected" }, { status: 400 })
  }

  const limit = clamp(searchParams.get("limit"), 48, 1, 200)
  const offset = clamp(searchParams.get("offset"), 0, 0, 100000)
  const deep = searchParams.get("details") === "1"

  try {
    const result = isAsos(target) ? await scrapeAsos(target, limit, offset, deep) : await scrapeGeneric(target)
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong"
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
