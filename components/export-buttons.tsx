"use client"

import { Button } from "@/components/ui/button"
import { Download } from "lucide-react"
import type { VideoData } from "@/lib/types"

interface ExportButtonsProps {
  videos: VideoData[]
}

export function ExportButtons({ videos }: ExportButtonsProps) {
  const exportJSON = () => {
    const dataStr = JSON.stringify(videos, null, 2)
    const dataBlob = new Blob([dataStr], { type: "application/json" })
    const url = URL.createObjectURL(dataBlob)
    const link = document.createElement("a")
    link.href = url
    link.download = `video-library-${new Date().toISOString().split("T")[0]}.json`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const exportCSV = () => {
    // CSV headers
    const headers = ["Category", "Channel Name", "Video URL", "Video Title"]

    // CSV rows
    const rows = videos.map((video) => [video.category, video.channelName, video.videoUrl, video.videoTitle])

    // Escape CSV values (handle commas and quotes)
    const escapeCSV = (value: string) => {
      if (value.includes(",") || value.includes('"') || value.includes("\n")) {
        return `"${value.replace(/"/g, '""')}"`
      }
      return value
    }

    // Construct CSV content
    const csvContent = [headers.join(","), ...rows.map((row) => row.map(escapeCSV).join(","))].join("\n")

    // Download CSV
    const dataBlob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(dataBlob)
    const link = document.createElement("a")
    link.href = url
    link.download = `video-library-${new Date().toISOString().split("T")[0]}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex items-center gap-2">
      <Button onClick={exportJSON} variant="outline" size="sm" className="gap-2 bg-transparent">
        <Download className="w-4 h-4" />
        Export JSON
      </Button>
      <Button onClick={exportCSV} variant="outline" size="sm" className="gap-2 bg-transparent">
        <Download className="w-4 h-4" />
        Export CSV
      </Button>
    </div>
  )
}
