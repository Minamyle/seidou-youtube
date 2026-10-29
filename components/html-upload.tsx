"use client"

import type React from "react"
import { useRef, useState } from "react"
import { FileCode, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { VideoData } from "@/lib/types"
import { useToast } from "@/hooks/use-toast"
import { extractYouTubeId } from "@/lib/utils"
import { parseHtmlImport, readHtmlFile, type HtmlVideoRecord } from "@/lib/video-import/html"

interface HtmlUploadProps {
  onUpload: (data: VideoData[]) => void
}

export function HtmlUpload({ onUpload }: HtmlUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { toast } = useToast()
  const [isLoading, setIsLoading] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0 })

  const toVideoData = (record: HtmlVideoRecord): VideoData => ({
    category: record.category,
    channelName: record.channelName,
    videoUrl: record.videoUrl,
    videoTitle: record.videoTitle,
    actualChannelName: record.actualChannelName ?? undefined,
    isUnrelatedChannel: record.isUnrelatedChannel,
    platform: record.platform,
  })

  const enrichYouTubeRecord = async (record: HtmlVideoRecord): Promise<{ video: VideoData; unrelated: boolean; fallback: boolean }> => {
    const videoId = extractYouTubeId(record.videoUrl)
    if (!videoId) return { video: toVideoData(record), unrelated: false, fallback: true }

    try {
      const response = await fetch(`/api/youtube-title?videoId=${videoId}`)
      const data = await response.json()

      if (!response.ok || !data.title || !data.author) {
        return { video: toVideoData(record), unrelated: false, fallback: true }
      }

      const actualChannelName = String(data.author)
      const normalizedActual = actualChannelName.toLowerCase().trim()
      const expectedChannelName = record.channelName.trim()
      const hasExpectedChannel =
        expectedChannelName.length > 0 && expectedChannelName.toLowerCase() !== "unknown channel"
      const normalizedExpected = expectedChannelName.toLowerCase()
      const matches =
        !hasExpectedChannel ||
        normalizedActual.includes(normalizedExpected) ||
        normalizedExpected.includes(normalizedActual)

      return {
        video: {
          ...toVideoData(record),
          channelName: actualChannelName,
          videoTitle: String(data.title),
          actualChannelName,
          isUnrelatedChannel: hasExpectedChannel && !matches,
        },
        unrelated: hasExpectedChannel && !matches,
        fallback: false,
      }
    } catch {
      return { video: toVideoData(record), unrelated: false, fallback: true }
    }
  }

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setIsLoading(true)

    try {
      const readResult = await readHtmlFile(file)
      if (!readResult.ok) {
        toast({
          title: "HTML file could not be read",
          description: readResult.issues[0]?.message ?? "Choose an .html file saved from X or a YouTube results page.",
          variant: "destructive",
        })
        return
      }

      const parsed = parseHtmlImport(readResult.text, file.name)
      const issues = [...readResult.issues, ...parsed.issues]
      const errors = issues.filter((issue) => issue.severity === "error")
      const warnings = issues.filter((issue) => issue.severity === "warning")

      if (!parsed.ok || parsed.records.length === 0) {
        toast({
          title: "No video links found",
          description:
            errors[0]?.message ??
            "No YouTube or X video links were found. Open the page, scroll until the videos load, then save it again as HTML.",
          variant: "destructive",
        })
        return
      }

      setProgress({ current: 0, total: parsed.records.length })

      const processedVideos: VideoData[] = []
      let unrelatedCount = 0
      let fallbackCount = 0

      for (let i = 0; i < parsed.records.length; i++) {
        const record = parsed.records[i]
        setProgress({ current: i + 1, total: parsed.records.length })

        if (record.platform === "youtube") {
          const { video, unrelated, fallback } = await enrichYouTubeRecord(record)
          processedVideos.push(video)
          if (unrelated) unrelatedCount++
          if (fallback) fallbackCount++
          await new Promise((resolve) => setTimeout(resolve, 150))
        } else {
          processedVideos.push(toVideoData(record))
        }
      }

      onUpload(processedVideos)

      const parts = [
        `${parsed.youtubeCount} YouTube video${parsed.youtubeCount === 1 ? "" : "s"}`,
        `${parsed.xCount} X post${parsed.xCount === 1 ? "" : "s"}`,
      ]
      const notes = [
        unrelatedCount > 0 ? `${unrelatedCount} tagged as unrelated` : "",
        fallbackCount > 0 ? `${fallbackCount} kept the title from the HTML` : "",
        warnings.length > 0 ? `${warnings.length} note${warnings.length === 1 ? "" : "s"} to review` : "",
      ].filter(Boolean)

      toast({
        title: "HTML converted to JSON",
        description: `Added ${parts.join(" and ")}${notes.length > 0 ? `. ${notes.join(". ")}` : ""}. Use Export JSON to download the file, then import it with the JSON Video Import Form.`,
      })
    } catch (error) {
      console.error("Error parsing HTML:", error)
      toast({
        title: "Error parsing HTML",
        description: "Please check your HTML file format and try again.",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
      setProgress({ current: 0, total: 0 })
      if (fileInputRef.current) {
        fileInputRef.current.value = ""
      }
    }
  }

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".html,.htm"
        onChange={handleFileChange}
        className="sr-only"
        id="html-upload"
        disabled={isLoading}
      />
      <Button asChild variant="outline" className="cursor-pointer bg-transparent" disabled={isLoading}>
        <label htmlFor="html-upload" className={isLoading ? "cursor-not-allowed" : ""}>
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              {progress.total > 0 ? `Converting ${progress.current}/${progress.total}` : "Converting..."}
            </>
          ) : (
            <>
              <FileCode className="w-4 h-4 mr-2" />
              Upload HTML
            </>
          )}
        </label>
      </Button>
    </>
  )
}
