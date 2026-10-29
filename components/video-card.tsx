"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { AlertTriangle, Trash2 } from "lucide-react"
import type { VideoData } from "@/lib/types"
import { detectVideoPlatform } from "@/lib/video-import/platforms"

interface VideoCardProps {
  video: VideoData
  onDelete?: (videoUrl: string) => void
}

export function VideoCard({ video, onDelete }: VideoCardProps) {
  const detected = detectVideoPlatform(video.videoUrl)
  const embedUrl = detected
    ? detected.platform === "youtube"
      ? `https://www.youtube.com/embed/${detected.externalId}`
      : `https://platform.twitter.com/embed/Tweet.html?id=${detected.externalId}`
    : null

  return (
    <Card
      className={`group overflow-hidden hover:shadow-lg transition-all duration-300 ${video.isUnrelatedChannel ? "border-amber-500 border-2" : ""}`}
    >
      {video.isUnrelatedChannel && (
        <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-500" />
          <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">Unrelated Channel</span>
        </div>
      )}

      <div className="relative aspect-video overflow-hidden bg-muted">
        {embedUrl ? (
          <iframe
            src={embedUrl}
            title={video.videoTitle}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="w-full h-full"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-muted text-muted-foreground">
            <p className="text-sm">Invalid video URL</p>
          </div>
        )}
      </div>
      <CardContent className="p-4">
        <h3 className="font-semibold text-card-foreground line-clamp-2 mb-2 leading-relaxed text-pretty">
          {video.videoTitle}
        </h3>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <Badge variant="secondary" className="text-xs">
            {video.channelName}
          </Badge>
          {onDelete && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDelete(video.videoUrl)}
              className="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="w-3 h-3 mr-1" />
              Remove
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
