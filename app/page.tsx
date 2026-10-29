"use client"

import Link from "next/link"
import { useState } from "react"
import { Upload, Trash2, AlertTriangle, DatabaseZap } from "lucide-react"
import { FileUpload } from "@/components/file-upload"
import { HtmlUpload } from "@/components/html-upload"
import { VideoGrid } from "@/components/video-grid"
import { ExportButtons } from "@/components/export-buttons"
import { Button } from "@/components/ui/button"
import type { VideoData } from "@/lib/types"
import { useToast } from "@/hooks/use-toast"

export default function HomePage() {
  const [videos, setVideos] = useState<VideoData[]>([])
  const { toast } = useToast()

  const handleFileUpload = (data: VideoData[]) => {
    setVideos((prevVideos) => [...prevVideos, ...data])
  }

  const handleDeleteAll = () => {
    setVideos([])
    toast({
      title: "All videos deleted",
      description: "Your video library has been cleared",
    })
  }

  const handleDeleteVideo = (videoUrl: string) => {
    setVideos((prevVideos) => prevVideos.filter((v) => v.videoUrl !== videoUrl))
    toast({
      title: "Video removed",
      description: "The video has been deleted from your library",
    })
  }

  const handleDeleteUnrelated = () => {
    const unrelatedCount = videos.filter((v) => v.isUnrelatedChannel).length
    setVideos((prevVideos) => prevVideos.filter((v) => !v.isUnrelatedChannel))
    toast({
      title: "Unrelated videos removed",
      description: `Deleted ${unrelatedCount} video${unrelatedCount !== 1 ? "s" : ""} from unrelated channels`,
    })
  }

  const unrelatedCount = videos.filter((v) => v.isUnrelatedChannel).length

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-foreground text-balance">Video Library</h1>
            <p className="text-muted-foreground mt-1">
              Convert an HTML page from YouTube or X into JSON, then push only the JSON to Supabase
            </p>
          </div>
          <Button asChild>
            <Link href="/import">
              <DatabaseZap className="w-4 h-4 mr-2" />
              JSON Video Import Form
            </Link>
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {videos.length === 0 ? (
          <div className="flex items-center justify-center min-h-[60vh]">
            <div className="text-center max-w-md">
              <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-primary/10 mb-6">
                <Upload className="w-10 h-10 text-primary" />
              </div>
              <h2 className="text-2xl font-semibold mb-3 text-balance">Upload Your Video Data</h2>
              <p className="text-muted-foreground mb-8 text-pretty">
                Upload a JSON file, or an HTML page saved from YouTube or X. HTML is converted to JSON locally, and only
                JSON is sent to Supabase.
              </p>
              <div className="flex items-center justify-center gap-3">
                <FileUpload onUpload={handleFileUpload} />
                <HtmlUpload onUpload={handleFileUpload} />
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <h2 className="text-2xl font-semibold">Your Videos</h2>
                <p className="text-muted-foreground mt-1">
                  {videos.length} video{videos.length !== 1 ? "s" : ""}
                  {unrelatedCount > 0 && (
                    <span className="text-amber-600 dark:text-amber-400 ml-2">({unrelatedCount} unrelated)</span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                {unrelatedCount > 0 && (
                  <Button
                    onClick={handleDeleteUnrelated}
                    variant="outline"
                    size="default"
                    className="border-amber-500 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950 bg-transparent"
                  >
                    <AlertTriangle className="w-4 h-4 mr-2" />
                    Delete Unrelated ({unrelatedCount})
                  </Button>
                )}
                <Button onClick={handleDeleteAll} variant="destructive" size="default">
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete All
                </Button>
                <ExportButtons videos={videos} />
                <FileUpload onUpload={handleFileUpload} />
                <HtmlUpload onUpload={handleFileUpload} />
              </div>
            </div>
            <VideoGrid videos={videos} onDeleteVideo={handleDeleteVideo} />
          </div>
        )}
      </main>
    </div>
  )
}
