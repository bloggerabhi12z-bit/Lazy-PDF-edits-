import { useEffect } from "react";
import { useDropzone, type Accept, type FileRejection } from "react-dropzone";
import { FileCheck2, UploadCloud } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { takeStagedFiles } from "@/lib/pending-files";

interface DropZoneProps {
  onFiles: (files: File[]) => void;
  accept?: Accept;
  multiple?: boolean;
  hint?: string;
  maxSize?: number;
}

const DEFAULT_MAX_SIZE = 200 * 1024 * 1024;

export function DropZone({ onFiles, accept, multiple = true, hint, maxSize = DEFAULT_MAX_SIZE }: DropZoneProps) {
  useEffect(() => {
    const staged = takeStagedFiles();
    if (staged.length) onFiles(multiple ? staged : staged.slice(0, 1));
  }, [multiple, onFiles]);

  const handleRejected = (rejections: FileRejection[]) => {
    const first = rejections[0];
    const message = first?.errors[0]?.code === "file-too-large"
      ? `Files must be smaller than ${Math.round(maxSize / 1024 / 1024)} MB.`
      : "That file type is not supported by this tool.";
    toast.error(message);
  };

  const { getRootProps, getInputProps, isDragActive, isDragReject } = useDropzone({
    onDropAccepted: onFiles,
    onDropRejected: handleRejected,
    accept,
    multiple,
    maxSize,
  });

  return (
    <div
      {...getRootProps()}
      className={`group relative cursor-pointer overflow-hidden rounded-[2rem] border-2 border-dashed p-8 text-center outline-none transition-all focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:p-12 ${
        isDragReject
          ? "border-destructive bg-destructive/5"
          : isDragActive
          ? "scale-[1.01] border-signal bg-signal-soft/70"
          : "border-border bg-gradient-to-b from-card to-secondary/40 hover:scale-[1.005] hover:border-signal/70 hover:shadow-lg"
      }`}
      aria-label="Select files or drag and drop files here"
    >
      <input
        {...getInputProps({
          style: {
            border: 0,
            clip: "rect(0px, 0px, 0px, 0px)",
            clipPath: "inset(50%)",
            height: "1px",
            margin: "0px -1px -1px 0px",
            overflow: "hidden",
            padding: 0,
            position: "absolute",
            width: "1px",
            whiteSpace: "nowrap",
          },
        })}
      />
      <motion.div
        animate={{ y: isDragActive ? -6 : 0, scale: isDragActive ? 1.05 : 1 }}
        className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-signal text-ink shadow-md shadow-signal/30 transition-transform group-hover:-translate-y-1"
      >
        {isDragActive && !isDragReject ? <FileCheck2 className="h-8 w-8" /> : <UploadCloud className="h-8 w-8" />}
      </motion.div>
      <div className="mt-5 font-display text-2xl">
        {isDragReject ? "This file cannot be used" : isDragActive ? "Drop your files" : "Select files"}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {isDragActive ? "" : "or drag and drop here"}
      </p>
      <p className="mt-3 text-xs text-muted-foreground">
        {hint ?? `PDF and supported source files up to ${Math.round(maxSize / 1024 / 1024)} MB`}
      </p>
    </div>
  );
}
