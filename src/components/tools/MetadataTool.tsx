import { useState } from "react";
import { PDFDocument } from "pdf-lib";
import { DropZone } from "@/components/site/DropZone";
import { SingleFilePicker } from "@/components/site/SingleFilePicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { downloadBlob } from "@/lib/download";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

export function MetadataTool() {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [subject, setSubject] = useState("");
  const [keywords, setKeywords] = useState("");
  const [busy, setBusy] = useState(false);

  async function onFiles(fs: File[]) {
    const f = fs[0];
    if (!f) return;
    setFile(f);
    const doc = await PDFDocument.load(new Uint8Array(await f.arrayBuffer()));
    setTitle(doc.getTitle() ?? "");
    setAuthor(doc.getAuthor() ?? "");
    setSubject(doc.getSubject() ?? "");
    setKeywords((doc.getKeywords() ?? "") as string);
  }

  async function run() {
    if (!file) return;
    setBusy(true);
    try {
      const doc = await PDFDocument.load(new Uint8Array(await file.arrayBuffer()));
      doc.setTitle(title);
      doc.setAuthor(author);
      doc.setSubject(subject);
      doc.setKeywords(keywords.split(",").map((k) => k.trim()).filter(Boolean));
      downloadBlob(await doc.save(), `lazy-pdf-metadata-${file.name}`);
      toast.success("Metadata updated.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {!file ? (
        <DropZone onFiles={onFiles} accept={{ "application/pdf": [".pdf"] }} multiple={false} hint="Drop a PDF." />
      ) : (
        <SingleFilePicker file={file} onChange={() => setFile(null)}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><Label htmlFor="t">Title</Label><Input id="t" value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1" /></div>
            <div><Label htmlFor="a">Author</Label><Input id="a" value={author} onChange={(e) => setAuthor(e.target.value)} className="mt-1" /></div>
            <div><Label htmlFor="s">Subject</Label><Input id="s" value={subject} onChange={(e) => setSubject(e.target.value)} className="mt-1" /></div>
            <div><Label htmlFor="k">Keywords (comma-separated)</Label><Input id="k" value={keywords} onChange={(e) => setKeywords(e.target.value)} className="mt-1" /></div>
          </div>
        </SingleFilePicker>
      )}
      <div className="flex justify-end">
        <Button variant="action" size="xl" onClick={run} disabled={!file || busy}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save metadata
        </Button>
      </div>
    </div>
  );
}
