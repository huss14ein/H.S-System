import type { ConfirmActionOptions } from '../hooks/useConfirmAction';

/** Pass `confirmed: true` after the UI modal; `system: true` for automation (recurring apply, internal transfers). */
export type RecordWriteOptions = {
  confirmed?: boolean;
  system?: boolean;
};

type ConfirmFn = (options: ConfirmActionOptions) => Promise<boolean>;

/** Native `window.confirm` text when the modal provider is unavailable. */
export function formatNativeConfirmMessage(options: ConfirmActionOptions): string {
  const lines = [options.title, '', options.message];
  if (options.details?.length) {
    lines.push('', ...options.details);
  }
  return lines.join('\n');
}

let confirmFn: ConfirmFn | null = null;

export function registerRecordConfirm(fn: ConfirmFn | null): void {
  confirmFn = fn;
}

export async function guardRecordWrite(
  opts: RecordWriteOptions | undefined,
  payload: ConfirmActionOptions,
): Promise<boolean> {
  if (opts?.confirmed || opts?.system) return true;
  if (confirmFn) return confirmFn(payload);
  if (typeof window !== 'undefined') {
    return window.confirm(formatNativeConfirmMessage(payload));
  }
  return false;
}
