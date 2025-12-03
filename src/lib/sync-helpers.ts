import { relative } from "node:path";
import ora, { type Ora } from "ora";

interface IndexingSpinner {
  spinner: Ora;
  onProgress: (info: InitialSyncProgress) => void;
}

export interface InitialSyncProgress {
  processed: number;
  uploaded: number;
  deleted: number;
  errors: number;
  total: number;
  filePath?: string;
  lastError?: string;
}

export interface InitialSyncResult {
  processed: number;
  uploaded: number;
  deleted: number;
  errors: number;
  total: number;
}

/**
 * Converts an absolute `filePath` into a path relative to `root` when possible,
 * keeping absolute fallbacks for paths outside the repo.
 *
 * @param root The root directory of the repository
 * @param filePath The path to the file to format
 * @returns The formatted path
 */
function formatRelativePath(root: string, filePath?: string): string {
  if (!filePath) {
    return "";
  }
  return filePath.startsWith(root) ? relative(root, filePath) : filePath;
}

/**
 * Creates a shared spinner + progress callback pair that keeps the CLI UI
 * consistent across commands running `initialSync`.
 *
 * @param root The root directory of the repository
 * @param label The label to use for the spinner
 * @returns The spinner and progress callback pair
 */
export function createIndexingSpinner(
  root: string,
  label = "Indexing files...",
): IndexingSpinner {
  const spinner = ora({ text: label }).start();
  return {
    spinner,
    onProgress(info) {
      const rel = formatRelativePath(root, info.filePath);
      const suffix = rel ? ` ${rel}` : "";
      const deletedInfo = info.deleted > 0 ? ` • deleted ${info.deleted}` : "";
      const errorsInfo = info.errors > 0 ? ` • errors ${info.errors}` : "";
      spinner.text = `Indexing files (${info.processed}/${info.total}) • uploaded ${info.uploaded}${deletedInfo}${errorsInfo}${suffix}`;
    },
  };
}

/**
 * Produces a single-line summary describing what a dry-run sync would have done.
 *
 * @param result The result of the initial sync
 * @param actionDescription The description of the action
 * @param includeTotal Whether to include the total number of files
 * @returns The formatted summary
 */
export function formatDryRunSummary(
  result: InitialSyncResult,
  {
    actionDescription,
    includeTotal = false,
  }: { actionDescription: string; includeTotal?: boolean },
): string {
  const totalSuffix = includeTotal ? " in total" : "";
  const deletedSuffix =
    result.deleted > 0 ? `, would have deleted ${result.deleted} files` : "";
  return `Dry run: ${actionDescription} ${result.processed} files${totalSuffix}, would have uploaded ${result.uploaded} changed or new files${deletedSuffix}`;
}
