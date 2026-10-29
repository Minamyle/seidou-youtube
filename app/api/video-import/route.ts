import { type NextRequest, NextResponse } from "next/server"
import { randomUUID } from "crypto"
import { getServiceClient, SupabaseConfigError } from "@/lib/supabase/server"
import {
  BATCH_IMAGE_BUCKET,
  IMAGE_FILE_MAX_BYTES,
  IMAGE_MIME_TYPES,
  MAX_REQUEST_BYTES,
  SIGNED_URL_TTL_SECONDS,
} from "@/lib/video-import/config"
import {
  readJsonFile,
  validateImageFile,
  validateVideoRecords,
  getExtension,
  type ValidationIssue,
} from "@/lib/video-import/validation"
import type { VideoPlatform } from "@/lib/video-import/config"

export const runtime = "nodejs"

interface ImportSuccessResponse {
  ok: true
  batchId: string
  status: "completed"
  counts: {
    processed: number
    inserted: number
    skippedExisting: number
    failed: number
    duplicatesInFile: number
  }
  category: string | null
  channelNames: string[]
  platforms: VideoPlatform[]
  image: { path: string; signedUrl: string | null }
}

function fail(
  status: number,
  code: string,
  error: string,
  issues?: ValidationIssue[],
): NextResponse {
  return NextResponse.json({ ok: false, code, error, ...(issues ? { issues } : {}) }, { status })
}

function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80)
  return cleaned || "batch-image"
}

/**
 * The browser may send the original .html filename alongside the synthesized
 * JSON payload, so the batch record shows what the user actually uploaded.
 */
function sanitizeSourceFilename(value: FormDataEntryValue | null, fallback: string): string {
  if (typeof value !== "string") return fallback

  const cleaned = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/]+/g, "_")
    .trim()
    .slice(0, 200)

  return cleaned || fallback
}

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") ?? "0")
  if (contentLength > MAX_REQUEST_BYTES) {
    return fail(413, "payload_too_large", "The selected files are too large for one import. Choose a smaller JSON file or image.")
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return fail(400, "invalid_request", "The request could not be read. Check the files and try again.")
  }

  const jsonFile = form.get("jsonFile")
  const imageFile = form.get("image")
  const acknowledged = form.get("conflictsAcknowledged") === "true"
  const sourceFilenameField = form.get("sourceFilename")

  if (!(jsonFile instanceof File)) {
    return fail(400, "missing_json", "No JSON file was uploaded. Choose a JSON file and try again.")
  }

  if (!(imageFile instanceof File)) {
    return fail(400, "missing_image", "No batch image was uploaded. Choose one image and try again.")
  }

  const readResult = await readJsonFile(jsonFile)
  if (!readResult.ok) {
    return fail(422, "invalid_json_file", "The JSON file could not be accepted.", readResult.issues)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(readResult.text)
  } catch {
    return fail(422, "invalid_json_file", "The JSON file could not be accepted.", [
      { severity: "error", message: "The file is not valid JSON." },
    ])
  }

  const validation = validateVideoRecords(parsed)

  if (!validation.ok) {
    return fail(422, "validation_failed", "The JSON file failed validation. Fix the issues and try again.", validation.issues)
  }

  const conflictsRequireAcknowledgment = validation.categoryConflict || validation.channelConflict

  if (conflictsRequireAcknowledgment && !acknowledged) {
    const detail = [
      validation.categoryConflict ? `categories: ${validation.categories.join(", ")}` : null,
      validation.channelConflict ? `channels: ${validation.channelNames.join(", ")}` : null,
    ]
      .filter(Boolean)
      .join("; ")

    return NextResponse.json(
      {
        ok: false,
        code: "conflicts_require_acknowledgment",
        error: `This batch contains conflicting values (${detail}). Confirm the batch resolution on the import form and submit again.`,
        requiresAcknowledgment: true,
      },
      { status: 409 },
    )
  }

  if (validation.records.length === 0) {
    return fail(422, "validation_failed", "No importable records were found in the JSON file.", validation.issues)
  }

  const imageValidation = await validateImageFile(imageFile)
  if (!imageValidation.ok) {
    return fail(422, "invalid_image", "The batch image was not accepted.", imageValidation.issues)
  }

  if (imageFile.size > IMAGE_FILE_MAX_BYTES) {
    return fail(413, "invalid_image", "The batch image is too large.", [
      { severity: "error", message: "Choose an image smaller than the configured size limit." },
    ])
  }

  if (!IMAGE_MIME_TYPES.includes(imageFile.type as (typeof IMAGE_MIME_TYPES)[number])) {
    return fail(415, "invalid_image", "The batch image type is not supported. Use JPEG, PNG, or WebP.")
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
  const extension = getExtension(imageFile.name)
  const imageContentType = imageFile.type
  const imagePath = `${batchId}/${sanitizeFileName(imageFile.name)}${extension && !imageFile.name.toLowerCase().endsWith(extension) ? extension : ""}`
  const sourceFilename = sanitizeSourceFilename(sourceFilenameField, jsonFile.name)

  const { error: batchError } = await supabase.from("video_import_batches").insert({
    id: batchId,
    source_filename: sourceFilename,
    category: validation.category,
    channel_names: validation.channelNames,
    platforms: validation.platforms,
    status: "pending",
    records_processed: validation.records.length,
  })

  if (batchError) {
    console.error("[video-import] batch insert failed:", JSON.stringify({ code: batchError.code, message: batchError.message, details: batchError.details, hint: batchError.hint }))
    return fail(500, "database_error", "The import could not be started because of a database error. Nothing was imported. Try again.")
  }

  let imageBytes: ArrayBuffer
  try {
    imageBytes = await imageFile.arrayBuffer()
  } catch {
    await markBatchFailed(supabase, batchId, "The batch image could not be read.")
    return fail(500, "image_upload_failed", "The batch image could not be read. Nothing was imported. Try again.")
  }

  const { error: uploadError } = await supabase.storage
    .from(BATCH_IMAGE_BUCKET)
    .upload(imagePath, imageBytes, { contentType: imageContentType, upsert: false })

  if (uploadError) {
    console.error("[video-import] storage upload failed:", JSON.stringify({ message: uploadError.message, name: (uploadError as any).name }))
    await markBatchFailed(supabase, batchId, "The batch image could not be uploaded.")
    return fail(502, "image_upload_failed", "The batch image could not be uploaded to storage. Nothing was imported. Check your connection and try again.")
  }

  const records = validation.records.map((record) => ({
    video_url: record.videoUrl,
    platform: record.platform,
    external_id: record.externalId,
    video_title: record.videoTitle,
    category: record.category,
    channel_name: record.channelName,
    actual_channel_name: record.actualChannelName,
    is_unrelated_channel: record.isUnrelatedChannel,
  }))

  const { data: rpcData, error: rpcError } = await supabase.rpc("import_video_batch", {
    p_batch_id: batchId,
    p_records: records,
  })

  if (rpcError) {
    await supabase.storage.from(BATCH_IMAGE_BUCKET).remove([imagePath])
    await markBatchFailed(supabase, batchId, "The video records could not be imported.")
    console.error("[video-import] rpc import_video_batch failed:", rpcError.code, rpcError.message, rpcError.details)
    return fail(500, "database_error", "The video records could not be imported. The import was rolled back and nothing was added to the catalogue. Try again.")
  }

  const counts = {
    processed: Number(rpcData?.processed ?? records.length),
    inserted: Number(rpcData?.inserted ?? 0),
    skippedExisting: Number(rpcData?.skipped_existing ?? 0),
    failed: 0,
    duplicatesInFile: validation.duplicateCount,
  }

  let signedUrl: string | null = null
  try {
    const { data } = await supabase.storage.from(BATCH_IMAGE_BUCKET).createSignedUrl(imagePath, SIGNED_URL_TTL_SECONDS)
    signedUrl = data?.signedUrl ?? null
  } catch {
    signedUrl = null
  }

  const response: ImportSuccessResponse = {
    ok: true,
    batchId,
    status: "completed",
    counts,
    category: validation.category,
    channelNames: validation.channelNames,
    platforms: validation.platforms,
    image: { path: imagePath, signedUrl },
  }

  return NextResponse.json(response)
}

async function markBatchFailed(
  supabase: ReturnType<typeof getServiceClient>,
  batchId: string,
  message: string,
): Promise<void> {
  try {
    await supabase
      .from("video_import_batches")
      .update({ status: "failed", error_message: message })
      .eq("id", batchId)
  } catch {
    return
  }
}
