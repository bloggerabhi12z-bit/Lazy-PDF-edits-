import { MergeTool } from "@/components/tools/MergeTool";
import { SplitTool } from "@/components/tools/SplitTool";
import { CompressTool } from "@/components/tools/CompressTool";
import { RotateTool } from "@/components/tools/RotateTool";
import { ImagesToPdfTool } from "@/components/tools/ImagesToPdfTool";
import { ExtractPagesTool } from "@/components/tools/ExtractPagesTool";
import { DeletePagesTool } from "@/components/tools/DeletePagesTool";
import { RearrangePagesTool } from "@/components/tools/RearrangePagesTool";
import { WatermarkTool } from "@/components/tools/WatermarkTool";
import { PageNumbersTool } from "@/components/tools/PageNumbersTool";
import { HeaderFooterTool } from "@/components/tools/HeaderFooterTool";
import { MetadataTool } from "@/components/tools/MetadataTool";
import { RepairTool } from "@/components/tools/RepairTool";
import { FlattenTool } from "@/components/tools/FlattenTool";
import {
  ComparePdfsTool,
  CropPdfTool,
  EditPdfTool,
  EpubToPdfTool,
  ExcelToPdfTool,
  ExtractImagesTool,
  ExtractTextTool,
  FillFormsTool,
  HtmlToPdfTool,
  OcrPdfTool,
  PdfToEpubTool,
  PdfToExcelTool,
  PdfToHtmlTool,
  PdfToImagesTool,
  PdfToPowerPointTool,
  PdfToWordTool,
  PowerPointToPdfTool,
  ProtectPdfTool,
  RedactPdfTool,
  RemoveWatermarkTool,
  ScanToPdfTool,
  SignPdfTool,
  UnlockPdfTool,
  WordToPdfTool,
} from "@/components/tools/AdvancedTools";
import type { ReactNode } from "react";

export function renderTool(slug: string): ReactNode {
  switch (slug) {
    case "merge": return <MergeTool />;
    case "split": return <SplitTool />;
    case "compress": return <CompressTool />;
    case "rotate": return <RotateTool />;
    case "extract-pages": return <ExtractPagesTool />;
    case "delete-pages": return <DeletePagesTool />;
    case "rearrange-pages": return <RearrangePagesTool />;
    case "crop": return <CropPdfTool />;
    case "watermark": return <WatermarkTool />;
    case "remove-watermark": return <RemoveWatermarkTool />;
    case "page-numbers": return <PageNumbersTool />;
    case "header-footer": return <HeaderFooterTool />;
    case "metadata": return <MetadataTool />;
    case "edit": return <EditPdfTool />;
    case "redact": return <RedactPdfTool />;
    case "compare": return <ComparePdfsTool />;
    case "protect": return <ProtectPdfTool />;
    case "unlock": return <UnlockPdfTool />;
    case "sign": return <SignPdfTool />;
    case "fill-forms": return <FillFormsTool />;
    case "repair": return <RepairTool />;
    case "flatten": return <FlattenTool />;
    case "jpg-to-pdf":
      return <ImagesToPdfTool accept={{ "image/jpeg": [".jpg", ".jpeg"] }} hint="Drop JPG images. They'll be added in the order shown." />;
    case "png-to-pdf":
      return <ImagesToPdfTool accept={{ "image/png": [".png"] }} hint="Drop PNG images. They'll be added in the order shown." />;
    case "scan-to-pdf": return <ScanToPdfTool />;
    case "pdf-to-jpg": return <PdfToImagesTool type="jpg" />;
    case "pdf-to-png": return <PdfToImagesTool type="png" />;
    case "extract-images": return <ExtractImagesTool />;
    case "extract-text": return <ExtractTextTool />;
    case "ocr": return <OcrPdfTool />;
    case "word-to-pdf": return <WordToPdfTool />;
    case "excel-to-pdf": return <ExcelToPdfTool />;
    case "powerpoint-to-pdf": return <PowerPointToPdfTool />;
    case "html-to-pdf": return <HtmlToPdfTool />;
    case "epub-to-pdf": return <EpubToPdfTool />;
    case "pdf-to-word": return <PdfToWordTool />;
    case "pdf-to-excel": return <PdfToExcelTool />;
    case "pdf-to-powerpoint": return <PdfToPowerPointTool />;
    case "pdf-to-html": return <PdfToHtmlTool />;
    case "pdf-to-epub": return <PdfToEpubTool />;
    default:
      return null;
  }
}
