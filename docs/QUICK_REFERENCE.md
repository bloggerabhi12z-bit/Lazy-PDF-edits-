# Word-to-PDF Implementation - Quick Reference

## For Frontend Developers

### Using the Tool
Navigate to `/tools/word-to-pdf` in the application to access the converter.

### Component Location
`src/components/tools/AdvancedTools.tsx` - Lines 1245-1320 (WordToPdfTool)

### Component Props
```typescript
// WordToPdfTool accepts file through drop zone
// Automatically:
// 1. Validates file type and size
// 2. Uploads to backend API
// 3. Tracks progress (0-100%)
// 4. Downloads result on success
```

### Testing Component Locally
```bash
npm run dev
# Navigate to http://localhost:5173/tools/word-to-pdf
# Drag DOCX file or click to select
```

### Common Issues

**Issue**: "LibreOffice not available" error
- **Cause**: LibreOffice not installed on development machine
- **Fix**: `brew install libreoffice` (macOS) or `apt-get install libreoffice` (Linux)

**Issue**: "Please select a valid .docx file"
- **Cause**: File is not DOCX or is corrupted
- **Fix**: Re-save document in Word or LibreOffice

---

## For Backend/DevOps

### API Endpoint
```
POST /.netlify/functions/docx-to-pdf
Content-Type: multipart/form-data

Input: Single DOCX file via "file" field
Output: Binary PDF (200 OK) or JSON error (400/413/500/503)
Timeout: 60 seconds
```

### Function Location
`netlify/functions/docx-to-pdf.mts`

### Deployment Configuration

#### Update netlify.toml
```toml
[build]
command = "apt-get update && apt-get install -y libreoffice && npm run build"
publish = "dist"

[functions]
directory = "netlify/functions"
node_bundler = "esbuild"

[functions."docx-to-pdf"]
timeout = 60
```

#### Deploy
```bash
git push origin main
# Netlify automatically triggers build with LibreOffice installation
```

### Monitoring

**Function Logs:**
- Netlify Dashboard → Functions → docx-to-pdf
- Filter by status code, duration, errors

**Metrics to Track:**
- Invocation count (usage)
- Duration (performance)
- Error count (reliability)
- 4xx/5xx rates (quality)

### Dependencies

**System:**
- LibreOffice (installed via build command)
- Node.js 16+ (for function runtime)

**NPM:**
- No new dependencies added (pure Node.js)

### Environment Variables (Optional)

In Netlify site settings:
```
LIBREOFFICE_TIMEOUT=60000  # milliseconds
MAX_FILE_SIZE=52428800     # bytes (50 MB)
```

---

## For QA/Testing

### Test Case 1: Simple Conversion
```
Input: Simple document.docx (1-2 paragraphs, no formatting)
Expected: PDF renders correctly, text is readable
Command: curl -F "file=@document.docx" http://localhost:8888/.netlify/functions/docx-to-pdf -o output.pdf
```

### Test Case 2: Complex Document
```
Input: Document with images, tables, formatting
Expected: All elements preserved, layout matches original
Command: npm run test:docx
```

### Test Case 3: Edge Cases
```
Test: File too large (>50MB) → 413 error
Test: Invalid DOCX → 400 error
Test: Corrupted ZIP → 400 error
Test: Empty DOCX → should convert successfully
```

### Test Data Sources
```
node_modules/mammoth/test/test-data/
  - simple-list.docx
  - tables.docx
  - single-paragraph.docx
  - underline.docx
  - [and more...]
```

### Success Criteria
- [ ] PDF opens without errors
- [ ] All text is readable
- [ ] Formatting is preserved
- [ ] Images display correctly
- [ ] Tables have correct structure
- [ ] Page size is correct (Letter/A4)
- [ ] No gray bars or artifacts
- [ ] No text clipping or duplication

---

## For Product/Design

### User Experience Flow

```
1. User visits /tools/word-to-pdf
2. User drags DOCX file or clicks to select
3. System validates file type/size
4. Upload begins with progress bar (0-50%)
5. Backend processes file (50-75%)
6. PDF is generated (75-100%)
7. User is prompted to download
8. File is automatically downloaded
```

### Error Messages (User-Facing)

| Error | Message | Action |
|-------|---------|--------|
| Invalid file | "Please select a valid .docx file" | Guide to DOCX format |
| File too large | "File size exceeds 50 MB limit" | Ask to split document |
| Server issue | "Server is not configured for this feature" | Retry or contact support |
| Timeout | "Conversion took too long" | Try simpler document |
| Corrupted | "File appears to be corrupted" | Recover from backup or resave |

### Success Message
"✓ Conversion complete! Your PDF is ready to download."

---

## For Documentation

### Key Files to Reference

1. **Getting Started**: `docs/WORD_TO_PDF_GUIDE.md`
2. **Technical Details**: `docs/DOCX_TO_PDF_IMPLEMENTATION.md`
3. **Deployment**: `docs/NETLIFY_DEPLOYMENT_GUIDE.md`
4. **Implementation Summary**: `docs/IMPLEMENTATION_COMPLETE.md`

### API Documentation

**File**: `netlify/functions/docx-to-pdf.mts`

**Public Endpoint**: `/.netlify/functions/docx-to-pdf`

**Request**:
- Method: POST
- Content-Type: multipart/form-data
- Field name: "file"
- File type: DOCX (.docx)
- Max size: 50 MB

**Response Success (200)**:
```
Content-Type: application/pdf
Body: Binary PDF data
```

**Response Error (400/413/500/503)**:
```json
{
  "error": "Error type",
  "message": "Detailed error message"
}
```

### Architecture Diagram

```
┌─────────────────────────────────────────────────┐
│         Browser / Frontend (React)              │
│  - File upload with drag-drop                   │
│  - Progress tracking (XMLHttpRequest)           │
│  - Result display and download                  │
└──────────────────┬──────────────────────────────┘
                   │
                   │ POST multipart/form-data
                   ▼
┌──────────────────────────────────────────────────┐
│  Netlify Functions (Node.js/Deno)               │
│  /.netlify/functions/docx-to-pdf                │
│  - File validation                              │
│  - LibreOffice detection                        │
│  - Conversion orchestration                     │
│  - Error handling and cleanup                   │
└──────────────────┬───────────────────────────────┘
                   │
                   │ spawn subprocess
                   ▼
┌──────────────────────────────────────────────────┐
│  LibreOffice Headless                           │
│  - Renders DOCX with full fidelity              │
│  - Generates PDF output                         │
│  - Preserves formatting, layout, images         │
└──────────────────────────────────────────────────┘
```

---

## For Deployment Team

### Pre-Deployment Checklist

- [ ] LibreOffice installation in build command
- [ ] Node.js version 16+ configured
- [ ] Function timeout ≥ 60 seconds
- [ ] No hardcoded secrets in code
- [ ] Temporary directory has write permissions
- [ ] Build artifact size < 500MB
- [ ] MIME types configured correctly
- [ ] Error handling verified

### Deployment Steps

1. **Code Review**
   - Check netlify.toml for LibreOffice command
   - Review security measures in docx-to-pdf.mts
   - Verify no secrets or hardcoded paths

2. **Staging Deployment**
   - Deploy to staging environment
   - Verify build includes LibreOffice
   - Test API endpoint
   - Monitor logs for errors

3. **Production Deployment**
   - Deploy to production
   - Monitor error rate for 24 hours
   - Set up alerts for failures
   - Document LibreOffice version installed

### Rollback Plan

If issues occur:
1. Revert netlify.toml to previous version
2. Revert docx-to-pdf.mts to previous version
3. Monitor metrics for improvement
4. Investigate root cause
5. Deploy fix

### Monitoring Commands

```bash
# Check function logs
netlify functions:log docx-to-pdf --lines=100

# Test endpoint
curl -X POST \
  -F "file=@test.docx" \
  https://your-site.netlify.app/.netlify/functions/docx-to-pdf \
  -o output.pdf && file output.pdf

# Check LibreOffice version (in build logs)
libreoffice --version
```

---

## Quick Links

- **Live Tool**: https://your-domain.com/tools/word-to-pdf
- **API Endpoint**: https://your-domain.com/.netlify/functions/docx-to-pdf
- **GitHub**: bloggerabhi12z-bit/Lazy-PDF-edits-
- **Netlify Dashboard**: https://app.netlify.com
- **LibreOffice Docs**: https://help.libreoffice.org/

---

## Contact & Support

### Issues with Conversions
→ See `docs/DOCX_TO_PDF_IMPLEMENTATION.md` Troubleshooting

### Deployment Problems
→ See `docs/NETLIFY_DEPLOYMENT_GUIDE.md` or Netlify Support

### Feature Requests
→ Create an issue with expected behavior and DOCX example

### Technical Questions
→ Review `docs/WORD_TO_PDF_GUIDE.md` or code comments
