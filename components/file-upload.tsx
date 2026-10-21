"use client"

import type React from "react"

import { useRef, useState } from "react"
import { Upload, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { VideoData } from "@/lib/types"
import { useToast } from "@/hooks/use-toast"
import { extractYouTubeId } from "@/lib/utils"

interface FileUploadProps {
  onUpload: (data: VideoData[]) => void
}

export function FileUpload({ onUpload }: FileUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { toast } = useToast()
  const [isLoading, setIsLoading] = useState(false)

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

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    if (!file.name.endsWith(".json")) {
      toast({
        title: "Invalid file type",
        description: "Please upload a JSON file",
        variant: "destructive",
      })
      return
    }

    setIsLoading(true)

    try {
      const text = await file.text()
      const data = JSON.parse(text)

      const videos = Array.isArray(data) ? data : [data]

      const validatedVideos: VideoData[] = []

      for (const item of videos) {
        const videoUrl = item.videoUrl || item["video URL"] || item.url || item.youtube_url || item.youtubeUrl
        if (!videoUrl) continue

        const videoId = extractYouTubeId(videoUrl)
        if (!videoId) continue

        let videoTitle = item.videoTitle || item["video title"] || item.video_title || item.title || "Untitled Video"

        try {
          const response = await fetch(`/api/youtube-title?videoId=${videoId}`)
          if (response.ok) {
            const data = await response.json()
            videoTitle = cleanVideoTitle(data.title)
          }
        } catch (error) {
          console.error(`Failed to fetch data for video ${videoId}:`, error)
          videoTitle = cleanVideoTitle(videoTitle)
        }

        validatedVideos.push({
          category: item.category || "Uncategorized",
          channelName: item.channelName || item["channel name"] || item.channel_name || "Unknown Channel",
          videoUrl,
          videoTitle,
        })
      }

      if (validatedVideos.length === 0) {
        toast({
          title: "No valid videos found",
          description: "The JSON file does not contain valid video data",
          variant: "destructive",
        })
        setIsLoading(false)
        return
      }

      onUpload(validatedVideos)
      toast({
        title: "Success!",
        description: `Loaded ${validatedVideos.length} videos`,
      })
    } catch (error) {
      console.error("Error parsing JSON:", error)
      toast({
        title: "Error parsing file",
        description: "Please check your JSON file format",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
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
        accept=".json"
        onChange={handleFileChange}
        className="sr-only"
        id="file-upload"
        disabled={isLoading}
      />
      <Button asChild className="cursor-pointer" disabled={isLoading}>
        <label htmlFor="file-upload" className={isLoading ? "cursor-not-allowed" : ""}>
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Processing...
            </>
          ) : (
            <>
              <Upload className="w-4 h-4 mr-2" />
              Upload JSON
            </>
          )}
        </label>
      </Button>
    </>
  )
}
