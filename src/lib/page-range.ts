// Parse "1,3,5-8" against a max page count, returns 1-based unique sorted pages.
export function parsePageRange(input: string, max: number): number[] {
  const out = new Set<number>();
  const parts = input.split(",").map((s) => s.trim()).filter(Boolean);
  for (const p of parts) {
    const m = p.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      let a = parseInt(m[1], 10);
      let b = parseInt(m[2], 10);
      if (a > b) [a, b] = [b, a];
      for (let i = a; i <= b; i++) if (i >= 1 && i <= max) out.add(i);
    } else if (/^\d+$/.test(p)) {
      const n = parseInt(p, 10);
      if (n >= 1 && n <= max) out.add(n);
    } else {
      throw new Error(`Invalid entry: "${p}"`);
    }
  }
  return [...out].sort((a, b) => a - b);
}

// Parse an explicit order list "3,1,2,4" (allows repeats, must be within range).
export function parsePageOrder(input: string, max: number): number[] {
  const out: number[] = [];
  for (const p of input.split(",").map((s) => s.trim()).filter(Boolean)) {
    if (!/^\d+$/.test(p)) throw new Error(`Invalid page: "${p}"`);
    const n = parseInt(p, 10);
    if (n < 1 || n > max) throw new Error(`Page ${n} out of range 1-${max}`);
    out.push(n);
  }
  return out;
}
