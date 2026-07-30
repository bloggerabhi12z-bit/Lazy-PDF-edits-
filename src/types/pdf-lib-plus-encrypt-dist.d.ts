declare module "pdf-lib-plus-encrypt/dist/pdf-lib-plus-encrypt.esm.js" {
  import type { PDFDocument as BasePDFDocument } from "pdf-lib";

  type EncryptedDocument = BasePDFDocument & {
    encrypt: (options: {
      userPassword: string;
      ownerPassword?: string;
      permissions?: {
        printing?: boolean | "lowResolution" | "highResolution";
        modifying?: boolean;
        copying?: boolean;
        annotating?: boolean;
        fillingForms?: boolean;
        contentAccessibility?: boolean;
        documentAssembly?: boolean;
      };
    }) => Promise<void>;
  };

  export const PDFDocument: {
    load: (pdf: string | Uint8Array | ArrayBuffer, options?: unknown) => Promise<EncryptedDocument>;
  };
}
