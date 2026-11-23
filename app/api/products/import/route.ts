import { randomUUID } from "crypto"
import { type NextRequest, NextResponse } from "next/server"
import { parseProductFile } from "@/lib/product-collector/json-file"
import { toProductRecords } from "@/lib/product-collector/to-records"
import { getServiceClient, SupabaseConfigError } from "@/lib/supabase/server"
import { BATCH_IMAGE_BUCKET, MAX_REQUEST_BYTES } from "@/lib/video-import/config"
import { PLATFORM_LABELS } from "@/lib/video-import/platforms"
import { getExtension, readJsonFile, validateImageFile, type ValidationIssue } from "@/lib/video-import/validation"

// Saves products to catalogue_products (never catalogue_videos, so they never
// reach Seidou Social). Two ways in:
//
//   application/json     from the Product Collector:
//                        { "category": "...", "sourceUrl": "...", "products": [ ... ] }
//   multipart/form-data  from the Product JSON Import form:
//                        jsonFile (products.json or a library export), category,
//                        image (optional batch image)

export const runtime = "nodejs"

function fail(status: number, code: string, error: string, issues?: ValidationIssue[]) {
  return NextResponse.json({ ok: false, code, error, ...(issues ? { issues } : {}) }, { status })
}

interface ImportInput {
  products: unknown
  category: string
  sourceUrl: string
  sourceLabel: string
  image: File | null
  fileIssues: ValidationIssue[]
}

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") ?? "0")
  if (contentLength > MAX_REQUEST_BYTES) {
    return fail(413, "payload_too_large", "Too much data for one import. Import fewer products at a time.")
  }

  const isForm = (request.headers.get("content-type") ?? "").includes("multipart/form-data")
  const input = isForm ? await readFormInput(request) : await readJsonInput(request)
  if (input instanceof NextResponse) return input

  return importProducts(input)
}

async function readJsonInput(request: NextRequest): Promise<ImportInput | NextResponse> {
  let body: { category?: unknown; sourceUrl?: unknown; products?: unknown }
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "The request could not be read.")
  }

  const sourceUrl = typeof body.sourceUrl === "string" ? body.sourceUrl.slice(0, 2000) : ""
  return {
    products: body.products,
    category: typeof body.category === "string" ? body.category.slice(0, 200) : "",
    sourceUrl,
    sourceLabel: sourceUrl || "Product Collector",
    image: null,
    fileIssues: [],
  }
}

async function readFormInput(request: NextRequest): Promise<ImportInput | NextResponse> {
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return fail(400, "invalid_request", "The request could not be read. Check the files and try again.")
  }

  const jsonFile = form.get("jsonFile")
  if (!(jsonFile instanceof File)) {
    return fail(400, "missing_json", "No JSON file was uploaded. Choose a JSON file and try again.")
  }

  const read = await readJsonFile(jsonFile)
  if (!read.ok) return fail(422, "invalid_json_file", "The JSON file could not be accepted.", read.issues)

  const file = parseProductFile(JSON.parse(read.text))
  if (!file.ok) return fail(422, "invalid_json_file", "The JSON file has no products to import.", file.issues)

  const image = form.get("image")
  const category = form.get("category")

  return {
    products: file.products,
    category: typeof category === "string" ? category.slice(0, 200) : "",
    sourceUrl: file.sourceUrl,
    sourceLabel: jsonFile.name.slice(0, 200),
    image: image instanceof File && image.size > 0 ? image : null,
    fileIssues: [...read.issues, ...file.issues],
  }
}

async function importProducts(input: ImportInput) {
  const conversion = toProductRecords(input.products, { category: input.category, sourceUrl: input.sourceUrl })
  const issues = [...input.fileIssues, ...conversion.issues]

  if (!conversion.ok) {
    return fail(422, "validation_failed", "These products could not be imported.", issues)
  }

  if (input.image) {
    const imageCheck = await validateImageFile(input.image)
    if (!imageCheck.ok) return fail(422, "invalid_image", "The batch image was not accepted.", imageCheck.issues)
  }

  let supabase
  try {
    supabase = getServiceClient()
  } catch (error) {
    if (error instanceof SupabaseConfigError) {
      return fail(503, "not_configured", "The import service is not configured. Ask an administrator to complete the Supabase setup.")
    }
    throw error
  }

  const batchId = randomUUID()
  let imagePath: string | null = null
  if (input.image) {
    const extension = getExtension(input.image.name)
    const safeName = input.image.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80) || "batch-image"
    imagePath = `${batchId}/${safeName}${extension && !safeName.toLowerCase().endsWith(extension) ? extension : ""}`
  }

  const { error: batchError } = await supabase.from("video_import_batches").insert({
    id: batchId,
    source_filename: input.sourceLabel,
    category: input.category.trim(),
    channel_names: conversion.platforms.map((platform) => PLATFORM_LABELS[platform]),
    platforms: conversion.platforms,
    image_path: imagePath,
    status: "pending",
    records_processed: conversion.records.length,
  })

  if (batchError) {
    console.error("[product-import] batch insert failed:", batchError.code, batchError.message)
    return fail(500, "database_error", "The import could not be started because of a database error. Nothing was imported.")
  }

  const markFailed = (message: string) =>
    supabase.from("video_import_batches").update({ status: "failed", error_message: message }).eq("id", batchId)

  if (input.image && imagePath) {
    const { error: uploadError } = await supabase.storage
      .from(BATCH_IMAGE_BUCKET)
      .upload(imagePath, await input.image.arrayBuffer(), { contentType: input.image.type, upsert: false })

    if (uploadError) {
      console.error("[product-import] storage upload failed:", uploadError.message)
      await markFailed("The batch image could not be uploaded.")
      return fail(502, "image_upload_failed", "The batch image could not be uploaded. Nothing was imported. Try again.")
    }
  }

  const { data, error: rpcError } = await supabase.rpc("import_product_batch", {
    p_batch_id: batchId,
    p_records: conversion.records,
  })

  if (rpcError) {
    console.error("[product-import] rpc import_product_batch failed:", rpcError.code, rpcError.message)
    if (imagePath) await supabase.storage.from(BATCH_IMAGE_BUCKET).remove([imagePath])
    await markFailed("The products could not be saved.")
    const missingFunction = rpcError.code === "PGRST202"
    const sharedLink = rpcError.code === "23505" && /product_url/.test(rpcError.message)
    return fail(
      500,
      "database_error",
      missingFunction
        ? "The products table is not set up yet. Run the 20261123130000_product_collector.sql migration in Supabase."
        : sharedLink
          ? "Some products share one link (ASOS sets do this). Run the 20261123140000_allow_shared_product_links.sql migration in Supabase, then import again. Nothing was imported."
          : // An internal tool: show the database's reason so failures can be fixed.
            `The products could not be saved. Nothing was imported. Database said: ${rpcError.message}`,
    )
  }

  return NextResponse.json({
    ok: true,
    batchId,
    counts: {
      processed: Number(data?.processed ?? conversion.records.length),
      inserted: Number(data?.inserted ?? 0),
      updated: Number(data?.updated ?? 0),
      skipped: Number(data?.skipped ?? 0),
    },
    platforms: conversion.platforms,
    imagePath,
    issues,
  })
}
