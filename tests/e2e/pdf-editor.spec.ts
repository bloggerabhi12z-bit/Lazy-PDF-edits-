import { test, expect, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import fs from 'node:fs/promises';
import path from 'node:path';

const BLUE_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAFAAAAAoCAIAAADmAupWAAAATUlEQVR4nO3PQQ0AMAwDsUIrf1IdiUl5xNIBOM/sdZU/AAYGBgYGBq4pfwAMDAwMDAxcU/4AGBgYGBgYuKb8ATAwMDAwMHBN+QNg4J89B36UYvVg1ocAAAAASUVORK5CYII=';

async function writeFixture(dir: string) {
  await fs.mkdir(dir, { recursive: true });
  const sourcePdf = path.join(dir, 'source.pdf');
  const image = path.join(dir, 'blue.png');
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  await fs.writeFile(sourcePdf, await doc.save());
  await fs.writeFile(image, Buffer.from(BLUE_PNG, 'base64'));
  return { sourcePdf, image };
}

async function openEditor(page: Page, pdfPath: string) {
  await page.goto('/edit-pdf');
  await page.locator('input[type="file"]').first().setInputFiles(pdfPath);
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible();
  await expect(page.locator('[data-page-index="0"]')).toBeVisible();
}

async function pageBox(page: Page) {
  const box = await page.locator('[data-page-index="0"]').boundingBox();
  if (!box) throw new Error('PDF page was not measurable');
  return box;
}

async function visibleColorBounds(page: Page, color: 'blue' | 'red', region?: { left: number; top: number; right: number; bottom: number }) {
  return page.locator('[data-page-index="0"] canvas').evaluate((canvas, args) => {
    const rect = canvas.getBoundingClientRect();
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Canvas context unavailable');
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    const bounds = args.region ? {
      left: Math.max(0, Math.floor(args.region.left * sx)),
      top: Math.max(0, Math.floor(args.region.top * sy)),
      right: Math.min(canvas.width, Math.ceil(args.region.right * sx)),
      bottom: Math.min(canvas.height, Math.ceil(args.region.bottom * sy)),
    } : { left: 0, top: 0, right: canvas.width, bottom: canvas.height };
    let left = canvas.width, top = canvas.height, right = -1, bottom = -1, count = 0;
    for (let y = bounds.top; y < bounds.bottom; y += 1) {
      for (let x = bounds.left; x < bounds.right; x += 1) {
        const i = (y * canvas.width + x) * 4;
        const r = image.data[i], g = image.data[i + 1], b = image.data[i + 2], a = image.data[i + 3];
        const match = color === 'blue'
          ? a > 220 && b > 180 && r < 90 && g < 150
          : a > 200 && r > 170 && g < 130 && b < 130;
        if (!match) continue;
        count += 1;
        left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
      }
    }
    return {
      count,
      left: left < 0 ? null : left / sx,
      top: top < 0 ? null : top / sy,
      right: right < 0 ? null : right / sx,
      bottom: bottom < 0 ? null : bottom / sy,
    };
  }, { color, region });
}

test('PDF editor exports text, image, and shape at matching positions', async ({ page }, testInfo) => {
  const fixture = await writeFixture(testInfo.outputPath('fixtures'));
  await openEditor(page, fixture.sourcePdf);

  await page.getByRole('button', { name: 'Text' }).click();
  let box = await pageBox(page);
  await page.mouse.click(box.x + 150, box.y + 150);
  await expect(page.locator('[data-el-content]')).toBeVisible();
  await page.locator('[data-el-content]').fill('E2E TEST');
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('[data-el-content]')).toHaveCount(0);

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Image' }).click();
  await (await chooser).setFiles(fixture.image);
  await expect(page.locator('[data-element-id]')).toHaveCount(2);

  await page.getByRole('button', { name: 'Shapes' }).click();
  await page.getByRole('button', { name: 'Rectangle' }).click();
  box = await pageBox(page);
  await page.mouse.move(box.x + 300, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 420, box.y + 380);
  await page.mouse.up();
  await expect(page.locator('[data-element-id]')).toHaveCount(3);

  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('PDF saved')).toBeVisible();
  await page.getByRole('button', { name: 'Download PDF' }).click();
  const download = await downloadEvent;
  const savedPath = await download.path();
  if (!savedPath) throw new Error('Saved PDF download path unavailable');

  await page.getByRole('button', { name: 'New PDF' }).click();
  await openEditor(page, savedPath);

  await page.getByRole('button', { name: 'Search' }).click();
  await page.locator('input[placeholder="Search in document…"]').fill('E2E TEST');
  await expect(page.getByText(/1 \/ 1/)).toBeVisible();

  const canvasRect = await page.locator('[data-page-index="0"] canvas').boundingBox();
  if (!canvasRect) throw new Error('Saved PDF canvas was not measurable');
  const scale = canvasRect.width / 595;

  const blue = await visibleColorBounds(page, 'blue');
  expect(blue.count).toBeGreaterThan(100);
  expect(Math.abs((blue.left ?? 0) - 60 * scale)).toBeLessThanOrEqual(1);
  expect(Math.abs((blue.top ?? 0) - 60 * scale)).toBeLessThanOrEqual(1);

  const red = await visibleColorBounds(page, 'red', { left: 280, top: 280, right: 440, bottom: 410 });
  expect(red.count).toBeGreaterThan(20);
  expect(Math.abs((red.left ?? 0) - 300 * scale)).toBeLessThanOrEqual(1);
  expect(Math.abs((red.top ?? 0) - 300 * scale)).toBeLessThanOrEqual(1);
});

test('interrupted element drag does not commit a partial move', async ({ page }, testInfo) => {
  const fixture = await writeFixture(testInfo.outputPath('fixtures-interrupted'));
  await openEditor(page, fixture.sourcePdf);
  await page.getByRole('button', { name: 'Shapes' }).click();
  await page.getByRole('button', { name: 'Rectangle' }).click();
  const box = await pageBox(page);
  await page.mouse.move(box.x + 180, box.y + 180);
  await page.mouse.down();
  await page.mouse.move(box.x + 260, box.y + 240);
  await page.mouse.up();

  const element = page.locator('[data-element-id]').first();
  await element.click();
  const before = await element.boundingBox();
  if (!before) throw new Error('Shape was not measurable');
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 + 80, before.y + before.height / 2 + 60);
  await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true })));
  const after = await element.boundingBox();
  if (!after) throw new Error('Shape disappeared after pointercancel');
  expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(0.5);
});


test('form controls export as real AcroForm fields', async ({ page }, testInfo) => {
  const fixture = await writeFixture(testInfo.outputPath('fixtures-form'));
  await openEditor(page, fixture.sourcePdf);
  await page.getByRole('button', { name: 'More tools' }).click();
  await page.getByRole('button', { name: 'field-checkbox' }).click();
  const box = await pageBox(page);
  await page.mouse.click(box.x + 220, box.y + 220);

  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('PDF saved')).toBeVisible();
  await page.getByRole('button', { name: 'Download PDF' }).click();
  const download = await downloadEvent;
  const savedPath = await download.path();
  if (!savedPath) throw new Error('Saved PDF download path unavailable');

  const bytes = await fs.readFile(savedPath);
  const doc = await PDFDocument.load(bytes);
  const fields = doc.getForm().getFields();
  expect(fields).toHaveLength(1);
  expect(fields[0]?.getName()).toContain('checkbox');
});
