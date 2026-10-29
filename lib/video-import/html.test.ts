import { describe, expect, it } from "vitest"
import { HTML_FILE_MAX_BYTES } from "./config"
import { parseFileName, parseHtmlImport, readHtmlFile } from "./html"

function makeHtmlFile(content: string, name = "Music , (@davido) _ X.html", type = "text/html") {
  return new File([content], name, { type })
}

function xArticle({
  handle = "davido",
  id,
  text,
  date,
  video = true,
}: {
  handle?: string | null
  id: string
  text?: string
  date?: string
  video?: boolean
}) {
  const href = handle ? `https://x.com/${handle}/status/${id}` : `https://x.com/i/web/status/${id}`
  const textBlock = text ? `<div data-testid="tweetText">${text}</div>` : ""
  const videoBlock = video ? `<div data-testid="videoPlayer"><video src="blob:https://x.com/123"></video></div>` : ""
  const timeBlock = date ? `<time datetime="${date}"></time>` : ""

  return `<article><a href="${href}">${timeBlock}</a>${textBlock}${videoBlock}</article>`
}

describe("parseFileName", () => {
  it("derives category and channel from an X HTML filename", () => {
    expect(parseFileName("Music , (@davido) _ X.html")).toEqual({
      category: "Music",
      channelName: "@davido",
    })
  })

  it("derives category and channel from a JSON filename", () => {
    expect(parseFileName("Music, DavidoVEVO.json")).toEqual({
      category: "Music",
      channelName: "DavidoVEVO",
    })
  })

  it("falls back when parts are missing", () => {
    expect(parseFileName("videos.json")).toEqual({
      category: "videos",
      channelName: "Unknown Channel",
    })
  })
})

describe("readHtmlFile", () => {
  it("accepts an .html file", async () => {
    const result = await readHtmlFile(makeHtmlFile("<html></html>"))

    expect(result.ok).toBe(true)
    expect(result.issues).toEqual([])
  })

  it("warns when the extension is not .html but still reads the content", async () => {
    const result = await readHtmlFile(makeHtmlFile("<html></html>", "saved-page.txt"))

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.text).toBe("<html></html>")
      expect(result.issues[0].severity).toBe("warning")
      expect(result.issues[0].message).toContain("does not have an .html extension")
    }
  })

  it("rejects a missing file", async () => {
    const result = await readHtmlFile(null)

    expect(result.ok).toBe(false)
    expect(result.issues[0].message).toContain("No HTML file selected")
  })

  it("rejects an empty file", async () => {
    const result = await readHtmlFile(makeHtmlFile(""))

    expect(result.ok).toBe(false)
    expect(result.issues[0].message).toContain("empty")
  })

  it("rejects a file over the size limit", async () => {
    const file = makeHtmlFile("<html></html>")
    Object.defineProperty(file, "size", { value: HTML_FILE_MAX_BYTES + 1 })

    const result = await readHtmlFile(file)

    expect(result.ok).toBe(false)
    expect(result.issues[0].message).toContain("larger than")
  })
})

describe("parseHtmlImport for X", () => {
  it("extracts video posts, keeps tweet text as the title, and drops t.co links", () => {
    const html = xArticle({
      id: "2095539619160814010",
      text: "Watch this <span>amazing</span> performance https://t.co/abc123",
      date: "2026-10-20T12:00:00.000Z",
    })

    const result = parseHtmlImport(html, "Music , (@davido) _ X.html")

    expect(result.ok).toBe(true)
    expect(result.xCount).toBe(1)
    expect(result.youtubeCount).toBe(0)
    expect(result.records[0]).toMatchObject({
      category: "Music",
      channelName: "@davido",
      videoUrl: "https://x.com/davido/status/2095539619160814010",
      videoTitle: "Watch this amazing performance",
      platform: "x",
      actualChannelName: "davido",
      isUnrelatedChannel: false,
    })
  })

  it("skips text-only posts when other posts contain video", () => {
    const html = [
      xArticle({ id: "1111111111111111111", text: "Text only", video: false }),
      xArticle({ id: "2222222222222222222", text: "Has video", video: true }),
    ].join("")

    const result = parseHtmlImport(html, "Music , (@davido) _ X.html")

    expect(result.xCount).toBe(1)
    expect(result.records[0].videoUrl).toBe("https://x.com/davido/status/2222222222222222222")
    expect(result.issues.some((issue) => issue.message.includes("skipped because no video"))).toBe(true)
  })

  it("includes every post with a warning when no video marker is found", () => {
    const html = [
      xArticle({ id: "1111111111111111111", text: "First", video: false }),
      xArticle({ id: "2222222222222222222", text: "Second", video: false }),
    ].join("")

    const result = parseHtmlImport(html, "Music , (@davido) _ X.html")

    expect(result.xCount).toBe(2)
    expect(result.issues.some((issue) => issue.message.includes("every X post"))).toBe(true)
  })

  it("de-duplicates the same status ID", () => {
    const html = [
      xArticle({ id: "2095539619160814010", text: "Original" }),
      xArticle({ id: "2095539619160814010", text: "Duplicate" }),
    ].join("")

    const result = parseHtmlImport(html, "Music , (@davido) _ X.html")

    expect(result.xCount).toBe(1)
    expect(result.records).toHaveLength(1)
  })

  it("falls back to the post date when there is no tweet text", () => {
    const html = xArticle({ id: "2091940590380273986", date: "2026-10-18T09:30:00.000Z", video: true })

    const result = parseHtmlImport(html, "Music , (@davido) _ X.html")

    expect(result.records[0].videoTitle).toBe("X video post - 2026-10-18")
  })

  it("uses the status ID as the title when there is no text or date", () => {
    const html = xArticle({ id: "2090815559147393032", video: true })

    const result = parseHtmlImport(html, "Music , (@davido) _ X.html")

    expect(result.records[0].videoTitle).toBe("X video post 2090815559147393032")
  })

  it("falls back to the file channel and an i/web URL when the handle is missing", () => {
    const html = xArticle({ handle: null, id: "2090815559147393032", text: "No handle" })

    const result = parseHtmlImport(html, "Music , (@davido) _ X.html")

    expect(result.records[0]).toMatchObject({
      channelName: "@davido",
      videoUrl: "https://x.com/i/web/status/2090815559147393032",
      actualChannelName: "@davido",
    })
  })

  it("derives the channel from the handle when the filename has no channel", () => {
    const html = xArticle({ handle: "teknoofficial", id: "2090815559147393032", text: "Hello" })

    const result = parseHtmlImport(html, "Music.html")

    expect(result.records[0]).toMatchObject({
      category: "Music",
      channelName: "@teknoofficial",
      actualChannelName: "teknoofficial",
    })
  })

  it("works without <article> wrappers by scanning around status links", () => {
    const html = `<div><a href="https://x.com/davido/status/2095539619160814010">Post</a><div data-testid="tweetText">Fallback title</div><div data-testid="videoPlayer"></div></div>`

    const result = parseHtmlImport(html, "Music , (@davido) _ X.html")

    expect(result.xCount).toBe(1)
    expect(result.records[0].videoTitle).toBe("Fallback title")
  })

  it("reads relative status links from saved X pages", () => {
    const html = `<article><a href="/davido/status/2095539619160814010"><time datetime="2026-10-20T12:00:00.000Z"></time></a><div data-testid="tweetText">Relative link</div><div data-testid="videoPlayer"></div></article>`

    const result = parseHtmlImport(html, "Music , (@davido) _ X.html")

    expect(result.xCount).toBe(1)
    expect(result.records[0].videoUrl).toBe("https://x.com/davido/status/2095539619160814010")
    expect(result.records[0].videoTitle).toBe("Relative link")
  })

  it("reads relative i/web status links", () => {
    const html = `<article><a href="/i/web/status/2090815559147393032">Post</a><div data-testid="tweetText">No handle</div><div data-testid="videoPlayer"></div></article>`

    const result = parseHtmlImport(html, "Music , (@davido) _ X.html")

    expect(result.xCount).toBe(1)
    expect(result.records[0].videoUrl).toBe("https://x.com/i/web/status/2090815559147393032")
  })

  it("does not import YouTube links quoted inside an X page", () => {
    const html = xArticle({
      id: "2095539619160814010",
      text: `Great video <a href="https://www.youtube.com/watch?v=aaaaaaaaaaa">https://www.youtube.com/watch?v=aaaaaaaaaaa</a>`,
    })

    const result = parseHtmlImport(html, "Music , (@davido) _ X.html")

    expect(result.xCount).toBe(1)
    expect(result.youtubeCount).toBe(0)
  })

  it("reports an X-specific error when an X page has no video posts", () => {
    const html = `<html><body><div data-testid="tweetText">Text only</div></body></html>`

    const result = parseHtmlImport(html, "Music , (@davido) _ X.html")

    expect(result.ok).toBe(false)
    expect(result.issues[0].message).toContain("looks like an X")
  })
})

describe("parseHtmlImport for YouTube", () => {
  it("extracts a YouTube redirect link and cleans the title", () => {
    const href =
      "https://www.youtube.com/redirect?q=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3D3Iyuym-Gci0&rurl=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3D3Iyuym-Gci0&tit=Davido+-+Fall+(Official+Video)"
    const html = `<a href="${href}">Davido - Fall (Official Video)</a>`

    const result = parseHtmlImport(html, "Music, DavidoVEVO.html")

    expect(result.youtubeCount).toBe(1)
    expect(result.records[0]).toMatchObject({
      category: "Music",
      channelName: "DavidoVEVO",
      videoUrl: "https://www.youtube.com/watch?v=3Iyuym-Gci0",
      videoTitle: "Davido - Fall (Official Video)",
      platform: "youtube",
    })
  })

  it("extracts direct watch, shorts, and youtu.be links once each", () => {
    const html = [
      `<a href="https://www.youtube.com/watch?v=aaaaaaaaaaa">First</a>`,
      `<a href="https://youtu.be/aaaaaaaaaaa">Duplicate</a>`,
      `<a href="https://www.youtube.com/shorts/bbbbbbbbbbb">Second</a>`,
      `<a href="https://www.youtube.com/watch?v=ccccccccccc">Third</a>`,
    ].join("")

    const result = parseHtmlImport(html, "Music, DavidoVEVO.html")

    expect(result.youtubeCount).toBe(3)
    expect(result.records.map((record) => record.videoUrl)).toEqual([
      "https://www.youtube.com/watch?v=aaaaaaaaaaa",
      "https://www.youtube.com/watch?v=bbbbbbbbbbb",
      "https://www.youtube.com/watch?v=ccccccccccc",
    ])
  })

  it("ignores links that are not YouTube videos", () => {
    const html = [
      `<a href="https://example.com/watch?v=aaaaaaaaaaa">Nope</a>`,
      `<a href="https://x.com/davido">Profile</a>`,
    ].join("")

    const result = parseHtmlImport(html, "Music, DavidoVEVO.html")

    expect(result.records).toHaveLength(0)
    expect(result.ok).toBe(false)
  })

  it("ignores ad redirects that embed a YouTube URL", () => {
    const html = [
      `<a href="https://www.googleadservices.com/pagead/aclk?adurl=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Daaaaaaaaaaa">Watch</a>`,
      `<a href="https://tracking.example.com/click?u=https://www.youtube.com/watch?v=bbbbbbbbbbb">Play</a>`,
    ].join("")

    const result = parseHtmlImport(html, "Music, DavidoVEVO.html")

    expect(result.records).toHaveLength(0)
  })

  it("keeps the real title when the same video is linked from a thumbnail", () => {
    const html = [
      `<a href="https://www.youtube.com/watch?v=aaaaaaaaaaa">Watch</a>`,
      `<a href="https://www.youtube.com/watch?v=aaaaaaaaaaa&pp=abc">Davido - Fall (Official Video)</a>`,
    ].join("")

    const result = parseHtmlImport(html, "Music, DavidoVEVO.html")

    expect(result.youtubeCount).toBe(1)
    expect(result.records[0].videoTitle).toBe("Davido - Fall (Official Video)")
  })

  it("does not strip numbers that are part of a real title", () => {
    const html = [
      `<a href="https://www.youtube.com/watch?v=aaaaaaaaaaa">7 Rings</a>`,
      `<a href="https://www.youtube.com/watch?v=bbbbbbbbbbb">50 Cent - In Da Club</a>`,
      `<a href="https://www.youtube.com/watch?v=ccccccccccc">1. Intro</a>`,
    ].join("")

    const result = parseHtmlImport(html, "Music, DavidoVEVO.html")

    expect(result.records.map((record) => record.videoTitle)).toEqual([
      "7 Rings",
      "50 Cent - In Da Club",
      "Intro",
    ])
  })
})

describe("parseHtmlImport with no usable links", () => {
  it("returns an error for empty HTML", () => {
    const result = parseHtmlImport("", "Music , (@davido) _ X.html")

    expect(result.ok).toBe(false)
    expect(result.records).toHaveLength(0)
    expect(result.issues[0].severity).toBe("error")
    expect(result.issues[0].message).toContain("No YouTube or X")
  })

  it("returns an error for HTML with no video links", () => {
    const result = parseHtmlImport("<html><body><p>Nothing here</p></body></html>", "Music.html")

    expect(result.ok).toBe(false)
    expect(result.issues.some((issue) => issue.severity === "error")).toBe(true)
  })
})
