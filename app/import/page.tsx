import type { Metadata } from "next"
import Link from "next/link"
import { PackageSearch } from "lucide-react"
import { Button } from "@/components/ui/button"
import { JsonVideoImportForm } from "@/components/video-import/json-video-import-form"

export const metadata: Metadata = {
  title: "Video & Product Import Tool",
  description: "Import videos and product pictures from a JSON or saved HTML file into Supabase",
}

export default function VideoImportPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-foreground text-balance">Video &amp; Product Import Tool</h1>
            <p className="text-muted-foreground mt-1">
              Upload a JSON file or a saved HTML page of YouTube or X (Twitter) videos, or ASOS, Temu or SHEIN product
              pictures, review the checks, and import to Supabase. Product batches do not need a batch image.
            </p>
            <p className="text-muted-foreground mt-1 text-sm">
              Have a <code>products.json</code> from the Product Collector? Import it on the Product Import page.
            </p>
          </div>
          <Button asChild variant="outline">
            <Link href="/products">
              <PackageSearch className="w-4 h-4 mr-2" />
              Product Import
            </Link>
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-3xl">
        <JsonVideoImportForm />
      </main>
    </div>
  )
}
