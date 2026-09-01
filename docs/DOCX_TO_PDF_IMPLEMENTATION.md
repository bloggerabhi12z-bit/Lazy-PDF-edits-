# Word to PDF Converter Implementation Guide

## Architecture

The Word-to-PDF converter is implemented using a backend-based approach with LibreOffice headless conversion for maximum visual fidelity.

### Components

1. **Backend API**: `netlify/functions/docx-to-pdf.mts`
   - Handles DOCX file uploads via multipart form data
   - Uses LibreOffice headless mode for conversion
   - Validates file type and size
   - Returns PDF as binary with proper headers
   - Includes comprehensive error handling and cleanup

2. **Frontend Component**: `src/components/tools/AdvancedTools.tsx` → `WordToPdfTool`
   - File upload with drag-and-drop support
   - Progress tracking (uploading and converting)
   - Error handling with user-friendly messages
   - Automatic download of converted PDF

## Requirements

### LibreOffice Installation

The conversion requires LibreOffice to be installed on the server. The application will attempt to detect LibreOffice at:

- `/usr/bin/libreoffice` (Linux)
- `/usr/bin/soffice` (Linux alternative)
- `C:\Program Files\LibreOffice\program\soffice.exe` (Windows)
- `C:\Program Files (x86)\LibreOffice\program\soffice.exe` (Windows 32-bit)
- `libreoffice` (via PATH - any platform)

### Netlify Deployment

#### Option 1: Using Netlify's Build Environment

Netlify's build environment has Ubuntu/Linux as the base. LibreOffice can be installed via the build.command or a custom build script.

**Setup steps:**

1. Create a `netlify/build-scripts/install-libreoffice.sh`:
```bash
#!/bin/bash
set -e

# Update package manager
apt-get update -qq

# Install LibreOffice
apt-get install -y -qq libreoffice

# Verify installation
libreoffice --version

echo "LibreOffice installation complete"
```

2. Update `netlify.toml` to include the script:
```toml
[build]
publish = "dist"
command = "./netlify/build-scripts/install-libreoffice.sh && npm run build"

[functions]
directory = "netlify/functions"
node_bundler = "esbuild"
```

#### Option 2: Using Netlify Build Plugins

Alternatively, use a Netlify Build plugin for automatic LibreOffice setup.

#### Option 3: Docker-based Deployment

For maximum control, deploy using Docker with LibreOffice pre-installed:

```dockerfile
FROM node:20-bullseye

# Install LibreOffice
RUN apt-get update && apt-get install -y libreoffice && rm -rf /var/lib/apt/lists/*

# Application setup
WORKDIR /app
COPY . .
RUN npm ci
RUN npm run build

EXPOSE 8888
CMD ["npm", "run", "dev"]
```

## API Endpoint

### POST `/.netlify/functions/docx-to-pdf`

Converts a DOCX file to PDF.

**Request:**
- Method: `POST`
- Content-Type: `multipart/form-data`
- Body: File uploaded as `file` field

**Response (Success):**
- Status: `200`
- Content-Type: `application/pdf`
- Body: Binary PDF data

**Response (Error):**
- Status: `400`, `413`, `500`, or `503` (depending on error)
- Content-Type: `application/json`
- Body:
```json
{
  "error": "Error type",
  "message": "Human-readable error message"
}
```

**Error Codes:**

| Status | Error | Meaning |
|--------|-------|---------|
| 400 | Bad request | Missing or invalid file |
| 400 | Invalid file type | Not a valid DOCX file |
| 413 | Payload too large | File exceeds 50 MB |
| 500 | Internal server error | Unexpected error |
| 503 | LibreOffice not available | LibreOffice not installed |

## Conversion Features

The converter preserves the following DOCX features:

- ✅ Page size and orientation
- ✅ Margins and sections
- ✅ Fonts, sizes, styles (bold, italic, underline, color)
- ✅ Paragraph formatting (alignment, spacing, indentation)
- ✅ Bullets and numbered lists
- ✅ Tables with borders and formatting
- ✅ Images (embedded)
- ✅ Headers and footers
- ✅ Page breaks and section breaks
- ✅ Hyperlinks
- ⚠️ Complex layouts (columns, text boxes) - may have limitations
- ⚠️ Advanced features (tracked changes, comments) - not supported

## Performance

- **Timeout**: 60 seconds per conversion
- **File Size Limit**: 50 MB
- **Maximum Concurrent**: Dependent on server resources

## Security Considerations

1. **File Validation**
   - MIME type checking
   - ZIP signature validation (DOCX is a ZIP file)
   - File size limits

2. **Process Safety**
   - Timeouts prevent hung processes
   - Isolated temporary directories
   - Automatic cleanup of temporary files
   - No arbitrary shell execution

3. **Resource Management**
   - Process stdio captured and not piped to terminal
   - Temporary files cleaned up after conversion
   - Memory limits via OS process management

## Local Development

### Prerequisites

Ensure LibreOffice is installed:

**macOS:**
```bash
brew install libreoffice
```

**Ubuntu/Debian:**
```bash
sudo apt-get install libreoffice
```

**Windows:**
Download and install from https://www.libreoffice.org/download/

### Running Locally

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

The API will be available at `http://localhost:8888/.netlify/functions/docx-to-pdf` during development.

## Testing

### Unit Tests

Test the backend function with curl:

```bash
curl -X POST \
  -F "file=@test.docx" \
  http://localhost:8888/.netlify/functions/docx-to-pdf \
  -o output.pdf
```

### Integration Tests

The frontend component can be tested via the UI at `/tools/word-to-pdf`

### Regression Testing

Key test cases:

1. Simple single-page DOCX
2. Multi-page document with headers/footers
3. Document with tables
4. Document with images
5. Document with various fonts and styles
6. Large documents (> 10 MB)
7. Corrupted DOCX files
8. Non-DOCX files

## Troubleshooting

### "LibreOffice not available" Error

**Cause**: LibreOffice is not installed on the deployment server.

**Solution**:
1. Verify LibreOffice is installed: `which libreoffice`
2. Check Netlify build logs for installation errors
3. Ensure build command includes LibreOffice installation
4. Restart deployment after installation changes

### Conversion Timeout

**Cause**: Document is very complex or server is overloaded.

**Solution**:
1. Try with a simpler document
2. Optimize DOCX file (reduce images, complexity)
3. Check server resources/logs

### "Invalid file type" Error

**Cause**: File is not a valid DOCX document.

**Solution**:
1. Verify file is saved as `.docx` format (not `.doc`)
2. Try re-saving the document in LibreOffice or Word
3. Check file is not corrupted

### PDF is Empty

**Cause**: LibreOffice failed to process the DOCX.

**Solution**:
1. Check DOCX file for corruption
2. Try opening in LibreOffice/Word locally
3. Simplify document content
4. Check server logs for LibreOffice errors

## Future Improvements

1. **Progress Streaming**: Return progress events for large files
2. **Batch Processing**: Support multiple file conversions
3. **Format Options**: Allow PDF optimization settings
4. **Async Processing**: Queue long-running conversions
5. **Caching**: Cache frequently converted documents
6. **Monitoring**: Add metrics and performance tracking
7. **Alternative Engines**: Support Pandoc or other converters

## References

- [LibreOffice Headless Documentation](https://help.libreoffice.org/latest/en-US/text/shared/guide/headless.html)
- [DOCX Format Specification](http://www.ecma-international.org/publications/standards/Ecma-376.htm)
- [Netlify Functions Documentation](https://docs.netlify.com/functions/overview/)
