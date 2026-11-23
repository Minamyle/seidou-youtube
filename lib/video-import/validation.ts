import { z } from "zod"
import {
  IMAGE_EXTENSIONS,
  IMAGE_FILE_MAX_BYTES,
  IMAGE_MIME_TYPES,
  JSON_FILE_MAX_BYTES,
  KNOWN_JSON_FIELDS,
  MAX_RECORDS_PER_IMPORT,
  SUPPORTED_PLATFORMS,
  type VideoPlatform,
} from "./config"
import {
  detectVideoPlatform,
  emptyPlatformCounts,
  isRetailPlatform,
  PLATFORM_LABELS,
  SUPPORTED_PLATFORM_LIST,
} from "./platforms"

export interface ValidationIssue {
  severity: "error" | "warning"
  recordIndex?: number
  field?: string
  message: string
}

export interface VideoRecordInput {
  videoUrl: string
  platform: VideoPlatform
  externalId: string
  videoTitle: string
  category: string
  channelName: string
  actualChannelName: string | null
  isUnrelatedChannel: boolean
  imageUrl: string | null
}

export interface ImportValidationResult {
  ok: boolean
  totalRecords: number
  validCount: number
  invalidCount: number
  duplicateCount: number
  records: VideoRecordInput[]
  categories: string[]
  category: string | null
  categoryConflict: boolean
  channelNames: string[]
  channelConflict: boolean
  platforms: VideoPlatform[]
  platformCounts: Record<VideoPlatform, number>
  issues: ValidationIssue[]
}

export type JsonReadResult =
  | { ok: true; text: string; issues: ValidationIssue[] }
  | { ok: false; issues: ValidationIssue[] }

function optionalHttpUrl(example: string) {
  return z
    .string()
    .trim()
    .superRefine((value, ctx) => {
      if (!value) return
      try {
        const parsed = new URL(value)
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "must start with http:// or https://" })
        }
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `must be a full URL such as ${example}` })
      }
    })
    .nullish()
    .transform((value) => (value ? value : null))
}

const videoRecordSchema = z
  .object({
    category: z.string().trim().min(1, "must not be empty"),
    channelName: z.string().trim().min(1, "must not be empty"),
    videoTitle: z.string().trim().min(1, "must not be empty"),
    videoUrl: z
      .string()
      .trim()
      .min(1, "must not be empty")
      .superRefine((value, ctx) => {
        try {
          const parsed = new URL(value)
          if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "must start with http:// or https://",
            })
            return
          }
        } catch {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "must be a full URL such as https://www.youtube.com/watch?v=..., https://x.com/user/status/... or a product page link",
          })
          return
        }

        if (!detectVideoPlatform(value)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `must be a ${SUPPORTED_PLATFORM_LIST} link - the video player only supports those platforms. Retail links must be a product page (for example .../prd/123, ...-g-123.html or ...-p-123.html)`,
          })
        }
      }),
    platform: z.enum(SUPPORTED_PLATFORMS).optional(),
    actualChannelName: z.string().trim().min(1, "must not be empty when provided").nullish(),
    isUnrelatedChannel: z.boolean().optional().default(false),
    imageUrl: optionalHttpUrl("https://img.ltwebstatic.com/images3/product.jpg"),
  })
  .superRefine((value, ctx) => {
    const detected = detectVideoPlatform(value.videoUrl)

    if (detected && isRetailPlatform(detected.platform) && !value.imageUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["imageUrl"],
        message: `is required for ${PLATFORM_LABELS[detected.platform]} products - it is the picture shown in the feed`,
      })
    }

    if (detected && !isRetailPlatform(detected.platform) && value.imageUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["imageUrl"],
        message: `is only used for ASOS, Temu and SHEIN products; ${PLATFORM_LABELS[detected.platform]} videos play from videoUrl. Remove it`,
      })
    }

    if (!value.platform) return

    if (detected && detected.platform !== value.platform) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["platform"],
        message: `is "${value.platform}" but the video URL is a ${PLATFORM_LABELS[detected.platform]} link`,
      })
    }
  })

export function describeJsonParseError(rawMessage: string, text: string): string {
  const lineColumnMatch = rawMessage.match(/line (\d+) column (\d+)/i)
  if (lineColumnMatch) {
    return `The file is not valid JSON (problem at line ${lineColumnMatch[1]}, column ${lineColumnMatch[2]}). Check for missing commas, quotes, or brackets.`
  }

  const positionMatch = rawMessage.match(/position (\d+)/i)
  if (positionMatch) {
    const position = Math.min(Number(positionMatch[1]), text.length)
    const upto = text.slice(0, position)
    const line = upto.split("\n").length
    const lastNewline = upto.lastIndexOf("\n")
    const column = position - lastNewline
    return `The file is not valid JSON (problem at line ${line}, column ${column}). Check for missing commas, quotes, or brackets.`
  }

  return "The file is not valid JSON. Open it in a text editor to check its structure."
}

export async function readJsonFile(file: File | null | undefined): Promise<JsonReadResult> {
  if (!file) {
    return {
      ok: false,
      issues: [{ severity: "error", message: "No JSON file selected. Choose a .json file to continue." }],
    }
  }

  const issues: ValidationIssue[] = []

  if (file.size === 0) {
    return {
      ok: false,
      issues: [{ severity: "error", message: `"${file.name}" is empty (0 bytes). Choose a file with video records.` }],
    }
  }

  if (file.size > JSON_FILE_MAX_BYTES) {
    const maxMb = Math.round(JSON_FILE_MAX_BYTES / (1024 * 1024))
    return {
      ok: false,
      issues: [
        {
          severity: "error",
          message: `"${file.name}" is ${formatBytes(file.size)}, which is larger than the ${maxMb} MB limit. Split the file into smaller batches.`,
        },
      ],
    }
  }

  if (!file.name.toLowerCase().endsWith(".json")) {
    issues.push({
      severity: "warning",
      message: `"${file.name}" does not have a .json extension. The content is validated anyway.`,
    })
  }

  let text: string
  try {
    text = await file.text()
  } catch {
    return {
      ok: false,
      issues: [{ severity: "error", message: `"${file.name}" could not be read. Try selecting the file again.` }],
    }
  }

  try {
    JSON.parse(text)
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown parse error"
    return { ok: false, issues: [...issues, { severity: "error", message: describeJsonParseError(message, text) }] }
  }

  return { ok: true, text, issues }
}

/** Shown when a Product Collector file is given to the video import. */
export const PRODUCT_FILE_MESSAGE =
  "This is a products file from the Product Collector, not a video file. Import it on the Product Import page: click Product Import at the top, then the \"Import a JSON file\" tab."

/**
 * The Product Collector's products.json ({ source, title, products: [...] }, or
 * just the products array). Those records have name/image instead of
 * videoUrl/videoTitle, so the video checks would only say "invalid".
 */
export function isProductCollectorFile(parsed: unknown): boolean {
  const isObject = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value)

  if (isObject(parsed) && Array.isArray(parsed.products)) return true
  return (
    Array.isArray(parsed) &&
    parsed.length > 0 &&
    parsed.every((item) => isObject(item) && "name" in item && "image" in item && !("videoUrl" in item))
  )
}

export function validateVideoRecords(parsed: unknown): ImportValidationResult {
  const issues: ValidationIssue[] = []

  if (isProductCollectorFile(parsed)) {
    return {
      ok: false,
      totalRecords: 0,
      validCount: 0,
      invalidCount: 0,
      duplicateCount: 0,
      records: [],
      categories: [],
      category: null,
      categoryConflict: false,
      channelNames: [],
      channelConflict: false,
      platforms: [],
      platformCounts: emptyPlatformCounts(),
      issues: [{ severity: "error", message: PRODUCT_FILE_MESSAGE }],
    }
  }

  if (!Array.isArray(parsed)) {
    return {
      ok: false,
      totalRecords: 0,
      validCount: 0,
      invalidCount: 0,
      duplicateCount: 0,
      records: [],
      categories: [],
      category: null,
      categoryConflict: false,
      channelNames: [],
      channelConflict: false,
      platforms: [],
      platformCounts: emptyPlatformCounts(),
      issues: [
        {
          severity: "error",
          message:
            "The file must contain an array of video records (a top-level list wrapped in [ ]).",
        },
      ],
    }
  }

  if (parsed.length === 0) {
    return {
      ok: false,
      totalRecords: 0,
      validCount: 0,
      invalidCount: 0,
      duplicateCount: 0,
      records: [],
      categories: [],
      category: null,
      categoryConflict: false,
      channelNames: [],
      channelConflict: false,
      platforms: [],
      platformCounts: emptyPlatformCounts(),
      issues: [{ severity: "error", message: "The file contains no video records. Add at least one record." }],
    }
  }

  if (parsed.length > MAX_RECORDS_PER_IMPORT) {
    issues.push({
      severity: "error",
      message: `The file contains ${parsed.length} records, which exceeds the limit of ${MAX_RECORDS_PER_IMPORT} per import. Split it into smaller batches.`,
    })
  }

  const records: { record: VideoRecordInput; sourceIndex: number }[] = []
  const unrecognized = new Set<string>()
  let invalidCount = 0

  parsed.forEach((item, index) => {
    const label = `Record #${index + 1}`

    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      invalidCount += 1
      issues.push({ severity: "error", recordIndex: index, message: `${label} is not an object.` })
      return
    }

    for (const key of Object.keys(item as Record<string, unknown>)) {
      if (!(KNOWN_JSON_FIELDS as readonly string[]).includes(key)) {
        unrecognized.add(key)
      }
    }

    const result = videoRecordSchema.safeParse(item)

    if (!result.success) {
      invalidCount += 1
      for (const issue of result.error.issues) {
        const field = issue.path.join(".")
        issues.push({
          severity: "error",
          recordIndex: index,
          field,
          message: `${label}: "${field}" ${issue.message}.`,
        })
      }
      return
    }

    const value = result.data
    const detected = detectVideoPlatform(value.videoUrl)
    if (!detected) return

    records.push({
      sourceIndex: index,
      record: {
        videoUrl: value.videoUrl,
        platform: detected.platform,
        externalId: detected.externalId,
        videoTitle: value.videoTitle,
        category: value.category,
        channelName: value.channelName,
        actualChannelName: value.actualChannelName ?? null,
        isUnrelatedChannel: value.isUnrelatedChannel,
        imageUrl: value.imageUrl,
      },
    })
  })

  if (unrecognized.size > 0) {
    issues.push({
      severity: "warning",
      message: `Unrecognized field(s) ignored: ${[...unrecognized].join(", ")}. They are not stored.`,
    })
  }

  const seen = new Map<string, number>()
  const uniqueRecords: VideoRecordInput[] = []
  let duplicateCount = 0

  records.forEach(({ record, sourceIndex }) => {
    const key = `${record.platform}:${record.externalId}`
    const firstIndex = seen.get(key)
    if (firstIndex !== undefined) {
      duplicateCount += 1
      issues.push({
        severity: "warning",
        recordIndex: firstIndex,
        message: `"${record.videoTitle}" (record #${sourceIndex + 1}) repeats record #${firstIndex + 1}. It will be imported only once.`,
      })
      return
    }
    seen.set(key, sourceIndex)
    uniqueRecords.push(record)
  })

  const categories = [...new Set(records.map(({ record }) => record.category))]
  const channelNames = [...new Set(records.map(({ record }) => record.channelName))]
  const platformCounts: Record<VideoPlatform, number> = emptyPlatformCounts()
  for (const record of uniqueRecords) {
    platformCounts[record.platform] += 1
  }
  const platforms = SUPPORTED_PLATFORMS.filter((platform) => platformCounts[platform] > 0)

  if (categories.length > 1) {
    issues.push({
      severity: "warning",
      message: `Inconsistent categories in this file: ${categories.join(", ")}. Confirm the batch resolution before importing, or split the file by category.`,
    })
  }

  if (channelNames.length > 1) {
    issues.push({
      severity: "warning",
      message: `Multiple channel names in this file: ${channelNames.join(", ")}. Each video keeps its own channel name from the file; confirm the batch contains multiple channels before importing.`,
    })
  }

  const ok = issues.every((issue) => issue.severity !== "error")

  return {
    ok,
    totalRecords: parsed.length,
    validCount: records.length,
    invalidCount,
    duplicateCount,
    records: uniqueRecords,
    categories,
    category: categories.length === 1 ? categories[0] : null,
    categoryConflict: categories.length > 1,
    channelNames,
    channelConflict: channelNames.length > 1,
    platforms,
    platformCounts,
    issues,
  }
}

export interface ImageValidationResult {
  ok: boolean
  issues: ValidationIssue[]
}

export async function validateImageFile(file: File | null | undefined): Promise<ImageValidationResult> {
  if (!file) {
    return {
      ok: false,
      issues: [{ severity: "error", message: "No batch image selected. Choose one image for this import." }],
    }
  }

  const extension = getExtension(file.name)

  if (!IMAGE_EXTENSIONS.includes(extension as (typeof IMAGE_EXTENSIONS)[number])) {
    return {
      ok: false,
      issues: [
        {
          severity: "error",
          message: `"${file.name}" is not a supported image type. Use JPEG, PNG, or WebP.`,
        },
      ],
    }
  }

  if (!IMAGE_MIME_TYPES.includes(file.type as (typeof IMAGE_MIME_TYPES)[number])) {
    return {
      ok: false,
      issues: [
        {
          severity: "error",
          message: `"${file.name}" does not report a JPEG, PNG, or WebP file type. Choose a different image.`,
        },
      ],
    }
  }

  if (file.size === 0) {
    return {
      ok: false,
      issues: [{ severity: "error", message: `"${file.name}" is empty (0 bytes). Choose a different image.` }],
    }
  }

  if (file.size > IMAGE_FILE_MAX_BYTES) {
    return {
      ok: false,
      issues: [
        {
          severity: "error",
          message: `"${file.name}" is ${formatBytes(file.size)}, which is larger than the ${formatBytes(IMAGE_FILE_MAX_BYTES)} limit.`,
        },
      ],
    }
  }

  try {
    const header = new Uint8Array(await file.slice(0, 12).arrayBuffer())
    if (!hasValidImageSignature(header, extension)) {
      return {
        ok: false,
        issues: [
          {
            severity: "error",
            message: `"${file.name}" does not contain valid JPEG, PNG, or WebP image data. Export the image again and retry.`,
          },
        ],
      }
    }
  } catch {
    return {
      ok: false,
      issues: [{ severity: "error", message: `"${file.name}" could not be read. Try selecting the image again.` }],
    }
  }

  return { ok: true, issues: [] }
}

function hasValidImageSignature(header: Uint8Array, extension: string): boolean {
  const startsWith = (bytes: number[]) => bytes.every((byte, index) => header[index] === byte)

  if (startsWith([0xff, 0xd8, 0xff])) {
    return extension === ".jpg" || extension === ".jpeg"
  }

  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return extension === ".png"
  }

  const ascii = String.fromCharCode(...header)
  if (ascii.startsWith("RIFF") && header[8] === 0x57 && header[9] === 0x45 && header[10] === 0x42 && header[11] === 0x50) {
    return extension === ".webp"
  }

  return false
}

export function getExtension(fileName: string): string {
  const index = fileName.lastIndexOf(".")
  return index === -1 ? "" : fileName.slice(index).toLowerCase()
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
