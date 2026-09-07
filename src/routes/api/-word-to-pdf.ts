import type { Route } from "./+types/word-to-pdf";

export async function POST({ request }: Route.ActionArgs) {
  const converterUrl = process.env.DOCX_CONVERTER_URL || "http://localhost:8080";
  
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    
    if (!file) {
      return Response.json(
        { error: "No file provided", message: "Please upload a Word document." },
        { status: 400 }
      );
    }
    
    if (!file.name.toLowerCase().endsWith(".docx")) {
      return Response.json(
        { error: "Invalid file type", message: "Only .docx files are supported." },
        { status: 400 }
      );
    }
    
    if (file.size > 50 * 1024 * 1024) {
      return Response.json(
        { error: "File too large", message: "File size exceeds 50 MB limit." },
        { status: 413 }
      );
    }
    
    const forwardFormData = new FormData();
    forwardFormData.append("file", file);
    
    const response = await fetch(`${converterUrl}/convert`, {
      method: "POST",
      body: forwardFormData,
    });
    
    if (!response.ok) {
      let errorMessage = "Conversion failed";
      try {
        const errorData = await response.json();
        errorMessage = errorData.message || errorData.error || errorMessage;
      } catch {
        errorMessage = `Server returned status ${response.status}`;
      }
      
      return Response.json(
        { error: "Conversion failed", message: errorMessage },
        { status: response.status }
      );
    }
    
    const pdfBlob = await response.blob();
    
    return new Response(pdfBlob, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${file.name.replace(/\.docx$/i, ".pdf")}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Word to PDF conversion error:", error);
    
    const message = error instanceof Error ? error.message : "An unexpected error occurred";
    
    if (message.includes("fetch") || message.includes("network") || message.includes("ECONNREFUSED")) {
      return Response.json(
        { error: "Service unavailable", message: "Unable to connect to PDF conversion service." },
        { status: 503 }
      );
    }
    
    return Response.json(
      { error: "Conversion error", message },
      { status: 500 }
    );
  }
}