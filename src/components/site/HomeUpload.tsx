import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Cloud, FileCheck2, FolderOpen, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { DropZone } from "@/components/site/DropZone";
import { FileList } from "@/components/site/FileList";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { stageFiles } from "@/lib/pending-files";

function routeFor(files: File[]) {
  if (files.length > 1 && files.every((file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) return "merge";
  const file = files[0];
  const name = file?.name.toLowerCase() ?? "";
  if (/\.jpe?g$/.test(name)) return "jpg-to-pdf";
  if (/\.png$/.test(name)) return "png-to-pdf";
  if (/\.docx?$/.test(name)) return "word-to-pdf";
  if (/\.xlsx?$/.test(name)) return "excel-to-pdf";
  if (/\.pptx?$/.test(name)) return "powerpoint-to-pdf";
  if (/\.html?$/.test(name)) return "html-to-pdf";
  return "compress";
}

export function HomeUpload() {
  const navigate = useNavigate();
  const [files, setFiles] = useState<File[]>([]);
  const [cloudOpen, setCloudOpen] = useState(false);
  const [cloudUrl, setCloudUrl] = useState("");
  const [importing, setImporting] = useState(false);

  const continueToTool = async (selected = files) => {
    if (!selected.length) return;
    stageFiles(selected);
    await navigate({ to: "/tools/$slug", params: { slug: routeFor(selected) } });
  };

  const importCloudFile = async () => {
    setImporting(true);
    try {
      const response = await fetch("/.netlify/functions/cloud-import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: cloudUrl }) });
      if (!response.ok) { const body = await response.json() as { error?: string }; throw new Error(body.error ?? "Cloud import failed."); }
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? "cloud-file.pdf";
      const imported = new File([blob], filename, { type: blob.type });
      setCloudOpen(false);
      setCloudUrl("");
      toast.success("Cloud file imported securely.");
      await continueToTool([imported]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Cloud import failed.");
    } finally { setImporting(false); }
  };

  return (
    <>
      <div className="glass-card rounded-[2rem] p-3 sm:p-5">
        {files.length === 0 ? <DropZone onFiles={setFiles} accept={{ "application/pdf": [".pdf"], "image/jpeg": [".jpg", ".jpeg"], "image/png": [".png"], "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"], "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"], "application/vnd.openxmlformats-officedocument.presentationml.presentation": [".pptx"], "text/html": [".html", ".htm"] }} hint="PDF, JPG, PNG, Word, Excel, PowerPoint, and HTML · up to 200 MB" /> : <div className="space-y-4"><FileList files={files} onRemove={(index) => setFiles((items) => items.filter((_, itemIndex) => itemIndex !== index))} /><Button size="lg" className="w-full" onClick={() => void continueToTool()}><FileCheck2 className="mr-2 h-5 w-5" />Continue with the best tool</Button></div>}
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <Button variant="outline" onClick={() => setCloudOpen(true)}><Cloud className="mr-2 h-4 w-4" />Upload from Google Drive</Button>
          <Button variant="outline" onClick={() => setCloudOpen(true)}><FolderOpen className="mr-2 h-4 w-4" />Upload from Dropbox</Button>
        </div>
        <div className="mt-4 flex items-center justify-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="h-4 w-4 text-signal" />Local files stay in your browser. Shared-link imports are never retained.</div>
      </div>
      <Dialog open={cloudOpen} onOpenChange={setCloudOpen}><DialogContent><DialogHeader><DialogTitle>Import a shared cloud file</DialogTitle><DialogDescription>Paste a public Google Drive or Dropbox file link. The file is streamed once and immediately handed to your browser.</DialogDescription></DialogHeader><div className="grid gap-3"><Label htmlFor="cloud-url">Shared file URL</Label><Input id="cloud-url" type="url" value={cloudUrl} onChange={(event) => setCloudUrl(event.target.value)} placeholder="https://drive.google.com/file/d/..." /><Button onClick={() => void importCloudFile()} disabled={importing || !cloudUrl}>{importing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Import file</Button></div></DialogContent></Dialog>
    </>
  );
}
