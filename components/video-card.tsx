"use client"

import { useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { AlertTriangle, ExternalLink, Trash2 } from "lucide-react"
import type { VideoData } from "@/lib/types"
import { detectVideoPlatform, isRetailPlatform, PLATFORM_LABELS } from "@/lib/video-import/platforms"

interface VideoCardProps {
  video: VideoData
  onDelete?: (videoUrl: string) => void
}

export function VideoCard({ video, onDelete }: VideoCardProps) {
  const [imageFailed, setImageFailed] = useState(false)
  const detected = detectVideoPlatform(video.videoUrl)
  const platform = detected?.platform ?? null
  const isRetail = isRetailPlatform(platform)
  const platformLabel = platform ? PLATFORM_LABELS[platform] : null

  const embedUrl =
    platform === "youtube"
      ? `https://www.youtube.com/embed/${detected?.externalId}`
      : platform === "x"
        ? `https://platform.twitter.com/embed/Tweet.html?id=${detected?.externalId}`
        : null

  // ASOS, Temu and SHEIN records are product picture posts: show the picture,
  // and link it to the product page. Product photos are usually portrait.
  const productImage = isRetail && video.imageUrl && !imageFailed ? video.imageUrl : null

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

      <div className={`relative overflow-hidden bg-muted ${isRetail ? "aspect-[4/5]" : "aspect-video"}`}>
        {embedUrl ? (
          <iframe
            src={embedUrl}
            title={video.videoTitle}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="w-full h-full"
          />
        ) : isRetail ? (
          <a
            href={video.videoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex w-full h-full items-center justify-center bg-white text-muted-foreground"
          >
            {productImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={productImage}
                alt={video.videoTitle}
                loading="lazy"
                referrerPolicy="no-referrer"
                onError={() => setImageFailed(true)}
                className="w-full h-full object-contain"
              />
            ) : (
              <span className="text-sm">Picture unavailable · View on {platformLabel}</span>
            )}
          </a>
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
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="secondary" className="text-xs">
              {video.channelName}
            </Badge>
            {isRetail && platformLabel && (
              <a
                href={video.videoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                {platformLabel}
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
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
