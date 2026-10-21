export const JSON_FILE_MAX_BYTES = 5 * 1024 * 1024

export const IMAGE_FILE_MAX_BYTES = 5 * 1024 * 1024

export const MAX_RECORDS_PER_IMPORT = 1000

export const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const

export const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"] as const

export const REQUIRED_JSON_FIELDS = ["category", "channelName", "videoUrl", "videoTitle"] as const

export const OPTIONAL_JSON_FIELDS = ["actualChannelName", "isUnrelatedChannel"] as const

export const KNOWN_JSON_FIELDS = [...REQUIRED_JSON_FIELDS, ...OPTIONAL_JSON_FIELDS] as const

export const BATCH_IMAGE_BUCKET = "video-import-images"

export const SIGNED_URL_TTL_SECONDS = 600

export const MAX_REQUEST_BYTES = JSON_FILE_MAX_BYTES + IMAGE_FILE_MAX_BYTES + 512 * 1024
