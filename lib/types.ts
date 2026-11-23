import type { VideoPlatform } from "./video-import/config"

export interface VideoData {
  category: string
  channelName: string
  videoUrl: string // YouTube watch URL, X post URL, or ASOS/Temu/SHEIN product page URL
  videoTitle: string
  actualChannelName?: string // The real channel name from YouTube API
  isUnrelatedChannel?: boolean // True if channel doesn't match expected channel
  platform?: VideoPlatform // Detected from videoUrl; included in exported JSON
  imageUrl?: string // ASOS/Temu/SHEIN only: the product picture shown in the feed
}
