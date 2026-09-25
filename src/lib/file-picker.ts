export type PickFileOptions = {
  accept?: string;
  multiple?: boolean;
};

/**
 * Opens a native file picker and resolves to null on user cancellation.
 * The caller owns loading/error state; this utility owns input cleanup and
 * normalizes browser cancel behavior into a Promise result.
 */
export function pickFile(options: PickFileOptions = {}): Promise<File | File[] | null> {
  if (typeof document === "undefined") {
    return Promise.reject(new Error("File picking is only available in a browser."));
  }

  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = options.accept ?? "";
    input.multiple = Boolean(options.multiple);
    input.style.position = "fixed";
    input.style.left = "-10000px";
    input.style.top = "-10000px";
    input.setAttribute("aria-hidden", "true");
    document.body.appendChild(input);

    let settled = false;
    const cleanup = () => {
      input.removeEventListener("change", onChange);
      input.removeEventListener("cancel", onCancel);
      input.remove();
    };
    const finish = (result: File | File[] | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error instanceof Error ? error : new Error("Could not open the file picker."));
    };
    const onChange = () => {
      const files = Array.from(input.files ?? []);
      finish(options.multiple ? files : files[0] ?? null);
    };
    const onCancel = () => finish(null);

    input.addEventListener("change", onChange, { once: true });
    input.addEventListener("cancel", onCancel, { once: true });
    try {
      input.click();
    } catch (error) {
      fail(error);
    }
  });
}
