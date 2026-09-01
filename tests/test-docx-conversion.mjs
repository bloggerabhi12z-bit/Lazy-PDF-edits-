#!/usr/bin/env node

/**
 * Local testing helper for DOCX→PDF conversion
 * Usage: node tests/test-docx-conversion.mjs <path-to-docx-file>
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Test configuration
const TEST_TIMEOUT = 60000; // 60 seconds
const TEST_FILES = [
  "node_modules/mammoth/test/test-data/simple-list.docx",
  "node_modules/mammoth/test/test-data/tables.docx",
  "node_modules/mammoth/test/test-data/single-paragraph.docx",
];

async function testFileUpload(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`❌ File not found: ${filePath}`);
    return false;
  }

  const fileName = path.basename(filePath);
  const fileSize = fs.statSync(filePath).size;

  console.log(`\n📄 Testing: ${fileName} (${(fileSize / 1024).toFixed(2)} KB)`);

  try {
    // Create FormData with the file
    const fileContent = fs.readFileSync(filePath);
    const boundary = "----LazyPDFTestBoundary" + Math.random().toString(36).substring(2);
    const CRLF = "\r\n";

    // Build multipart body
    let body = `--${boundary}${CRLF}`;
    body += `Content-Disposition: form-data; name="file"; filename="${fileName}"${CRLF}`;
    body += `Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document${CRLF}${CRLF}`;

    const bodyStart = Buffer.from(body);
    const boundaryEnd = Buffer.from(`${CRLF}--${boundary}--`);
    const fullBody = Buffer.concat([bodyStart, fileContent, boundaryEnd]);

    // Make request to local Netlify functions
    const url = "http://localhost:8888/.netlify/functions/docx-to-pdf";

    console.log(`📡 Sending request to ${url}...`);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body: fullBody,
    });

    console.log(`📊 Response status: ${response.status}`);

    if (response.status === 200) {
      const pdfBuffer = await response.arrayBuffer();
      const outputName = `${path.basename(filePath, ".docx")}-output.pdf`;
      const outputPath = path.join(dirname(filePath), outputName);

      fs.writeFileSync(outputPath, Buffer.from(pdfBuffer));
      console.log(`✅ Success! PDF saved to: ${outputPath}`);
      console.log(`   PDF size: ${(pdfBuffer.byteLength / 1024).toFixed(2)} KB`);
      return true;
    } else {
      const errorText = await response.text();
      try {
        const error = JSON.parse(errorText);
        console.error(`❌ Conversion failed: ${error.error}`);
        console.error(`   ${error.message}`);
      } catch {
        console.error(`❌ Conversion failed: ${errorText}`);
      }
      return false;
    }
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    return false;
  }
}

async function runTests() {
  console.log("🧪 DOCX→PDF Conversion Test Suite");
  console.log("==================================\n");

  // Check if running locally
  console.log("ℹ️  Make sure to run: npm run dev");
  console.log("ℹ️  And ensure LibreOffice is installed on your system\n");

  let results = {
    total: 0,
    passed: 0,
    failed: 0,
  };

  // Use provided file or test defaults
  const filesToTest =
    process.argv.length > 2 ? process.argv.slice(2) : TEST_FILES;

  for (const file of filesToTest) {
    results.total++;
    const success = await testFileUpload(file);
    if (success) {
      results.passed++;
    } else {
      results.failed++;
    }
  }

  // Summary
  console.log("\n📋 Test Summary");
  console.log("===============");
  console.log(`Total: ${results.total}`);
  console.log(`✅ Passed: ${results.passed}`);
  console.log(`❌ Failed: ${results.failed}`);
  console.log(`Success rate: ${((results.passed / results.total) * 100).toFixed(1)}%`);

  process.exit(results.failed > 0 ? 1 : 0);
}

// Run tests
runTests().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
