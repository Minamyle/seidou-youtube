"use client"

import type React from "react"

import { useEffect, useRef, useState } from "react"
import {
  AlertTriangle,
  CheckCircle2,
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
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import { formatBytes, readJsonFile, validateImageFile, validateVideoRecords } from "@/lib/video-import/validation"
import type { ImportValidationResult, ValidationIssue } from "@/lib/video-import/validation"
import type { VideoPlatform } from "@/lib/video-import/config"
import { parseHtmlImport, readHtmlFile } from "@/lib/video-import/html"
import { PLATFORM_LABELS } from "@/lib/video-import/platforms"
import { ValidationPreview } from "./validation-preview"

interface ImportSuccessResult {
  ok: true
  batchId: string
  status: "completed"
  counts: {
    processed: number
    inserted: number
    skippedExisting: number
    failed: number
    duplicatesInFile: number
  }
  category: string | null
  channelNames: string[]
  platforms: VideoPlatform[]
  image: { path: string; signedUrl: string | null }
}

type SourceKind = "json" | "html"

type JsonState =
  | { phase: "idle" }
  | { phase: "reading"; fileName: string; fileSize: number; kind: SourceKind }
  | {
      phase: "selected"
      fileName: string
      fileSize: number
      kind: SourceKind
      issues: ValidationIssue[]
      validation: ImportValidationResult | null
    }

type ImportState =
  | { phase: "idle" }
  | { phase: "importing" }
  | { phase: "success"; result: ImportSuccessResult }
  | { phase: "error"; message: string }

interface ImageState {
  file: File | null
  issues: ValidationIssue[]
  previewUrl: string | null
}

const initialJsonState: JsonState = { phase: "idle" }
const initialImageState: ImageState = { file: null, issues: [], previewUrl: null }

export function JsonVideoImportForm() {
  const { toast } = useToast()

  const jsonInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const submittingRef = useRef(false)

  const [jsonFile, setJsonFile] = useState<File | null>(null)
  const [jsonState, setJsonState] = useState<JsonState>(initialJsonState)
  const [imageState, setImageState] = useState<ImageState>(initialImageState)
  const [conflictsAcknowledged, setConflictsAcknowledged] = useState(false)
  const [importState, setImportState] = useState<ImportState>({ phase: "idle" })
  const [dragOver, setDragOver] = useState<{ json: boolean; image: boolean }>({ json: false, image: false })

  const importing = importState.phase === "importing"

  useEffect(() => {
    return () => {
      if (imageState.previewUrl) {
        URL.revokeObjectURL(imageState.previewUrl)
      }
    }
  }, [imageState.previewUrl])

  const validation = jsonState.phase === "selected" ? jsonState.validation : null
  const fileIssues = jsonState.phase === "selected" ? jsonState.issues : []

  const jsonReady =
    jsonState.phase === "selected" &&
    validation !== null &&
    validation.ok &&
    fileIssues.every((issue) => issue.severity !== "error")

  const imageReady = imageState.file !== null && imageState.issues.length === 0
  const needsAcknowledgment = validation !== null && (validation.categoryConflict || validation.channelConflict)
  const canImport = jsonReady && imageReady && (!needsAcknowledgment || conflictsAcknowledged) && !importing && importState.phase !== "success"

  async function handleSourceSelection(file: File | null | undefined) {
    if (!file || importing) return

    const kind: SourceKind = /\.html?$/i.test(file.name) ? "html" : "json"

    setJsonFile(null)
    setConflictsAcknowledged(false)
    setImportState({ phase: "idle" })
    setJsonState({ phase: "reading", fileName: file.name, fileSize: file.size, kind })

    if (kind === "html") {
      const readResult = await readHtmlFile(file)

      if (!readResult.ok) {
        setJsonState({
          phase: "selected",
          fileName: file.name,
          fileSize: file.size,
          kind,
          issues: readResult.issues,
          validation: null,
        })
        return
      }

      const parsed = parseHtmlImport(readResult.text, file.name)
      const result = validateVideoRecords(parsed.records)
      const issues = [...readResult.issues, ...parsed.issues]

      if (parsed.records.length > 0) {
        const syntheticName = `${file.name.replace(/\.html?$/i, "")}.json`
        setJsonFile(
          new File([JSON.stringify(parsed.records)], syntheticName, {
            type: "application/json",
          }),
        )
      }

      setJsonState({
        phase: "selected",
        fileName: file.name,
        fileSize: file.size,
        kind,
        issues,
        validation: result,
      })
      return
    }

    const readResult = await readJsonFile(file)

    if (!readResult.ok) {
      setJsonState({
        phase: "selected",
        fileName: file.name,
        fileSize: file.size,
        kind,
        issues: readResult.issues,
        validation: null,
      })
      return
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(readResult.text)
    } catch {
      setJsonState({
        phase: "selected",
        fileName: file.name,
        fileSize: file.size,
        kind,
        issues: [{ severity: "error", message: "The file is not valid JSON." }],
        validation: null,
      })
      return
    }

    const result = validateVideoRecords(parsed)
    setJsonFile(file)
    setJsonState({
      phase: "selected",
      fileName: file.name,
      fileSize: file.size,
      kind,
      issues: readResult.issues,
      validation: result,
    })
  }

  async function handleImageSelection(file: File | null | undefined) {
    if (!file || importing) return

    setImportState({ phase: "idle" })
    const result = await validateImageFile(file)
    let previewUrl: string | null = null
    try {
      previewUrl = URL.createObjectURL(file)
    } catch {
      previewUrl = null
    }

    setImageState({ file, issues: result.issues, previewUrl })
  }

  async function handleImport() {
    if (submittingRef.current || !canImport || !jsonFile || !imageState.file) return

    submittingRef.current = true
    setImportState({ phase: "importing" })

    const sourceFilename = jsonState.phase === "selected" ? jsonState.fileName : jsonFile.name
    const formData = new FormData()
    formData.append("jsonFile", jsonFile)
    formData.append("image", imageState.file)
    formData.append("sourceFilename", sourceFilename)
    formData.append("conflictsAcknowledged", String(conflictsAcknowledged))

    try {
      const response = await fetch("/api/video-import", {
        method: "POST",
        body: formData,
      })

      const data = await response.json().catch(() => null)

      if (!response.ok || !data?.ok) {
        const message =
          typeof data?.error === "string" && data.error
            ? data.error
            : "The import failed. Check your connection and try again."
        setImportState({ phase: "error", message })
        toast({ title: "Import failed", description: message, variant: "destructive" })
        return
      }

      const result = data as ImportSuccessResult
      setImportState({ phase: "success", result })
      toast({
        title: "Import complete",
        description: `${result.counts.inserted} video${result.counts.inserted === 1 ? "" : "s"} added, ${result.counts.skippedExisting} already in the catalogue.`,
      })
    } catch {
      const message =
        "The connection was interrupted before the import finished. Nothing can be confirmed yet - check your catalogue before retrying."
      setImportState({ phase: "error", message })
      toast({ title: "Connection problem", description: message, variant: "destructive" })
    } finally {
      submittingRef.current = false
    }
  }

  function resetForm() {
    if (importing) return
    if (imageState.previewUrl) {
      URL.revokeObjectURL(imageState.previewUrl)
    }
    setJsonFile(null)
    setJsonState(initialJsonState)
    setImageState(initialImageState)
    setConflictsAcknowledged(false)
    setImportState({ phase: "idle" })
    if (jsonInputRef.current) jsonInputRef.current.value = ""
    if (imageInputRef.current) imageInputRef.current.value = ""
  }

  function handleDrop(kind: "json" | "image", event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragOver((prev) => ({ ...prev, [kind]: false }))
    const file = event.dataTransfer.files?.[0] ?? null
    if (kind === "json") {
      void handleSourceSelection(file)
    } else {
      void handleImageSelection(file)
    }
  }

  const categories = validation?.categories.join(", ") ?? ""
  const channels = validation?.channelNames.join(", ") ?? ""

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">JSON Video Import Form</CardTitle>
          <CardDescription>
            Pick a JSON file of video records and one image for the batch. Everything is checked before anything is
            imported. Your JSON file is the source of truth - category and channel names are read from it and cannot be
            edited here. YouTube and X (Twitter) video links are both supported.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-8">
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="import-category">Category</Label>
              <Input
                id="import-category"
                readOnly
                value={categories}
                placeholder={jsonState.phase === "reading" ? "Reading file..." : "Select a JSON file to detect the category"}
                aria-describedby="import-category-hint"
              />
              <p id="import-category-hint" className="text-xs text-muted-foreground">
                Taken from the JSON file. It cannot be changed here.
              </p>
              {validation?.categoryConflict && (
                <p className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  The file mixes {validation.categories.length} categories: {categories}. Confirm the batch below or
                  split the file by category.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="import-channel">Channel Name</Label>
              <Input
                id="import-channel"
                readOnly
                value={channels}
                placeholder={jsonState.phase === "reading" ? "Reading file..." : "Select a JSON file to detect the channel"}
                aria-describedby="import-channel-hint"
              />
              <p id="import-channel-hint" className="text-xs text-muted-foreground">
                Taken from the JSON file. It cannot be changed here.
              </p>
              {validation?.channelConflict && (
                <p className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  The file lists {validation.channelNames.length} channel names: {channels}. Each video keeps its own
                  channel name from the file. Confirm the batch below.
                </p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label id="json-file-label">Video Data File</Label>
            <p className="text-xs text-muted-foreground">
              Use a JSON file, or an HTML page saved from X / a video results page. HTML is converted to JSON in your
              browser, then validated again on the server.
            </p>
            <div
              onDragOver={(event) => {
                event.preventDefault()
                if (!importing) setDragOver((prev) => ({ ...prev, json: true }))
              }}
              onDragLeave={() => setDragOver((prev) => ({ ...prev, json: false }))}
              onDrop={(event) => handleDrop("json", event)}
              className={`rounded-lg border border-dashed p-4 transition-colors ${
                dragOver.json ? "border-primary bg-primary/5" : "border-border"
              }`}
            >
              <input
                ref={jsonInputRef}
                id="json-file-input"
                type="file"
                accept=".json,.html,.htm,application/json,text/html"
                className="sr-only"
                disabled={importing}
                onChange={(event) => {
                  void handleSourceSelection(event.target.files?.[0] ?? null)
                  event.target.value = ""
                }}
              />

              {jsonState.phase === "idle" && (
                <div className="flex flex-col items-center gap-3 py-4 text-center">
                  <FileJson className="h-8 w-8 text-muted-foreground" />
                  <div className="text-sm text-muted-foreground">
                    Drag a .json, .html, or .htm file here, or choose one below.
                  </div>
                  <Button asChild variant="outline" disabled={importing}>
                    <label htmlFor="json-file-input" className="cursor-pointer">
                      <Upload className="mr-2 h-4 w-4" />
                      Choose File
                    </label>
                  </Button>
                </div>
              )}

              {jsonState.phase === "reading" && (
                <div className="flex items-center gap-3 py-4">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  <div>
                    <p className="text-sm font-medium">Validating {jsonState.fileName}...</p>
                    <p className="text-xs text-muted-foreground">Reading and checking every record.</p>
                  </div>
                </div>
              )}

              {jsonState.phase === "selected" && (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background">
                      <FileJson className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{jsonState.fileName}</p>
                      <p className="text-xs text-muted-foreground">{formatBytes(jsonState.fileSize)}</p>
                    </div>
                    <Badge variant="outline" className="ml-1 shrink-0">
                      {jsonState.kind === "html" ? "HTML" : "JSON"}
                    </Badge>
                    <Badge variant={jsonReady ? "default" : "destructive"} className="ml-1 shrink-0">
                      {jsonReady ? "Valid" : "Invalid"}
                    </Badge>
                  </div>
                  <div className="flex gap-2">
                    <Button asChild variant="outline" size="sm" disabled={importing}>
                      <label htmlFor="json-file-input" className="cursor-pointer">
                        <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                        Replace
                      </label>
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={importing}
                      onClick={() => {
                        setJsonFile(null)
                        setJsonState(initialJsonState)
                        setConflictsAcknowledged(false)
                        setImportState({ phase: "idle" })
                        if (jsonInputRef.current) jsonInputRef.current.value = ""
                      }}
                    >
                      <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                      Remove
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label id="image-file-label">Batch Image</Label>
            <div
              onDragOver={(event) => {
                event.preventDefault()
                if (!importing) setDragOver((prev) => ({ ...prev, image: true }))
              }}
              onDragLeave={() => setDragOver((prev) => ({ ...prev, image: false }))}
              onDrop={(event) => handleDrop("image", event)}
              className={`rounded-lg border border-dashed p-4 transition-colors ${
                dragOver.image ? "border-primary bg-primary/5" : "border-border"
              }`}
            >
              <input
                ref={imageInputRef}
                id="image-file-input"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                disabled={importing}
                onChange={(event) => {
                  void handleImageSelection(event.target.files?.[0] ?? null)
                  event.target.value = ""
                }}
              />

              {imageState.file === null && (
                <div className="flex flex-col items-center gap-3 py-4 text-center">
                  <ImageIcon className="h-8 w-8 text-muted-foreground" />
                  <div className="text-sm text-muted-foreground">
                    Drag a JPEG, PNG, or WebP image here (one image for the whole batch).
                  </div>
                  <Button asChild variant="outline" disabled={importing}>
                    <label htmlFor="image-file-input" className="cursor-pointer">
                      <Upload className="mr-2 h-4 w-4" />
                      Choose Image
                    </label>
                  </Button>
                </div>
              )}

              {imageState.file !== null && (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    {imageState.previewUrl ? (
                      <img
                        src={imageState.previewUrl}
                        alt="Selected batch image preview"
                        className="h-14 w-14 shrink-0 rounded-md border border-border object-cover"
                      />
                    ) : (
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border border-border bg-background">
                        <ImageIcon className="h-5 w-5 text-muted-foreground" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{imageState.file.name}</p>
                      <p className="text-xs text-muted-foreground">{formatBytes(imageState.file.size)}</p>
                      {imageState.issues.length === 0 ? (
                        <p className="mt-0.5 flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Image ready
                        </p>
                      ) : (
                        <p className="mt-0.5 flex items-center gap-1 text-xs text-destructive">
                          <AlertTriangle className="h-3.5 w-3.5" /> {imageState.issues[0].message}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button asChild variant="outline" size="sm" disabled={importing}>
                      <label htmlFor="image-file-input" className="cursor-pointer">
                        <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                        Replace
                      </label>
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={importing}
                      onClick={() => {
                        if (imageState.previewUrl) URL.revokeObjectURL(imageState.previewUrl)
                        setImageState(initialImageState)
                        setImportState({ phase: "idle" })
                        if (imageInputRef.current) imageInputRef.current.value = ""
                      }}
                    >
                      <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                      Remove
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {needsAcknowledgment && (
            <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
              <Checkbox
                id="conflict-ack"
                checked={conflictsAcknowledged}
                disabled={importing}
                onCheckedChange={(checked) => setConflictsAcknowledged(checked === true)}
                className="mt-0.5"
              />
              <div className="grid gap-1.5 leading-snug">
                <Label htmlFor="conflict-ack" className="text-sm font-medium text-amber-700 dark:text-amber-400">
                  I confirm this batch is intentional
                </Label>
                <p className="text-xs text-amber-700/90 dark:text-amber-400/90">
                  {validation?.categoryConflict && (
                    <>
                      Categories in this file: {categories}.{" "}
                    </>
                  )}
                  {validation?.channelConflict && <>Channels in this file: {channels}. </>
                  }
                  Each video keeps its own category and channel exactly as written in the JSON file. Nothing is
                  overwritten or renamed.
                </p>
              </div>
            </div>
          )}

          <ValidationPreview
            jsonFileName={
              jsonState.phase === "reading" || jsonState.phase === "selected"
                ? jsonState.fileName
                : jsonFile?.name ?? null
            }
            jsonFileSize={
              jsonState.phase === "reading" || jsonState.phase === "selected"
                ? jsonState.fileSize
                : jsonFile?.size ?? null
            }
            sourceKind={jsonState.phase === "selected" ? jsonState.kind : "json"}
            jsonIssues={fileIssues}
            validation={validation}
            imageFileName={imageState.file?.name ?? null}
            imagePreviewUrl={imageState.previewUrl}
            imageIssues={imageState.issues}
            conflictsAcknowledged={conflictsAcknowledged}
          />

          <div className="flex flex-col gap-3">
            <Button type="button" size="lg" disabled={!canImport} onClick={() => void handleImport()}>
              {importing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Importing...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Import to Supabase
                </>
              )}
            </Button>
            <p aria-live="polite" className="text-sm text-muted-foreground">
              {importing && "Uploading the image and saving the video records. This can take a moment - please keep this page open."}
              {!importing && importState.phase === "idle" && "The import starts only after every check passes."}
            </p>
          </div>

          {importState.phase === "success" && (
            <Alert className="border-emerald-500/40 bg-emerald-500/10">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <AlertTitle>Import succeeded</AlertTitle>
              <AlertDescription className="space-y-3">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="rounded-md border border-border bg-background/50 p-2">
                    <p className="text-xs text-muted-foreground">Imported</p>
                    <p className="text-lg font-semibold">{importState.result.counts.inserted}</p>
                  </div>
                  <div className="rounded-md border border-border bg-background/50 p-2">
                    <p className="text-xs text-muted-foreground">Already in catalogue</p>
                    <p className="text-lg font-semibold">{importState.result.counts.skippedExisting}</p>
                  </div>
                  <div className="rounded-md border border-border bg-background/50 p-2">
                    <p className="text-xs text-muted-foreground">Duplicates in file</p>
                    <p className="text-lg font-semibold">{importState.result.counts.duplicatesInFile}</p>
                  </div>
                  <div className="rounded-md border border-border bg-background/50 p-2">
                    <p className="text-xs text-muted-foreground">Failed</p>
                    <p className="text-lg font-semibold">{importState.result.counts.failed}</p>
                  </div>
                </div>
                {importState.result.image.signedUrl && (
                  <div className="flex items-center gap-3">
                    <img
                      src={importState.result.image.signedUrl}
                      alt="Imported batch"
                      className="h-14 w-14 rounded-md border border-border object-cover"
                    />
                    <p className="text-xs text-muted-foreground">
                      The batch image was saved to Supabase Storage for this import batch.
                    </p>
                  </div>
                )}
                {importState.result.platforms.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Platforms: {importState.result.platforms.map((platform) => PLATFORM_LABELS[platform]).join(", ")}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">Batch reference: {importState.result.batchId}</p>
                <Button type="button" variant="outline" size="sm" onClick={resetForm}>
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  Start another import
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {importState.phase === "error" && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Import failed</AlertTitle>
              <AlertDescription className="space-y-2">
                <p>{importState.message}</p>
                <p className="text-xs">Fix the problem if needed and press &quot;Import to Supabase&quot; to try again.</p>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
