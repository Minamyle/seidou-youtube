import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ProductCollector } from "@/components/product-collector/product-collector"
import { ProductJsonImportForm } from "@/components/product-collector/product-json-import-form"

export const metadata = {
  title: "Product Import",
  description: "Collect ASOS products from a shop link, or import a product JSON file, into the product catalogue",
}

export default function ProductsPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-foreground text-balance">Product Import</h1>
            <p className="text-muted-foreground mt-1">
              Collect products from a shop link, or import a product JSON file, into the product catalogue in Supabase
            </p>
          </div>
          <Button asChild variant="outline">
            <Link href="/">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Video Library
            </Link>
          </Button>
        </div>
      </header>
      <main className="container mx-auto max-w-6xl px-4 py-8">
        <Tabs defaultValue="collect" className="space-y-6">
          <TabsList>
            <TabsTrigger value="collect">Collect from a link</TabsTrigger>
            <TabsTrigger value="json">Import a saved page or file</TabsTrigger>
          </TabsList>
          <TabsContent value="collect">
            <ProductCollector />
          </TabsContent>
          <TabsContent value="json">
            <ProductJsonImportForm />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}
