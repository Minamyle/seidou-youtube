"use client"

import type React from "react"
import { useRef, useState } from "react"
import { FileCode, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { VideoData } from "@/lib/types"
import { useToast } from "@/hooks/use-toast"
import { extractYouTubeId } from "@/lib/utils"

interface HtmlUploadProps {
  onUpload: (data: VideoData[]) => void
}

export function HtmlUpload({ onUpload }: HtmlUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { toast } = useToast()
  const [isLoading, setIsLoading] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0 })

  const cleanVideoTitle = (title: string): string => {
    let cleaned = title.replace(/^\d+:\d+(:\d+)?/, "").trim()
    cleaned = cleaned.replace(/\d+\.?\d*[KM]?\s*views?.*$/i, "").trim()
    cleaned = cleaned.replace(/\d+\.?\s*$/, "").trim()
    cleaned = cleaned.replace(/YouTube.*$/i, "").trim()
    cleaned = cleaned.replace(/www\.youtube\.com.*$/i, "").trim()
    cleaned = cleaned.replace(/Share feedback.*$/i, "").trim()
    cleaned = cleaned.replace(/^\d+[\s.\-:)]+/, "").trim()
    return cleaned
  }

  const extractYouTubeData = (htmlContent: string, fileName: string) => {
    const fileNameWithoutExt = fileName.replace(/\.html?$/i, "")
    const parts = fileNameWithoutExt.split(",").map((p) => p.trim())

    const category = parts[0] || "Uncategorized"
    const expectedChannelName = parts[1] || "Unknown Channel"

    const parser = new DOMParser()
    const doc = parser.parseFromString(htmlContent, "text/html")

    const videos: { videoUrl: string; videoTitle: string }[] = []
    const seenUrls = new Set<string>()

    const links = doc.querySelectorAll("a[href]")

    links.forEach((link) => {
      const href = link.getAttribute("href")
      if (!href) return

      let videoUrl = ""
      let videoTitle = ""

      try {
        if (href.includes("tit=") && href.includes("rurl=")) {
          const rurlMatch = href.match(/rurl=([^&]+)/)
          if (rurlMatch) {
            videoUrl = decodeURIComponent(rurlMatch[1])
          }

          const titMatch = href.match(/tit=([^&]+)/)
          if (titMatch) {
            videoTitle = decodeURIComponent(titMatch[1])
            videoTitle = videoTitle.replace(/<[^>]+>/g, "")
            videoTitle = videoTitle.replace(/\+/g, " ")
            videoTitle = videoTitle.replace(/\s+/g, " ").trim()
            videoTitle = cleanVideoTitle(videoTitle)
          }
        } else if (href.includes("youtube.com/watch")) {
          const urlMatch = href.match(/https?:\/\/(www\.)?youtube\.com\/watch\?v=([a-zA-Z0-9_-]+)/)
          if (urlMatch) {
            videoUrl = `https://www.youtube.com/watch?v=${urlMatch[2]}`
            videoTitle = cleanVideoTitle(link.textContent?.trim() || "Untitled Video")
          }
        } else if (href.includes("youtu.be")) {
          const urlMatch = href.match(/https?:\/\/youtu\.be\/([a-zA-Z0-9_-]+)/)
          if (urlMatch) {
            videoUrl = `https://www.youtube.com/watch?v=${urlMatch[1]}`
            videoTitle = cleanVideoTitle(link.textContent?.trim() || "Untitled Video")
          }
        }
      } catch (error) {
        return
      }

      if (!videoUrl || !videoTitle || videoTitle.length < 3) return

      if (seenUrls.has(videoUrl)) return
      seenUrls.add(videoUrl)

      videos.push({ videoUrl, videoTitle })
    })

    return { category, expectedChannelName, videos }
  }

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    if (!file.name.match(/\.html?$/i)) {
      toast({
        title: "Invalid file type",
        description: "Please upload an HTML file",
        variant: "destructive",
      })
      return
    }

    setIsLoading(true)

    try {
      const htmlContent = await file.text()
      const { category, expectedChannelName, videos: extractedVideos } = extractYouTubeData(htmlContent, file.name)

      if (extractedVideos.length === 0) {
        toast({
          title: "No videos found",
          description: "No valid YouTube videos found in the HTML file",
          variant: "destructive",
        })
        setIsLoading(false)
        return
      }

      setProgress({ current: 0, total: extractedVideos.length })

      const processedVideos: VideoData[] = []
      const normalizedExpected = expectedChannelName.toLowerCase().trim()
      let filteredCount = 0
      let apiFailCount = 0

      for (let i = 0; i < extractedVideos.length; i++) {
        const video = extractedVideos[i]
        setProgress({ current: i + 1, total: extractedVideos.length })

        try {
          const videoId = extractYouTubeId(video.videoUrl)
          if (!videoId) continue

          const response = await fetch(`/api/youtube-title?videoId=${videoId}`)
          const data = await response.json()

          let finalTitle = video.videoTitle
          const finalChannelName = expectedChannelName

          if (response.ok && data.title && data.author) {
            finalTitle = data.title
            const actualChannelName = data.author
            const normalizedActual = actualChannelName.toLowerCase().trim()

            if (normalizedActual.includes(normalizedExpected) || normalizedExpected.includes(normalizedActual)) {
              processedVideos.push({
                category,
                channelName: actualChannelName,
                videoUrl: video.videoUrl,
                videoTitle: finalTitle,
                actualChannelName: actualChannelName,
                isUnrelatedChannel: false,
              })
            } else {
              processedVideos.push({
                category,
                channelName: actualChannelName,
                videoUrl: video.videoUrl,
                videoTitle: finalTitle,
                actualChannelName: actualChannelName,
                isUnrelatedChannel: true,
              })
              filteredCount++
            }
          } else {
            processedVideos.push({
              category,
              channelName: finalChannelName,
              videoUrl: video.videoUrl,
              videoTitle: finalTitle,
              isUnrelatedChannel: false,
            })
            apiFailCount++
          }

          await new Promise((resolve) => setTimeout(resolve, 150))
        } catch (error) {
          console.error("Error processing video:", error)
        }
      }

      if (processedVideos.length === 0) {
        toast({
          title: "No videos added",
          description: "All videos were filtered or failed to process",
          variant: "destructive",
        })
        setIsLoading(false)
        return
      }

      onUpload(processedVideos)
      toast({
        title: "HTML processed successfully!",
        description: `Added ${processedVideos.length} videos${filteredCount > 0 ? `. ${filteredCount} tagged as unrelated` : ""}${apiFailCount > 0 ? `. ${apiFailCount} used fallback data` : ""}`,
      })
    } catch (error) {
      console.error("Error parsing HTML:", error)
      toast({
        title: "Error parsing HTML",
        description: "Please check your HTML file format",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
      setProgress({ current: 0, total: 0 })
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = ""
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
              {progress.total > 0 ? `Processing ${progress.current}/${progress.total}` : "Processing..."}
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
