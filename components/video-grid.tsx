"use client"

import { useMemo } from "react"
import { VideoCard } from "@/components/video-card"
import type { VideoData } from "@/lib/types"

interface VideoGridProps {
  videos: VideoData[]
  onDeleteVideo?: (videoUrl: string) => void
}

export function VideoGrid({ videos, onDeleteVideo }: VideoGridProps) {
  // Group videos by category
  const groupedVideos = useMemo(() => {
    const groups: Record<string, VideoData[]> = {}
    videos.forEach((video) => {
      const category = video.category || "Uncategorized"
      if (!groups[category]) {
        groups[category] = []
      }
      groups[category].push(video)
    })
    return groups
  }, [videos])

  return (
    <div className="space-y-12">
      {Object.entries(groupedVideos).map(([category, categoryVideos]) => (
        <section key={category}>
          <h2 className="text-xl font-semibold mb-4 text-foreground">{category}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {categoryVideos.map((video, index) => (
              <VideoCard key={`${video.videoUrl}-${index}`} video={video} onDelete={onDeleteVideo} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
