"use client"

import { AlertTriangle, CheckCircle2, ChevronDown, CircleX, ImageIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"
import { formatBytes, type ImportValidationResult, type ValidationIssue } from "@/lib/video-import/validation"

interface ValidationPreviewProps {
  jsonFileName: string | null
  jsonFileSize: number | null
  jsonIssues: ValidationIssue[]
  validation: ImportValidationResult | null
  imageFileName: string | null
  imagePreviewUrl: string | null
  imageIssues: ValidationIssue[]
  conflictsAcknowledged: boolean
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

export function ValidationPreview({
  jsonFileName,
  jsonFileSize,
  jsonIssues,
  validation,
  imageFileName,
  imagePreviewUrl,
  imageIssues,
  conflictsAcknowledged,
}: ValidationPreviewProps) {
  const jsonReady = validation !== null && validation.ok && jsonIssues.every((issue) => issue.severity !== "error")
  const imageReady = imageFileName !== null && imageIssues.length === 0
  const needsAcknowledgment = validation !== null && (validation.categoryConflict || validation.channelConflict)
  const acknowledged = !needsAcknowledgment || conflictsAcknowledged
  const ready = jsonReady && imageReady && acknowledged

  const errors = [...jsonIssues.filter((issue) => issue.severity === "error"), ...(validation?.issues ?? []).filter((issue) => issue.severity === "error"), ...imageIssues]
  const warnings = [
    ...jsonIssues.filter((issue) => issue.severity === "warning"),
    ...(validation?.issues ?? []).filter((issue) => issue.severity === "warning"),
  ]

  if (!jsonFileName && !imageFileName) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Validation summary</CardTitle>
          <CardDescription>Select a JSON file and a batch image to see what will be imported.</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const summaryParts: string[] = []
  if (validation) {
    summaryParts.push(
      validation.ok
        ? `Your file contains ${validation.totalRecords} video record${validation.totalRecords === 1 ? "" : "s"}. All records passed validation.`
        : `Your file contains ${validation.totalRecords} video record${validation.totalRecords === 1 ? "" : "s"}, but ${validation.invalidCount} of them failed validation.`,
    )
    if (validation.duplicateCount > 0) {
      summaryParts.push(`${validation.duplicateCount} duplicate record${validation.duplicateCount === 1 ? " was" : "s were"} detected and will be imported once.`)
    }
    if (validation.categories.length > 0) {
      summaryParts.push(`Category: ${validation.categories.join(", ")}.`)
    }
    if (validation.channelNames.length > 0) {
      summaryParts.push(`Channel: ${validation.channelNames.join(", ")}.`)
    }
  }
  if (imageReady) {
    summaryParts.push("Your batch image is ready.")
  }
  summaryParts.push(
    ready
      ? "You can now import."
      : needsAcknowledgment && !conflictsAcknowledged
        ? "Confirm the batch details below to enable the import."
        : "Fix the issues below to enable the import.",
  )

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">Validation summary</CardTitle>
          <Badge variant={ready ? "default" : "secondary"} className={cn(ready && "bg-emerald-600 hover:bg-emerald-600 text-white")}>
            {ready ? "Ready to import" : "Not ready"}
          </Badge>
        </div>
        <CardDescription>{summaryParts.join(" ")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">JSON file</dt>
            <dd className="mt-1 text-sm">
              {jsonFileName ? (
                <>
                  <span className="font-medium break-all">{jsonFileName}</span>
                  {jsonFileSize !== null && <span className="text-muted-foreground"> ({formatBytes(jsonFileSize)})</span>}
                  <span className={cn("mt-1 block text-xs", jsonReady ? "text-emerald-600 dark:text-emerald-400" : "text-destructive")}>
                    {jsonReady ? "Parsed and validated" : "Not valid yet"}
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground">No file selected</span>
              )}
            </dd>
          </div>
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Batch image</dt>
            <dd className="mt-1 flex items-center gap-3 text-sm">
              {imagePreviewUrl ? (
                <img src={imagePreviewUrl} alt="Batch preview" className="h-12 w-12 rounded-md border border-border object-cover" />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-md border border-border bg-background">
                  <ImageIcon className="h-5 w-5 text-muted-foreground" />
                </div>
              )}
              <div className="min-w-0">
                {imageFileName ? (
                  <>
                    <span className="font-medium break-all">{imageFileName}</span>
                    <span className={cn("mt-1 block text-xs", imageReady ? "text-emerald-600 dark:text-emerald-400" : "text-destructive")}>
                      {imageReady ? "Image validated" : "Not valid yet"}
                    </span>
                  </>
                ) : (
                  <span className="text-muted-foreground">No image selected</span>
                )}
              </div>
            </dd>
          </div>
        </dl>

        {validation && (
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-border p-3">
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Records</dt>
              <dd className="mt-1 text-lg font-semibold">{validation.totalRecords}</dd>
            </div>
            <div className="rounded-lg border border-border p-3">
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Valid</dt>
              <dd className="mt-1 text-lg font-semibold text-emerald-600 dark:text-emerald-400">{validation.validCount}</dd>
            </div>
            <div className="rounded-lg border border-border p-3">
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Invalid</dt>
              <dd className={cn("mt-1 text-lg font-semibold", validation.invalidCount > 0 ? "text-destructive" : "")}>{validation.invalidCount}</dd>
            </div>
            <div className="rounded-lg border border-border p-3">
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Duplicates</dt>
              <dd className={cn("mt-1 text-lg font-semibold", validation.duplicateCount > 0 ? "text-amber-600 dark:text-amber-400" : "")}>{validation.duplicateCount}</dd>
            </div>
          </dl>
        )}

        {needsAcknowledgment && !conflictsAcknowledged && (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
            This file mixes multiple {validation?.categoryConflict ? "categories" : ""}
            {validation?.categoryConflict && validation?.channelConflict ? " and " : ""}
            {validation?.channelConflict ? "channels" : ""}. Each video keeps its own values from the file. Tick the confirmation above to approve this batch.
          </p>
        )}

        {(errors.length > 0 || warnings.length > 0) && (
          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-muted-foreground">
                <ChevronDown className="mr-1 h-4 w-4" />
                Validation details ({errors.length} error{errors.length === 1 ? "" : "s"}, {warnings.length} warning{warnings.length === 1 ? "" : "s"})
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2 space-y-3 rounded-lg border border-border p-3">
              {errors.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-destructive">Errors</p>
                  <IssueList issues={errors} />
                </div>
              )}
              {warnings.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">Warnings</p>
                  <IssueList issues={warnings} />
                </div>
              )}
              {errors.length === 0 && warnings.length === 0 && (
                <p className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" /> No validation problems found.
                </p>
              )}
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  )
}
