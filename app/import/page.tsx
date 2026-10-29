import type { Metadata } from "next"
import { JsonVideoImportForm } from "@/components/video-import/json-video-import-form"

export const metadata: Metadata = {
  title: "Video Import Tool",
  description: "Import video records from a JSON or saved HTML file into Supabase",
}

export default function VideoImportPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-6">
          <h1 className="text-3xl font-bold text-foreground text-balance">Video Import Tool</h1>
          <p className="text-muted-foreground mt-1">
            Upload a JSON file or a saved HTML page of YouTube and X (Twitter) videos plus a batch image, review the
            checks, and import to Supabase
          </p>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-3xl">
        <JsonVideoImportForm />
      </main>
    </div>
  )
}
