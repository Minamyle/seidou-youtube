"use client"

import { type FormEvent, useMemo, useState } from "react"
import { AlertTriangle, Check, Copy, DatabaseZap, Download, ExternalLink, Loader2, PackageSearch } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useToast } from "@/hooks/use-toast"
import type { ScrapeResult } from "@/lib/product-collector/types"
import type { ValidationIssue } from "@/lib/video-import/validation"

const EXAMPLE = "https://www.asos.com/women/a-to-z-of-brands/mango/cat/?cid=8264"
const LIMITS = [12, 24, 48, 100, 200]

interface ImportOutcome {
  counts: { processed: number; inserted: number; updated: number; skipped: number }
  issues: ValidationIssue[]
}

export function ProductCollector() {
  const { toast } = useToast()
  const [url, setUrl] = useState("")
  const [limit, setLimit] = useState(48)
  const [details, setDetails] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ScrapeResult | null>(null)
  const [view, setView] = useState<"grid" | "json">("grid")
  const [copied, setCopied] = useState(false)
  const [category, setCategory] = useState("")
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<{ message: string; issues: ValidationIssue[] } | null>(null)
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null)

  const json = useMemo(() => (result ? JSON.stringify(result, null, 2) : ""), [result])

  async function collect(event: FormEvent) {
    event.preventDefault()
    if (!url.trim()) return
    setLoading(true)
    setError(null)
    setResult(null)
    setOutcome(null)
    setImportError(null)
    try {
      const query = new URLSearchParams({ url: url.trim(), limit: String(limit) })
      if (details) query.set("details", "1")
      const res = await fetch(`/api/products/collect?${query.toString()}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Request failed")
      if (!data.products?.length) throw new Error("No products were found at that link")
      setResult(data)
      setCategory((current) => current || data.title || "")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setLoading(false)
    }
  }

  async function importProducts() {
    if (!result || importing) return
    setImporting(true)
    setImportError(null)
    setOutcome(null)
    try {
      const res = await fetch("/api/products/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, sourceUrl: result.source, products: result.products }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) {
        setImportError({ message: data?.error || "The import failed. Try again.", issues: data?.issues ?? [] })
        return
      }
      setOutcome({ counts: data.counts, issues: data.issues ?? [] })
      toast({
        title: "Products imported",
        description: `${data.counts.inserted} added, ${data.counts.updated} updated.`,
      })
    } catch {
      setImportError({ message: "The connection was interrupted. Check the products table before retrying.", issues: [] })
    } finally {
      setImporting(false)
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(json)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  function download() {
    const blob = new Blob([json], { type: "application/json" })
    const link = document.createElement("a")
    link.href = URL.createObjectURL(blob)
    link.download = "products.json"
    link.click()
    URL.revokeObjectURL(link.href)
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Collect products</CardTitle>
          <CardDescription>
            Paste an ASOS category or product link. Other shops are tried from the page&apos;s product data; Temu and
            SHEIN usually block this, so use a saved HTML page on the import form for those.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={collect} className="space-y-4">
            <Input
              type="url"
              required
              placeholder="https://www.asos.com/..."
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              aria-label="Shop link"
            />
            <div className="flex flex-wrap items-center gap-4">
              <Label className="flex items-center gap-2 text-sm font-normal">
                Products
                <select
                  value={limit}
                  onChange={(event) => setLimit(Number(event.target.value))}
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                >
                  {LIMITS.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </Label>
              <Label className="flex items-center gap-2 text-sm font-normal">
                <Checkbox checked={details} onCheckedChange={(checked) => setDetails(checked === true)} />
                Try full descriptions (slower)
              </Label>
              <Button type="button" variant="ghost" size="sm" onClick={() => setUrl(EXAMPLE)}>
                Use example
              </Button>
              <Button type="submit" disabled={loading} className="ml-auto">
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PackageSearch className="mr-2 h-4 w-4" />}
                {loading ? "Collecting..." : "Collect products"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Could not collect products</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {result && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Import to products</CardTitle>
              <CardDescription>
                Saves these products to the <code>catalogue_products</code> table for the product page. Products
                already there are updated with the new price and pictures. Nothing is added to Seidou Social.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-64 flex-1 space-y-2">
                  <Label htmlFor="product-category">Category</Label>
                  <Input
                    id="product-category"
                    value={category}
                    onChange={(event) => setCategory(event.target.value)}
                    placeholder="e.g. Dresses"
                  />
                </div>
                <Button onClick={() => void importProducts()} disabled={importing || !category.trim()}>
                  {importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <DatabaseZap className="mr-2 h-4 w-4" />}
                  {importing ? "Importing..." : `Import ${result.count} product${result.count === 1 ? "" : "s"}`}
                </Button>
              </div>

              {importError && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Import failed</AlertTitle>
                  <AlertDescription>
                    <p>{importError.message}</p>
                    {importError.issues.length > 0 && (
                      <ul className="mt-2 list-disc pl-4">
                        {importError.issues.map((issue, index) => (
                          <li key={index}>{issue.message}</li>
                        ))}
                      </ul>
                    )}
                  </AlertDescription>
                </Alert>
              )}

              {outcome && (
                <Alert className="border-emerald-500/40 bg-emerald-500/10">
                  <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  <AlertTitle>Import succeeded</AlertTitle>
                  <AlertDescription>
                    <p>
                      {outcome.counts.inserted} added, {outcome.counts.updated} updated
                      {outcome.counts.skipped > 0 ? `, ${outcome.counts.skipped} skipped` : ""}.
                    </p>
                    {outcome.issues.length > 0 && (
                      <ul className="mt-2 list-disc pl-4 text-amber-700 dark:text-amber-400">
                        {outcome.issues.map((issue, index) => (
                          <li key={index}>{issue.message}</li>
                        ))}
                      </ul>
                    )}
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">{result.title || "Results"}</h2>
                <p className="text-sm text-muted-foreground">
                  {result.count} of {result.total} products
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Tabs value={view} onValueChange={(value) => setView(value as "grid" | "json")}>
                  <TabsList>
                    <TabsTrigger value="grid">Preview</TabsTrigger>
                    <TabsTrigger value="json">JSON</TabsTrigger>
                  </TabsList>
                </Tabs>
                <Button variant="outline" size="sm" onClick={() => void copy()}>
                  <Copy className="mr-1.5 h-3.5 w-3.5" />
                  {copied ? "Copied" : "Copy"}
                </Button>
                <Button variant="outline" size="sm" onClick={download}>
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  Download
                </Button>
              </div>
            </div>

            {view === "json" ? (
              <pre className="max-h-[70vh] overflow-auto rounded-lg border border-border bg-muted/40 p-4 text-xs">
                {json}
              </pre>
            ) : (
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
                {result.products.map((product) => (
                  <article key={product.id} className="overflow-hidden rounded-lg border border-border bg-card">
                    <div className="aspect-[4/5] bg-white">
                      {product.image && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={product.thumbnail || product.image}
                          alt={product.name}
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          className="h-full w-full object-contain"
                        />
                      )}
                    </div>
                    <div className="space-y-1.5 p-3">
                      <h3 className="line-clamp-2 text-sm font-medium">{product.name}</h3>
                      <div className="flex items-baseline gap-2 text-sm">
                        <span className="font-semibold">{product.price}</span>
                        {product.previousPrice && (
                          <s className="text-xs text-muted-foreground">{product.previousPrice}</s>
                        )}
                      </div>
                      {product.brand && (
                        <Badge variant="secondary" className="text-xs">
                          {product.brand}
                        </Badge>
                      )}
                      {product.description && (
                        <p className="line-clamp-3 text-xs text-muted-foreground">{product.description}</p>
                      )}
                      <div className="flex gap-3 pt-1 text-xs">
                        {product.image && (
                          <a href={product.image} target="_blank" rel="noreferrer" className="hover:underline">
                            Full image
                          </a>
                        )}
                        {product.url && (
                          <a
                            href={product.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 hover:underline"
                          >
                            View product <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
