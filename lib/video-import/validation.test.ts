import { describe, expect, it } from "vitest"
import { JSON_FILE_MAX_BYTES, IMAGE_FILE_MAX_BYTES, MAX_RECORDS_PER_IMPORT } from "./config"
import {
  describeJsonParseError,
  formatBytes,
  readJsonFile,
  validateImageFile,
  validateVideoRecords,
} from "./validation"

function makeRecord(overrides: Record<string, unknown> = {}) {
  return {
    category: "Music",
    channelName: "DavidoVEVO",
    videoUrl: "https://www.youtube.com/watch?v=3Iyuym-Gci0",
    videoTitle: "Davido - Fall (Official Video)",
    actualChannelName: "DavidoVEVO",
    isUnrelatedChannel: false,
    ...overrides,
  }
}

function makeJsonFile(content: string, name = "videos.json", type = "application/json") {
  return new File([content], name, { type })
}

function makePngBytes(): Uint8Array<ArrayBuffer> {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d])
}

function makeJpegBytes(): Uint8Array<ArrayBuffer> {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01])
}

function makeWebpBytes(): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(12)
  bytes.set([0x52, 0x49, 0x46, 0x46], 0)
  bytes.set([0x57, 0x45, 0x42, 0x50], 8)
  return bytes
}

describe("readJsonFile", () => {
  it("accepts a valid JSON file regardless of extension trust", async () => {
    const result = await readJsonFile(makeJsonFile(JSON.stringify([makeRecord()])))
    expect(result.ok).toBe(true)
  })

  it("rejects a missing file", async () => {
    const result = await readJsonFile(null)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues[0].message).toContain("No JSON file selected")
    }
  })

  it("rejects an empty file", async () => {
    const result = await readJsonFile(makeJsonFile(""))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues[0].message).toContain("empty")
    }
  })

  it("rejects a file larger than the size limit", async () => {
    const big = "x".repeat(JSON_FILE_MAX_BYTES + 1)
    const result = await readJsonFile(makeJsonFile(big))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues[0].message).toContain("larger than")
    }
  })

  it("rejects malformed JSON with a helpful message", async () => {
    const result = await readJsonFile(makeJsonFile('[{"category": "Music",}]'))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.message.includes("not valid JSON"))).toBe(true)
    }
  })

  it("warns when the extension is not .json but still validates content", async () => {
    const result = await readJsonFile(makeJsonFile(JSON.stringify([makeRecord()]), "data.txt", "text/plain"))
    expect(result.ok).toBe(true)
  })
})

describe("describeJsonParseError", () => {
  it("reports line and column when V8 provides them", () => {
    const message = "Unexpected token } in JSON at position 12 (line 2 column 5)"
    const description = describeJsonParseError(message, 'x\n{"a": }')
    expect(description).toContain("line 2")
    expect(description).toContain("column 5")
  })

  it("computes line and column from position", () => {
    const text = '[\n{"a": 1,}\n]'
    const description = describeJsonParseError("Unexpected token } in JSON at position 9", text)
    expect(description).toContain("line 2")
  })

  it("falls back to a generic message", () => {
    expect(describeJsonParseError("unexpected", "x")).toContain("not valid JSON")
  })
})

describe("validateVideoRecords", () => {
  it("accepts records matching the sample schema", () => {
    const result = validateVideoRecords([
      makeRecord(),
      makeRecord({ videoUrl: "https://www.youtube.com/watch?v=rRjtTx49hkc", videoTitle: "Second" }),
    ])

    expect(result.ok).toBe(true)
    expect(result.totalRecords).toBe(2)
    expect(result.validCount).toBe(2)
    expect(result.invalidCount).toBe(0)
    expect(result.duplicateCount).toBe(0)
    expect(result.category).toBe("Music")
    expect(result.channelNames).toEqual(["DavidoVEVO"])
    expect(result.records[0].youtubeId).toBe("3Iyuym-Gci0")
    expect(result.records[0].actualChannelName).toBe("DavidoVEVO")
    expect(result.records[0].isUnrelatedChannel).toBe(false)
  })

  it("allows actualChannelName and isUnrelatedChannel to be absent", () => {
    const result = validateVideoRecords([
      {
        category: "Music",
        channelName: "DavidoVEVO",
        videoUrl: "https://www.youtube.com/watch?v=3Iyuym-Gci0",
        videoTitle: "Davido - Fall",
      },
    ])

    expect(result.ok).toBe(true)
    expect(result.records[0].actualChannelName).toBeNull()
    expect(result.records[0].isUnrelatedChannel).toBe(false)
  })

  it("rejects a top-level object", () => {
    const result = validateVideoRecords({ videos: [] })
    expect(result.ok).toBe(false)
    expect(result.issues[0].message).toContain("array")
  })

  it("rejects an empty array", () => {
    const result = validateVideoRecords([])
    expect(result.ok).toBe(false)
    expect(result.issues[0].message).toContain("no video records")
  })

  it("rejects files above the record limit", () => {
    const records = Array.from({ length: MAX_RECORDS_PER_IMPORT + 1 }, (_, index) =>
      makeRecord({ videoUrl: `https://www.youtube.com/watch?v=aaaaaaaa${String(index % 10)}${index}`, videoTitle: `T${index}` }),
    )
    const result = validateVideoRecords(records)
    expect(result.ok).toBe(false)
    expect(result.issues.some((issue) => issue.message.includes("exceeds the limit"))).toBe(true)
  })

  it("flags records with missing required fields", () => {
    const result = validateVideoRecords([makeRecord({ videoTitle: undefined }), makeRecord()])
    expect(result.ok).toBe(false)
    expect(result.invalidCount).toBe(1)
    expect(result.issues.some((issue) => issue.message.includes('"videoTitle"') && issue.message.includes("Record #1"))).toBe(true)
  })

  it("flags empty strings in required fields", () => {
    const result = validateVideoRecords([makeRecord({ category: "   " })])
    expect(result.ok).toBe(false)
    expect(result.issues.some((issue) => issue.message.includes('"category"'))).toBe(true)
  })

  it("flags wrong data types", () => {
    const result = validateVideoRecords([makeRecord({ isUnrelatedChannel: "false" })])
    expect(result.ok).toBe(false)
    expect(result.invalidCount).toBe(1)
  })

  it("flags null records and non-object entries", () => {
    const result = validateVideoRecords([null, "video", makeRecord()])
    expect(result.ok).toBe(false)
    expect(result.invalidCount).toBe(2)
  })

  it("flags invalid and non-YouTube video URLs", () => {
    const result = validateVideoRecords([
      makeRecord({ videoUrl: "not-a-url" }),
      makeRecord({ videoUrl: "https://example.com/video/1", videoTitle: "Other site" }),
    ])
    expect(result.ok).toBe(false)
    expect(result.invalidCount).toBe(2)
    expect(result.issues.some((issue) => issue.message.includes("YouTube"))).toBe(true)
  })

  it("flags inconsistent categories without hard-blocking structure", () => {
    const result = validateVideoRecords([
      makeRecord(),
      makeRecord({ category: "Sports", videoUrl: "https://www.youtube.com/watch?v=rRjtTx49hkc" }),
    ])
    expect(result.ok).toBe(true)
    expect(result.categoryConflict).toBe(true)
    expect(result.categories).toEqual(["Music", "Sports"])
    expect(result.category).toBeNull()
    expect(result.issues.some((issue) => issue.severity === "warning" && issue.message.includes("Inconsistent categories"))).toBe(true)
  })

  it("flags multiple channel names", () => {
    const result = validateVideoRecords([
      makeRecord(),
      makeRecord({ channelName: "Davido", actualChannelName: "Davido", videoUrl: "https://www.youtube.com/watch?v=qIxYymMYvTk" }),
    ])
    expect(result.ok).toBe(true)
    expect(result.channelConflict).toBe(true)
    expect(result.channelNames).toEqual(["DavidoVEVO", "Davido"])
  })

  it("detects exact duplicate records and keeps the first", () => {
    const result = validateVideoRecords([makeRecord(), makeRecord()])
    expect(result.ok).toBe(true)
    expect(result.duplicateCount).toBe(1)
    expect(result.records).toHaveLength(1)
    expect(result.issues.some((issue) => issue.severity === "warning" && issue.message.includes("imported only once"))).toBe(true)
  })

  it("detects duplicates across different URL forms of the same video", () => {
    const result = validateVideoRecords([
      makeRecord(),
      makeRecord({ videoUrl: "https://youtu.be/3Iyuym-Gci0" }),
    ])
    expect(result.duplicateCount).toBe(1)
    expect(result.records).toHaveLength(1)
  })

  it("warns about unrecognized fields without blocking", () => {
    const result = validateVideoRecords([makeRecord({ extraField: "hello" })])
    expect(result.ok).toBe(true)
    expect(result.issues.some((issue) => issue.message.includes("extraField"))).toBe(true)
  })
})

describe("validateImageFile", () => {
  it("accepts a valid PNG", async () => {
    const file = new File([makePngBytes()], "batch.png", { type: "image/png" })
    const result = await validateImageFile(file)
    expect(result.ok).toBe(true)
  })

  it("accepts a valid JPEG", async () => {
    const file = new File([makeJpegBytes()], "batch.jpg", { type: "image/jpeg" })
    const result = await validateImageFile(file)
    expect(result.ok).toBe(true)
  })

  it("accepts a valid WebP", async () => {
    const file = new File([makeWebpBytes()], "batch.webp", { type: "image/webp" })
    const result = await validateImageFile(file)
    expect(result.ok).toBe(true)
  })

  it("rejects a missing image", async () => {
    const result = await validateImageFile(null)
    expect(result.ok).toBe(false)
  })

  it("rejects unsupported extensions", async () => {
    const file = new File([makePngBytes()], "batch.gif", { type: "image/gif" })
    const result = await validateImageFile(file)
    expect(result.ok).toBe(false)
    expect(result.issues[0].message).toContain("JPEG, PNG, or WebP")
  })

  it("rejects when the MIME type does not match the accepted list", async () => {
    const file = new File([makePngBytes()], "batch.png", { type: "image/svg+xml" })
    const result = await validateImageFile(file)
    expect(result.ok).toBe(false)
  })

  it("rejects an oversized image", async () => {
    const bytes = new Uint8Array(IMAGE_FILE_MAX_BYTES + 1)
    bytes.set(makePngBytes())
    const file = new File([bytes], "big.png", { type: "image/png" })
    const result = await validateImageFile(file)
    expect(result.ok).toBe(false)
    expect(result.issues[0].message).toContain("larger than")
  })

  it("rejects a file whose content does not match the image signature", async () => {
    const file = new File(["definitely not a png"], "fake.png", { type: "image/png" })
    const result = await validateImageFile(file)
    expect(result.ok).toBe(false)
    expect(result.issues[0].message).toContain("image data")
  })

  it("rejects a PNG signature saved with a .jpg extension", async () => {
    const file = new File([makePngBytes()], "mismatch.jpg", { type: "image/jpeg" })
    const result = await validateImageFile(file)
    expect(result.ok).toBe(false)
  })

  it("rejects a missing file", async () => {
    const result = await validateImageFile(undefined)
    expect(result.ok).toBe(false)
  })
})

describe("formatBytes", () => {
  it("formats common sizes", () => {
    expect(formatBytes(0)).toBe("0 B")
    expect(formatBytes(2048)).toBe("2.0 KB")
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB")
  })
})
