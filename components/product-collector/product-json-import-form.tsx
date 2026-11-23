"use client"

import { type DragEvent, useEffect, useMemo, useRef, useState } from "react"
import {
  AlertTriangle,
  CheckCircle2,
  CircleX,
  FileJson,
  ImageIcon,
  Loader2,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import { parseProductFile, type ProductFile } from "@/lib/product-collector/json-file"
import { toProductRecords } from "@/lib/product-collector/to-records"
import { PLATFORM_LABELS } from "@/lib/video-import/platforms"
import { formatBytes, readJsonFile, validateImageFile, type ValidationIssue } from "@/lib/video-import/validation"
import { cn } from "@/lib/utils"

interface JsonState {
  file: File
  issues: ValidationIssue[]
  parsed: ProductFile | null
}

interface ImageState {
  file: File
  issues: ValidationIssue[]
  previewUrl: string
}

type ImportState =
  | { phase: "idle" }
  | { phase: "importing" }
  | { phase: "success"; counts: { inserted: number; updated: number; skipped: number }; issues: ValidationIssue[] }
  | { phase: "error"; message: string; issues: ValidationIssue[] }

/**
 * Pushes a product JSON file to Supabase's catalogue_products, the way the
 * JSON Video Import Form does for videos. Accepts the Product Collector's
 * products.json or a video library export with ASOS/Temu/SHEIN records.
 * The batch image is optional: every product already has its own picture.
 */
export function ProductJsonImportForm() {
  const { toast } = useToast()
  const jsonInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const submittingRef = useRef(false)
  const [json, setJson] = useState<JsonState | null>(null)
  const [image, setImage] = useState<ImageState | null>(null)
  const [category, setCategory] = useState("")
  const [dragOver, setDragOver] = useState<{ json: boolean; image: boolean }>({ json: false, image: false })
  const [importState, setImportState] = useState<ImportState>({ phase: "idle" })

  useEffect(() => () => {
    if (image) URL.revokeObjectURL(image.previewUrl)
  }, [image])

  // The same checks the server runs, so problems show before importing.
  const conversion = useMemo(
    () => (json?.parsed ? toProductRecords(json.parsed.products, { category, sourceUrl: json.parsed.sourceUrl }) : null),
    [json, category],
  )

  const fileErrors = (json?.issues ?? []).filter((issue) => issue.severity === "error")
  const jsonReady = json !== null && json.parsed !== null && fileErrors.length === 0
  const imageReady = image === null || image.issues.length === 0
  const importing = importState.phase === "importing"
  const canImport = jsonReady && conversion?.ok === true && imageReady && !importing && importState.phase !== "success"

  async function selectJson(file: File | null | undefined) {
    if (!file || importing) return
    setImportState({ phase: "idle" })

    const read = await readJsonFile(file)
    if (!read.ok) {
      setJson({ file, issues: read.issues, parsed: null })
      return
    }

    const parsed = parseProductFile(JSON.parse(read.text))
    if (!parsed.ok) {
      setJson({ file, issues: [...read.issues, ...parsed.issues], parsed: null })
      return
    }

    setJson({ file, issues: [...read.issues, ...parsed.issues], parsed })
    setCategory(parsed.suggestedCategory)
  }

  async function selectImage(file: File | null | undefined) {
    if (!file || importing) return
    setImportState({ phase: "idle" })
    const result = await validateImageFile(file)
    setImage({ file, issues: result.issues, previewUrl: URL.createObjectURL(file) })
  }

  function handleDrop(kind: "json" | "image", event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragOver((prev) => ({ ...prev, [kind]: false }))
    const file = event.dataTransfer.files?.[0]
    if (kind === "json") void selectJson(file)
    else void selectImage(file)
  }

  function removeJson() {
    setJson(null)
    setCategory("")
    setImportState({ phase: "idle" })
    if (jsonInputRef.current) jsonInputRef.current.value = ""
  }

  function removeImage() {
    setImage(null)
    if (imageInputRef.current) imageInputRef.current.value = ""
  }

  function reset() {
    removeJson()
    removeImage()
  }

  async function handleImport() {
    if (submittingRef.current || !canImport || !json) return
    submittingRef.current = true
    setImportState({ phase: "importing" })

    const formData = new FormData()
    formData.append("jsonFile", json.file)
    formData.append("category", category)
    if (image) formData.append("image", image.file)

    try {
      const response = await fetch("/api/products/import", { method: "POST", body: formData })
      const data = await response.json().catch(() => null)

      if (!response.ok || !data?.ok) {
        setImportState({
          phase: "error",
          message: data?.error || "The import failed. Check your connection and try again.",
          issues: data?.issues ?? [],
        })
        return
      }

      setImportState({ phase: "success", counts: data.counts, issues: data.issues ?? [] })
      toast({
        title: "Products imported",
        description: `${data.counts.inserted} added, ${data.counts.updated} updated.`,
      })
    } catch {
      setImportState({
        phase: "error",
        message: "The connection was interrupted before the import finished. Check the products table before retrying.",
        issues: [],
      })
    } finally {
      submittingRef.current = false
    }
  }

  const issues = [...(json?.issues ?? []), ...(conversion?.issues ?? []), ...(image?.issues ?? [])]
  const errors = issues.filter((issue) => issue.severity === "error")
  const warnings = issues.filter((issue) => issue.severity === "warning")
  const records = conversion?.records ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Product JSON Import Form</CardTitle>
        <CardDescription>
          Pick a product JSON file - <code>products.json</code> from the collector, or a video library export with
          ASOS, Temu or SHEIN records - and push it to the <code>catalogue_products</code> table. Everything is checked
          before anything is imported. Products already there are updated. A batch image is optional: each product has
          its own picture.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-8">
        {/* JSON file */}
        <div className="space-y-2">
          <Label id="product-json-label">Product Data File</Label>
          <div
            onDragOver={(event) => {
              event.preventDefault()
              if (!importing) setDragOver((prev) => ({ ...prev, json: true }))
            }}
            onDragLeave={() => setDragOver((prev) => ({ ...prev, json: false }))}
            onDrop={(event) => handleDrop("json", event)}
            className={cn(
              "rounded-xl border-2 border-dashed p-6 transition-colors",
              dragOver.json ? "border-primary bg-primary/5" : "border-border",
            )}
          >
            <input
              ref={jsonInputRef}
              id="product-json-input"
              type="file"
              accept=".json,application/json"
              className="sr-only"
              aria-labelledby="product-json-label"
              disabled={importing}
              onChange={(event) => void selectJson(event.target.files?.[0] ?? null)}
            />

            {json === null ? (
              <div className="flex flex-col items-center gap-3 text-center">
                <FileJson className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Drag a .json file here, or choose one below.</p>
                <Button asChild variant="outline" size="sm" disabled={importing}>
                  <label htmlFor="product-json-input" className="cursor-pointer">
                    <Upload className="mr-1.5 h-3.5 w-3.5" />
                    Choose JSON File
                  </label>
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-md border border-border bg-background">
                  <FileJson className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{json.file.name}</p>
                  <p className="text-xs text-muted-foreground">{formatBytes(json.file.size)}</p>
                </div>
                {json.parsed && (
                  <Badge variant="outline">{json.parsed.format === "collector" ? "Collector file" : "Library export"}</Badge>
                )}
                <Badge variant={jsonReady && conversion?.ok ? "default" : "destructive"}>
                  {jsonReady && conversion?.ok ? "Valid" : "Invalid"}
                </Badge>
                <Button asChild variant="outline" size="sm" disabled={importing}>
                  <label htmlFor="product-json-input" className="cursor-pointer">
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                    Replace
                  </label>
                </Button>
                <Button variant="ghost" size="sm" onClick={removeJson} disabled={importing}>
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  Remove
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Category */}
        <div className="space-y-2">
          <Label htmlFor="product-json-category">Category</Label>
          <Input
            id="product-json-category"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            placeholder="e.g. Dresses"
            disabled={importing || json === null}
          />
          <p className="text-xs text-muted-foreground">
            Filled in from the file. Every product in this import is saved under this category.
          </p>
        </div>

        {/* Batch image */}
        <div className="space-y-2">
          <Label id="product-image-label">Batch Image (optional)</Label>
          <p className="text-xs text-muted-foreground">
            Not needed for products - each product already has its own picture. If you add one, it is saved with
            this import batch.
          </p>
          <div
            onDragOver={(event) => {
              event.preventDefault()
              if (!importing) setDragOver((prev) => ({ ...prev, image: true }))
            }}
            onDragLeave={() => setDragOver((prev) => ({ ...prev, image: false }))}
            onDrop={(event) => handleDrop("image", event)}
            className={cn(
              "rounded-xl border-2 border-dashed p-6 transition-colors",
              dragOver.image ? "border-primary bg-primary/5" : "border-border",
            )}
          >
            <input
              ref={imageInputRef}
              id="product-image-input"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              aria-labelledby="product-image-label"
              disabled={importing}
              onChange={(event) => void selectImage(event.target.files?.[0] ?? null)}
            />

            {image === null ? (
              <div className="flex flex-col items-center gap-3 text-center">
                <ImageIcon className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Drag a JPEG, PNG, or WebP image here.</p>
                <Button asChild variant="outline" size="sm" disabled={importing}>
                  <label htmlFor="product-image-input" className="cursor-pointer">
                    <Upload className="mr-1.5 h-3.5 w-3.5" />
                    Choose Image
                  </label>
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.previewUrl} alt="Selected batch image" className="h-12 w-12 rounded-md border border-border object-cover" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{image.file.name}</p>
                  <p className="text-xs text-muted-foreground">{formatBytes(image.file.size)}</p>
                  {image.issues.length === 0 ? (
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Image ready
                    </p>
                  ) : (
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-destructive">
                      <AlertTriangle className="h-3.5 w-3.5" /> {image.issues[0].message}
                    </p>
                  )}
                </div>
                <Button asChild variant="outline" size="sm" disabled={importing}>
                  <label htmlFor="product-image-input" className="cursor-pointer">
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                    Replace
                  </label>
                </Button>
                <Button variant="ghost" size="sm" onClick={removeImage} disabled={importing}>
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  Remove
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Validation summary */}
        {json !== null && (
          <div className="space-y-4 rounded-xl border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">Validation summary</h3>
              <Badge variant={canImport ? "default" : "secondary"}>{canImport ? "Ready to import" : "Not ready"}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {json.parsed
                ? `${records.length} of ${json.parsed.products.length} product${json.parsed.products.length === 1 ? "" : "s"} will be imported${
                    category.trim() ? ` under "${category.trim()}"` : ""
                  }.${image === null ? " No batch image is needed." : ""}`
                : "The file could not be read."}
            </p>
            {conversion && conversion.platforms.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {conversion.platforms.map((platform) => (
                  <Badge key={platform} variant="secondary">
                    {PLATFORM_LABELS[platform]}: {records.filter((record) => record.platform === platform).length}
                  </Badge>
                ))}
              </div>
            )}
            {errors.length > 0 && <IssueList issues={errors} />}
            {warnings.length > 0 && <IssueList issues={warnings} />}
            {records.length > 0 && (
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
                {records.slice(0, 8).map((record) => (
                  <div key={`${record.platform}:${record.product_id}`} className="aspect-[4/5] overflow-hidden rounded-md border border-border bg-white">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={record.image_url} alt={record.title} title={record.title} loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-contain" />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Import */}
        <div className="flex flex-col gap-3">
          <Button type="button" size="lg" disabled={!canImport} onClick={() => void handleImport()}>
            {importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
            {importing ? "Importing..." : "Import to Supabase"}
          </Button>
          <p aria-live="polite" className="text-sm text-muted-foreground">
            {importing && "Saving the products. This can take a moment - please keep this page open."}
            {importState.phase === "idle" && "The import starts only after every check passes."}
          </p>
        </div>

        {importState.phase === "error" && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Import failed</AlertTitle>
            <AlertDescription>
              <p>{importState.message}</p>
              {importState.issues.length > 0 && <IssueList issues={importState.issues} />}
            </AlertDescription>
          </Alert>
        )}

        {importState.phase === "success" && (
          <Alert className="border-emerald-500/40 bg-emerald-500/10">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <AlertTitle>Import succeeded</AlertTitle>
            <AlertDescription className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    ["Added", importState.counts.inserted],
                    ["Updated", importState.counts.updated],
                    ["Skipped", importState.counts.skipped],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="rounded-md border border-border bg-background/50 p-2">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="text-lg font-semibold">{value}</p>
                  </div>
                ))}
              </div>
              <Button type="button" variant="outline" size="sm" onClick={reset}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                Start another import
              </Button>
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}

function IssueList({ issues }: { issues: ValidationIssue[] }) {
  return (
    <ul className="space-y-1.5">
      {issues.map((issue, index) => (
        <li
          key={index}
          className={cn(
            "flex gap-2 text-sm leading-snug",
            issue.severity === "error" ? "text-destructive" : "text-amber-600 dark:text-amber-400",
          )}
        >
          {issue.severity === "error" ? (
            <CircleX className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          ) : (
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          )}
          <span>{issue.message}</span>
        </li>
      ))}
    </ul>
  )
}
