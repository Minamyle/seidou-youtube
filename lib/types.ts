export interface VideoData {
  category: string
  channelName: string
  videoUrl: string
  videoTitle: string
  actualChannelName?: string // The real channel name from YouTube API
  isUnrelatedChannel?: boolean // True if channel doesn't match expected channel
}
