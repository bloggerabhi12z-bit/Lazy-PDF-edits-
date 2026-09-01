# Netlify Deployment Setup for LibreOffice Support

This guide explains how to set up the Lazy PDF application on Netlify with LibreOffice support for DOCX→PDF conversion.

## Option 1: Using Build Scripts (Recommended for Netlify)

### Step 1: Create Build Script

Create `netlify/build-scripts/install-libreoffice.sh`:

```bash
#!/bin/bash
set -e

echo "Installing LibreOffice..."

# Update package manager
apt-get update -qq

# Install LibreOffice headless
apt-get install -y -qq libreoffice

# Verify installation
LO_VERSION=$(libreoffice --version)
echo "✓ LibreOffice installed: $LO_VERSION"

# Clean up to reduce deployment size
apt-get clean
rm -rf /var/lib/apt/lists/*

echo "Build environment ready for DOCX conversion"
```

### Step 2: Update netlify.toml

Modify your `netlify.toml` to install LibreOffice during build:

```toml
[build]
publish = "dist"
command = "apt-get update && apt-get install -y libreoffice && npm run build"

[functions]
directory = "netlify/functions"
node_bundler = "esbuild"

[[headers]]
for = "/*"
[headers.values]
X-Content-Type-Options = "nosniff"
X-Frame-Options = "DENY"
Referrer-Policy = "strict-origin-when-cross-origin"
Permissions-Policy = "camera=(), microphone=(), geolocation=()"
```

### Step 3: Deploy

Push your changes to the connected Git repository:

```bash
git add netlify.toml
git commit -m "Configure LibreOffice for DOCX→PDF conversion"
git push origin main
```

Netlify will automatically trigger a build with LibreOffice installed.

## Option 2: Docker Deployment

For maximum control and faster deploys, use Docker:

### Step 1: Create Dockerfile

```dockerfile
FROM node:20-bullseye

# Install LibreOffice
RUN apt-get update && \
    apt-get install -y libreoffice && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy source
COPY package*.json ./
RUN npm ci

COPY . .

# Build
RUN npm run build

# For Netlify
ENV NETLIFY_BUILD_COMPLETE=true

EXPOSE 8888
CMD ["npm", "start"]
```

### Step 2: Configure Netlify with Docker

In Netlify dashboard:

1. Connect your repository
2. Go to Build & Deploy → Build settings
3. Set build command to: `docker build -t lazy-pdf . && npm run build`
4. Add environment variable `DOCKER_BUILDKIT=1`

## Option 3: Using Netlify Build Plugins

Create a custom Netlify Build plugin at `netlify/plugins/install-libreoffice/index.js`:

```javascript
module.exports = {
  onPreBuild: async ({ utils: { build } }) => {
    console.log("Installing LibreOffice...");
    
    try {
      // Check if already installed
      const { execSync } = require("child_process");
      try {
        execSync("which libreoffice");
        console.log("✓ LibreOffice already installed");
        return;
      } catch {
        // Not installed, proceed
      }

      // Install LibreOffice
      execSync("apt-get update && apt-get install -y libreoffice", {
        stdio: "inherit"
      });
      
      // Verify
      const version = execSync("libreoffice --version").toString();
      console.log(`✓ LibreOffice installed: ${version}`);
    } catch (error) {
      build.failBuild(`Failed to install LibreOffice: ${error.message}`);
    }
  }
};
```

Then add to `netlify.toml`:

```toml
[[plugins]]
package = "./netlify/plugins/install-libreoffice"
```

## Verification

After deployment, verify LibreOffice is available:

### Check Deployment Logs

1. Go to Netlify Dashboard
2. Select your site
3. Go to Deploys
4. Click on the latest deploy
5. Look for "Installing LibreOffice" in the logs

### Test the API

Once deployed, test the DOCX→PDF endpoint:

```bash
curl -X POST \
  -F "file=@sample.docx" \
  https://your-site.netlify.app/.netlify/functions/docx-to-pdf \
  -o output.pdf
```

Or use the web interface at:
```
https://your-site.netlify.app/tools/word-to-pdf
```

## Troubleshooting

### "LibreOffice not available" after deployment

1. Check build logs for installation errors
2. Ensure build command completes successfully
3. Check Netlify Functions environment:
   - Go to Functions settings
   - Verify Node.js version is 16+
   - Check timeout is at least 60 seconds

### Build size too large

LibreOffice adds ~500MB to the build. To reduce:

1. Use Docker deployment (caches layers)
2. Uninstall unnecessary LibreOffice components:

```bash
apt-get install -y --no-install-recommends libreoffice
```

### Conversion timeout

If conversions timeout (> 60 seconds):

1. Increase function timeout in netlify.toml:
```toml
[functions."docx-to-pdf"]
  timeout = 120
```

2. Optimize DOCX files:
   - Reduce image resolution
   - Remove embedded objects
   - Simplify formatting

### Memory issues

If you see memory errors:

1. Increase Netlify Functions memory allocation (if available)
2. Reduce allowed file size in API
3. Process files sequentially (no parallel conversions)

## Performance Optimization

### For better performance:

1. **Reduce build size:**
   ```bash
   apt-get install -y --no-install-recommends \
     libreoffice-calc \
     libreoffice-writer
   ```

2. **Cache LibreOffice between builds:**
   - Use Docker for consistent environment
   - Consider Lambda layers for AWS deployment

3. **Monitor function usage:**
   - Set up CloudWatch logs
   - Monitor invocation count and duration
   - Set alerts for failures

## Alternative: Using Cloud Conversion APIs

If Netlify doesn't support your needs, consider using cloud APIs:

### CloudConvert

Modify the backend to use CloudConvert API:

```typescript
import axios from "axios";

const convertWithCloudConvert = async (docxBuffer: Buffer) => {
  const formData = new FormData();
  formData.append("file", new Blob([docxBuffer]), "document.docx");
  formData.append("output_format", "pdf");

  const response = await axios.post(
    "https://api.cloudconvert.com/v2/convert",
    formData,
    {
      headers: {
        "Authorization": `Bearer ${process.env.CLOUDCONVERT_API_KEY}`
      }
    }
  );

  return response.data.download;
};
```

### Zamzar, Online-Convert, or Similar

Similar approach with their respective APIs.

## Environment Variables

Add these to Netlify site settings:

```
LIBREOFFICE_TIMEOUT=60000  # ms
MAX_FILE_SIZE=52428800      # 50 MB
TEMP_DIR=/tmp
```

Then use in function:

```typescript
const timeout = parseInt(process.env.LIBREOFFICE_TIMEOUT || "60000");
const maxSize = parseInt(process.env.MAX_FILE_SIZE || String(50 * 1024 * 1024));
```

## Monitoring and Logging

### Enable detailed logging:

In `netlify/functions/docx-to-pdf.mts`, add:

```typescript
console.log("Conversion started:", {
  fileSize: docxBuffer.length,
  timestamp: new Date().toISOString()
});
```

Monitor in Netlify Functions logs:
- Netlify Dashboard → Functions → View logs
- Or use `netlify functions:invoke docx-to-pdf`

## Local Development

For local testing before deployment:

```bash
# Install LibreOffice locally
brew install libreoffice  # macOS
sudo apt-get install libreoffice  # Linux
# Download and install from https://www.libreoffice.org/ (Windows)

# Run development server
npm run dev

# Test function
curl -X POST \
  -F "file=@sample.docx" \
  http://localhost:8888/.netlify/functions/docx-to-pdf \
  -o output.pdf
```

## Cost Considerations

### Netlify Functions (Pay-as-you-go)

- First 125,000 function invocations per month: Free
- Additional: $0.00000200 per invocation
- Bandwidth: Pay per GB used

### With CloudConvert

- Free tier: 25 conversions/month
- Pro tier: ~$9.99/month for 500 conversions

Choose based on your expected usage.
