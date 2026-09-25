export type Rotation = 0 | 90 | 180 | 270;

export function normalizeRotation(rotation: number): Rotation {
  const r = ((Math.round(rotation) % 360) + 360) % 360;
  return (r === 90 || r === 180 || r === 270 ? r : 0) as Rotation;
}

export function rotatePointToScreen(
  x: number,
  y: number,
  rotation: number,
  pageWidth: number,
  pageHeight: number,
): { x: number; y: number } {
  switch (normalizeRotation(rotation)) {
    case 90:
      return { x: pageHeight - y, y: x };
    case 180:
      return { x: pageWidth - x, y: pageHeight - y };
    case 270:
      return { x: y, y: pageWidth - x };
    default:
      return { x, y };
  }
}

export function rotatePointFromScreen(
  screenX: number,
  screenY: number,
  rotation: number,
  pageWidth: number,
  pageHeight: number,
): { x: number; y: number } {
  switch (normalizeRotation(rotation)) {
    case 90:
      return { x: screenY, y: pageHeight - screenX };
    case 180:
      return { x: pageWidth - screenX, y: pageHeight - screenY };
    case 270:
      return { x: pageWidth - screenY, y: screenX };
    default:
      return { x: screenX, y: screenY };
  }
}

export function rotateVector(dx: number, dy: number, angleDegrees: number): { dx: number; dy: number } {
  const rad = (angleDegrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { dx: dx * cos - dy * sin, dy: dx * sin + dy * cos };
}

export function elementScreenRect(
  x: number,
  y: number,
  width: number,
  height: number,
  rotation: Rotation,
  pageWidth: number,
  pageHeight: number,
  scale: number,
) {
  const center = rotatePointToScreen(x + width / 2, y + height / 2, rotation, pageWidth, pageHeight);
  return {
    left: center.x * scale - (width * scale) / 2,
    top: center.y * scale - (height * scale) / 2,
    width: width * scale,
    height: height * scale,
  };
}

export function pdfBottomY(yTop: number, height: number, pageHeight: number) {
  return pageHeight - yTop - height;
}

export function screenPointToPdf(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number },
  scale: number,
  rotation: Rotation,
  pageWidth: number,
  pageHeight: number,
) {
  return rotatePointFromScreen(
    (clientX - rect.left) / scale,
    (clientY - rect.top) / scale,
    rotation,
    pageWidth,
    pageHeight,
  );
}
