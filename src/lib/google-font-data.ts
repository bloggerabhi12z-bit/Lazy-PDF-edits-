const cache = new Map<string, string>();

export async function loadGoogleFontData(family: string): Promise<string> {
  const cached = cache.get(family);
  if (cached) return cached;
  const cssUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}:wght@400;700&display=swap`;
  const css = await fetch(cssUrl).then(async (response) => {
    if (!response.ok) throw new Error(`Could not load ${family}.`);
    return response.text();
  });
  const urls = [...css.matchAll(/url\((https:[^)]+)\)/g)].map((match) => match[1]);
  const url = urls[0];
  if (!url) throw new Error(`No embeddable font was returned for ${family}.`);
  const bytes = new Uint8Array(await fetch(url).then(async (response) => {
    if (!response.ok) throw new Error(`Could not download ${family}.`);
    return response.arrayBuffer();
  }));
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  const data = `data:font/woff2;base64,${btoa(binary)}`;
  cache.set(family, data);
  return data;
}
